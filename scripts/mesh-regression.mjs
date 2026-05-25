import fs from 'node:fs';

const args = new Set(process.argv.slice(2));
const update = args.has('--update');
const jsonOutput = args.has('--json');

const wasmPath = new URL('../public/voxel_core.wasm', import.meta.url);
const baselinePath = new URL('../docs/mesh-quality-baseline.json', import.meta.url);
const bytes = fs.readFileSync(wasmPath);
const { instance } = await WebAssembly.instantiate(bytes, {});
const e = instance.exports;

const required = [
  'memory',
  'generate_chunk',
  'mesh_cached_chunk',
  'apply_subtract_sphere_to_density',
  'apply_subtract_sphere_to_density_falloff',
  'apply_add_sphere_to_density',
  'apply_subtract_box_to_density',
  'apply_smooth_sphere_to_density',
  'apply_flatten_sphere_to_density',
  'get_vertex_ptr',
  'get_index_ptr',
  'get_density_ptr',
  'get_vertex_count',
  'get_index_count',
  'get_density_count',
  'get_vertex_stride',
  'get_density_scale',
  'get_mesher_id',
  'get_chunk_lod',
  'get_cell_size',
  'get_chunk_world_size',
  'get_chunk_n',
  'get_overflow',
  'get_terrain_height',
  'clear_edits',
];
for (const name of required) {
  if (!(name in e)) throw new Error(`Missing WASM export: ${name}`);
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

function fnv1a64(bytesView) {
  let hash = FNV_OFFSET;
  for (const byte of bytesView) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * FNV_PRIME);
  }
  return `0x${hash.toString(16).padStart(16, '0')}`;
}

function readU16LE(bytesView, offset) {
  return bytesView[offset] | (bytesView[offset + 1] << 8);
}

function densityView() {
  return new Int16Array(e.memory.buffer, e.get_density_ptr(), e.get_density_count());
}

function densityBytes() {
  const density = densityView();
  return new Uint8Array(density.buffer, density.byteOffset, density.byteLength);
}

function clampI16(value) {
  return Math.max(-32768, Math.min(32767, Math.round(value)));
}

function writeDensityField(field) {
  const density = densityView();
  const scale = e.get_density_scale();
  const n = e.get_chunk_n() + 1;
  let i = 0;
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        density[i++] = clampI16(field(x, y, z) * scale);
      }
    }
  }
}

function copyDensity() {
  return new Int16Array(densityView());
}

function restoreDensity(samples) {
  densityView().set(samples);
}

function edgeKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function triangleKey(a, b, c) {
  return [a, b, c].sort((x, y) => x - y).join(':');
}

function captureMesh(name, mode) {
  const vertexCount = e.get_vertex_count();
  const indexCount = e.get_index_count();
  const vertexStride = e.get_vertex_stride();
  if (vertexCount <= 0 || indexCount <= 0) throw new Error(`${name} generated an empty mesh`);
  if (indexCount % 3 !== 0) throw new Error(`${name} index count is not divisible by 3`);
  if (e.get_overflow() !== 0) throw new Error(`${name} overflowed the WASM mesh buffers`);

  const vertexBytes = new Uint8Array(e.memory.buffer, e.get_vertex_ptr(), vertexCount * vertexStride);
  const indices = new Uint32Array(e.memory.buffer, e.get_index_ptr(), indexCount);
  const indexBytes = new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength);
  const edgeCounts = new Map();
  const triangleCounts = new Map();
  let invalidIndices = 0;
  let degenerateTriangles = 0;
  let materialByteSum = 0;

  for (let i = 0; i < vertexCount; i++) {
    const offset = i * vertexStride;
    materialByteSum += vertexBytes[offset + 12] + vertexBytes[offset + 13] + vertexBytes[offset + 14] + vertexBytes[offset + 15];
  }

  for (let i = 0; i < indexCount; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];
    if (a >= vertexCount || b >= vertexCount || c >= vertexCount) {
      invalidIndices++;
      continue;
    }

    const aOffset = a * vertexStride;
    const bOffset = b * vertexStride;
    const cOffset = c * vertexStride;
    const ax = readU16LE(vertexBytes, aOffset);
    const ay = readU16LE(vertexBytes, aOffset + 2);
    const az = readU16LE(vertexBytes, aOffset + 4);
    const bx = readU16LE(vertexBytes, bOffset);
    const by = readU16LE(vertexBytes, bOffset + 2);
    const bz = readU16LE(vertexBytes, bOffset + 4);
    const cx = readU16LE(vertexBytes, cOffset);
    const cy = readU16LE(vertexBytes, cOffset + 2);
    const cz = readU16LE(vertexBytes, cOffset + 4);
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const crossX = aby * acz - abz * acy;
    const crossY = abz * acx - abx * acz;
    const crossZ = abx * acy - aby * acx;
    if (crossX === 0 && crossY === 0 && crossZ === 0) degenerateTriangles++;

    for (const key of [edgeKey(a, b), edgeKey(b, c), edgeKey(c, a)]) {
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
    const triKey = triangleKey(a, b, c);
    triangleCounts.set(triKey, (triangleCounts.get(triKey) ?? 0) + 1);
  }

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  for (const count of edgeCounts.values()) {
    if (count === 1) boundaryEdges++;
    if (count > 2) nonManifoldEdges++;
  }
  let duplicateTriangles = 0;
  for (const count of triangleCounts.values()) {
    if (count > 1) duplicateTriangles += count - 1;
  }

  const capture = {
    name,
    mode,
    vertices: vertexCount,
    indices: indexCount,
    triangles: indexCount / 3,
    boundaryEdges,
    nonManifoldEdges,
    invalidIndices,
    degenerateTriangles,
    duplicateTriangles,
    materialByteSum,
    lod: e.get_chunk_lod(),
    cellSize: e.get_cell_size(),
    chunkWorldSize: e.get_chunk_world_size(),
    densityHash: fnv1a64(densityBytes()),
    vertexHash: fnv1a64(vertexBytes),
    indexHash: fnv1a64(indexBytes),
  };

  if (invalidIndices > 0 || duplicateTriangles > 0 || nonManifoldEdges > 0) {
    throw new Error(`${name} mesh quality failed: ${JSON.stringify({
      invalidIndices,
      degenerateTriangles,
      duplicateTriangles,
      nonManifoldEdges,
    })}`);
  }
  return capture;
}

