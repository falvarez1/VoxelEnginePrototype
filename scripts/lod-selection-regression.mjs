import fs from 'node:fs';
import crypto from 'node:crypto';
import ts from 'typescript';

const args = new Set(process.argv.slice(2));
const update = args.has('--update');
const jsonOutput = args.has('--json');
const baselineUrl = new URL('../docs/lod-selection-baseline.json', import.meta.url);
const terrainLodUrl = new URL('../src/terrain_lod.ts', import.meta.url);
const wasmUrl = new URL('../public/voxel_core.wasm', import.meta.url);

const SCENES = [
  { name: 'radius7-lod-off', cameraChunkX: 0, cameraChunkZ: 0, radius: 7, lodEnabled: false },
  { name: 'radius9-lod-on-threshold', cameraChunkX: 0, cameraChunkZ: 0, radius: 9, lodEnabled: true },
  { name: 'radius12-offset-lod-on', cameraChunkX: -3, cameraChunkZ: 4, radius: 12, lodEnabled: true },
  { name: 'radius20-offset-lod-on', cameraChunkX: 8, cameraChunkZ: -6, radius: 20, lodEnabled: true },
];

const VERTICAL_CHUNKS = [-1, 0, 1, 2];
const MIN_STREAM_RADIUS = 3;

function usage() {
  console.log(`Usage: node scripts/lod-selection-regression.mjs [--update] [--json]

Compares deterministic terrain LOD selection, seam masks, transition worklists, transition sample cases, and table-driven transition mesh staging against docs/lod-selection-baseline.json.
Use --update after intentional LOD selector changes.
`);
}

if (args.has('--help') || args.has('-h')) {
  usage();
  process.exit(0);
}

for (const arg of args) {
  if (arg !== '--update' && arg !== '--json') throw new Error(`Unknown option: ${arg}`);
}

function readText(url) {
  return fs.readFileSync(url, 'utf8');
}

function transpileTs(source, fileName) {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      isolatedModules: true,
      allowImportingTsExtensions: true,
      skipLibCheck: true,
    },
    fileName,
    reportDiagnostics: true,
  });
  const errors = result.diagnostics?.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error) ?? [];
  if (errors.length > 0) {
    const message = errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n');
    throw new Error(`Failed to transpile ${fileName}:\n${message}`);
  }
  return result.outputText;
}

function moduleUrl(js) {
  return `data:text/javascript;base64,${Buffer.from(js, 'utf8').toString('base64')}`;
}

async function loadTerrainLodModule() {
  const js = transpileTs(readText(terrainLodUrl), 'terrain_lod.ts');
  return import(moduleUrl(js));
}

function compactRequest(request) {
  return {
    key: request.key,
    lod: request.lod,
    priority: Number(request.priority.toFixed(3)),
    seam: request.lodSeamMask,
  };
}

function compactTransition(transition) {
  return {
    key: transition.key,
    sourceKey: transition.sourceKey,
    lod: transition.lod,
    side: transition.side,
    span: transition.span,
    neighborMinLod: transition.neighborMinLod,
    neighborMaxLod: transition.neighborMaxLod,
    neighborBaseCells: transition.neighborBaseCells,
    priority: Number(transition.priority.toFixed(3)),
  };
}

function compactTransitionCell(cell) {
  return {
    key: cell.key,
    faceKey: cell.faceKey,
    sourceKey: cell.sourceKey,
    neighborKey: cell.neighborKey,
    lod: cell.lod,
    side: cell.side,
    localU: cell.localU,
    localV: cell.localV,
    base: [cell.baseX, cell.baseY, cell.baseZ],
    neighborLod: cell.neighborLod,
    priority: Number(cell.priority.toFixed(3)),
  };
}

function roundDensity(value) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : null;
}

function compactTransitionSample(sample) {
  return {
    role: sample.role,
    corner: sample.corner,
    chunkKey: sample.chunkKey,
    grid: [sample.gx, sample.gy, sample.gz],
    density: roundDensity(sample.density),
    solid: sample.solid,
  };
}

