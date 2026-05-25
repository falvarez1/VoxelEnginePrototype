import fs from 'node:fs';
import { performance } from 'node:perf_hooks';

const wasmPath = new URL('../public/voxel_core.wasm', import.meta.url);
const bytes = fs.readFileSync(wasmPath);
const { instance } = await WebAssembly.instantiate(bytes, {});
const e = instance.exports;

const required = [
  'memory',
  'generate_chunk',
  'mesh_cached_chunk',
  'apply_subtract_sphere_to_density',
  'apply_add_sphere_to_density',
  'apply_subtract_box_to_density',
  'apply_add_capsule_to_density',
  'apply_smooth_sphere_to_density',
  'apply_flatten_sphere_to_density',
  'clear_edits',
  'get_vertex_count',
  'get_index_count',
  'get_density_ptr',
  'get_density_count',
  'get_overflow',
  'get_terrain_height',
];
for (const name of required) {
  if (!(name in e)) throw new Error(`Missing WASM export: ${name}`);
}

const scenes = [
  {
    name: 'origin-canyon',
    chunks: [
      [-1, 0, -2], [0, 0, -2], [1, 0, -2],
      [-1, 0, -1], [0, 0, -1], [1, 0, -1],
      [-1, 0, 0], [0, 0, 0], [1, 0, 0],
    ],
  },
  {
    name: 'river-bend',
    chunks: [
      [-6, -1, -8], [-1, -1, -8], [7, -1, -8],
      [-4, 0, 3], [-3, 0, 3], [-2, 0, 3],
      [-4, 0, 4], [-3, 0, 4], [-2, 0, 4],
    ],
  },
  {
    name: 'mountain-stack',
    chunks: [
      [-5, 1, -6], [-4, 1, -6], [-3, 1, -6],
      [-2, 1, -8], [-1, 1, -8], [1, 1, -8],
      [5, 1, -8], [-7, 1, -7], [2, 1, -7],
    ],
  },
];

function timeMs(fn) {
  const start = performance.now();
  const result = fn();
  return { result, ms: performance.now() - start };
}

function densityCopy() {
  return new Int16Array(new Int16Array(e.memory.buffer, e.get_density_ptr(), e.get_density_count()));
}

function restoreDensity(samples) {
  new Int16Array(e.memory.buffer, e.get_density_ptr(), e.get_density_count()).set(samples);
}

function assertMesh(label) {
  const vertices = e.get_vertex_count();
  const indices = e.get_index_count();
  if (vertices <= 0 || indices <= 0) throw new Error(`${label} generated an empty mesh`);
  if (e.get_overflow() !== 0) throw new Error(`${label} overflowed the WASM mesh buffers`);
  return { vertices, indices };
}

function chunkCenter(cx, cz) {
  const x = cx * 32 + 16;
  const z = cz * 32 + 16;
  return { x, z, y: e.get_terrain_height(x, z) - 2 };
}

const rows = [];
let generatedChunks = 0;
let totalGenerateMs = 0;
let totalCachedRemeshMs = 0;
let totalEditRemeshMs = 0;
let totalBuildRemeshMs = 0;
let totalBoxRemeshMs = 0;
let totalCapsuleRemeshMs = 0;
let totalSmoothRemeshMs = 0;
let totalFlattenRemeshMs = 0;

