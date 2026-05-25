import fs from 'node:fs';

const wasmPath = new URL('../public/voxel_core.wasm', import.meta.url);
const bytes = fs.readFileSync(wasmPath);
const { instance } = await WebAssembly.instantiate(bytes, {});
const e = instance.exports;

const required = [
  'memory',
  'generate_chunk',
  'mesh_cached_chunk',
  'generate_lod_transition_cell_mesh',
  'apply_subtract_sphere_to_density',
  'apply_add_sphere_to_density',
  'apply_subtract_box_to_density',
  'apply_add_box_to_density',
  'apply_subtract_capsule_to_density',
  'apply_add_capsule_to_density',
  'apply_subtract_sphere_to_density_falloff',
  'apply_add_sphere_to_density_falloff',
  'apply_subtract_box_to_density_falloff',
  'apply_add_box_to_density_falloff',
  'apply_subtract_capsule_to_density_falloff',
  'apply_add_capsule_to_density_falloff',
  'apply_smooth_sphere_to_density',
  'apply_smooth_box_to_density',
  'apply_smooth_capsule_to_density',
  'apply_flatten_sphere_to_density',
  'apply_flatten_box_to_density',
  'apply_flatten_capsule_to_density',
  'get_vertex_ptr',
  'get_index_ptr',
  'get_vertex_count',
  'get_index_count',
  'get_density_ptr',
  'get_lod_transition_position_ptr',
  'get_lod_transition_density_ptr',
  'get_density_count',
  'get_lod_transition_sample_count',
  'get_lod_transition_algorithm_id',
  'get_overflow',
  'get_vertex_stride',
  'get_density_stride',
  'get_density_scale',
  'get_mesher_id',
  'set_chunk_lod',
  'get_chunk_lod',
  'get_base_chunk_world_size',
  'get_chunk_world_size',
  'get_cell_size',
  'get_chunk_n',
  'get_bounds_min_x',
  'get_bounds_min_y',
  'get_bounds_min_z',
  'get_bounds_max_x',
  'get_bounds_max_y',
  'get_bounds_max_z',
  'generate_worldgen_tile',
  'get_worldgen_tile_field_ptr',
  'get_worldgen_tile_biome_id_ptr',
  'get_worldgen_tile_water_id_ptr',
  'get_worldgen_tile_river_id_ptr',
  'get_worldgen_tile_resolution',
  'get_worldgen_tile_sample_count',
  'get_worldgen_tile_field_count',
  'get_worldgen_tile_size',
  'generate_erosion_tile',
  'get_erosion_tile_field_ptr',
  'get_erosion_tile_resolution',
  'get_erosion_tile_sample_count',
  'get_erosion_tile_field_count',
  'get_erosion_tile_schema_version',
  'get_erosion_tile_generator_version',
  'get_erosion_tile_size',
  'generate_material_tile',
  'get_material_tile_field_ptr',
  'get_material_tile_id_ptr',
  'get_material_tile_resolution',
  'get_material_tile_sample_count',
  'get_material_tile_field_count',
  'get_material_tile_schema_version',
  'get_material_tile_generator_version',
  'get_material_tile_size',
  'generate_cave_graph_tile',
  'get_cave_graph_passage_ptr',
  'get_cave_graph_chamber_ptr',
  'get_cave_graph_passage_count',
  'get_cave_graph_chamber_count',
  'get_cave_graph_max_passages',
  'get_cave_graph_max_chambers',
  'get_cave_graph_passage_field_count',
  'get_cave_graph_chamber_field_count',
  'get_cave_graph_tile_schema_version',
  'get_cave_graph_tile_generator_version',
  'get_cave_graph_tile_size',
  'add_subtract_sphere',
  'add_add_sphere',
  'add_subtract_box',
  'add_add_box',
  'add_subtract_capsule',
  'add_add_capsule',
  'add_subtract_sphere_falloff',
  'add_add_sphere_falloff',
  'add_subtract_box_falloff',
  'add_add_box_falloff',
  'add_subtract_capsule_falloff',
  'add_add_capsule_falloff',
  'add_paint_sphere',
  'add_paint_box',
  'add_paint_capsule',
  'add_smooth_sphere',
  'add_smooth_box',
  'add_smooth_capsule',
  'add_flatten_sphere',
  'add_flatten_box',
  'add_flatten_capsule',
  'clear_edits',
  'get_terrain_height',
  'get_river_center',
  'get_macro_continent',
  'get_moisture_mask',
  'get_temperature_mask',
  'get_cave_distance',
  'get_biome_mask',
  'get_wetness_mask',
  'get_snow_mask',
  'get_drainage_mask',
  'get_erosion_mask',
  'get_vegetation_mask'
];
for (const name of required) {
  if (!(name in e)) throw new Error(`Missing WASM export: ${name}`);
}

