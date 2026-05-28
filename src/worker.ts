import type {
  BrowserWorkerBenchmarkSceneResult,
  BrowserWorkerBenchmarkSummary,
  CaveGraphTileMessage,
  ErosionTileMessage,
  EditOperation,
  LodTransitionMeshMessage,
  MaterialTileMessage,
  WorldgenTileMessage,
  WorkerInboundMessage,
  WorkerOutboundMessage,
} from './engine_contracts';
import { PACKED_TERRAIN_VERTEX_STRIDE } from './terrain_mesh.ts';
import { WorkerScratchArena } from './worker_scratch.ts';

type GenerateMessage = Extract<WorkerInboundMessage, { type: 'generate' }>;
type RemeshDensityMessage = Extract<WorkerInboundMessage, { type: 'remeshDensity' }>;
type RemeshDensitySharedMessage = Extract<WorkerInboundMessage, { type: 'remeshDensityShared' }>;
type SharedGenerateMessage = GenerateMessage & { resultSlotIndex: number; resultSlotGeneration: number };
type GenerateLodTransitionMeshMessage = Extract<WorkerInboundMessage, { type: 'generateLodTransitionMesh' }>;

const BENCHMARK_SCENES = [
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
] as const;

interface VoxelCoreExports {
  memory: WebAssembly.Memory;
  generate_chunk(cx: number, cy: number, cz: number, lod: number): number;
  mesh_cached_chunk(cx: number, cy: number, cz: number, lod: number): number;
  generate_lod_transition_cell_mesh(side: number): number;
  generate_lod_transition_chunk_mesh(cellCount: number): number;
  set_chunk_lod(lod: number): void;
  get_chunk_lod(): number;
  apply_subtract_sphere_to_density(cx: number, cy: number, cz: number, x: number, y: number, z: number, radius: number): number;
  apply_add_sphere_to_density(cx: number, cy: number, cz: number, x: number, y: number, z: number, radius: number): number;
  apply_subtract_box_to_density(cx: number, cy: number, cz: number, x: number, y: number, z: number, radius: number): number;
  apply_add_box_to_density(cx: number, cy: number, cz: number, x: number, y: number, z: number, radius: number): number;
  apply_subtract_capsule_to_density(cx: number, cy: number, cz: number, x: number, y: number, z: number, radius: number, dx: number, dy: number, dz: number, length: number): number;
  apply_add_capsule_to_density(cx: number, cy: number, cz: number, x: number, y: number, z: number, radius: number, dx: number, dy: number, dz: number, length: number): number;
  apply_subtract_sphere_to_density_falloff(cx: number, cy: number, cz: number, x: number, y: number, z: number, radius: number, falloff: number): number;
  apply_add_sphere_to_density_falloff(cx: number, cy: number, cz: number, x: number, y: number, z: number, radius: number, falloff: number): number;
  apply_subtract_box_to_density_falloff(cx: number, cy: number, cz: number, x: number, y: number, z: number, radius: number, falloff: number): number;
  apply_add_box_to_density_falloff(cx: number, cy: number, cz: number, x: number, y: number, z: number, radius: number, falloff: number): number;
  apply_subtract_capsule_to_density_falloff(cx: number, cy: number, cz: number, x: number, y: number, z: number, radius: number, dx: number, dy: number, dz: number, length: number, falloff: number): number;
  apply_add_capsule_to_density_falloff(cx: number, cy: number, cz: number, x: number, y: number, z: number, radius: number, dx: number, dy: number, dz: number, length: number, falloff: number): number;
  apply_smooth_sphere_to_density(cx: number, cy: number, cz: number, x: number, y: number, z: number, radius: number, strength: number): number;
  apply_smooth_box_to_density(cx: number, cy: number, cz: number, x: number, y: number, z: number, radius: number, strength: number): number;
  apply_smooth_capsule_to_density(cx: number, cy: number, cz: number, x: number, y: number, z: number, radius: number, dx: number, dy: number, dz: number, length: number, strength: number): number;
  apply_flatten_sphere_to_density(cx: number, cy: number, cz: number, x: number, y: number, z: number, radius: number, strength: number): number;
  apply_flatten_box_to_density(cx: number, cy: number, cz: number, x: number, y: number, z: number, radius: number, strength: number): number;
  apply_flatten_capsule_to_density(cx: number, cy: number, cz: number, x: number, y: number, z: number, radius: number, dx: number, dy: number, dz: number, length: number, strength: number): number;
  get_vertex_count(): number;
  get_index_count(): number;
  get_vertex_ptr(): number;
  get_index_ptr(): number;
  get_density_ptr(): number;
  get_lod_transition_position_ptr(): number;
  get_lod_transition_density_ptr(): number;
  get_lod_transition_chunk_position_ptr(): number;
  get_lod_transition_chunk_density_ptr(): number;
  get_lod_transition_chunk_sides_ptr(): number;
  get_lod_transition_max_chunk_cells(): number;
  get_pack_origin_x(): number;
  get_pack_origin_y(): number;
  get_pack_origin_z(): number;
  get_pack_scale(): number;
  get_overflow(): number;
  get_vertex_stride(): number;
  get_density_stride(): number;
  get_density_count(): number;
  get_density_scale(): number;
  get_lod_transition_sample_count(): number;
  get_lod_transition_algorithm_id(): number;
  get_base_chunk_world_size(): number;
  get_chunk_world_size(): number;
  get_cell_size(): number;
  get_terrain_height(x: number, z: number): number;
  get_river_center(z: number): number;
  get_vegetation_mask(x: number, z: number): number;
  get_bounds_min_x(): number;
  get_bounds_min_y(): number;
  get_bounds_min_z(): number;
  get_bounds_max_x(): number;
  get_bounds_max_y(): number;
  get_bounds_max_z(): number;
  generate_worldgen_tile(tileX: number, tileZ: number): number;
  get_worldgen_tile_field_ptr(): number;
  get_worldgen_tile_biome_id_ptr(): number;
  get_worldgen_tile_water_id_ptr(): number;
  get_worldgen_tile_river_id_ptr(): number;
  get_worldgen_tile_resolution(): number;
  get_worldgen_tile_sample_count(): number;
  get_worldgen_tile_field_count(): number;
  get_worldgen_tile_size(): number;
  generate_erosion_tile(tileX: number, tileZ: number): number;
  get_erosion_tile_field_ptr(): number;
  get_erosion_tile_resolution(): number;
  get_erosion_tile_sample_count(): number;
  get_erosion_tile_field_count(): number;
  get_erosion_tile_schema_version(): number;
  get_erosion_tile_generator_version(): number;
  get_erosion_tile_size(): number;
  generate_material_tile(tileX: number, tileZ: number): number;
  get_material_tile_field_ptr(): number;
  get_material_tile_id_ptr(): number;
  get_material_tile_resolution(): number;
  get_material_tile_sample_count(): number;
  get_material_tile_field_count(): number;
  get_material_tile_schema_version(): number;
  get_material_tile_generator_version(): number;
  get_material_tile_size(): number;
  generate_cave_graph_tile(tileX: number, tileZ: number): number;
  get_cave_graph_passage_ptr(): number;
  get_cave_graph_chamber_ptr(): number;
  get_cave_graph_passage_count(): number;
  get_cave_graph_chamber_count(): number;
  get_cave_graph_passage_field_count(): number;
  get_cave_graph_chamber_field_count(): number;
  get_cave_graph_tile_schema_version(): number;
  get_cave_graph_tile_generator_version(): number;
  get_cave_graph_tile_size(): number;
  add_subtract_sphere(x: number, y: number, z: number, radius: number): number;
  add_add_sphere(x: number, y: number, z: number, radius: number): number;
  add_subtract_box(x: number, y: number, z: number, radius: number): number;
  add_add_box(x: number, y: number, z: number, radius: number): number;
  add_subtract_capsule(x: number, y: number, z: number, radius: number, dx: number, dy: number, dz: number, length: number): number;
  add_add_capsule(x: number, y: number, z: number, radius: number, dx: number, dy: number, dz: number, length: number): number;
  add_subtract_sphere_falloff(x: number, y: number, z: number, radius: number, falloff: number): number;
  add_add_sphere_falloff(x: number, y: number, z: number, radius: number, falloff: number): number;
  add_subtract_box_falloff(x: number, y: number, z: number, radius: number, falloff: number): number;
  add_add_box_falloff(x: number, y: number, z: number, radius: number, falloff: number): number;
  add_subtract_capsule_falloff(x: number, y: number, z: number, radius: number, dx: number, dy: number, dz: number, length: number, falloff: number): number;
  add_add_capsule_falloff(x: number, y: number, z: number, radius: number, dx: number, dy: number, dz: number, length: number, falloff: number): number;
  add_paint_sphere(x: number, y: number, z: number, radius: number, material: number): number;
  add_paint_box(x: number, y: number, z: number, radius: number, material: number): number;
  add_paint_capsule(x: number, y: number, z: number, radius: number, dx: number, dy: number, dz: number, length: number, material: number): number;
  add_smooth_sphere(x: number, y: number, z: number, radius: number, strength: number): number;
  add_smooth_box(x: number, y: number, z: number, radius: number, strength: number): number;
  add_smooth_capsule(x: number, y: number, z: number, radius: number, dx: number, dy: number, dz: number, length: number, strength: number): number;
  add_flatten_sphere(x: number, y: number, z: number, radius: number, strength: number): number;
  add_flatten_box(x: number, y: number, z: number, radius: number, strength: number): number;
  add_flatten_capsule(x: number, y: number, z: number, radius: number, dx: number, dy: number, dz: number, length: number, strength: number): number;
  clear_edits(): void;
}