for (const scene of scenes) {
  e.clear_edits();
  let sceneVertices = 0;
  let sceneIndices = 0;
  let sceneGenerateMs = 0;
  let sceneCachedRemeshMs = 0;
  let sceneEditRemeshMs = 0;
  let sceneBuildRemeshMs = 0;
  let sceneBoxRemeshMs = 0;
  let sceneCapsuleRemeshMs = 0;
  let sceneSmoothRemeshMs = 0;
  let sceneFlattenRemeshMs = 0;
  let sceneEditedSamples = 0;
  let sceneBuiltSamples = 0;
  let sceneBoxSamples = 0;
  let sceneCapsuleSamples = 0;
  let sceneSmoothSamples = 0;
  let sceneFlattenSamples = 0;

  for (const [cx, cy, cz] of scene.chunks) {
    const label = `${scene.name} ${cx},${cy},${cz}`;
    const generated = timeMs(() => e.generate_chunk(cx, cy, cz, 0));
    const mesh = assertMesh(`${label} generate`);
    const samples = densityCopy();
    const cached = timeMs(() => e.mesh_cached_chunk(cx, cy, cz, 0));
    const cachedMesh = assertMesh(`${label} cached remesh`);
    if (cached.result !== mesh.vertices || cachedMesh.indices !== mesh.indices) {
      throw new Error(`${label} cached remesh changed topology: ${cached.result}/${cachedMesh.indices} vs ${mesh.vertices}/${mesh.indices}`);
    }

    restoreDensity(samples);
    const center = chunkCenter(cx, cz);
    const editedSamples = e.apply_subtract_sphere_to_density(cx, cy, cz, center.x, center.y, center.z, 7.5);
    const edited = timeMs(() => e.mesh_cached_chunk(cx, cy, cz, 0));
    const editedMesh = assertMesh(`${label} edit remesh`);
    if (edited.result !== editedMesh.vertices) {
      throw new Error(`${label} edit remesh returned ${edited.result} but exported ${editedMesh.vertices} vertices`);
    }

    restoreDensity(samples);
    const builtSamples = e.apply_add_sphere_to_density(cx, cy, cz, center.x, center.y + 8, center.z, 6.5);
    const built = timeMs(() => e.mesh_cached_chunk(cx, cy, cz, 0));
    const builtMesh = assertMesh(`${label} build remesh`);
    if (built.result !== builtMesh.vertices) {
      throw new Error(`${label} build remesh returned ${built.result} but exported ${builtMesh.vertices} vertices`);
    }

    restoreDensity(samples);
    const boxSamples = e.apply_subtract_box_to_density(cx, cy, cz, center.x, center.y, center.z, 5.5);
    const box = timeMs(() => e.mesh_cached_chunk(cx, cy, cz, 0));
    const boxMesh = assertMesh(`${label} box remesh`);
    if (box.result !== boxMesh.vertices) {
      throw new Error(`${label} box remesh returned ${box.result} but exported ${boxMesh.vertices} vertices`);
    }

    restoreDensity(samples);
    const capsuleSamples = e.apply_add_capsule_to_density(cx, cy, cz, center.x, center.y + 8, center.z, 4.5, 1, 0, 0, 18);
    const capsule = timeMs(() => e.mesh_cached_chunk(cx, cy, cz, 0));
    const capsuleMesh = assertMesh(`${label} capsule remesh`);
    if (capsule.result !== capsuleMesh.vertices) {
      throw new Error(`${label} capsule remesh returned ${capsule.result} but exported ${capsuleMesh.vertices} vertices`);
    }

    restoreDensity(samples);
    const smoothSamples = e.apply_smooth_sphere_to_density(cx, cy, cz, center.x, center.y, center.z, 9.5, 0.65);
    const smooth = timeMs(() => e.mesh_cached_chunk(cx, cy, cz, 0));
    const smoothMesh = assertMesh(`${label} smooth remesh`);
    if (smooth.result !== smoothMesh.vertices) {
      throw new Error(`${label} smooth remesh returned ${smooth.result} but exported ${smoothMesh.vertices} vertices`);
    }

    restoreDensity(samples);
    const flattenSamples = e.apply_flatten_sphere_to_density(cx, cy, cz, center.x, center.y, center.z, 9.5, 0.65);
    const flatten = timeMs(() => e.mesh_cached_chunk(cx, cy, cz, 0));
    const flattenMesh = assertMesh(`${label} flatten remesh`);
    if (flatten.result !== flattenMesh.vertices) {
      throw new Error(`${label} flatten remesh returned ${flatten.result} but exported ${flattenMesh.vertices} vertices`);
    }

    generatedChunks++;
    sceneVertices += mesh.vertices;
    sceneIndices += mesh.indices;
    sceneGenerateMs += generated.ms;
    sceneCachedRemeshMs += cached.ms;
    sceneEditRemeshMs += edited.ms;
    sceneBuildRemeshMs += built.ms;
    sceneBoxRemeshMs += box.ms;
    sceneCapsuleRemeshMs += capsule.ms;
    sceneSmoothRemeshMs += smooth.ms;
    sceneFlattenRemeshMs += flatten.ms;
    sceneEditedSamples += editedSamples;
    sceneBuiltSamples += builtSamples;
    sceneBoxSamples += boxSamples;
    sceneCapsuleSamples += capsuleSamples;
    sceneSmoothSamples += smoothSamples;
    sceneFlattenSamples += flattenSamples;
  }

  totalGenerateMs += sceneGenerateMs;
  totalCachedRemeshMs += sceneCachedRemeshMs;
  totalEditRemeshMs += sceneEditRemeshMs;
  totalBuildRemeshMs += sceneBuildRemeshMs;
  totalBoxRemeshMs += sceneBoxRemeshMs;
  totalCapsuleRemeshMs += sceneCapsuleRemeshMs;
  totalSmoothRemeshMs += sceneSmoothRemeshMs;
  totalFlattenRemeshMs += sceneFlattenRemeshMs;
  rows.push({
    scene: scene.name,
    chunks: scene.chunks.length,
    vertices: sceneVertices,
    triangles: Math.round(sceneIndices / 3),
    editedSamples: sceneEditedSamples,
    builtSamples: sceneBuiltSamples,
    boxSamples: sceneBoxSamples,
    capsuleSamples: sceneCapsuleSamples,
    smoothSamples: sceneSmoothSamples,
    flattenSamples: sceneFlattenSamples,
    avgGenerateMs: sceneGenerateMs / scene.chunks.length,
    avgCachedRemeshMs: sceneCachedRemeshMs / scene.chunks.length,
    avgEditRemeshMs: sceneEditRemeshMs / scene.chunks.length,
    avgBuildRemeshMs: sceneBuildRemeshMs / scene.chunks.length,
    avgBoxRemeshMs: sceneBoxRemeshMs / scene.chunks.length,
    avgCapsuleRemeshMs: sceneCapsuleRemeshMs / scene.chunks.length,
    avgSmoothRemeshMs: sceneSmoothRemeshMs / scene.chunks.length,
    avgFlattenRemeshMs: sceneFlattenRemeshMs / scene.chunks.length,
  });
}