function proceduralCapture(name, cx, cy, cz, lod = 0) {
  e.clear_edits();
  e.generate_chunk(cx, cy, cz, lod);
  return captureMesh(name, 'procedural');
}

function editedCapture(name, cx, cy, cz, edit) {
  e.clear_edits();
  e.generate_chunk(cx, cy, cz, 0);
  const samples = copyDensity();
  const x = cx * 32 + 16;
  const z = cz * 32 + 16;
  const y = e.get_terrain_height(x, z) - 2;
  restoreDensity(samples);
  const changed = edit(x, y, z);
  if (changed <= 0) throw new Error(`${name} did not modify density samples`);
  e.mesh_cached_chunk(cx, cy, cz, 0);
  const capture = captureMesh(name, 'cached-edit');
  return { ...capture, editedSamples: changed };
}

function syntheticCapture(name, field) {
  e.clear_edits();
  e.generate_chunk(0, 0, 0, 0);
  writeDensityField(field);
  e.mesh_cached_chunk(0, 0, 0, 0);
  return captureMesh(name, 'synthetic-density');
}

const captures = [
  proceduralCapture('origin-canyon-0-0-0', 0, 0, 0),
  proceduralCapture('origin-canyon-lod1-0-0-0', 0, 0, 0, 1),
  proceduralCapture('river-bend--3-0-4', -3, 0, 4),
  proceduralCapture('mountain-stack--5-1--6', -5, 1, -6),
  editedCapture('origin-carve-sphere', 0, 0, 0, (x, y, z) => e.apply_subtract_sphere_to_density(0, 0, 0, x, y, z, 7.5)),
  editedCapture('origin-carve-sphere-falloff', 0, 0, 0, (x, y, z) => e.apply_subtract_sphere_to_density_falloff(0, 0, 0, x, y, z, 7.5, 1.5)),
  editedCapture('origin-build-sphere', 0, 0, 0, (x, y, z) => e.apply_add_sphere_to_density(0, 0, 0, x, y + 8, z, 6.5)),
  editedCapture('origin-carve-box', 0, 0, 0, (x, y, z) => e.apply_subtract_box_to_density(0, 0, 0, x, y, z, 5.5)),
  editedCapture('origin-smooth-sphere', 0, 0, 0, (x, y, z) => e.apply_smooth_sphere_to_density(0, 0, 0, x, y, z, 9.5, 0.7)),
  editedCapture('origin-flatten-sphere', 0, 0, 0, (x, y, z) => e.apply_flatten_sphere_to_density(0, 0, 0, x, y, z, 9.5, 0.7)),
  syntheticCapture('synthetic-diagonal-plane', (x, y, z) => x + y + z - 48.25),
  syntheticCapture('synthetic-saddle-sheet', (x, y, z) => ((x - 16.2) * (y - 15.7) - 18.0) * 0.12 + (z - 16.0) * 0.45),
];

const result = {
  version: 1,
  mesherId: e.get_mesher_id(),
  mesher: 'marching-cubes-face-contour',
  chunkCells: e.get_chunk_n(),
  vertexStride: e.get_vertex_stride(),
  densityScale: e.get_density_scale(),
  generatedAt: new Date().toISOString(),
  captures,
};

function comparable(baseline) {
  const { generatedAt, ...stable } = baseline;
  return stable;
}

function describeDiff(actual, expected) {
  const diffs = [];
  const expectedByName = new Map(expected.captures.map(capture => [capture.name, capture]));
  for (const capture of actual.captures) {
    const prior = expectedByName.get(capture.name);
    if (!prior) {
      diffs.push(`${capture.name}: missing from baseline`);
      continue;
    }
    for (const key of Object.keys(capture)) {
      if (capture[key] !== prior[key]) {
        diffs.push(`${capture.name}.${key}: expected ${prior[key]}, got ${capture[key]}`);
      }
    }
  }
  const actualNames = new Set(actual.captures.map(capture => capture.name));
  for (const capture of expected.captures) {
    if (!actualNames.has(capture.name)) diffs.push(`${capture.name}: no longer produced`);
  }
  return diffs;
}

if (update) {
  fs.writeFileSync(baselinePath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Updated ${baselinePath.pathname}`);
} else {
  if (!fs.existsSync(baselinePath)) {
    throw new Error('Missing mesh-quality baseline. Run `npm run mesh:regression -- --update` after reviewing the current captures.');
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const actualStable = comparable(result);
  const baselineStable = comparable(baseline);
  if (JSON.stringify(actualStable) !== JSON.stringify(baselineStable)) {
    const diffs = describeDiff(actualStable, baselineStable).slice(0, 20);
    throw new Error(`Mesh-quality regression baseline changed:\n${diffs.join('\n')}`);
  }
}

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.table(captures.map(capture => ({
    name: capture.name,
    mode: capture.mode,
    vertices: capture.vertices,
    triangles: capture.triangles,
    boundaryEdges: capture.boundaryEdges,
    vertexHash: capture.vertexHash,
    indexHash: capture.indexHash,
  })));
  console.log(`Mesh regression passed: ${captures.length} captures, mesher id ${result.mesherId}.`);
}