if (e.get_chunk_n() !== 32) {
  throw new Error(`Expected 32 chunk cells, got ${e.get_chunk_n()}`);
}
if (e.get_base_chunk_world_size() !== 32) {
  throw new Error(`Expected 32m base chunk coordinates, got ${e.get_base_chunk_world_size()}`);
}
if (e.get_cell_size() !== 1) {
  throw new Error(`Expected 1m cells, got ${e.get_cell_size()}`);
}
if (e.get_chunk_world_size() !== 32) {
  throw new Error(`Expected 32m chunks, got ${e.get_chunk_world_size()}`);
}
if (e.get_vertex_stride() !== 16) {
  throw new Error(`Expected 16-byte packed vertices, got stride ${e.get_vertex_stride()}`);
}
if (e.get_density_stride() !== 2) {
  throw new Error(`Expected 2-byte quantized density samples, got stride ${e.get_density_stride()}`);
}
if (e.get_density_count() !== 33 * 33 * 33) {
  throw new Error(`Expected 33^3 density samples, got ${e.get_density_count()}`);
}
if (e.get_density_scale() !== 256) {
  throw new Error(`Expected density scale 256, got ${e.get_density_scale()}`);
}
if (e.get_worldgen_tile_resolution() !== 17) {
  throw new Error(`Expected 17x17 native worldgen tiles, got ${e.get_worldgen_tile_resolution()}`);
}
if (e.get_worldgen_tile_sample_count() !== 17 * 17) {
  throw new Error(`Expected 289 native worldgen tile samples, got ${e.get_worldgen_tile_sample_count()}`);
}
if (e.get_worldgen_tile_field_count() !== 32) {
  throw new Error(`Expected 32 native worldgen tile fields, got ${e.get_worldgen_tile_field_count()}`);
}
if (e.get_worldgen_tile_size() !== 256) {
  throw new Error(`Expected 256m native worldgen tiles, got ${e.get_worldgen_tile_size()}`);
}
if (e.get_erosion_tile_resolution() !== 17) {
  throw new Error(`Expected 17x17 native erosion tiles, got ${e.get_erosion_tile_resolution()}`);
}
if (e.get_erosion_tile_sample_count() !== 17 * 17) {
  throw new Error(`Expected 289 native erosion tile samples, got ${e.get_erosion_tile_sample_count()}`);
}
if (e.get_erosion_tile_field_count() !== 11) {
  throw new Error(`Expected 11 native erosion tile fields, got ${e.get_erosion_tile_field_count()}`);
}
if (e.get_erosion_tile_size() !== 256) {
  throw new Error(`Expected 256m native erosion tiles, got ${e.get_erosion_tile_size()}`);
}
if (e.get_erosion_tile_schema_version() !== 1 || e.get_erosion_tile_generator_version() !== 1) {
  throw new Error(`Expected native erosion schema/generator 1/1, got ${e.get_erosion_tile_schema_version()}/${e.get_erosion_tile_generator_version()}`);
}
if (e.get_material_tile_resolution() !== 17) {
  throw new Error(`Expected 17x17 native material tiles, got ${e.get_material_tile_resolution()}`);
}
if (e.get_material_tile_sample_count() !== 17 * 17) {
  throw new Error(`Expected 289 native material tile samples, got ${e.get_material_tile_sample_count()}`);
}
if (e.get_material_tile_field_count() !== 12) {
  throw new Error(`Expected 12 native material tile fields, got ${e.get_material_tile_field_count()}`);
}
if (e.get_material_tile_size() !== 256) {
  throw new Error(`Expected 256m native material tiles, got ${e.get_material_tile_size()}`);
}
if (e.get_material_tile_schema_version() !== 1 || e.get_material_tile_generator_version() !== 1) {
  throw new Error(`Expected native material schema/generator 1/1, got ${e.get_material_tile_schema_version()}/${e.get_material_tile_generator_version()}`);
}
if (e.get_cave_graph_tile_size() !== 256) {
  throw new Error(`Expected 256m native cave graph tiles, got ${e.get_cave_graph_tile_size()}`);
}
if (e.get_cave_graph_tile_schema_version() !== 1 || e.get_cave_graph_tile_generator_version() !== 1) {
  throw new Error(`Expected native cave graph schema/generator 1/1, got ${e.get_cave_graph_tile_schema_version()}/${e.get_cave_graph_tile_generator_version()}`);
}
if (e.get_cave_graph_passage_field_count() !== 16) {
  throw new Error(`Expected 16 native cave graph passage fields, got ${e.get_cave_graph_passage_field_count()}`);
}
if (e.get_cave_graph_chamber_field_count() !== 7) {
  throw new Error(`Expected 7 native cave graph chamber fields, got ${e.get_cave_graph_chamber_field_count()}`);
}
if (e.get_mesher_id() !== 1) {
  throw new Error(`Expected Marching Cubes mesher id 1, got ${e.get_mesher_id()}`);
}
if (e.get_lod_transition_sample_count() !== 12) {
  throw new Error(`Expected 12 native LOD transition samples, got ${e.get_lod_transition_sample_count()}`);
}
if (e.get_lod_transition_algorithm_id() !== 1) {
  throw new Error(`Expected native LOD transition algorithm id 1, got ${e.get_lod_transition_algorithm_id()}`);
}
e.set_chunk_lod(1);
if (e.get_chunk_lod() !== 1 || e.get_cell_size() !== 2 || e.get_chunk_world_size() !== 64) {
  throw new Error(`LOD 1 did not configure 2m cells / 64m chunks: lod=${e.get_chunk_lod()}, cell=${e.get_cell_size()}, chunk=${e.get_chunk_world_size()}`);
}
e.set_chunk_lod(0);