interface WorkerScope {
  postMessage(message: WorkerOutboundMessage, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent<WorkerInboundMessage>) => void | Promise<void>) | null;
}

let wasm: WebAssembly.WebAssemblyInstantiatedSource | null = null;
let wasmExports: VoxelCoreExports | null = null;
let appliedEditVersion = 0;
const workerSelf = self as unknown as WorkerScope;
const scratchArena = new WorkerScratchArena();
const VEGETATION_SAMPLES_PER_CHUNK = 48;
const VEGETATION_INSTANCE_FLOATS = 8;
const SHARED_GENERATE_BATCH_SIZE = 4;
const SHARED_GENERATE_HEADER_INTS = 4;
const SHARED_GENERATE_JOB_INTS = 10;
const SHARED_GENERATE_STATUS = 0;
const SHARED_GENERATE_COUNT = 1;
const SHARED_GENERATE_JOB_BASE = SHARED_GENERATE_HEADER_INTS;
const SHARED_GENERATE_CX = 0;
const SHARED_GENERATE_CY = 1;
const SHARED_GENERATE_CZ = 2;
const SHARED_GENERATE_LOD = 3;
const SHARED_GENERATE_PRIORITY_MILLIS = 4;
const SHARED_GENERATE_VERSION = 5;
const SHARED_GENERATE_EDIT_VERSION = 6;
const SHARED_GENERATE_LOD_SEAM_MASK = 7;
const SHARED_GENERATE_RESULT_SLOT = 8;
const SHARED_GENERATE_RESULT_GENERATION = 9;
let sharedGenerateQueue: Int32Array | null = null;
let sharedRemeshDensitySamples: Int16Array | null = null;
let sharedResultArena: Uint8Array | null = null;
let sharedResultSlotCount = 0;

function align4(value: number): number {
  return (value + 3) & ~3;
}

function core(): VoxelCoreExports {
  if (!wasmExports) throw new Error('WASM core is not initialized.');
  return wasmExports;
}

async function init() {
  if (wasm) return;
  const bytes = await fetch('/voxel_core.wasm').then(r => {
    if (!r.ok) throw new Error(`Failed to load WASM: ${r.status}`);
    return r.arrayBuffer();
  });
  wasm = await WebAssembly.instantiate(bytes, {});
  wasmExports = wasm.instance.exports as unknown as VoxelCoreExports;
}