const summary = {
  chunks: generatedChunks,
  avgGenerateMs: totalGenerateMs / generatedChunks,
  avgCachedRemeshMs: totalCachedRemeshMs / generatedChunks,
  avgEditRemeshMs: totalEditRemeshMs / generatedChunks,
  avgBuildRemeshMs: totalBuildRemeshMs / generatedChunks,
  avgBoxRemeshMs: totalBoxRemeshMs / generatedChunks,
  avgCapsuleRemeshMs: totalCapsuleRemeshMs / generatedChunks,
  avgSmoothRemeshMs: totalSmoothRemeshMs / generatedChunks,
  avgFlattenRemeshMs: totalFlattenRemeshMs / generatedChunks,
  scenes: rows,
};

if (process.env.BENCH_JSON === '1') {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.table(rows.map(row => ({
    scene: row.scene,
    chunks: row.chunks,
    vertices: row.vertices,
    triangles: row.triangles,
    editedSamples: row.editedSamples,
    builtSamples: row.builtSamples,
    boxSamples: row.boxSamples,
    capsuleSamples: row.capsuleSamples,
    smoothSamples: row.smoothSamples,
    flattenSamples: row.flattenSamples,
    avgGenerateMs: row.avgGenerateMs.toFixed(2),
    avgCachedRemeshMs: row.avgCachedRemeshMs.toFixed(2),
    avgEditRemeshMs: row.avgEditRemeshMs.toFixed(2),
    avgBuildRemeshMs: row.avgBuildRemeshMs.toFixed(2),
    avgBoxRemeshMs: row.avgBoxRemeshMs.toFixed(2),
    avgCapsuleRemeshMs: row.avgCapsuleRemeshMs.toFixed(2),
    avgSmoothRemeshMs: row.avgSmoothRemeshMs.toFixed(2),
    avgFlattenRemeshMs: row.avgFlattenRemeshMs.toFixed(2),
  })));
  console.log(
    `Benchmark complete: ${summary.chunks} chunks, avg generate ${summary.avgGenerateMs.toFixed(2)} ms, ` +
    `cached remesh ${summary.avgCachedRemeshMs.toFixed(2)} ms, carve remesh ${summary.avgEditRemeshMs.toFixed(2)} ms, ` +
    `build remesh ${summary.avgBuildRemeshMs.toFixed(2)} ms, box remesh ${summary.avgBoxRemeshMs.toFixed(2)} ms, ` +
    `capsule remesh ${summary.avgCapsuleRemeshMs.toFixed(2)} ms, smooth remesh ${summary.avgSmoothRemeshMs.toFixed(2)} ms, ` +
    `flatten remesh ${summary.avgFlattenRemeshMs.toFixed(2)} ms.`,
  );
}