function compactTransitionCase(transitionCase, includeSamples = true) {
  const compact = {
    key: transitionCase.key,
    cellKey: transitionCase.cellKey,
    faceKey: transitionCase.faceKey,
    sourceKey: transitionCase.sourceKey,
    neighborKey: transitionCase.neighborKey,
    side: transitionCase.side,
    lod: transitionCase.lod,
    neighborLod: transitionCase.neighborLod,
    span: transitionCase.span,
    coarseFaceCase: transitionCase.coarseFaceCase,
    neighborCellCase: transitionCase.neighborCellCase,
    combinedCase: transitionCase.combinedCase,
    samplesPresent: transitionCase.samplesPresent,
    missingSamples: transitionCase.missingSamples,
    solidCorners: [transitionCase.coarseSolidCorners, transitionCase.neighborSolidCorners],
    densityRange: [roundDensity(transitionCase.minDensity), roundDensity(transitionCase.maxDensity)],
    crossesSurface: transitionCase.crossesSurface,
  };
  if (includeSamples) compact.samples = transitionCase.samples.map(compactTransitionSample);
  return compact;
}

function compactTransitionMeshVertex(vertex) {
  return {
    key: vertex.key,
    cellKey: vertex.cellKey,
    edgeKey: vertex.edgeKey,
    p: [
      Number(vertex.x.toFixed(3)),
      Number(vertex.y.toFixed(3)),
      Number(vertex.z.toFixed(3)),
    ],
  };
}

function compactTransitionMeshCell(cell) {
  return {
    cellKey: cell.cellKey,
    combinedCase: cell.combinedCase,
    vertexStart: cell.vertexStart,
    vertexCount: cell.vertexCount,
    triangleStart: cell.triangleStart,
    triangleCount: cell.triangleCount,
    skippedReason: cell.skippedReason,
  };
}

function hashJson(value) {
  return `sha256:${crypto.createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, 16)}`;
}