function rand01(x: number, y: number, salt = 0): number {
  let h = (Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(salt | 0, 0xcb1ab31f)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h & 0x00ffffff) / 16777215;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function terrainNormalY(e: VoxelCoreExports, x: number, z: number): number {
  const step = 4.0;
  const hL = e.get_terrain_height(x - step, z);
  const hR = e.get_terrain_height(x + step, z);
  const hD = e.get_terrain_height(x, z - step);
  const hU = e.get_terrain_height(x, z + step);
  const nx = hL - hR;
  const ny = step * 2.0;
  const nz = hD - hU;
  return ny / (Math.hypot(nx, ny, nz) || 1);
}

function generateVegetation(cx: number, cy: number, cz: number): Float32Array {
  if (cy !== 0) return new Float32Array(0);
  const e = core();
  const baseChunkSize = e.get_base_chunk_world_size();
  const chunkSize = e.get_chunk_world_size();
  const baseX = cx * baseChunkSize;
  const baseZ = cz * baseChunkSize;
  const values = scratchArena.acquireFloat32(VEGETATION_SAMPLES_PER_CHUNK * VEGETATION_INSTANCE_FLOATS);
  let cursor = 0;
  for (let i = 0; i < VEGETATION_SAMPLES_PER_CHUNK; i++) {
    const rx = rand01(cx, cz, i * 17 + 3);
    const rz = rand01(cx, cz, i * 31 + 9);
    const x = baseX + rx * chunkSize;
    const z = baseZ + rz * chunkSize;
    const h = e.get_terrain_height(x, z);
    const rc = e.get_river_center(z);
    const riverDistance = Math.abs(x - rc);
    const vegetationMask = e.get_vegetation_mask(x, z);
    const normalY = terrainNormalY(e, x, z);
    const rockMask = clamp01((0.62 - normalY) * 1.75 + (h - 34) / 130 + (riverDistance - 30) / 260);
    const rockRoll = rand01(cx - i, cz + i, 177);
    if (h > 8 && h < 138 && riverDistance > 18 && rockMask > 0.20 && rockRoll < Math.min(0.30, rockMask * 0.24)) {
      const scale = (0.85 + rand01(cx, cz, 260 + i) * 2.25) * (1.0 + (1.0 - normalY) * 0.65);
      values[cursor++] = x;
      values[cursor++] = h - 0.08;
      values[cursor++] = z;
      values[cursor++] = scale;
      values[cursor++] = 2;
      values[cursor++] = rand01(cx, cz, 400 + i) * 100.0;
      values[cursor++] = rockMask;
      values[cursor++] = rand01(cx, cz, 440 + i);
      continue;
    }

    if (h < 7 || h > 82 || riverDistance < 34 || vegetationMask < 0.10 || normalY < 0.34) continue;
    const densityRoll = rand01(cx + i, cz - i, 123);
    if (densityRoll > Math.min(0.58, vegetationMask * 0.86 + 0.04)) continue;
    const pineChance = Math.min(0.80, vegetationMask * 1.34 + 0.05);
    const type = vegetationMask > 0.30 && densityRoll < pineChance ? 1 : 0; // 0 grass/shrub, 1 pine
    const scaleBias = 0.82 + vegetationMask * 0.48;
    const scale = (type === 1 ? 4.8 + rand01(cx, cz, 200 + i) * 7.0 : 0.55 + rand01(cx, cz, 300 + i) * 1.35) * scaleBias;
    values[cursor++] = x;
    values[cursor++] = h - 0.15;
    values[cursor++] = z;
    values[cursor++] = scale;
    values[cursor++] = type;
    values[cursor++] = rand01(cx, cz, 400 + i) * 100.0;
    values[cursor++] = vegetationMask;
    values[cursor++] = rand01(cx, cz, 440 + i);
  }
  return scratchArena.copyFloat32(values.subarray(0, cursor));
}

function keyFromJob(job: GenerateMessage | RemeshDensityMessage): string { return `${job.cx},${job.cy},${job.cz},${job.lod ?? 0}`; }

function readSharedGenerateJobs(): SharedGenerateMessage[] {
  if (!sharedGenerateQueue) throw new Error('Shared generate queue is not initialized.');
  const status = Atomics.exchange(sharedGenerateQueue, SHARED_GENERATE_STATUS, 0);
  if (status !== 1) throw new Error(`Shared generate queue had no pending job; status=${status}.`);
  const count = Math.max(1, Math.min(SHARED_GENERATE_BATCH_SIZE, Atomics.load(sharedGenerateQueue, SHARED_GENERATE_COUNT)));
  const jobs: SharedGenerateMessage[] = [];
  for (let index = 0; index < count; index++) {
    const offset = SHARED_GENERATE_JOB_BASE + index * SHARED_GENERATE_JOB_INTS;
    const cx = Atomics.load(sharedGenerateQueue, offset + SHARED_GENERATE_CX);
    const cy = Atomics.load(sharedGenerateQueue, offset + SHARED_GENERATE_CY);
    const cz = Atomics.load(sharedGenerateQueue, offset + SHARED_GENERATE_CZ);
    const lod = Atomics.load(sharedGenerateQueue, offset + SHARED_GENERATE_LOD);
    jobs.push({
      type: 'generate',
      key: `${cx},${cy},${cz},${lod}`,
      cx,
      cy,
      cz,
      lod,
      lodSeamMask: Atomics.load(sharedGenerateQueue, offset + SHARED_GENERATE_LOD_SEAM_MASK),
      priority: Atomics.load(sharedGenerateQueue, offset + SHARED_GENERATE_PRIORITY_MILLIS) / 1000,
      version: Atomics.load(sharedGenerateQueue, offset + SHARED_GENERATE_VERSION),
      editVersion: Atomics.load(sharedGenerateQueue, offset + SHARED_GENERATE_EDIT_VERSION),
      resultSlotIndex: Atomics.load(sharedGenerateQueue, offset + SHARED_GENERATE_RESULT_SLOT),
      resultSlotGeneration: Atomics.load(sharedGenerateQueue, offset + SHARED_GENERATE_RESULT_GENERATION),
    });
  }
  return jobs;
}

function readSharedRemeshJob(msg: RemeshDensitySharedMessage): RemeshDensityMessage {
  if (!sharedRemeshDensitySamples) throw new Error('Shared remesh density page is not initialized.');
  if (msg.densitySampleCount > sharedRemeshDensitySamples.length) {
    throw new Error(`Shared remesh density page is too small: ${msg.densitySampleCount} > ${sharedRemeshDensitySamples.length}.`);
  }
  return {
    type: 'remeshDensity',
    key: msg.key,
    cx: msg.cx,
    cy: msg.cy,
    cz: msg.cz,
    lod: msg.lod ?? 0,
    lodSeamMask: msg.lodSeamMask ?? 0,
    priority: msg.priority,
    version: msg.version,
    editVersion: msg.editVersion,
    mode: 'remeshDensity',
    densitySamples: sharedRemeshDensitySamples.subarray(0, msg.densitySampleCount),
    editsToApply: msg.editsToApply,
  };
}

function capsuleArgs(edit: EditOperation): [number, number, number, number] {
  return [edit.dx ?? 0, edit.dy ?? 0, edit.dz ?? 1, Math.max(0, edit.length ?? 0)];
}

function editFalloff(edit: EditOperation): number {
  return Math.max(0, Math.min(8, Number(edit.falloff ?? 0)));
}

function addEdit(e: VoxelCoreExports, edit: EditOperation): void {
  const shape = edit.shape ?? 'sphere';
  const material = Math.max(0, Math.min(255, Math.trunc(edit.material ?? 0)));
  const strength = Math.max(0.05, Math.min(1, Number(edit.strength ?? 0.55)));
  if (edit.type === 'subtractSphere') {
    const falloff = editFalloff(edit);
    if (shape === 'box') {
      if (falloff > 0) e.add_subtract_box_falloff(edit.x, edit.y, edit.z, edit.radius, falloff);
      else e.add_subtract_box(edit.x, edit.y, edit.z, edit.radius);
    } else if (shape === 'capsule') {
      if (falloff > 0) e.add_subtract_capsule_falloff(edit.x, edit.y, edit.z, edit.radius, ...capsuleArgs(edit), falloff);
      else e.add_subtract_capsule(edit.x, edit.y, edit.z, edit.radius, ...capsuleArgs(edit));
    } else if (falloff > 0) e.add_subtract_sphere_falloff(edit.x, edit.y, edit.z, edit.radius, falloff);
    else e.add_subtract_sphere(edit.x, edit.y, edit.z, edit.radius);
  } else if (edit.type === 'addSphere') {
    const falloff = editFalloff(edit);
    if (shape === 'box') {
      if (falloff > 0) e.add_add_box_falloff(edit.x, edit.y, edit.z, edit.radius, falloff);
      else e.add_add_box(edit.x, edit.y, edit.z, edit.radius);
    } else if (shape === 'capsule') {
      if (falloff > 0) e.add_add_capsule_falloff(edit.x, edit.y, edit.z, edit.radius, ...capsuleArgs(edit), falloff);
      else e.add_add_capsule(edit.x, edit.y, edit.z, edit.radius, ...capsuleArgs(edit));
    } else if (falloff > 0) e.add_add_sphere_falloff(edit.x, edit.y, edit.z, edit.radius, falloff);
    else e.add_add_sphere(edit.x, edit.y, edit.z, edit.radius);
  } else if (edit.type === 'paintMaterial') {
    if (shape === 'box') e.add_paint_box(edit.x, edit.y, edit.z, edit.radius, material);
    else if (shape === 'capsule') e.add_paint_capsule(edit.x, edit.y, edit.z, edit.radius, ...capsuleArgs(edit), material);
    else e.add_paint_sphere(edit.x, edit.y, edit.z, edit.radius, material);
  } else if (edit.type === 'smoothDensity') {
    if (shape === 'box') e.add_smooth_box(edit.x, edit.y, edit.z, edit.radius, strength);
    else if (shape === 'capsule') e.add_smooth_capsule(edit.x, edit.y, edit.z, edit.radius, ...capsuleArgs(edit), strength);
    else e.add_smooth_sphere(edit.x, edit.y, edit.z, edit.radius, strength);
  } else if (edit.type === 'flattenDensity') {
    if (shape === 'box') e.add_flatten_box(edit.x, edit.y, edit.z, edit.radius, strength);
    else if (shape === 'capsule') e.add_flatten_capsule(edit.x, edit.y, edit.z, edit.radius, ...capsuleArgs(edit), strength);
    else e.add_flatten_sphere(edit.x, edit.y, edit.z, edit.radius, strength);
  }
}

function applyDensityEdit(e: VoxelCoreExports, job: RemeshDensityMessage, edit: EditOperation): void {
  if (edit.type === 'paintMaterial') return;
  const shape = edit.shape ?? 'sphere';
  const strength = Math.max(0.05, Math.min(1, Number(edit.strength ?? 0.55)));
  if (edit.type === 'subtractSphere') {
    const falloff = editFalloff(edit);
    if (shape === 'box') {
      if (falloff > 0) e.apply_subtract_box_to_density_falloff(job.cx, job.cy, job.cz, edit.x, edit.y, edit.z, edit.radius, falloff);
      else e.apply_subtract_box_to_density(job.cx, job.cy, job.cz, edit.x, edit.y, edit.z, edit.radius);
    } else if (shape === 'capsule') {
      if (falloff > 0) e.apply_subtract_capsule_to_density_falloff(job.cx, job.cy, job.cz, edit.x, edit.y, edit.z, edit.radius, ...capsuleArgs(edit), falloff);
      else e.apply_subtract_capsule_to_density(job.cx, job.cy, job.cz, edit.x, edit.y, edit.z, edit.radius, ...capsuleArgs(edit));
    } else if (falloff > 0) e.apply_subtract_sphere_to_density_falloff(job.cx, job.cy, job.cz, edit.x, edit.y, edit.z, edit.radius, falloff);
    else e.apply_subtract_sphere_to_density(job.cx, job.cy, job.cz, edit.x, edit.y, edit.z, edit.radius);
  } else if (edit.type === 'addSphere') {
    const falloff = editFalloff(edit);
    if (shape === 'box') {
      if (falloff > 0) e.apply_add_box_to_density_falloff(job.cx, job.cy, job.cz, edit.x, edit.y, edit.z, edit.radius, falloff);
      else e.apply_add_box_to_density(job.cx, job.cy, job.cz, edit.x, edit.y, edit.z, edit.radius);
    } else if (shape === 'capsule') {
      if (falloff > 0) e.apply_add_capsule_to_density_falloff(job.cx, job.cy, job.cz, edit.x, edit.y, edit.z, edit.radius, ...capsuleArgs(edit), falloff);
      else e.apply_add_capsule_to_density(job.cx, job.cy, job.cz, edit.x, edit.y, edit.z, edit.radius, ...capsuleArgs(edit));
    } else if (falloff > 0) e.apply_add_sphere_to_density_falloff(job.cx, job.cy, job.cz, edit.x, edit.y, edit.z, edit.radius, falloff);
    else e.apply_add_sphere_to_density(job.cx, job.cy, job.cz, edit.x, edit.y, edit.z, edit.radius);
  } else if (edit.type === 'smoothDensity') {
    if (shape === 'box') e.apply_smooth_box_to_density(job.cx, job.cy, job.cz, edit.x, edit.y, edit.z, edit.radius, strength);
    else if (shape === 'capsule') e.apply_smooth_capsule_to_density(job.cx, job.cy, job.cz, edit.x, edit.y, edit.z, edit.radius, ...capsuleArgs(edit), strength);
    else e.apply_smooth_sphere_to_density(job.cx, job.cy, job.cz, edit.x, edit.y, edit.z, edit.radius, strength);
  } else if (edit.type === 'flattenDensity') {
    if (shape === 'box') e.apply_flatten_box_to_density(job.cx, job.cy, job.cz, edit.x, edit.y, edit.z, edit.radius, strength);
    else if (shape === 'capsule') e.apply_flatten_capsule_to_density(job.cx, job.cy, job.cz, edit.x, edit.y, edit.z, edit.radius, ...capsuleArgs(edit), strength);
    else e.apply_flatten_sphere_to_density(job.cx, job.cy, job.cz, edit.x, edit.y, edit.z, edit.radius, strength);
  }
}

function applyEditLog(version: number, edits: EditOperation[]): void {
  const e = core();
  e.clear_edits();
  for (const edit of edits) addEdit(e, edit);
  appliedEditVersion = version;
}

function timeMs<T>(fn: () => T): { result: T; ms: number } {
  const start = performance.now();
  const result = fn();
  return { result, ms: performance.now() - start };
}

function densityCopy(e: VoxelCoreExports): Int16Array {
  return new Int16Array(new Int16Array(e.memory.buffer, e.get_density_ptr(), e.get_density_count()));
}

function restoreDensity(e: VoxelCoreExports, samples: Int16Array): void {
  new Int16Array(e.memory.buffer, e.get_density_ptr(), e.get_density_count()).set(samples);
}

function assertBenchmarkMesh(e: VoxelCoreExports, label: string): { vertices: number; indices: number } {
  const vertices = e.get_vertex_count();
  const indices = e.get_index_count();
  if (vertices <= 0 || indices <= 0) throw new Error(`${label} generated an empty mesh`);
  if (e.get_overflow() !== 0) throw new Error(`${label} overflowed the WASM mesh buffers`);
  return { vertices, indices };
}

function benchmarkChunkCenter(e: VoxelCoreExports, cx: number, cz: number): { x: number; y: number; z: number } {
  const chunkSize = e.get_chunk_world_size();
  const x = cx * chunkSize + chunkSize * 0.5;
  const z = cz * chunkSize + chunkSize * 0.5;
  return { x, z, y: e.get_terrain_height(x, z) - 2 };
}

async function runBenchmark(benchmarkId: string): Promise<void> {
  await init();
  const e = core();
  const startedAt = performance.now();
  const scenes: BrowserWorkerBenchmarkSceneResult[] = [];
  let chunks = 0;
  let totalGenerateMs = 0;
  let totalCachedRemeshMs = 0;
  let totalEditRemeshMs = 0;
  let totalBuildRemeshMs = 0;
  let totalBoxRemeshMs = 0;
  let totalCapsuleRemeshMs = 0;
  let totalSmoothRemeshMs = 0;
  let totalFlattenRemeshMs = 0;

  for (const scene of BENCHMARK_SCENES) {
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
      const mesh = assertBenchmarkMesh(e, `${label} generate`);
      const samples = densityCopy(e);

      const cached = timeMs(() => e.mesh_cached_chunk(cx, cy, cz, 0));
      const cachedMesh = assertBenchmarkMesh(e, `${label} cached remesh`);
      if (cached.result !== mesh.vertices || cachedMesh.indices !== mesh.indices) {
        throw new Error(`${label} cached remesh changed topology: ${cached.result}/${cachedMesh.indices} vs ${mesh.vertices}/${mesh.indices}`);
      }

      restoreDensity(e, samples);
      const center = benchmarkChunkCenter(e, cx, cz);
      const editedSamples = e.apply_subtract_sphere_to_density(cx, cy, cz, center.x, center.y, center.z, 7.5);
      const edited = timeMs(() => e.mesh_cached_chunk(cx, cy, cz, 0));
      const editedMesh = assertBenchmarkMesh(e, `${label} edit remesh`);
      if (edited.result !== editedMesh.vertices) {
        throw new Error(`${label} edit remesh returned ${edited.result} but exported ${editedMesh.vertices} vertices`);
      }

      restoreDensity(e, samples);
      const builtSamples = e.apply_add_sphere_to_density(cx, cy, cz, center.x, center.y + 8, center.z, 6.5);
      const built = timeMs(() => e.mesh_cached_chunk(cx, cy, cz, 0));
      const builtMesh = assertBenchmarkMesh(e, `${label} build remesh`);
      if (built.result !== builtMesh.vertices) {
        throw new Error(`${label} build remesh returned ${built.result} but exported ${builtMesh.vertices} vertices`);
      }

      restoreDensity(e, samples);
      const boxSamples = e.apply_subtract_box_to_density(cx, cy, cz, center.x, center.y, center.z, 5.5);
      const box = timeMs(() => e.mesh_cached_chunk(cx, cy, cz, 0));
      const boxMesh = assertBenchmarkMesh(e, `${label} box remesh`);
      if (box.result !== boxMesh.vertices) {
        throw new Error(`${label} box remesh returned ${box.result} but exported ${boxMesh.vertices} vertices`);
      }

      restoreDensity(e, samples);
      const capsuleSamples = e.apply_add_capsule_to_density(cx, cy, cz, center.x, center.y + 8, center.z, 4.5, 1, 0, 0, 18);
      const capsule = timeMs(() => e.mesh_cached_chunk(cx, cy, cz, 0));
      const capsuleMesh = assertBenchmarkMesh(e, `${label} capsule remesh`);
      if (capsule.result !== capsuleMesh.vertices) {
        throw new Error(`${label} capsule remesh returned ${capsule.result} but exported ${capsuleMesh.vertices} vertices`);
      }

      restoreDensity(e, samples);
      const smoothSamples = e.apply_smooth_sphere_to_density(cx, cy, cz, center.x, center.y, center.z, 9.5, 0.65);
      const smooth = timeMs(() => e.mesh_cached_chunk(cx, cy, cz, 0));
      const smoothMesh = assertBenchmarkMesh(e, `${label} smooth remesh`);
      if (smooth.result !== smoothMesh.vertices) {
        throw new Error(`${label} smooth remesh returned ${smooth.result} but exported ${smoothMesh.vertices} vertices`);
      }

      restoreDensity(e, samples);
      const flattenSamples = e.apply_flatten_sphere_to_density(cx, cy, cz, center.x, center.y, center.z, 9.5, 0.65);
      const flatten = timeMs(() => e.mesh_cached_chunk(cx, cy, cz, 0));
      const flattenMesh = assertBenchmarkMesh(e, `${label} flatten remesh`);
      if (flatten.result !== flattenMesh.vertices) {
        throw new Error(`${label} flatten remesh returned ${flatten.result} but exported ${flattenMesh.vertices} vertices`);
      }

      chunks++;
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
    scenes.push({
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

  e.clear_edits();
  const result: BrowserWorkerBenchmarkSummary = {
    benchmarkId,
    capturedAt: Date.now(),
    elapsedMs: performance.now() - startedAt,
    chunks,
    avgGenerateMs: totalGenerateMs / chunks,
    avgCachedRemeshMs: totalCachedRemeshMs / chunks,
    avgEditRemeshMs: totalEditRemeshMs / chunks,
    avgBuildRemeshMs: totalBuildRemeshMs / chunks,
    avgBoxRemeshMs: totalBoxRemeshMs / chunks,
    avgCapsuleRemeshMs: totalCapsuleRemeshMs / chunks,
    avgSmoothRemeshMs: totalSmoothRemeshMs / chunks,
    avgFlattenRemeshMs: totalFlattenRemeshMs / chunks,
    scenes,
  };
  workerSelf.postMessage({ type: 'benchmarkResult', benchmarkId, result });
}

function collectChunkResult(
  e: VoxelCoreExports,
  job: GenerateMessage | RemeshDensityMessage,
  t0: number,
  remeshed: boolean,
  resultSlotIndex = -1,
  resultSlotCount = 0,
): void {
  const vertexCount = e.get_vertex_count();
  const indexCount = e.get_index_count();
  const vertexPtr = e.get_vertex_ptr();
  const indexPtr = e.get_index_ptr();
  const densityPtr = e.get_density_ptr();
  const overflow = e.get_overflow();
  const vertexStride = e.get_vertex_stride();
  if (vertexStride !== PACKED_TERRAIN_VERTEX_STRIDE) {
    throw new Error(`Unexpected WASM vertex stride ${vertexStride}; expected ${PACKED_TERRAIN_VERTEX_STRIDE}`);
  }
  if (e.get_density_stride() !== Int16Array.BYTES_PER_ELEMENT) {
    throw new Error(`Unexpected WASM density stride ${e.get_density_stride()}; expected ${Int16Array.BYTES_PER_ELEMENT}`);
  }
  const densityCount = e.get_density_count();
  const densityScale = e.get_density_scale();
  const mem = e.memory.buffer;
  const vertexBytes = vertexCount * vertexStride;
  const indexBytes = indexCount * Uint32Array.BYTES_PER_ELEMENT;
  const densityBytes = densityCount * Int16Array.BYTES_PER_ELEMENT;
  const vegetation = generateVegetation(job.cx, job.cy, job.cz);
  const vegetationBytes = vegetation.byteLength;
  const baseChunkSize = e.get_base_chunk_world_size();
  const chunkWorldSize = e.get_chunk_world_size();
  const frame = {
    origin: [job.cx * baseChunkSize, job.cy * baseChunkSize, job.cz * baseChunkSize] as [number, number, number],
    scale: chunkWorldSize,
  };
  const bounds = {
    center: [
      (e.get_bounds_min_x() + e.get_bounds_max_x()) * 0.5,
      (e.get_bounds_min_y() + e.get_bounds_max_y()) * 0.5,
      (e.get_bounds_min_z() + e.get_bounds_max_z()) * 0.5,
    ] as [number, number, number],
    radius: Math.hypot(
      (e.get_bounds_max_x() - e.get_bounds_min_x()) * 0.5,
      (e.get_bounds_max_y() - e.get_bounds_min_y()) * 0.5,
      (e.get_bounds_max_z() - e.get_bounds_min_z()) * 0.5,
    ),
  };
  const t1 = performance.now();
  if (sharedResultArena && resultSlotIndex >= 0 && resultSlotCount > 0) {
    const slotCount = Math.max(1, resultSlotCount | 0);
    const slotIndex = Math.max(0, Math.min(slotCount - 1, resultSlotIndex | 0));
    const rawSlotBytes = Math.floor(sharedResultArena.byteLength / slotCount);
    const arenaBaseOffset = align4(rawSlotBytes * slotIndex);
    const arenaLimit = slotIndex === slotCount - 1
      ? sharedResultArena.byteLength
      : Math.max(arenaBaseOffset, align4(rawSlotBytes * (slotIndex + 1)));
    const arenaBytes = Math.max(0, arenaLimit - arenaBaseOffset);
    const vertexOffset = 0;
    const indexOffset = align4(vertexOffset + vertexBytes);
    const densityOffset = align4(indexOffset + indexBytes);
    const vegetationOffset = align4(densityOffset + densityBytes);
    const totalBytes = align4(vegetationOffset + vegetationBytes);
    if (totalBytes <= arenaBytes) {
      const vertices = new Uint8Array(sharedResultArena.buffer, arenaBaseOffset + vertexOffset, vertexBytes);
      vertices.set(new Uint8Array(mem, vertexPtr, vertexBytes));
      new Uint8Array(sharedResultArena.buffer, arenaBaseOffset + indexOffset, indexBytes)
        .set(new Uint8Array(mem, indexPtr, indexBytes));
      new Uint8Array(sharedResultArena.buffer, arenaBaseOffset + densityOffset, densityBytes)
        .set(new Uint8Array(mem, densityPtr, densityBytes));
      new Uint8Array(sharedResultArena.buffer, arenaBaseOffset + vegetationOffset, vegetationBytes)
        .set(new Uint8Array(vegetation.buffer, vegetation.byteOffset, vegetationBytes));
      const resultSlotGeneration = (job as Partial<SharedGenerateMessage>).resultSlotGeneration ?? 0;
      workerSelf.postMessage({
        type: 'chunk',
        key: keyFromJob(job),
        cx: job.cx, cy: job.cy, cz: job.cz, lod: job.lod ?? 0,
        version: job.version ?? 1,
        vertices,
        indices: new Uint32Array(sharedResultArena.buffer, arenaBaseOffset + indexOffset, indexCount),
        densitySamples: new Int16Array(sharedResultArena.buffer, arenaBaseOffset + densityOffset, densityCount),
        vegetation: new Float32Array(sharedResultArena.buffer, arenaBaseOffset + vegetationOffset, vegetation.length),
        frame,
        bounds,
        stats: {
          vertexCount,
          indexCount,
          densityCount,
          densityScale,
          lod: e.get_chunk_lod(),
          lodSeamMask: job.lodSeamMask ?? 0,
          cellSize: e.get_cell_size(),
          chunkWorldSize,
          remeshed,
          overflow,
          ms: t1 - t0,
          workerScratch: scratchArena.stats(),
          sharedResultArena: true,
          sharedResultBytes: totalBytes,
          sharedResultSlotIndex: slotIndex,
          sharedResultGeneration: resultSlotGeneration,
        },
      });
      return;
    }
  }
  const vertices = scratchArena.copyUint8(new Uint8Array(mem, vertexPtr, vertexBytes));
  const indices = scratchArena.copyUint32(new Uint32Array(mem, indexPtr, indexCount));
  const densitySamples = scratchArena.copyInt16(new Int16Array(mem, densityPtr, densityCount));
  const resultSlotGeneration = (job as Partial<SharedGenerateMessage>).resultSlotGeneration ?? 0;
  workerSelf.postMessage({
    type: 'chunk',
    key: keyFromJob(job),
    cx: job.cx, cy: job.cy, cz: job.cz, lod: job.lod ?? 0,
    version: job.version ?? 1,
    vertices,
    indices,
    densitySamples,
    vegetation,
    frame,
    bounds,
    stats: {
      vertexCount,
      indexCount,
      densityCount,
      densityScale,
      lod: e.get_chunk_lod(),
      lodSeamMask: job.lodSeamMask ?? 0,
      cellSize: e.get_cell_size(),
      chunkWorldSize,
      remeshed,
      overflow,
      ms: t1 - t0,
      workerScratch: scratchArena.stats(),
      sharedResultSlotIndex: resultSlotIndex >= 0 ? resultSlotIndex : undefined,
      sharedResultGeneration: resultSlotIndex >= 0 ? resultSlotGeneration : undefined,
    },
  }, [vertices.buffer, indices.buffer, densitySamples.buffer, vegetation.buffer] as Transferable[]);
}

async function generate(job: GenerateMessage, resultSlotIndex = 0, resultSlotCount = 1): Promise<void> {
  await init();
  const e = core();
  if (job.editVersion !== appliedEditVersion) {
    throw new Error(`Worker edit log out of sync: job=${job.editVersion}, worker=${appliedEditVersion}`);
  }
  const t0 = performance.now();
  e.generate_chunk(job.cx, job.cy, job.cz, job.lod ?? 0);
  collectChunkResult(e, job, t0, false, resultSlotIndex, resultSlotCount);
}

async function remeshDensity(job: RemeshDensityMessage): Promise<void> {
  await init();
  const e = core();
  if (job.editVersion !== appliedEditVersion) {
    throw new Error(`Worker edit log out of sync: job=${job.editVersion}, worker=${appliedEditVersion}`);
  }
  const densityCount = e.get_density_count();
  if (job.densitySamples.length !== densityCount) {
    throw new Error(`Cached density sample count mismatch: ${job.densitySamples.length} vs ${densityCount}`);
  }
  const t0 = performance.now();
  e.set_chunk_lod(job.lod ?? 0);
  new Int16Array(e.memory.buffer, e.get_density_ptr(), densityCount).set(job.densitySamples);
  for (const edit of job.editsToApply) applyDensityEdit(e, job, edit);
  e.mesh_cached_chunk(job.cx, job.cy, job.cz, job.lod ?? 0);
  collectChunkResult(e, job, t0, true);
}

async function generateLodTransitionMesh(msg: GenerateLodTransitionMeshMessage): Promise<void> {
  await init();
  const e = core();
  const t0 = performance.now();
  const sampleCount = e.get_lod_transition_sample_count();
  if (sampleCount !== 12) throw new Error(`Unexpected native LOD transition sample count ${sampleCount}`);
  if (e.get_lod_transition_algorithm_id() !== 1) throw new Error(`Unexpected native LOD transition algorithm ${e.get_lod_transition_algorithm_id()}`);
  if (e.get_vertex_stride() !== PACKED_TERRAIN_VERTEX_STRIDE) {
    throw new Error(`Unexpected WASM vertex stride ${e.get_vertex_stride()}; expected ${PACKED_TERRAIN_VERTEX_STRIDE}`);
  }
  const nativeCellCount = msg.sides.length;
  const floatsPerCell = sampleCount * 4;
  if (msg.samples.length !== nativeCellCount * floatsPerCell) {
    throw new Error(`LOD transition sample payload mismatch: ${msg.samples.length} floats for ${nativeCellCount} cells`);
  }
  if (msg.combinedCases.length !== nativeCellCount) {
    throw new Error(`LOD transition case payload mismatch: ${msg.combinedCases.length} cases for ${nativeCellCount} cells`);
  }
  const maxChunkCells = e.get_lod_transition_max_chunk_cells();
  if (nativeCellCount > maxChunkCells) {
    throw new Error(`LOD transition chunk capacity ${maxChunkCells} exceeded by ${nativeCellCount} cells`);
  }

  const vertexStride = e.get_vertex_stride();

  const emptyResult = (degenerateCells: number, overflow: number): void => {
    const empty: LodTransitionMeshMessage = {
      type: 'lodTransitionMesh',
      signature: msg.signature,
      sourceKey: msg.sourceKey,
      version: msg.version,
      vertices: new Uint8Array(0),
      indices: new Uint32Array(0),
      frame: { origin: [0, 0, 0], scale: 1 },
      bounds: { center: [0, 0, 0], radius: 0 },
      stats: {
        vertexCount: 0,
        indexCount: 0,
        lodTransitionMesh: true,
        lodTransitionMeshCells: msg.cellCount,
        lodTransitionMeshEmittedCells: 0,
        lodTransitionMeshMissingSampleCells: msg.missingSampleCells,
        lodTransitionMeshDegenerateCells: degenerateCells,
        overflow,
        ms: performance.now() - t0,
        workerScratch: scratchArena.stats(),
      },
    };
    workerSelf.postMessage(empty);
  };

  if (nativeCellCount === 0) {
    emptyResult(0, 0);
    return;
  }

  const chunkPositionsView = new Float32Array(
    e.memory.buffer,
    e.get_lod_transition_chunk_position_ptr(),
    nativeCellCount * sampleCount * 3,
  );
  const chunkDensitiesView = new Float32Array(
    e.memory.buffer,
    e.get_lod_transition_chunk_density_ptr(),
    nativeCellCount * sampleCount,
  );
  const chunkSidesView = new Int32Array(
    e.memory.buffer,
    e.get_lod_transition_chunk_sides_ptr(),
    nativeCellCount,
  );
  for (let cell = 0; cell < nativeCellCount; cell++) {
    const srcBase = cell * floatsPerCell;
    const posBase = cell * sampleCount * 3;
    const denBase = cell * sampleCount;
    for (let sample = 0; sample < sampleCount; sample++) {
      const src = srcBase + sample * 4;
      const pos = posBase + sample * 3;
      chunkPositionsView[pos + 0] = msg.samples[src + 0];
      chunkPositionsView[pos + 1] = msg.samples[src + 1];
      chunkPositionsView[pos + 2] = msg.samples[src + 2];
      chunkDensitiesView[denBase + sample] = msg.samples[src + 3];
    }
    chunkSidesView[cell] = msg.sides[cell];
  }

  const aggregateVertexCount = e.generate_lod_transition_chunk_mesh(nativeCellCount);
  const overflow = e.get_overflow() ? 1 : 0;
  const aggregateIndexCount = e.get_index_count();
  if (aggregateVertexCount <= 0 || aggregateIndexCount < 3) {
    emptyResult(nativeCellCount, overflow);
    return;
  }

  const packedSrc = new Uint8Array(e.memory.buffer, e.get_vertex_ptr(), aggregateVertexCount * vertexStride);
  const indicesSrc = new Uint32Array(e.memory.buffer, e.get_index_ptr(), aggregateIndexCount);
  const vertices = new Uint8Array(packedSrc);
  const indices = new Uint32Array(indicesSrc);

  const frame = {
    origin: [e.get_pack_origin_x(), e.get_pack_origin_y(), e.get_pack_origin_z()] as [number, number, number],
    scale: e.get_pack_scale(),
  };
  const minX = e.get_bounds_min_x();
  const minY = e.get_bounds_min_y();
  const minZ = e.get_bounds_min_z();
  const maxX = e.get_bounds_max_x();
  const maxY = e.get_bounds_max_y();
  const maxZ = e.get_bounds_max_z();
  const vertexCount = aggregateVertexCount;
  const emittedCells = nativeCellCount;
  const degenerateCells = 0;
  const message: LodTransitionMeshMessage = {
    type: 'lodTransitionMesh',
    signature: msg.signature,
    sourceKey: msg.sourceKey,
    version: msg.version,
    vertices,
    indices,
    frame,
    bounds: {
      center: [(minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5],
      radius: Math.hypot((maxX - minX) * 0.5, (maxY - minY) * 0.5, (maxZ - minZ) * 0.5),
    },
    stats: {
      vertexCount,
      indexCount: indices.length,
      lodTransitionMesh: true,
      lodTransitionMeshCells: msg.cellCount,
      lodTransitionMeshEmittedCells: emittedCells,
      lodTransitionMeshMissingSampleCells: msg.missingSampleCells,
      lodTransitionMeshDegenerateCells: degenerateCells,
      overflow,
      ms: performance.now() - t0,
      workerScratch: scratchArena.stats(),
    },
  };
  workerSelf.postMessage(message, [vertices.buffer, indices.buffer] as Transferable[]);
}

async function generateWorldgenTile(key: string, tileX: number, tileZ: number): Promise<void> {
  await init();
  const e = core();
  const t0 = performance.now();
  const sampleCount = e.generate_worldgen_tile(tileX, tileZ);
  const resolution = e.get_worldgen_tile_resolution();
  const fieldCount = e.get_worldgen_tile_field_count();
  const fields = new Float32Array(new Float32Array(e.memory.buffer, e.get_worldgen_tile_field_ptr(), sampleCount * fieldCount));
  const biomeIds = new Uint8Array(new Uint8Array(e.memory.buffer, e.get_worldgen_tile_biome_id_ptr(), sampleCount));
  const waterIds = new Uint8Array(new Uint8Array(e.memory.buffer, e.get_worldgen_tile_water_id_ptr(), sampleCount));
  const riverNetworkIds = new Uint16Array(new Uint16Array(e.memory.buffer, e.get_worldgen_tile_river_id_ptr(), sampleCount));
  const message: WorldgenTileMessage = {
    type: 'worldgenTile',
    key,
    tileX,
    tileZ,
    tileSize: e.get_worldgen_tile_size(),
    resolution,
    fieldCount,
    fields,
    biomeIds,
    waterIds,
    riverNetworkIds,
    ms: performance.now() - t0,
  };
  workerSelf.postMessage(message, [fields.buffer, biomeIds.buffer, waterIds.buffer, riverNetworkIds.buffer] as Transferable[]);
}

async function generateErosionTile(key: string, tileX: number, tileZ: number): Promise<void> {
  await init();
  const e = core();
  const t0 = performance.now();
  const sampleCount = e.generate_erosion_tile(tileX, tileZ);
  const resolution = e.get_erosion_tile_resolution();
  const fieldCount = e.get_erosion_tile_field_count();
  const fields = new Float32Array(new Float32Array(e.memory.buffer, e.get_erosion_tile_field_ptr(), sampleCount * fieldCount));
  const message: ErosionTileMessage = {
    type: 'erosionTile',
    key,
    tileX,
    tileZ,
    tileSize: e.get_erosion_tile_size(),
    schemaVersion: e.get_erosion_tile_schema_version(),
    generatorVersion: e.get_erosion_tile_generator_version(),
    resolution,
    fieldCount,
    fields,
    ms: performance.now() - t0,
  };
  workerSelf.postMessage(message, [fields.buffer] as Transferable[]);
}

async function generateMaterialTile(key: string, tileX: number, tileZ: number): Promise<void> {
  await init();
  const e = core();
  const t0 = performance.now();
  const sampleCount = e.generate_material_tile(tileX, tileZ);
  const resolution = e.get_material_tile_resolution();
  const fieldCount = e.get_material_tile_field_count();
  const fields = new Float32Array(new Float32Array(e.memory.buffer, e.get_material_tile_field_ptr(), sampleCount * fieldCount));
  const dominantMaterialIds = new Uint8Array(new Uint8Array(e.memory.buffer, e.get_material_tile_id_ptr(), sampleCount));
  const message: MaterialTileMessage = {
    type: 'materialTile',
    key,
    tileX,
    tileZ,
    tileSize: e.get_material_tile_size(),
    schemaVersion: e.get_material_tile_schema_version(),
    generatorVersion: e.get_material_tile_generator_version(),
    resolution,
    fieldCount,
    fields,
    dominantMaterialIds,
    ms: performance.now() - t0,
  };
  workerSelf.postMessage(message, [fields.buffer, dominantMaterialIds.buffer] as Transferable[]);
}

async function generateCaveGraphTile(key: string, tileX: number, tileZ: number): Promise<void> {
  await init();
  const e = core();
  const t0 = performance.now();
  const passageCount = e.generate_cave_graph_tile(tileX, tileZ);
  const chamberCount = e.get_cave_graph_chamber_count();
  const passageFieldCount = e.get_cave_graph_passage_field_count();
  const chamberFieldCount = e.get_cave_graph_chamber_field_count();
  const passages = new Float32Array(new Float32Array(e.memory.buffer, e.get_cave_graph_passage_ptr(), passageCount * passageFieldCount));
  const chambers = new Float32Array(new Float32Array(e.memory.buffer, e.get_cave_graph_chamber_ptr(), chamberCount * chamberFieldCount));
  const message: CaveGraphTileMessage = {
    type: 'caveGraphTile',
    key,
    tileX,
    tileZ,
    tileSize: e.get_cave_graph_tile_size(),
    schemaVersion: e.get_cave_graph_tile_schema_version(),
    generatorVersion: e.get_cave_graph_tile_generator_version(),
    passageFieldCount,
    chamberFieldCount,
    passageCount,
    chamberCount,
    passages,
    chambers,
    ms: performance.now() - t0,
  };
  workerSelf.postMessage(message, [passages.buffer, chambers.buffer] as Transferable[]);
}

workerSelf.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === 'initSharedQueue') {
      sharedGenerateQueue = new Int32Array(msg.queue);
    } else if (msg.type === 'initSharedRemeshPage') {
      sharedRemeshDensitySamples = new Int16Array(msg.densitySamples);
    } else if (msg.type === 'initSharedResultArena') {
      sharedResultArena = new Uint8Array(msg.arena);
      sharedResultSlotCount = Math.max(0, Math.trunc(msg.slotCount ?? 0));
    } else if (msg.type === 'init') {
      await init();
      workerSelf.postMessage({ type: 'ready' });
    } else if (msg.type === 'generate') {
      await generate(msg);
    } else if (msg.type === 'generateShared') {
      const jobs = readSharedGenerateJobs();
      for (let index = 0; index < jobs.length; index++) {
        await generate(jobs[index], jobs[index].resultSlotIndex, sharedResultSlotCount);
      }
    } else if (msg.type === 'remeshDensity') {
      await remeshDensity(msg);
    } else if (msg.type === 'remeshDensityShared') {
      await remeshDensity(readSharedRemeshJob(msg));
    } else if (msg.type === 'generateLodTransitionMesh') {
      await generateLodTransitionMesh(msg);
    } else if (msg.type === 'generateWorldgenTile') {
      await generateWorldgenTile(msg.key, msg.tileX, msg.tileZ);
    } else if (msg.type === 'generateErosionTile') {
      await generateErosionTile(msg.key, msg.tileX, msg.tileZ);
    } else if (msg.type === 'generateMaterialTile') {
      await generateMaterialTile(msg.key, msg.tileX, msg.tileZ);
    } else if (msg.type === 'generateCaveGraphTile') {
      await generateCaveGraphTile(msg.key, msg.tileX, msg.tileZ);
    } else if (msg.type === 'syncEdits') {
      await init();
      applyEditLog(msg.version, msg.edits);
      workerSelf.postMessage({ type: 'editAck', version: msg.version });
    } else if (msg.type === 'runBenchmark') {
      await runBenchmark(msg.benchmarkId);
    }
  } catch (error) {
    workerSelf.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack ?? '' : '',
    });
  }
};