const transitionPositions = new Float32Array(e.memory.buffer, e.get_lod_transition_position_ptr(), e.get_lod_transition_sample_count() * 3);
const transitionDensities = new Float32Array(e.memory.buffer, e.get_lod_transition_density_ptr(), e.get_lod_transition_sample_count());
transitionPositions.set([
  -0.5, 0, 0,
  -0.5, 0, 1,
  -0.5, 1, 0,
  -0.5, 1, 1,
  0, 0, 0,
  1, 0, 0,
  0, 1, 0,
  1, 1, 0,
  0, 0, 1,
  1, 0, 1,
  0, 1, 1,
  1, 1, 1
]);
for (let i = 0; i < transitionDensities.length; i++) {
  const o = i * 3;
  transitionDensities[i] = transitionPositions[o] + transitionPositions[o + 1] + transitionPositions[o + 2] - 1.05;
}
const transitionMeshSummaries = [];
for (const side of [0, 1, 2, 3]) {
  const vertexCount = e.generate_lod_transition_cell_mesh(side);
  const indexCount = e.get_index_count();
  if (vertexCount <= 0 || indexCount <= 0) {
    throw new Error(`Native LOD transition side ${side} generated an empty mesh: ${vertexCount}/${indexCount}`);
  }
  if (indexCount % 3 !== 0) {
    throw new Error(`Native LOD transition side ${side} produced non-triangle-list index count ${indexCount}`);
  }
  if (e.get_overflow() !== 0) {
    throw new Error(`Native LOD transition side ${side} overflowed mesh buffers`);
  }
  const transitionBounds = [
    e.get_bounds_min_x(),
    e.get_bounds_min_y(),
    e.get_bounds_min_z(),
    e.get_bounds_max_x(),
    e.get_bounds_max_y(),
    e.get_bounds_max_z()
  ];
  if (!transitionBounds.every(Number.isFinite)) {
    throw new Error(`Native LOD transition side ${side} produced non-finite bounds: ${transitionBounds.join(', ')}`);
  }
  if (!(transitionBounds[0] <= transitionBounds[3] && transitionBounds[1] <= transitionBounds[4] && transitionBounds[2] <= transitionBounds[5])) {
    throw new Error(`Native LOD transition side ${side} produced inverted bounds: ${transitionBounds.join(', ')}`);
  }
  const transitionIndices = new Uint32Array(e.memory.buffer, e.get_index_ptr(), indexCount);
  for (let i = 0; i < transitionIndices.length; i++) {
    if (transitionIndices[i] >= vertexCount) {
      throw new Error(`Native LOD transition side ${side} index ${i} references ${transitionIndices[i]} beyond ${vertexCount}`);
    }
  }
  transitionMeshSummaries.push(`${vertexCount}v/${indexCount / 3}t`);
}

