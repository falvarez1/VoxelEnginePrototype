import fs from 'node:fs';

const wasmPath = new URL('../public/voxel_core.wasm', import.meta.url);
const bytes = fs.readFileSync(wasmPath);
const { instance } = await WebAssembly.instantiate(bytes, {});
const e = instance.exports;

const required = [
  'memory',
  'generate_chunk',
  'get_vertex_count',
  'get_index_count',
  'get_overflow',
  'add_subtract_sphere',
  'clear_edits',
  'get_terrain_height',
  'get_river_center'
];
for (const name of required) {
  if (!(name in e)) throw new Error(`Missing WASM export: ${name}`);
}

e.clear_edits();
e.generate_chunk(0, 0, 0, 0);
const verticesBefore = e.get_vertex_count();
const indicesBefore = e.get_index_count();
if (verticesBefore <= 0 || indicesBefore <= 0) {
  throw new Error(`Expected non-empty generated chunk, got ${verticesBefore} vertices and ${indicesBefore} indices`);
}
if (e.get_overflow() !== 0) {
  throw new Error('WASM terrain mesh buffer overflowed during smoke test');
}

const h = e.get_terrain_height(0, 0);
const edited = e.add_subtract_sphere(0, h - 2, 0, 8);
if (edited !== 1) throw new Error('Failed to add runtime SDF edit sphere');
e.generate_chunk(0, 0, 0, 0);
const verticesAfter = e.get_vertex_count();
if (verticesAfter <= 0) {
  throw new Error('Edited chunk generated no vertices');
}

console.log(`Smoke test passed: ${verticesBefore} vertices / ${indicesBefore} indices before edit, ${verticesAfter} vertices after edit.`);