function hashBytes(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16)}`;
}

function transitionSideId(side) {
  if (side === 'negX') return 0;
  if (side === 'posX') return 1;
  if (side === 'negZ') return 2;
  return 3;
}

function transitionCaseSample(transitionCase, role, corner) {
  return transitionCase.samples.find(sample => sample.role === role && sample.corner === corner) ?? null;
}

function nativeTransitionCaseSamples(mod, transitionCase) {
  const ordered = [];
  for (let corner = 0; corner < 4; corner++) {
    const sample = transitionCaseSample(transitionCase, 'coarseFace', corner);
    if (!sample || sample.density === null) return null;
    ordered.push(sample);
  }
  for (let corner = 0; corner < 8; corner++) {
    const sample = transitionCaseSample(transitionCase, 'neighborCell', corner);
    if (!sample || sample.density === null) return null;
    ordered.push(sample);
  }
  return ordered.map(sample => {
    const [x, y, z] = mod.sampleTerrainLodTransitionGeometryPosition(sample, transitionCase.side);
    return [x, y, z, sample.density];
  });
}

function compactNativeBounds(e) {
  return [
    Number(e.get_bounds_min_x().toFixed(3)),
    Number(e.get_bounds_min_y().toFixed(3)),
    Number(e.get_bounds_min_z().toFixed(3)),
    Number(e.get_bounds_max_x().toFixed(3)),
    Number(e.get_bounds_max_y().toFixed(3)),
    Number(e.get_bounds_max_z().toFixed(3)),
  ];
}

function summarizeNativeTransitionMesh(mod, e, cases) {
  const sampleCount = e.get_lod_transition_sample_count();
  if (sampleCount !== 12) throw new Error(`Expected native transition sample count 12, got ${sampleCount}`);
  if (e.get_lod_transition_algorithm_id() !== 1) throw new Error(`Expected native transition algorithm 1, got ${e.get_lod_transition_algorithm_id()}`);
  const positions = new Float32Array(e.memory.buffer, e.get_lod_transition_position_ptr(), sampleCount * 3);
  const densities = new Float32Array(e.memory.buffer, e.get_lod_transition_density_ptr(), sampleCount);
  const records = [];
  let candidates = 0;
  let emittedCells = 0;
  let vertexCount = 0;
  let triangleCount = 0;
  let overflow = 0;
  for (const transitionCase of cases) {
    if (transitionCase.missingSamples !== 0 || !transitionCase.crossesSurface) continue;
    const samples = nativeTransitionCaseSamples(mod, transitionCase);
    if (!samples) continue;
    candidates++;
    for (let sample = 0; sample < sampleCount; sample++) {
      positions[sample * 3 + 0] = samples[sample][0];
      positions[sample * 3 + 1] = samples[sample][1];
      positions[sample * 3 + 2] = samples[sample][2];
      densities[sample] = samples[sample][3];
    }
    e.generate_lod_transition_cell_mesh(transitionSideId(transitionCase.side));
    const vertices = e.get_vertex_count();
    const indices = e.get_index_count();
    overflow += e.get_overflow() ? 1 : 0;
    if (vertices <= 0 || indices <= 0) continue;
    emittedCells++;
    vertexCount += vertices;
    triangleCount += indices / 3;
    records.push({
      side: transitionCase.side,
      combinedCase: transitionCase.combinedCase,
      vertices,
      triangles: indices / 3,
      bounds: compactNativeBounds(e),
      vertexHash: hashBytes(new Uint8Array(e.memory.buffer, e.get_vertex_ptr(), vertices * e.get_vertex_stride())),
      indexHash: hashBytes(new Uint8Array(e.memory.buffer, e.get_index_ptr(), indices * Uint32Array.BYTES_PER_ELEMENT)),
    });
  }
  return {
    algorithmId: e.get_lod_transition_algorithm_id(),
    candidates,
    emittedCells,
    vertexCount,
    triangleCount,
    overflow,
    recordHash: hashJson(records),
    records: records.slice(0, 12),
  };
}

function summarizeTransitionCases(cases) {
  const completeCells = cases.filter(item => item.missingSamples === 0).length;
  const crossingCells = cases.filter(item => item.crossesSurface).length;
  const coarseMixedCases = cases.filter(item => item.coarseFaceCase !== 0 && item.coarseFaceCase !== 15).length;
  const neighborMixedCases = cases.filter(item => item.neighborCellCase !== 0 && item.neighborCellCase !== 255).length;
  const uniqueCombinedCases = new Set(cases.map(item => item.combinedCase)).size;
  const missingSamples = cases.reduce((sum, item) => sum + item.missingSamples, 0);
  const fullCaseHash = hashJson(cases.map(item => compactTransitionCase(item, true)));
  return {
    totalCells: cases.length,
    completeCells,
    crossingCells,
    coarseMixedCases,
    neighborMixedCases,
    uniqueCombinedCases,
    missingSamples,
    fullCaseHash,
  };
}

function summarizeTransitionMesh(mesh) {
  const skippedByReason = mesh.cells.reduce((counts, cell) => {
    counts[cell.skippedReason] = (counts[cell.skippedReason] ?? 0) + 1;
    return counts;
  }, {});
  return {
    algorithm: mesh.algorithm,
    cellCount: mesh.cellCount,
    emittedCells: mesh.emittedCells,
    skippedCells: mesh.skippedCells,
    missingSampleCells: mesh.missingSampleCells,
    degenerateCells: mesh.degenerateCells,
    uniformCells: skippedByReason.uniform ?? 0,
    vertexCount: mesh.vertices.length,
    triangleCount: mesh.indices.length / 3,
    cellHash: hashJson(mesh.cells.map(compactTransitionMeshCell)),
    vertexHash: hashJson(mesh.vertices.map(compactTransitionMeshVertex)),
    indexHash: hashJson(mesh.indices),
  };
}

function syntheticTransitionDensity(mod, point) {
  const [cx, cy, cz, lod] = mod.parseTerrainChunkKey(point.chunkKey);
  const cellSize = mod.lodSpan(lod);
  const wx = cx * 32 + point.gx * cellSize;
  const wy = cy * 32 + point.gy * cellSize;
  const wz = cz * 32 + point.gz * cellSize;
  const height = 24
    + Math.sin(wx * 0.018) * 14
    + Math.cos(wz * 0.021) * 12
    + Math.sin((wx + wz) * 0.006) * 18
    + Math.cos((wx - wz) * 0.004) * 8;
  return wy - height;
}

function captureScene(mod, e, scene) {
  const requests = mod.planTerrainLodRequests({
    cameraChunkX: scene.cameraChunkX,
    cameraChunkZ: scene.cameraChunkZ,
    radius: scene.radius,
    verticalChunks: VERTICAL_CHUNKS,
    lodEnabled: scene.lodEnabled,
    minStreamRadius: MIN_STREAM_RADIUS,
  });
  const summary = mod.summarizeTerrainLodPlan(requests);
  const transitionRequests = requests
    .filter(request => request.lodSeamMask !== 0)
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(0, 12)
    .map(compactRequest);
  const transitionSchedule = mod.buildTerrainLodTransitionPlan(requests)
    .slice(0, 12)
    .map(compactTransition);
  const transitionCells = mod.buildTerrainLodTransitionCells(requests)
    .slice(0, 12)
    .map(compactTransitionCell);
  const transitionCases = mod.buildTerrainLodTransitionCases(requests, point => syntheticTransitionDensity(mod, point));
  const transitionCaseSummary = summarizeTransitionCases(transitionCases);
  const transitionCaseSamples = transitionCases
    .slice(0, 12)
    .map(item => compactTransitionCase(item, true));
  const transitionMesh = mod.buildTerrainLodTransitionMesh(transitionCases);
  const transitionMeshSummary = summarizeTransitionMesh(transitionMesh);
  const nativeTransitionMeshSummary = summarizeNativeTransitionMesh(mod, e, transitionCases);
  const transitionMeshCells = transitionMesh.cells
    .filter(item => item.skippedReason === 'none')
    .slice(0, 12)
    .map(compactTransitionMeshCell);
  const transitionMeshVertices = transitionMesh.vertices
    .slice(0, 24)
    .map(compactTransitionMeshVertex);
  const firstRequests = requests.slice(0, 12).map(compactRequest);
  return {
    ...scene,
    summary,
    firstRequests,
    transitionRequests,
    transitionSchedule,
    transitionCells,
    transitionCaseSummary,
    transitionCaseSamples,
    transitionMeshSummary,
    nativeTransitionMeshSummary,
    transitionMeshCells,
    transitionMeshVertices,
  };
}

async function captureBaseline() {
  const mod = await loadTerrainLodModule();
  const bytes = fs.readFileSync(wasmUrl);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const e = instance.exports;
  const scenes = SCENES.map(scene => captureScene(mod, e, scene));
  return {
    version: 7,
    generatedBy: 'scripts/lod-selection-regression.mjs',
    verticalChunks: VERTICAL_CHUNKS,
    minStreamRadius: MIN_STREAM_RADIUS,
    scenes,
  };
}

function stableStringify(value) {
  return JSON.stringify(value, null, 2);
}

function compareBaseline(expected, actual) {
  const expectedText = stableStringify(expected);
  const actualText = stableStringify(actual);
  if (expectedText === actualText) return [];
  const expectedLines = expectedText.split('\n');
  const actualLines = actualText.split('\n');
  const diffs = [];
  const length = Math.max(expectedLines.length, actualLines.length);
  for (let i = 0; i < length && diffs.length < 20; i++) {
    if (expectedLines[i] !== actualLines[i]) {
      diffs.push(`line ${i + 1}: expected ${expectedLines[i] ?? '<missing>'} | actual ${actualLines[i] ?? '<missing>'}`);
    }
  }
  return diffs;
}

function printSummary(baseline) {
  if (jsonOutput) {
    console.log(stableStringify(baseline));
    return;
  }
  for (const scene of baseline.scenes) {
    const s = scene.summary;
    const c = scene.transitionCaseSummary;
    const m = scene.transitionMeshSummary;
    const n = scene.nativeTransitionMeshSummary;
    const caseSummary = c ? `, cases ${c.crossingCells}/${c.totalCells} crossing, ${c.uniqueCombinedCases} unique` : '';
    const meshSummary = m ? `, transition mesh ${m.emittedCells} cells/${m.triangleCount} tris` : '';
    const nativeSummary = n ? `, native ${n.emittedCells} cells/${n.triangleCount} tris` : '';
    console.log(`- ${scene.name}: ${s.targetChunks} chunks, LOD 0/1/2+ ${s.lod0Chunks}/${s.lod1Chunks}/${s.lod2PlusChunks}, transitions ${s.transitionFaces}/${s.transitionEdges} faces on ${s.skirtedChunks} chunks, ${s.transitionCells} cells (${s.transitionFaceBaseCells} face cells)${caseSummary}${meshSummary}${nativeSummary}, covered ${s.coveredBaseCells}`);
  }
}

const actual = await captureBaseline();
if (update || !fs.existsSync(baselineUrl)) {
  fs.writeFileSync(baselineUrl, `${stableStringify(actual)}\n`);
  if (!jsonOutput) console.log(`Updated ${baselineUrl.pathname}`);
  printSummary(actual);
  process.exit(0);
}

const expected = JSON.parse(readText(baselineUrl));
const failures = compareBaseline(expected, actual);
if (failures.length > 0) {
  console.error('LOD selection regression failed: baseline differs.');
  for (const failure of failures) console.error(`  ${failure}`);
  console.error('Run `node scripts/lod-selection-regression.mjs --update` after intentional LOD selector changes.');
  process.exit(1);
}

if (!jsonOutput) console.log(`LOD selection regression passed: ${actual.scenes.length} scenes.`);
printSummary(actual);