e.clear_edits();
e.generate_chunk(0, 0, 0, 0);
const verticesBefore = e.get_vertex_count();
const indicesBefore = e.get_index_count();
const h = e.get_terrain_height(0, 0);
const worldgenSamples = e.generate_worldgen_tile(0, 0);
const worldgenFieldCount = e.get_worldgen_tile_field_count();
if (worldgenSamples !== e.get_worldgen_tile_sample_count()) {
  throw new Error(`Native worldgen tile wrote ${worldgenSamples} samples, expected ${e.get_worldgen_tile_sample_count()}`);
}
const worldgenFields = new Float32Array(e.memory.buffer, e.get_worldgen_tile_field_ptr(), worldgenSamples * worldgenFieldCount);
const worldgenBiomeIds = new Uint8Array(e.memory.buffer, e.get_worldgen_tile_biome_id_ptr(), worldgenSamples);
const worldgenWaterIds = new Uint8Array(e.memory.buffer, e.get_worldgen_tile_water_id_ptr(), worldgenSamples);
const worldgenRiverIds = new Uint16Array(e.memory.buffer, e.get_worldgen_tile_river_id_ptr(), worldgenSamples);
if (Math.abs(worldgenFields[0] - h) > 0.001) {
  throw new Error(`Native worldgen tile height origin mismatch: ${worldgenFields[0]} vs ${h}`);
}
for (let sample = 0; sample < worldgenSamples; sample++) {
  const base = sample * worldgenFieldCount;
  const normalizedFields = [2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 27, 31];
  for (const fieldIndex of normalizedFields) {
    const value = worldgenFields[base + fieldIndex];
    if (!Number.isFinite(value) || value < -0.0001 || value > 1.0001) {
      throw new Error(`Native worldgen tile normalized field ${fieldIndex} out of range at sample ${sample}: ${value}`);
    }
  }
  for (const fieldIndex of [0, 1, 11, 12, 13, 14, 26, 28, 29, 30]) {
    const value = worldgenFields[base + fieldIndex];
    if (!Number.isFinite(value)) {
      throw new Error(`Native worldgen tile field ${fieldIndex} is not finite at sample ${sample}: ${value}`);
    }
  }
  const basinId = worldgenFields[base + 28];
  const streamOrder = worldgenFields[base + 29];
  const channelWidth = worldgenFields[base + 30];
  if (basinId < 0 || basinId > 65535 || Math.round(basinId) !== basinId) {
    throw new Error(`Native worldgen drainage basin id out of range at sample ${sample}: ${basinId}`);
  }
  if (streamOrder < 0 || streamOrder > 4 || Math.round(streamOrder) !== streamOrder) {
    throw new Error(`Native worldgen stream order out of range at sample ${sample}: ${streamOrder}`);
  }
  if (channelWidth < 0 || channelWidth > 64) {
    throw new Error(`Native worldgen channel width out of range at sample ${sample}: ${channelWidth}`);
  }
  const weightSum = worldgenFields[base + 16] + worldgenFields[base + 17] + worldgenFields[base + 18] + worldgenFields[base + 19] + worldgenFields[base + 20] + worldgenFields[base + 21];
  if (Math.abs(weightSum - 1) > 0.001) {
    throw new Error(`Native worldgen biome weights should sum to 1, got ${weightSum} at sample ${sample}`);
  }
  const materialWeightSum = worldgenFields[base + 22] + worldgenFields[base + 23] + worldgenFields[base + 24] + worldgenFields[base + 25];
  if (Math.abs(materialWeightSum - 1) > 0.001) {
    throw new Error(`Native worldgen material weights should sum to 1, got ${materialWeightSum} at sample ${sample}`);
  }
  if (worldgenBiomeIds[sample] > 5) throw new Error(`Native worldgen biome id out of range at sample ${sample}: ${worldgenBiomeIds[sample]}`);
  if (worldgenWaterIds[sample] > 2) throw new Error(`Native worldgen water id out of range at sample ${sample}: ${worldgenWaterIds[sample]}`);
  if (worldgenRiverIds[sample] < 0 || worldgenRiverIds[sample] > 65535) throw new Error(`Native worldgen river id out of range at sample ${sample}: ${worldgenRiverIds[sample]}`);
}
const erosionSamples = e.generate_erosion_tile(0, 0);
const erosionFieldCount = e.get_erosion_tile_field_count();
if (erosionSamples !== e.get_erosion_tile_sample_count()) {
  throw new Error(`Native erosion tile wrote ${erosionSamples} samples, expected ${e.get_erosion_tile_sample_count()}`);
}
const erosionFields = new Float32Array(e.memory.buffer, e.get_erosion_tile_field_ptr(), erosionSamples * erosionFieldCount);
if (Math.abs(erosionFields[0] - h) > 0.001) {
  throw new Error(`Native erosion tile height origin mismatch: ${erosionFields[0]} vs ${h}`);
}
for (let sample = 0; sample < erosionSamples; sample++) {
  const base = sample * erosionFieldCount;
  for (let fieldIndex = 0; fieldIndex < erosionFieldCount; fieldIndex++) {
    const value = erosionFields[base + fieldIndex];
    if (!Number.isFinite(value)) throw new Error(`Native erosion tile field ${fieldIndex} is not finite at sample ${sample}: ${value}`);
    if (fieldIndex !== 0 && (value < -0.0001 || value > 1.0001)) {
      throw new Error(`Native erosion normalized field ${fieldIndex} out of range at sample ${sample}: ${value}`);
    }
  }
}
const materialSamples = e.generate_material_tile(0, 0);
const materialFieldCount = e.get_material_tile_field_count();
if (materialSamples !== e.get_material_tile_sample_count()) {
  throw new Error(`Native material tile wrote ${materialSamples} samples, expected ${e.get_material_tile_sample_count()}`);
}
const materialFields = new Float32Array(e.memory.buffer, e.get_material_tile_field_ptr(), materialSamples * materialFieldCount);
const materialIds = new Uint8Array(e.memory.buffer, e.get_material_tile_id_ptr(), materialSamples);
for (let sample = 0; sample < materialSamples; sample++) {
  const base = sample * materialFieldCount;
  for (let fieldIndex = 0; fieldIndex < materialFieldCount; fieldIndex++) {
    const value = materialFields[base + fieldIndex];
    if (!Number.isFinite(value)) throw new Error(`Native material tile field ${fieldIndex} is not finite at sample ${sample}: ${value}`);
    if (value < -0.0001 || value > 1.0001) {
      throw new Error(`Native material normalized field ${fieldIndex} out of range at sample ${sample}: ${value}`);
    }
  }
  const weightSum = materialFields[base + 0] + materialFields[base + 1] + materialFields[base + 2] + materialFields[base + 3];
  if (Math.abs(weightSum - 1) > 0.001) {
    throw new Error(`Native material weights should sum to 1, got ${weightSum} at sample ${sample}`);
  }
  if (materialIds[sample] > 3) throw new Error(`Native material id out of range at sample ${sample}: ${materialIds[sample]}`);
}
const caveGraphPassagesWritten = e.generate_cave_graph_tile(0, 0);
const caveGraphPassageCount = e.get_cave_graph_passage_count();
const caveGraphChamberCount = e.get_cave_graph_chamber_count();
const caveGraphPassageFieldCount = e.get_cave_graph_passage_field_count();
const caveGraphChamberFieldCount = e.get_cave_graph_chamber_field_count();
if (caveGraphPassagesWritten !== caveGraphPassageCount) {
  throw new Error(`Native cave graph returned ${caveGraphPassagesWritten} passages but reports ${caveGraphPassageCount}`);
}
if (caveGraphPassageCount <= 0 || caveGraphPassageCount > e.get_cave_graph_max_passages()) {
  throw new Error(`Native cave graph passage count out of range: ${caveGraphPassageCount}`);
}
if (caveGraphChamberCount <= 0 || caveGraphChamberCount > e.get_cave_graph_max_chambers()) {
  throw new Error(`Native cave graph chamber count out of range: ${caveGraphChamberCount}`);
}
const caveGraphPassages = new Float32Array(e.memory.buffer, e.get_cave_graph_passage_ptr(), caveGraphPassageCount * caveGraphPassageFieldCount);
const caveGraphChambers = new Float32Array(e.memory.buffer, e.get_cave_graph_chamber_ptr(), caveGraphChamberCount * caveGraphChamberFieldCount);
for (let passage = 0; passage < caveGraphPassageCount; passage++) {
  const base = passage * caveGraphPassageFieldCount;
  for (let field = 0; field < caveGraphPassageFieldCount; field++) {
    const value = caveGraphPassages[base + field];
    if (!Number.isFinite(value)) throw new Error(`Native cave graph passage ${passage} field ${field} is not finite: ${value}`);
  }
  const kind = caveGraphPassages[base + 0];
  const radius = caveGraphPassages[base + 12];
  const length = caveGraphPassages[base + 13];
  const hook = caveGraphPassages[base + 15];
  if (kind < 0 || kind > 2 || Math.round(kind) !== kind) throw new Error(`Native cave graph passage kind out of range: ${kind}`);
  if (radius <= 0 || length <= 0) throw new Error(`Native cave graph passage ${passage} has invalid radius/length ${radius}/${length}`);
  if (hook < 0 || hook > 3 || Math.round(hook) !== hook) throw new Error(`Native cave graph passage biome hook out of range: ${hook}`);
}
for (let chamber = 0; chamber < caveGraphChamberCount; chamber++) {
  const base = chamber * caveGraphChamberFieldCount;
  for (let field = 0; field < caveGraphChamberFieldCount; field++) {
    const value = caveGraphChambers[base + field];
    if (!Number.isFinite(value)) throw new Error(`Native cave graph chamber ${chamber} field ${field} is not finite: ${value}`);
  }
  const radius = caveGraphChambers[base + 4];
  const hasShaft = caveGraphChambers[base + 5];
  const hook = caveGraphChambers[base + 6];
  if (radius <= 0) throw new Error(`Native cave graph chamber ${chamber} has invalid radius ${radius}`);
  if (hasShaft !== 0 && hasShaft !== 1) throw new Error(`Native cave graph chamber hasShaft out of range: ${hasShaft}`);
  if (hook < 0 || hook > 3 || Math.round(hook) !== hook) throw new Error(`Native cave graph chamber biome hook out of range: ${hook}`);
}
for (const [x, z] of [
  [0, 0],
  [128, -256],
  [-512, 384]
]) {
  const continent = e.get_macro_continent(x, z);
  if (!Number.isFinite(continent) || continent < -1 || continent > 1) {
    throw new Error(`Expected macro continent field to be finite in [-1,1], got ${continent} at ${x},${z}`);
  }
  for (const [name, value] of [
    ['moisture', e.get_moisture_mask(x, z)],
    ['temperature', e.get_temperature_mask(x, z)]
  ]) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`Expected ${name} climate field to be normalized, got ${value} at ${x},${z}`);
    }
  }
}
const caveDistance = e.get_cave_distance(0, h - 8, 0);
if (!Number.isFinite(caveDistance) || caveDistance < -128 || caveDistance > 256) {
  throw new Error(`Expected cave distance probe to be finite and bounded, got ${caveDistance}`);
}
for (const [name, value] of [
  ['biome', e.get_biome_mask(0, 0)],
  ['wetness', e.get_wetness_mask(0, h, 0, 1)],
  ['snow', e.get_snow_mask(0, h + 48, 0, 1)],
  ['drainage', e.get_drainage_mask(0, 0)],
  ['erosion', e.get_erosion_mask(0, 0, 0.75)],
  ['vegetation', e.get_vegetation_mask(0, 0)]
]) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Expected ${name} mask to be normalized, got ${value}`);
  }
}
if (verticesBefore <= 0 || indicesBefore <= 0) {
  throw new Error(`Expected non-empty generated chunk, got ${verticesBefore} vertices and ${indicesBefore} indices`);
}
if (indicesBefore % 3 !== 0) {
  throw new Error(`Expected triangle-list index count to be divisible by 3, got ${indicesBefore}`);
}
if (e.get_overflow() !== 0) {
  throw new Error('WASM terrain mesh buffer overflowed during smoke test');
}
if (!(e.get_bounds_min_x() <= e.get_bounds_max_x() && e.get_bounds_min_y() <= e.get_bounds_max_y() && e.get_bounds_min_z() <= e.get_bounds_max_z())) {
  throw new Error('WASM terrain bounds were not populated correctly');
}
const vertexBytes = new Uint8Array(e.memory.buffer, e.get_vertex_ptr(), verticesBefore * e.get_vertex_stride());
const indices = new Uint32Array(e.memory.buffer, e.get_index_ptr(), indicesBefore);
for (let i = 0; i < indices.length; i++) {
  if (indices[i] >= verticesBefore) {
    throw new Error(`Generated mesh index ${i} references vertex ${indices[i]} beyond ${verticesBefore}`);
  }
}
let maskBytes = 0;
for (let i = 0; i < verticesBefore; i++) {
  const offset = i * e.get_vertex_stride();
  maskBytes += vertexBytes[offset + 13] + vertexBytes[offset + 14] + vertexBytes[offset + 15];
}
if (maskBytes <= 0) {
  throw new Error('Expected generated terrain vertices to carry biome/wetness/snow mask bytes');
}
const density = new Int16Array(e.memory.buffer, e.get_density_ptr(), e.get_density_count());
if (density.length !== 33 * 33 * 33) {
  throw new Error(`Expected copied density view to have 33^3 samples, got ${density.length}`);
}
const densityCopy = new Int16Array(density);
const verticesFromCache = e.mesh_cached_chunk(0, 0, 0, 0);
if (verticesFromCache !== verticesBefore) {
  throw new Error(`Cached-density remesh vertex count changed: ${verticesFromCache} vs ${verticesBefore}`);
}
new Int16Array(e.memory.buffer, e.get_density_ptr(), e.get_density_count()).set(densityCopy);
const editedSamples = e.apply_subtract_sphere_to_density(0, 0, 0, 0, h - 2, 0, 8);
if (editedSamples <= 0) {
  throw new Error('Expected cached density edit to modify at least one sample');
}
const cachedEditVertices = e.mesh_cached_chunk(0, 0, 0, 0);
if (cachedEditVertices <= 0) {
  throw new Error('Cached-density edit remesh generated no vertices');
}

new Int16Array(e.memory.buffer, e.get_density_ptr(), e.get_density_count()).set(densityCopy);
const falloffSamples = e.apply_subtract_sphere_to_density_falloff(0, 0, 0, 0, h - 2, 0, 8, 2);
if (falloffSamples <= 0) {
  throw new Error('Expected cached density falloff carve to modify at least one sample');
}
const cachedFalloffVertices = e.mesh_cached_chunk(0, 0, 0, 0);
if (cachedFalloffVertices <= 0) {
  throw new Error('Cached-density falloff carve remesh generated no vertices');
}

new Int16Array(e.memory.buffer, e.get_density_ptr(), e.get_density_count()).set(densityCopy);
const builtSamples = e.apply_add_sphere_to_density(0, 0, 0, 0, h + 8, 0, 6);
if (builtSamples <= 0) {
  throw new Error('Expected cached density build edit to modify at least one sample');
}
const cachedBuildVertices = e.mesh_cached_chunk(0, 0, 0, 0);
if (cachedBuildVertices <= 0) {
  throw new Error('Cached-density build remesh generated no vertices');
}

new Int16Array(e.memory.buffer, e.get_density_ptr(), e.get_density_count()).set(densityCopy);
const boxSamples = e.apply_subtract_box_to_density(0, 0, 0, 0, h - 2, 0, 6);
if (boxSamples <= 0) {
  throw new Error('Expected cached density box carve to modify at least one sample');
}
if (e.mesh_cached_chunk(0, 0, 0, 0) <= 0) {
  throw new Error('Cached-density box carve remesh generated no vertices');
}

new Int16Array(e.memory.buffer, e.get_density_ptr(), e.get_density_count()).set(densityCopy);
const capsuleSamples = e.apply_add_capsule_to_density(0, 0, 0, 0, h + 8, 0, 4, 1, 0, 0, 18);
if (capsuleSamples <= 0) {
  throw new Error('Expected cached density capsule build to modify at least one sample');
}
if (e.mesh_cached_chunk(0, 0, 0, 0) <= 0) {
  throw new Error('Cached-density capsule build remesh generated no vertices');
}

new Int16Array(e.memory.buffer, e.get_density_ptr(), e.get_density_count()).set(densityCopy);
if (e.apply_add_box_to_density_falloff(0, 0, 0, 0, h + 8, 0, 5, 1.5) <= 0) {
  throw new Error('Expected cached density falloff box build to modify at least one sample');
}
if (e.mesh_cached_chunk(0, 0, 0, 0) <= 0) {
  throw new Error('Cached-density falloff box build remesh generated no vertices');
}

new Int16Array(e.memory.buffer, e.get_density_ptr(), e.get_density_count()).set(densityCopy);
if (e.apply_subtract_capsule_to_density_falloff(0, 0, 0, 0, h - 2, 0, 4, 1, 0, 0, 18, 1.5) <= 0) {
  throw new Error('Expected cached density falloff capsule carve to modify at least one sample');
}
if (e.mesh_cached_chunk(0, 0, 0, 0) <= 0) {
  throw new Error('Cached-density falloff capsule carve remesh generated no vertices');
}

new Int16Array(e.memory.buffer, e.get_density_ptr(), e.get_density_count()).set(densityCopy);
const smoothSamples = e.apply_smooth_sphere_to_density(0, 0, 0, 0, h - 1, 0, 10, 0.7);
if (smoothSamples <= 0) {
  throw new Error('Expected cached density smooth edit to modify at least one sample');
}
if (e.mesh_cached_chunk(0, 0, 0, 0) <= 0) {
  throw new Error('Cached-density smooth remesh generated no vertices');
}

new Int16Array(e.memory.buffer, e.get_density_ptr(), e.get_density_count()).set(densityCopy);
const smoothBoxSamples = e.apply_smooth_box_to_density(0, 0, 0, 0, h - 1, 0, 8, 0.5);
if (smoothBoxSamples <= 0) {
  throw new Error('Expected cached density box smooth edit to modify at least one sample');
}

new Int16Array(e.memory.buffer, e.get_density_ptr(), e.get_density_count()).set(densityCopy);
const smoothCapsuleSamples = e.apply_smooth_capsule_to_density(0, 0, 0, 0, h - 1, 0, 5, 1, 0, 0, 18, 0.5);
if (smoothCapsuleSamples <= 0) {
  throw new Error('Expected cached density capsule smooth edit to modify at least one sample');
}

new Int16Array(e.memory.buffer, e.get_density_ptr(), e.get_density_count()).set(densityCopy);
const flattenSamples = e.apply_flatten_sphere_to_density(0, 0, 0, 0, h - 1, 0, 10, 0.7);
if (flattenSamples <= 0) {
  throw new Error('Expected cached density flatten edit to modify at least one sample');
}
if (e.mesh_cached_chunk(0, 0, 0, 0) <= 0) {
  throw new Error('Cached-density flatten remesh generated no vertices');
}

new Int16Array(e.memory.buffer, e.get_density_ptr(), e.get_density_count()).set(densityCopy);
const flattenBoxSamples = e.apply_flatten_box_to_density(0, 0, 0, 0, h - 1, 0, 8, 0.5);
if (flattenBoxSamples <= 0) {
  throw new Error('Expected cached density box flatten edit to modify at least one sample');
}

new Int16Array(e.memory.buffer, e.get_density_ptr(), e.get_density_count()).set(densityCopy);
const flattenCapsuleSamples = e.apply_flatten_capsule_to_density(0, 0, 0, 0, h - 1, 0, 5, 1, 0, 0, 18, 0.5);
if (flattenCapsuleSamples <= 0) {
  throw new Error('Expected cached density capsule flatten edit to modify at least one sample');
}

new Int16Array(e.memory.buffer, e.get_density_ptr(), e.get_density_count()).set(densityCopy);
e.clear_edits();
const paintCenterH = e.get_terrain_height(16, 16);
const painted = e.add_paint_sphere(16, paintCenterH, 16, 128, 2);
if (painted !== 1) throw new Error('Failed to add runtime material paint sphere');
e.generate_chunk(0, 0, 0, 0);
const verticesPainted = e.get_vertex_count();
if (verticesPainted <= 0) {
  throw new Error('Paint-edited chunk generated no vertices');
}
const paintedDensity = new Int16Array(e.memory.buffer, e.get_density_ptr(), e.get_density_count());
for (let i = 0; i < densityCopy.length; i++) {
  if (paintedDensity[i] !== densityCopy[i]) {
    throw new Error(`Material paint changed density sample ${i}: ${paintedDensity[i]} vs ${densityCopy[i]}`);
  }
}
const paintedVertexBytes = new Uint8Array(e.memory.buffer, e.get_vertex_ptr(), verticesPainted * e.get_vertex_stride());
for (let i = 0; i < verticesPainted; i++) {
  const material = paintedVertexBytes[i * e.get_vertex_stride() + 12];
  if (material !== 2) {
    throw new Error(`Expected full-chunk material paint to write material 2, got ${material} at vertex ${i}`);
  }
}

e.clear_edits();
if (e.add_paint_box(16, paintCenterH, 16, 128, 3) !== 1) throw new Error('Failed to add runtime material paint box');
if (e.add_paint_capsule(16, paintCenterH, 16, 128, 1, 0, 0, 32, 1) !== 1) throw new Error('Failed to add runtime material paint capsule');

e.clear_edits();
const smoothed = e.add_smooth_sphere(0, h - 1, 0, 10, 0.7);
if (smoothed !== 1) throw new Error('Failed to add runtime SDF smooth sphere');
e.generate_chunk(0, 0, 0, 0);
const verticesSmoothed = e.get_vertex_count();
if (verticesSmoothed <= 0) {
  throw new Error('Smooth-edited chunk generated no vertices');
}
e.clear_edits();
if (e.add_smooth_box(0, h - 1, 0, 8, 0.5) !== 1) throw new Error('Failed to add runtime SDF smooth box');
if (e.add_smooth_capsule(0, h - 1, 0, 5, 1, 0, 0, 18, 0.5) !== 1) throw new Error('Failed to add runtime SDF smooth capsule');

e.clear_edits();
const flattened = e.add_flatten_sphere(0, h - 1, 0, 10, 0.7);
if (flattened !== 1) throw new Error('Failed to add runtime SDF flatten sphere');
e.generate_chunk(0, 0, 0, 0);
const verticesFlattened = e.get_vertex_count();
if (verticesFlattened <= 0) {
  throw new Error('Flatten-edited chunk generated no vertices');
}
e.clear_edits();
if (e.add_flatten_box(0, h - 1, 0, 8, 0.5) !== 1) throw new Error('Failed to add runtime SDF flatten box');
if (e.add_flatten_capsule(0, h - 1, 0, 5, 1, 0, 0, 18, 0.5) !== 1) throw new Error('Failed to add runtime SDF flatten capsule');

e.clear_edits();
const edited = e.add_subtract_sphere(0, h - 2, 0, 8);
if (edited !== 1) throw new Error('Failed to add runtime SDF edit sphere');
e.generate_chunk(0, 0, 0, 0);
const verticesAfter = e.get_vertex_count();
if (verticesAfter <= 0) {
  throw new Error('Edited chunk generated no vertices');
}
e.clear_edits();
if (e.add_subtract_sphere_falloff(0, h - 2, 0, 8, 2) !== 1) throw new Error('Failed to add runtime SDF falloff carve sphere');
e.generate_chunk(0, 0, 0, 0);
const verticesFalloff = e.get_vertex_count();
if (verticesFalloff <= 0) {
  throw new Error('Falloff-edited chunk generated no vertices');
}
e.clear_edits();
const built = e.add_add_sphere(0, h + 8, 0, 6);
if (built !== 1) throw new Error('Failed to add runtime SDF build sphere');
e.generate_chunk(0, 0, 0, 0);
const verticesBuilt = e.get_vertex_count();
if (verticesBuilt <= 0) {
  throw new Error('Build-edited chunk generated no vertices');
}
e.clear_edits();
const boxEdited = e.add_subtract_box(0, h - 2, 0, 6);
if (boxEdited !== 1) throw new Error('Failed to add runtime SDF box carve');
e.generate_chunk(0, 0, 0, 0);
const verticesBox = e.get_vertex_count();
if (verticesBox <= 0) {
  throw new Error('Box-edited chunk generated no vertices');
}
e.clear_edits();
if (e.add_add_box_falloff(0, h + 8, 0, 5, 1.5) !== 1) throw new Error('Failed to add runtime SDF falloff box build');
if (e.add_subtract_capsule_falloff(0, h - 2, 0, 4, 1, 0, 0, 18, 1.5) !== 1) throw new Error('Failed to add runtime SDF falloff capsule carve');
e.generate_chunk(0, 0, 0, 0);
if (e.get_vertex_count() <= 0) {
  throw new Error('Falloff box/capsule edited chunk generated no vertices');
}
e.clear_edits();
const capsuleEdited = e.add_add_capsule(0, h + 8, 0, 4, 1, 0, 0, 18);
if (capsuleEdited !== 1) throw new Error('Failed to add runtime SDF capsule build');
e.generate_chunk(0, 0, 0, 0);
const verticesCapsule = e.get_vertex_count();
if (verticesCapsule <= 0) {
  throw new Error('Capsule-edited chunk generated no vertices');
}

console.log(`Smoke test passed: ${verticesBefore} vertices / ${indicesBefore} indices before edit, native transitions ${transitionMeshSummaries.join(', ')}, ${verticesAfter} after carve, ${verticesFalloff} after falloff carve, ${verticesBuilt} after build, ${verticesBox} after box, ${verticesCapsule} after capsule, ${verticesPainted} after paint, ${verticesSmoothed} after smooth, ${verticesFlattened} after flatten.`);
