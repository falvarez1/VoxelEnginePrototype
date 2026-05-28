import { biomeMask, fbm2, riverCenter, ridge2, snowMask, terrainHeight, valueNoise2, wetnessMask } from './terrain_math.ts';
import {
  FLOAT_TERRAIN_VERTEX_FLOATS,
  PACKED_TERRAIN_VERTEX_STRIDE,
  TERRAIN_CLUSTER_INDEX_COUNT,
  buildTerrainClusterBounds,
  packFloatTerrainVertices,
  packFrameFromFloatTerrainVertices,
} from './terrain_mesh.ts';
import type {
  ChunkMeshStats,
  RendererMemoryStats,
  RendererSettings,
  RendererStats,
  RuntimeCapabilities,
  SphereBounds,
  TerrainPackFrame,
} from './engine_contracts';
import type { FlyCamera, Mat4, Vec3 } from './math.ts';
import { mat4Identity, mat4LookAt, mat4Multiply, mat4Ortho } from './math.ts';

function roundUp4(n: number): number { return (n + 3) & ~3; }

const FAR_TERRAIN_RINGS = [
  { inner: 120, outer: 1152, step: 16 },
  { inner: 1152, outer: 2688, step: 32 },
  { inner: 2688, outer: 5760, step: 64 },
] as const;
const FAR_TERRAIN_RADIUS = FAR_TERRAIN_RINGS[FAR_TERRAIN_RINGS.length - 1].outer;
const FAR_TERRAIN_SNAP = 96;
const FAR_TERRAIN_REBUILD_IDLE_SECONDS = 0.28;
const FAR_TERRAIN_RECENTER_DISTANCE = FAR_TERRAIN_SNAP * 16;
const FAR_TERRAIN_CAMERA_MOVE_EPSILON = 0.05;
const DEBUG_VIEW_SNOW_MASK = 10;
const DEFAULT_RENDERER_SETTINGS: RendererSettings = {
  nearTerrainEnabled: true,
  farTerrainEnabled: true,
  waterEnabled: true,
  vegetationEnabled: true,
  fogDensity: 0.42,
  materialDetail: 0.68,
  exposure: 1.54,
  atmosphereStrength: 1.10,
  skyEnabled: true,
  cinematicLighting: true,
  shadowsEnabled: false,
  debugView: 0,
  waterOpacity: 0.93,
  animationSpeed: 1,
  sunDirection: [-0.930, 0.139, -0.339],
};

interface RenderableChunk {
  vertexOffset: number;
  indexOffset: number;
  clusterOffset: number;
  clusterCount: number;
  indexCount: number;
  vertexCount: number;
  vertexBytes: number;
  indexBytes: number;
  originBytes: number;
  clusterBytes: number;
  indirectBytes: number;
  bounds: SphereBounds;
  stats: ChunkMeshStats;
  lodSeamMask: number;
}

interface VisibleTerrainChunk {
  chunk: RenderableChunk;
  visibleClusters: number[];
  visibleRanges: ClusterRange[];
}

interface ClusterRange {
  firstCluster: number;
  clusterCount: number;
  firstIndex: number;
  indexCount: number;
}

interface VegetationPatch {
  instances: Float32Array;
  instanceCount: number;
  instanceBytes: number;
  bounds: SphereBounds;
}

interface VegetationBatchResult {
  buffer: GPUBuffer | null;
  instanceCount: number;
  lodCulledInstances: number;
}

interface GameMarkerBatch {
  instanceBuffer: GPUBuffer;
  instanceCount: number;
  instanceBytes: number;
}

interface IndexedMesh {
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  indexCount: number;
  vertexBytes: number;
  indexBytes: number;
}

interface TerrainMesh extends IndexedMesh {
  originBuffer: GPUBuffer;
  originBytes: number;
}

type Plane = [number, number, number, number];
const CLUSTER_CULL_PARAMS_BYTES = 192;
const HIZ_OCCLUSION_COUNTER_BYTES = 8;
const HIZ_VIEWPROJ_EPSILON = 0.002;
const INDIRECT_INDEXED_ARGS_U32 = 5;
const INDIRECT_INDEXED_ARGS_BYTES = INDIRECT_INDEXED_ARGS_U32 * Uint32Array.BYTES_PER_ELEMENT;
const VEGETATION_INSTANCE_FLOATS = 8;
const TERRAIN_ARENA_MIN_VERTICES = 4_194_304;
const TERRAIN_ARENA_MIN_INDICES = 16_777_216;
const TERRAIN_ARENA_MIN_CLUSTERS = 32_768;
const TERRAIN_ARENA_ORIGIN_STRIDE = 4 * Float32Array.BYTES_PER_ELEMENT;
const TERRAIN_INDIRECT_REPLAY_STARTUP_SLOTS = 2048;
const TERRAIN_INDIRECT_REPLAY_MIN_SLOTS = 512;
const TERRAIN_INDIRECT_REPLAY_HEADROOM_SLOTS = 768;
const TERRAIN_INDIRECT_REPLAY_VISIBLE_MULTIPLIER = 1.2;
const TERRAIN_INDIRECT_REPLAY_STABLE_MAX_SLOTS = 4096;
const TERRAIN_INDIRECT_REPLAY_MOVING_MAX_SLOTS = 2048;
const TERRAIN_INDIRECT_REPLAY_CAMERA_MOVE_EPSILON = 0.025;
const TERRAIN_INDIRECT_REPLAY_MOVING_SECONDS = 0.22;
const VEGETATION_SHRUB_LOD_DISTANCE = 720;
const VEGETATION_ROCK_LOD_DISTANCE = 2600;
const VEGETATION_SMALL_PINE_LOD_DISTANCE = 3850;
const VEGETATION_SMALL_PINE_SCALE = 6.0;
const WATER_RECENTER_DISTANCE = 1024;
const WATER_SEGMENTS = 560;
const WATER_LAKE_RINGS = 5;
const WATER_LAKE_SIDES = 40;
const WATER_LAKE_EDGE_SAMPLES = 24;
const UPLOAD_RING_PAGE_BYTES = 8 * 1024 * 1024;
const UPLOAD_RING_MAX_PAGES = 8;
const DEPTH_FORMAT: GPUTextureFormat = 'depth32float';
const DEPTH_PYRAMID_FORMAT: GPUTextureFormat = 'r32float';
const SHADOW_MAP_SIZE = 2048;
const SHADOW_ORTHO_HALF = 420;
const SHADOW_ORTHO_DEPTH = 1400;
// Push the shadow box center ahead of the eye so the fixed-size ortho frustum
// spends resolution on the viewed region instead of behind the camera. Kept
// well under SHADOW_ORTHO_HALF so near-camera terrain stays inside the box.
const SHADOW_LOOKAHEAD = 240;
const LOD_SEAM_NEG_X = 1 << 0;
const LOD_SEAM_POS_X = 1 << 1;
const LOD_SEAM_NEG_Z = 1 << 2;
const LOD_SEAM_POS_Z = 1 << 3;
const LOD_SEAM_MASK_ALL = LOD_SEAM_NEG_X | LOD_SEAM_POS_X | LOD_SEAM_NEG_Z | LOD_SEAM_POS_Z;
const SCENIC_WATER_LEVEL = 8.8;
const FAR_TERRAIN_VISUAL_BASE_HEIGHT = 1.8;
const FAR_TERRAIN_VISUAL_HEIGHT_SCALE = 1.98;
const SCENIC_FOREST_STEP = 28;
const SCENIC_NEAR_FOREST_STEP = 28;
const SCENIC_FOREST_RADIUS = 4200;
const SCENIC_FOREST_INNER_CLEARING = 36;
const SCENIC_NEAR_FOREST_INNER_CLEARING = 44;
const SCENIC_REFERENCE_SUN_DIR: [number, number, number] = [-0.930, 0.139, -0.339];

interface UploadRingCopy {
  sourceOffset: number;
  destination: GPUBuffer;
  size: number;
}

interface UploadRingPage {
  buffer: GPUBuffer;
  bytes: Uint8Array | null;
  offset: number;
  pending: UploadRingCopy[];
  remapping: boolean;
}

interface UploadRingStats {
  pages: number;
  pageBytes: number;
  stagingBytes: number;
  pendingBytes: number;
  lastFlushBytes: number;
  totalUploadBytes: number;
  totalCopies: number;
  fallbackUploads: number;
  fallbackBytes: number;
}

interface DepthPyramidResources {
  texture: GPUTexture;
  firstBindGroup: GPUBindGroup;
  mipBindGroups: GPUBindGroup[];
  clusterCullBindGroup: GPUBindGroup;
  mipLevels: number;
  bytes: number;
}

interface HiZOcclusionCounters {
  tested: number;
  culled: number;
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothStep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / Math.max(edge1 - edge0, 0.0001), 0, 1);
  return t * t * (3 - 2 * t);
}

function typedArrayBytes(data: Float32Array | Uint32Array | Uint16Array | Uint8Array): Uint8Array {
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function createMappedBufferWithData(
  device: GPUDevice,
  data: Float32Array | Uint32Array | Uint16Array | Uint8Array,
  usage: GPUBufferUsageFlags,
  label: string,
): GPUBuffer {
  if (!data || data.byteLength === 0) throw new Error(`Cannot create empty GPU buffer: ${label}`);
  const buffer = device.createBuffer({
    label,
    size: roundUp4(data.byteLength),
    usage,
    mappedAtCreation: true,
  });
  const mapped = buffer.getMappedRange();
  if (data instanceof Float32Array) new Float32Array(mapped).set(data);
  else if (data instanceof Uint32Array) new Uint32Array(mapped).set(data);
  else if (data instanceof Uint16Array) new Uint16Array(mapped).set(data);
  else new Uint8Array(mapped).set(data);
  buffer.unmap();
  return buffer;
}

class GpuUploadRing {
  device: GPUDevice;
  pages: UploadRingPage[] = [];
  lastFlushBytes = 0;
  totalUploadBytes = 0;
  totalCopies = 0;
  fallbackUploads = 0;
  fallbackBytes = 0;
  private pendingDestinations = new Set<GPUBuffer>();
  private deferredDestroys = new Set<GPUBuffer>();

  constructor(device: GPUDevice) {
    this.device = device;
  }

  createBuffer(
    data: Float32Array | Uint32Array | Uint16Array | Uint8Array,
    usage: GPUBufferUsageFlags,
    label: string,
  ): GPUBuffer {
    if (!data || data.byteLength === 0) throw new Error(`Cannot create empty GPU buffer: ${label}`);
    const size = roundUp4(data.byteLength);
    const allocation = this.allocate(size);
    if (!allocation) {
      this.fallbackUploads++;
      this.fallbackBytes += data.byteLength;
      return createMappedBufferWithData(this.device, data, usage, label);
    }

    allocation.page.bytes?.set(typedArrayBytes(data), allocation.offset);
    const destination = this.device.createBuffer({
      label,
      size,
      usage: usage | GPUBufferUsage.COPY_DST,
    });
    this.pendingDestinations.add(destination);
    allocation.page.pending.push({ sourceOffset: allocation.offset, destination, size });
    return destination;
  }

  destroyBuffer(buffer: GPUBuffer): void {
    if (this.pendingDestinations.has(buffer)) {
      this.deferredDestroys.add(buffer);
      return;
    }
    buffer.destroy();
  }

  flush(): void {
    const pages = this.pages.filter(page => page.bytes && page.pending.length > 0);
    if (pages.length === 0) {
      this.lastFlushBytes = 0;
      return;
    }

    const encoder = this.device.createCommandEncoder({ label: 'renderer upload ring flush' });
    let flushedBytes = 0;
    let copies = 0;
    const flushedDestinations: GPUBuffer[] = [];
    for (const page of pages) {
      page.buffer.unmap();
      page.bytes = null;
      for (const copy of page.pending) {
        encoder.copyBufferToBuffer(page.buffer, copy.sourceOffset, copy.destination, 0, copy.size);
        flushedDestinations.push(copy.destination);
        flushedBytes += copy.size;
        copies++;
      }
      page.pending = [];
      page.offset = 0;
    }
    this.device.queue.submit([encoder.finish()]);
    for (const destination of flushedDestinations) this.pendingDestinations.delete(destination);
    for (const buffer of this.deferredDestroys) {
      if (!this.pendingDestinations.has(buffer)) {
        buffer.destroy();
        this.deferredDestroys.delete(buffer);
      }
    }
    for (const page of pages) this.remapPage(page);
    this.lastFlushBytes = flushedBytes;
    this.totalUploadBytes += flushedBytes;
    this.totalCopies += copies;
  }

  stats(): UploadRingStats {
    const pendingBytes = this.pages.reduce((total, page) => total + page.pending.reduce((pageTotal, copy) => pageTotal + copy.size, 0), 0);
    return {
      pages: this.pages.length,
      pageBytes: UPLOAD_RING_PAGE_BYTES,
      stagingBytes: this.pages.length * UPLOAD_RING_PAGE_BYTES,
      pendingBytes,
      lastFlushBytes: this.lastFlushBytes,
      totalUploadBytes: this.totalUploadBytes,
      totalCopies: this.totalCopies,
      fallbackUploads: this.fallbackUploads,
      fallbackBytes: this.fallbackBytes,
    };
  }

  private allocate(size: number): { page: UploadRingPage; offset: number } | null {
    if (size > UPLOAD_RING_PAGE_BYTES) return null;
    for (const page of this.pages) {
      if (page.bytes && page.offset + size <= UPLOAD_RING_PAGE_BYTES) {
        const offset = page.offset;
        page.offset = roundUp4(page.offset + size);
        return { page, offset };
      }
    }
    if (this.pages.length >= UPLOAD_RING_MAX_PAGES) return null;
    const page = this.createPage();
    const offset = page.offset;
    page.offset = roundUp4(page.offset + size);
    return { page, offset };
  }

  private createPage(): UploadRingPage {
    const buffer = this.device.createBuffer({
      label: `renderer upload ring page ${this.pages.length}`,
      size: UPLOAD_RING_PAGE_BYTES,
      usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
    });
    const page: UploadRingPage = {
      buffer,
      bytes: new Uint8Array(buffer.getMappedRange()),
      offset: 0,
      pending: [],
      remapping: false,
    };
    this.pages.push(page);
    return page;
  }

  private remapPage(page: UploadRingPage): void {
    page.remapping = true;
    void this.device.queue.onSubmittedWorkDone()
      .then(() => page.buffer.mapAsync(GPUMapMode.WRITE))
      .then(() => {
        page.bytes = new Uint8Array(page.buffer.getMappedRange());
        page.offset = 0;
        page.remapping = false;
      })
      .catch(() => {
        page.remapping = false;
      });
  }
}

interface ArenaRange {
  offset: number;
  size: number;
}

class LinearRangeAllocator {
  highWater = 0;
  active = 0;
  private free: ArenaRange[] = [];

  allocate(size: number): number {
    const requested = Math.max(0, Math.trunc(size));
    if (requested <= 0) return 0;
    for (let i = 0; i < this.free.length; i++) {
      const range = this.free[i];
      if (range.size < requested) continue;
      const offset = range.offset;
      range.offset += requested;
      range.size -= requested;
      if (range.size <= 0) this.free.splice(i, 1);
      this.active += requested;
      return offset;
    }
    const offset = this.highWater;
    this.highWater += requested;
    this.active += requested;
    return offset;
  }

  release(offset: number, size: number): void {
    const released = Math.max(0, Math.trunc(size));
    if (released <= 0) return;
    this.active = Math.max(0, this.active - released);
    this.free.push({ offset: Math.max(0, Math.trunc(offset)), size: released });
    this.free.sort((a, b) => a.offset - b.offset);
    for (let i = 0; i < this.free.length - 1;) {
      const current = this.free[i];
      const next = this.free[i + 1];
      if (current.offset + current.size < next.offset) {
        i++;
        continue;
      }
      const end = Math.max(current.offset + current.size, next.offset + next.size);
      current.size = end - current.offset;
      this.free.splice(i + 1, 1);
    }
  }
}

class TerrainGpuArena {
  private vertexAllocator = new LinearRangeAllocator();
  private indexAllocator = new LinearRangeAllocator();
  private clusterAllocator = new LinearRangeAllocator();
  private allocations = new Map<string, RenderableChunk>();
  private bindGroup: GPUBindGroup | null = null;
  private bindGroupDirty = true;

  vertexBuffer: GPUBuffer | null = null;
  originBuffer: GPUBuffer | null = null;
  indexBuffer: GPUBuffer | null = null;
  clusterBoundsBuffer: GPUBuffer | null = null;
  sourceIndirectBuffer: GPUBuffer | null = null;
  compactIndirectBuffer: GPUBuffer | null = null;
  cullParamsBuffer: GPUBuffer;
  vertexCapacity = 0;
  indexCapacity = 0;
  clusterCapacity = 0;

  constructor(
    private readonly device: GPUDevice,
    private readonly bindGroupLayout: GPUBindGroupLayout,
  ) {
    this.cullParamsBuffer = createEmptyBuffer(
      device,
      CLUSTER_CULL_PARAMS_BYTES,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      'terrain arena cull params',
    );
  }

  uploadChunk(
    key: string,
    vertices: Uint8Array,
    indices: Uint32Array,
    frame: TerrainPackFrame,
    clusterBounds: Float32Array,
    bounds: SphereBounds,
    stats: ChunkMeshStats,
    lodSeamMask: number,
  ): RenderableChunk {
    this.removeChunk(key);
    const vertexCount = Math.floor(vertices.byteLength / PACKED_TERRAIN_VERTEX_STRIDE);
    const indexCount = indices.length;
    const clusterCount = Math.max(1, Math.ceil(indexCount / TERRAIN_CLUSTER_INDEX_COUNT));
    const vertexOffset = this.vertexAllocator.allocate(vertexCount);
    const indexOffset = this.indexAllocator.allocate(indexCount);
    const clusterOffset = this.clusterAllocator.allocate(clusterCount);

    this.ensureVertexCapacity(this.vertexAllocator.highWater);
    this.ensureIndexCapacity(this.indexAllocator.highWater);
    this.ensureClusterCapacity(this.clusterAllocator.highWater);

    if (!this.vertexBuffer || !this.originBuffer || !this.indexBuffer || !this.clusterBoundsBuffer || !this.sourceIndirectBuffer) {
      throw new Error('Terrain GPU arena buffers were not initialized.');
    }

    this.device.queue.writeBuffer(this.vertexBuffer, vertexOffset * PACKED_TERRAIN_VERTEX_STRIDE, vertices);
    const originScales = new Float32Array(vertexCount * 4);
    for (let i = 0; i < vertexCount; i++) {
      const offset = i * 4;
      originScales[offset + 0] = frame.origin[0];
      originScales[offset + 1] = frame.origin[1];
      originScales[offset + 2] = frame.origin[2];
      originScales[offset + 3] = frame.scale;
    }
    this.device.queue.writeBuffer(this.originBuffer, vertexOffset * TERRAIN_ARENA_ORIGIN_STRIDE, originScales);
    this.device.queue.writeBuffer(this.indexBuffer, indexOffset * Uint32Array.BYTES_PER_ELEMENT, indices);
    this.device.queue.writeBuffer(this.clusterBoundsBuffer, clusterOffset * 4 * Float32Array.BYTES_PER_ELEMENT, clusterBounds);
    this.device.queue.writeBuffer(this.sourceIndirectBuffer, clusterOffset * INDIRECT_INDEXED_ARGS_BYTES, this.buildSourceIndirectArgs(indexOffset, vertexOffset, indexCount, clusterCount));

    const chunk: RenderableChunk = {
      vertexOffset,
      indexOffset,
      clusterOffset,
      clusterCount,
      indexCount,
      vertexCount,
      vertexBytes: vertices.byteLength,
      indexBytes: indices.byteLength,
      originBytes: vertexCount * TERRAIN_ARENA_ORIGIN_STRIDE,
      clusterBytes: clusterBounds.byteLength,
      indirectBytes: clusterCount * INDIRECT_INDEXED_ARGS_BYTES,
      bounds,
      stats,
      lodSeamMask,
    };
    this.allocations.set(key, chunk);
    return chunk;
  }

  removeChunk(key: string): RenderableChunk | null {
    const chunk = this.allocations.get(key);
    if (!chunk) return null;
    if (this.sourceIndirectBuffer && chunk.clusterCount > 0) {
      this.device.queue.writeBuffer(
        this.sourceIndirectBuffer,
        chunk.clusterOffset * INDIRECT_INDEXED_ARGS_BYTES,
        new Uint32Array(chunk.clusterCount * INDIRECT_INDEXED_ARGS_U32),
      );
    }
    this.vertexAllocator.release(chunk.vertexOffset, chunk.vertexCount);
    this.indexAllocator.release(chunk.indexOffset, chunk.indexCount);
    this.clusterAllocator.release(chunk.clusterOffset, chunk.clusterCount);
    this.allocations.delete(key);
    return chunk;
  }

  updateCullParams(
    planes: Plane[],
    viewProj: Mat4,
    drawSlotCapacity: number,
    viewportWidth: number,
    viewportHeight: number,
    mipLevels: number,
    occlusionEnabled: boolean,
  ): void {
    writeClusterCullParams(
      this.device,
      this.cullParamsBuffer,
      planes,
      viewProj,
      this.clusterHighWater,
      drawSlotCapacity,
      viewportWidth,
      viewportHeight,
      mipLevels,
      occlusionEnabled,
      0,
    );
  }

  get chunkCount(): number {
    return this.allocations.size;
  }

  get activeClusters(): number {
    return this.clusterAllocator.active;
  }

  get clusterHighWater(): number {
    return this.clusterAllocator.highWater;
  }

  get drawSlotCount(): number {
    return this.clusterAllocator.highWater;
  }

  get drawIndirectClearBytes(): number {
    return roundUp4(this.drawSlotCount * INDIRECT_INDEXED_ARGS_BYTES);
  }

  get ready(): boolean {
    return !!(this.vertexBuffer && this.originBuffer && this.indexBuffer && this.clusterBoundsBuffer && this.sourceIndirectBuffer && this.compactIndirectBuffer);
  }

  createBindGroup(): GPUBindGroup {
    if (!this.ready) throw new Error('Terrain GPU arena is not ready.');
    if (!this.bindGroup || this.bindGroupDirty) {
      this.bindGroup = this.device.createBindGroup({
        label: 'terrain arena cull bind group',
        layout: this.bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.clusterBoundsBuffer! } },
          { binding: 1, resource: { buffer: this.sourceIndirectBuffer! } },
          { binding: 2, resource: { buffer: this.compactIndirectBuffer! } },
          { binding: 3, resource: { buffer: this.cullParamsBuffer } },
        ],
      });
      this.bindGroupDirty = false;
    }
    return this.bindGroup;
  }

  gpuBytes(): number {
    return this.vertexCapacity * PACKED_TERRAIN_VERTEX_STRIDE
      + this.vertexCapacity * TERRAIN_ARENA_ORIGIN_STRIDE
      + this.indexCapacity * Uint32Array.BYTES_PER_ELEMENT
      + this.clusterCapacity * 4 * Float32Array.BYTES_PER_ELEMENT
      + this.clusterCapacity * INDIRECT_INDEXED_ARGS_BYTES * 2
      + CLUSTER_CULL_PARAMS_BYTES;
  }

  private buildSourceIndirectArgs(indexOffset: number, vertexOffset: number, indexCount: number, clusterCount: number): Uint32Array {
    const args = new Uint32Array(clusterCount * INDIRECT_INDEXED_ARGS_U32);
    for (let cluster = 0; cluster < clusterCount; cluster++) {
      const firstIndex = indexOffset + cluster * TERRAIN_CLUSTER_INDEX_COUNT;
      const localFirstIndex = cluster * TERRAIN_CLUSTER_INDEX_COUNT;
      const count = Math.max(0, Math.min(TERRAIN_CLUSTER_INDEX_COUNT, indexCount - localFirstIndex));
      const offset = cluster * INDIRECT_INDEXED_ARGS_U32;
      args[offset + 0] = count >>> 0;
      args[offset + 1] = 1;
      args[offset + 2] = firstIndex >>> 0;
      args[offset + 3] = vertexOffset >>> 0;
      args[offset + 4] = 0;
    }
    return args;
  }

  private ensureVertexCapacity(requiredVertices: number): void {
    if (this.vertexCapacity >= requiredVertices && this.vertexBuffer && this.originBuffer) return;
    const nextCapacity = nextPowerOfTwo(Math.max(TERRAIN_ARENA_MIN_VERTICES, requiredVertices));
    const vertexBytes = nextCapacity * PACKED_TERRAIN_VERTEX_STRIDE;
    const originBytes = nextCapacity * TERRAIN_ARENA_ORIGIN_STRIDE;
    this.vertexBuffer = this.recreateBuffer(
      this.vertexBuffer,
      this.vertexCapacity * PACKED_TERRAIN_VERTEX_STRIDE,
      vertexBytes,
      GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      'terrain arena vertices',
      true,
    );
    this.originBuffer = this.recreateBuffer(
      this.originBuffer,
      this.vertexCapacity * TERRAIN_ARENA_ORIGIN_STRIDE,
      originBytes,
      GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      'terrain arena origin stream',
      true,
    );
    this.vertexCapacity = nextCapacity;
  }

  private ensureIndexCapacity(requiredIndices: number): void {
    if (this.indexCapacity >= requiredIndices && this.indexBuffer) return;
    const nextCapacity = nextPowerOfTwo(Math.max(TERRAIN_ARENA_MIN_INDICES, requiredIndices));
    this.indexBuffer = this.recreateBuffer(
      this.indexBuffer,
      this.indexCapacity * Uint32Array.BYTES_PER_ELEMENT,
      nextCapacity * Uint32Array.BYTES_PER_ELEMENT,
      GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      'terrain arena indices',
      true,
    );
    this.indexCapacity = nextCapacity;
  }

  private ensureClusterCapacity(requiredClusters: number): void {
    if (this.clusterCapacity >= requiredClusters && this.clusterBoundsBuffer && this.sourceIndirectBuffer && this.compactIndirectBuffer) return;
    const nextCapacity = nextPowerOfTwo(Math.max(TERRAIN_ARENA_MIN_CLUSTERS, requiredClusters));
    this.clusterBoundsBuffer = this.recreateBuffer(
      this.clusterBoundsBuffer,
      this.clusterCapacity * 4 * Float32Array.BYTES_PER_ELEMENT,
      nextCapacity * 4 * Float32Array.BYTES_PER_ELEMENT,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      'terrain arena cluster bounds',
      true,
    );
    this.sourceIndirectBuffer = this.recreateBuffer(
      this.sourceIndirectBuffer,
      this.clusterCapacity * INDIRECT_INDEXED_ARGS_BYTES,
      nextCapacity * INDIRECT_INDEXED_ARGS_BYTES,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      'terrain arena source indirect args',
      true,
    );
    this.compactIndirectBuffer = this.recreateBuffer(
      this.compactIndirectBuffer,
      0,
      nextCapacity * INDIRECT_INDEXED_ARGS_BYTES,
      GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
      'terrain arena compact indirect args',
      false,
    );
    this.clusterCapacity = nextCapacity;
    this.bindGroupDirty = true;
  }

  private recreateBuffer(
    previous: GPUBuffer | null,
    previousBytes: number,
    nextBytes: number,
    usage: GPUBufferUsageFlags,
    label: string,
    copyPrevious: boolean,
  ): GPUBuffer {
    const buffer = this.device.createBuffer({
      label,
      size: roundUp4(Math.max(nextBytes, 4)),
      usage,
    });
    if (previous) {
      if (copyPrevious && previousBytes > 0) {
        const encoder = this.device.createCommandEncoder({ label: `${label} grow copy` });
        encoder.copyBufferToBuffer(previous, 0, buffer, 0, roundUp4(previousBytes));
        this.device.queue.submit([encoder.finish()]);
      }
      this.destroyAfterSubmittedWork(previous);
    }
    return buffer;
  }

  private destroyAfterSubmittedWork(buffer: GPUBuffer): void {
    void this.device.queue.onSubmittedWorkDone()
      .then(() => buffer.destroy())
      .catch(() => {
        try {
          buffer.destroy();
        } catch {
          // Device loss cleanup is best-effort.
        }
      });
  }
}

function nextPowerOfTwo(value: number): number {
  let n = 1;
  const target = Math.max(1, Math.ceil(value));
  while (n < target) n *= 2;
  return n;
}

function bytesToMB(bytes: number): number {
  return bytes / (1024 * 1024);
}

const MULTI_DRAW_INDIRECT_FEATURE = 'chromium-experimental-multi-draw-indirect' as GPUFeatureName;

function detectCapabilities(adapter: GPUAdapter): RuntimeCapabilities {
  const crossOriginIsolated = globalThis.crossOriginIsolated === true;
  const sharedArrayBufferAvailable = typeof SharedArrayBuffer !== 'undefined';
  const sharedReady = crossOriginIsolated && sharedArrayBufferAvailable;
  return {
    webgpu: true,
    crossOriginIsolated,
    sharedArrayBufferAvailable,
    workerBufferMode: sharedReady ? 'shared-ready' : 'transferable',
    maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
    maxBufferSizeMB: bytesToMB(adapter.limits.maxBufferSize),
    maxStorageBufferBindingSizeMB: bytesToMB(adapter.limits.maxStorageBufferBindingSize),
    timestampQuery: adapter.features.has('timestamp-query'),
    multiDrawIndirect: adapter.features.has(MULTI_DRAW_INDIRECT_FEATURE),
  };
}

function normalizePlane(plane: Plane): Plane {
  const len = Math.hypot(plane[0], plane[1], plane[2]) || 1;
  return [plane[0] / len, plane[1] / len, plane[2] / len, plane[3] / len];
}

function createFrustumPlanes(m: Mat4): Plane[] {
  return [
    normalizePlane([m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]]),
    normalizePlane([m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]]),
    normalizePlane([m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]]),
    normalizePlane([m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]]),
    normalizePlane([m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]]),
    normalizePlane([m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]]),
  ];
}

function sphereInFrustum(bounds: SphereBounds, planes: Plane[]): boolean {
  for (const plane of planes) {
    const d = plane[0] * bounds.center[0] + plane[1] * bounds.center[1] + plane[2] * bounds.center[2] + plane[3];
    if (d < -bounds.radius) return false;
  }
  return true;
}

function clusterSphereInFrustum(bounds: Float32Array, cluster: number, planes: Plane[]): boolean {
  const offset = cluster * 4;
  const cx = bounds[offset + 0];
  const cy = bounds[offset + 1];
  const cz = bounds[offset + 2];
  const radius = bounds[offset + 3];
  for (const plane of planes) {
    const d = plane[0] * cx + plane[1] * cy + plane[2] * cz + plane[3];
    if (d < -radius) return false;
  }
  return true;
}

function buildClusterRanges(clusters: number[], indexCount: number): ClusterRange[] {
  if (clusters.length === 0) return [];
  const ranges: ClusterRange[] = [];
  let first = clusters[0];
  let previous = first;
  for (let i = 1; i <= clusters.length; i++) {
    const current = clusters[i];
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    const firstIndex = first * TERRAIN_CLUSTER_INDEX_COUNT;
    const clusterCount = previous - first + 1;
    ranges.push({
      firstCluster: first,
      clusterCount,
      firstIndex,
      indexCount: Math.max(0, Math.min(indexCount - firstIndex, clusterCount * TERRAIN_CLUSTER_INDEX_COUNT)),
    });
    if (current === undefined) break;
    first = current;
    previous = current;
  }
  return ranges;
}

function buildClusterRangeBounds(clusterBounds: Float32Array, ranges: readonly ClusterRange[]): Float32Array {
  const bounds = new Float32Array(ranges.length * 4);
  for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex++) {
    const range = ranges[rangeIndex];
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < range.clusterCount; i++) {
      const offset = (range.firstCluster + i) * 4;
      const x = clusterBounds[offset + 0] ?? 0;
      const y = clusterBounds[offset + 1] ?? 0;
      const z = clusterBounds[offset + 2] ?? 0;
      const r = Math.max(0, clusterBounds[offset + 3] ?? 0);
      minX = Math.min(minX, x - r);
      minY = Math.min(minY, y - r);
      minZ = Math.min(minZ, z - r);
      maxX = Math.max(maxX, x + r);
      maxY = Math.max(maxY, y + r);
      maxZ = Math.max(maxZ, z + r);
    }
    if (!Number.isFinite(minX)) {
      minX = minY = minZ = maxX = maxY = maxZ = 0;
    }
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    const radius = Math.hypot(maxX - cx, maxY - cy, maxZ - cz);
    const offset = rangeIndex * 4;
    bounds[offset + 0] = cx;
    bounds[offset + 1] = cy;
    bounds[offset + 2] = cz;
    bounds[offset + 3] = radius;
  }
  return bounds;
}

function buildClusterRangeIndirectArgs(ranges: readonly ClusterRange[]): Uint32Array {
  const args = new Uint32Array(ranges.length * INDIRECT_INDEXED_ARGS_U32);
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    const offset = i * INDIRECT_INDEXED_ARGS_U32;
    args[offset + 0] = Math.max(0, range.indexCount) >>> 0;
    args[offset + 1] = 1;
    args[offset + 2] = Math.max(0, range.firstIndex) >>> 0;
    args[offset + 3] = 0;
    args[offset + 4] = 0;
  }
  return args;
}

function matricesNear(a: Mat4, b: Mat4 | null, epsilon = HIZ_VIEWPROJ_EPSILON): boolean {
  if (!b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > epsilon) return false;
  }
  return true;
}

function createTerrainOriginBuffer(device: GPUDevice, frame: TerrainPackFrame, label: string): GPUBuffer {
  return createMappedBufferWithData(
    device,
    new Float32Array([frame.origin[0], frame.origin[1], frame.origin[2], frame.scale]),
    GPUBufferUsage.VERTEX,
    label,
  );
}

function createEmptyBuffer(device: GPUDevice, size: number, usage: GPUBufferUsageFlags, label: string): GPUBuffer {
  return device.createBuffer({ label, size: roundUp4(Math.max(size, 4)), usage });
}

function writeClusterCullParams(
  device: GPUDevice,
  buffer: GPUBuffer,
  planes: Plane[],
  viewProj: Mat4,
  clusterCount: number,
  indexCount: number,
  viewportWidth: number,
  viewportHeight: number,
  mipLevels: number,
  occlusionEnabled: boolean,
  clusterIndexCount = TERRAIN_CLUSTER_INDEX_COUNT,
): void {
  const bytes = new ArrayBuffer(CLUSTER_CULL_PARAMS_BYTES);
  const view = new DataView(bytes);
  let offset = 0;
  for (let i = 0; i < 6; i++) {
    const plane = planes[i];
    view.setFloat32(offset + 0, plane[0], true);
    view.setFloat32(offset + 4, plane[1], true);
    view.setFloat32(offset + 8, plane[2], true);
    view.setFloat32(offset + 12, plane[3], true);
    offset += 16;
  }
  for (let i = 0; i < 16; i++) {
    view.setFloat32(offset + i * 4, viewProj[i], true);
  }
  offset += 64;
  view.setUint32(offset + 0, clusterCount, true);
  view.setUint32(offset + 4, indexCount, true);
  view.setUint32(offset + 8, Math.max(0, clusterIndexCount) >>> 0, true);
  view.setUint32(offset + 12, Math.max(1, mipLevels), true);
  offset += 16;
  view.setFloat32(offset + 0, viewportWidth, true);
  view.setFloat32(offset + 4, viewportHeight, true);
  view.setFloat32(offset + 8, occlusionEnabled ? 1.0 : 0.0, true);
  view.setFloat32(offset + 12, 0.0025, true);
  device.queue.writeBuffer(buffer, 0, bytes);
}

function createIndirectArgsBuffer(device: GPUDevice, clusterCount: number, label: string): GPUBuffer {
  return createEmptyBuffer(
    device,
    clusterCount * INDIRECT_INDEXED_ARGS_BYTES,
    GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    label,
  );
}

function countLodTransitionEdges(mask: number): number {
  let n = mask & LOD_SEAM_MASK_ALL;
  let count = 0;
  while (n) {
    count += n & 1;
    n >>= 1;
  }
  return count;
}

function vegetationPatchBounds(instances: Float32Array): SphereBounds {
  if (!instances || instances.length < 8) return { center: [0, 0, 0], radius: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i + 7 < instances.length; i += 8) {
    const x = instances[i + 0];
    const y = instances[i + 1];
    const z = instances[i + 2];
    const scale = Math.max(0.1, instances[i + 3]);
    const radius = scale * 0.55;
    minX = Math.min(minX, x - radius);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z - radius);
    maxX = Math.max(maxX, x + radius);
    maxY = Math.max(maxY, y + scale * 1.55);
    maxZ = Math.max(maxZ, z + radius);
  }
  const center: [number, number, number] = [
    (minX + maxX) * 0.5,
    (minY + maxY) * 0.5,
    (minZ + maxZ) * 0.5,
  ];
  let radius = 0;
  for (let i = 0; i + 7 < instances.length; i += 8) {
    const x = instances[i + 0];
    const y = instances[i + 1] + Math.max(0.1, instances[i + 3]) * 0.75;
    const z = instances[i + 2];
    const scale = Math.max(0.1, instances[i + 3]);
    radius = Math.max(radius, Math.hypot(x - center[0], y - center[1], z - center[2]) + scale * 1.65);
  }
  return { center, radius };
}

function scenicFarTerrainHeight(x: number, z: number): number {
  const riverDistance = Math.abs(x - scenicRiverCenter(z));
  const lateral = x - scenicRiverCenter(z);
  const h = terrainHeight(x, z);
  const valleyFloorNoise = fbm2(x * 0.016 + 42.0, z * 0.016 - 13.0, 3);
  const riverShelf = SCENIC_WATER_LEVEL - 1.16 + valleyFloorNoise * 0.44;
  const valleyRise = smoothStep(28, 470, riverDistance);
  const benchNoise = fbm2(x * 0.0052 - 8.0, z * 0.0052 + 22.0, 3);
  const rollingBreakup = fbm2(x * 0.010 + z * 0.0017, z * 0.010 - x * 0.0013, 4);
  const foothillRidges = ridge2((x + z * 0.18) * 0.0064 - 21.0, (z - x * 0.22) * 0.0060 + 14.0);
  const valleyFolds = ridge2(lateral * 0.010 + z * 0.0024, z * 0.0068 - x * 0.0013);
  const drainageWrinkles = fbm2((x + z * 0.24) * 0.017, (z - x * 0.18) * 0.016, 3);
  const softenedValley = riverShelf
    + Math.pow(valleyRise, 1.08) * 28.0
    + smoothStep(190, 780, riverDistance) * 40.0
    + benchNoise * 8.2 * smoothStep(58, 900, riverDistance)
    + rollingBreakup * 10.8 * smoothStep(92, 1100, riverDistance)
    + foothillRidges * 15.2 * smoothStep(145, 1160, riverDistance)
    + valleyFolds * 10.6 * smoothStep(48, 820, riverDistance)
    + drainageWrinkles * 4.8 * smoothStep(84, 920, riverDistance);
  const hSoft = mix(softenedValley, h, smoothStep(620, 1550, riverDistance));
  const valleyClear = smoothStep(230, 1080, riverDistance);
  const broadRange = ridge2(x * 0.0027 - 18.0, z * 0.0028 + 7.0);
  const crossedRange = ridge2((x + z * 0.26) * 0.0022 + 33.0, (z - x * 0.14) * 0.00235 - 12.0);
  const massif = clamp(fbm2(x * 0.00105 + 71.0, z * 0.00105 - 24.0) * 0.5 + 0.5, 0, 1);
  const leftWall = smoothStep(380, 1620, scenicRiverCenter(z) - x) * ridge2(x * 0.00175 - 43.0, z * 0.0020 + 25.0);
  const rightWall = smoothStep(320, 1450, x - scenicRiverCenter(z)) * ridge2(x * 0.0017 + 9.0, z * 0.00225 - 61.0);
  const skylineWall = smoothStep(780, 2550, Math.abs(z - 80)) * ridge2(x * 0.00135 - 27.0, z * 0.00155 + 32.0);
  const distanceLift = smoothStep(420, 2600, Math.abs(z)) * 34.0;
  const serratedPeaks = ridge2((x + z * 0.34) * 0.0039 + 4.0, (z - x * 0.20) * 0.0042 - 38.0)
    * smoothStep(780, 3450, Math.abs(z) + riverDistance * 0.52);
  const highShoulders = ridge2((x - z * 0.16) * 0.0056 - 53.0, (z + x * 0.12) * 0.0048 + 18.0)
    * smoothStep(520, 2550, riverDistance)
    * smoothStep(80, 330, h);
  const alpineLift = valleyClear * (
    broadRange * 118
      + crossedRange * 106
      + massif * 54
      + leftWall * 74
      + rightWall * 122
      + skylineWall * 154
      + serratedPeaks * 118
      + highShoulders * 48
      + distanceLift * 1.18
  );
  const nearRiverShelf = smoothStep(42, 230, riverDistance) * (1 - valleyClear) * 5.8;
  const foregroundRoll = fbm2(x * 0.022 - 16.0, z * 0.022 + 28.0, 3)
    * smoothStep(120, 980, riverDistance)
    * (1 - smoothStep(1500, 3600, Math.abs(z)));
  return FAR_TERRAIN_VISUAL_BASE_HEIGHT
    + (hSoft - FAR_TERRAIN_VISUAL_BASE_HEIGHT) * FAR_TERRAIN_VISUAL_HEIGHT_SCALE
    + alpineLift
    + nearRiverShelf
    + foregroundRoll;
}

function scenicFarTerrainNormal(x: number, z: number, sampleStep: number): [number, number, number] {
  const hL = scenicFarTerrainHeight(x - sampleStep, z);
  const hR = scenicFarTerrainHeight(x + sampleStep, z);
  const hD = scenicFarTerrainHeight(x, z - sampleStep);
  const hU = scenicFarTerrainHeight(x, z + sampleStep);
  const nx = hL - hR;
  const ny = sampleStep * 2.0;
  const nz = hD - hU;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function scenicFarTerrainAo(x: number, y: number, z: number, normalY: number, sampleStep: number): number {
  const sunX = SCENIC_REFERENCE_SUN_DIR[0];
  const sunY = SCENIC_REFERENCE_SUN_DIR[1];
  const sunZ = SCENIC_REFERENCE_SUN_DIR[2];
  const sunHorizontal = Math.hypot(sunX, sunZ) || 1;
  const raySlope = sunY / sunHorizontal;
  const distances = [
    sampleStep * 2.0,
    sampleStep * 4.0,
    sampleStep * 7.5,
    sampleStep * 12.0,
  ];
  let blocker = 0;
  for (const distance of distances) {
    const sx = x + sunX / sunHorizontal * distance;
    const sz = z + sunZ / sunHorizontal * distance;
    const rayY = y + raySlope * distance + 4.5 + distance * 0.010;
    const terrainY = scenicFarTerrainHeight(sx, sz) - 0.65;
    blocker = Math.max(blocker, clamp((terrainY - rayY) / (16 + distance * 0.052), 0, 1));
  }

  const shoulder = sampleStep * 2.25;
  const localHigh = Math.max(
    scenicFarTerrainHeight(x + shoulder, z),
    scenicFarTerrainHeight(x - shoulder, z),
    scenicFarTerrainHeight(x, z + shoulder),
    scenicFarTerrainHeight(x, z - shoulder),
  ) - 0.65;
  const cavity = clamp((localHigh - y) / (18 + shoulder * 0.10), 0, 1);
  const visibility = 1 - blocker;
  return clamp(0.54 + Math.max(normalY, 0) * 0.34 + visibility * 0.18 - blocker * 0.42 - cavity * 0.20, 0.28, 1.0);
}

function scenicTerrainMaterial(x: number, visualY: number, z: number, normalY: number, physicalY: number): number {
  const riverDistance = Math.abs(x - scenicRiverCenter(z));
  const wetBank = riverDistance < 13 && physicalY < 19.0;
  if (wetBank) return 3.0;
  const snowLine = 170
    + valueNoise2(x * 0.0035 + 11.0, z * 0.0035 - 19.0) * 50
    + smoothStep(0, 980, riverDistance) * 34;
  if (visualY > snowLine && normalY > 0.18) return 2.0;
  const exposedRock = normalY < 0.13
    || (visualY > snowLine - 32 && normalY < 0.44)
    || (visualY > 238 && ridge2(x * 0.006, z * 0.006) > 0.78);
  if (exposedRock) return 1.0;
  return 0.0;
}

function hashGrid01(x: number, z: number, salt = 0): number {
  let h = (Math.imul(x | 0, 0x8da6b343) ^ Math.imul(z | 0, 0xd8163841) ^ Math.imul(salt | 0, 0xcb1ab31f)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h & 0x00ffffff) / 16777215;
}

function scenicRiverCenter(z: number): number {
  const base = riverCenter(z);
  const sweep = Math.sin(z * 0.00162 + 1.7) * 138.0 + Math.sin(z * 0.0039 - 0.55) * 52.0;
  const valleyNoise = (valueNoise2(z * 0.0019 - 12.0, 73.0) * 2.0 - 1.0) * 48.0;
  return base + sweep + valleyNoise;
}

function scenicForestDensity(x: number, z: number, visualY: number, physicalY: number, normalY: number): number {
  const riverDistance = Math.abs(x - scenicRiverCenter(z));
  const shoulder = smoothStep(16, 112, riverDistance) * (1 - smoothStep(1850, 3450, riverDistance) * 0.24);
  const elevation = smoothStep(0, 12, physicalY) * (1 - smoothStep(220, 338, visualY));
  const slope = smoothStep(0.18, 0.70, normalY);
  const snowLine = 182 + valueNoise2(x * 0.0035 + 11.0, z * 0.0035 - 19.0) * 58;
  const belowSnow = 1 - smoothStep(snowLine - 58, snowLine + 16, visualY);
  const macroPatch = clamp(
    0.66
      + fbm2(x * 0.0042 + 17.0, z * 0.0042 - 31.0) * 0.42
      + (valueNoise2(x * 0.014 - 9.0, z * 0.014 + 45.0) - 0.5) * 0.24,
    0,
    1,
  );
  const clump = smoothStep(0.28, 0.86, macroPatch);
  const meadowBreak = 1 - smoothStep(0.50, 0.84, valueNoise2(x * 0.0028 - 46.0, z * 0.0028 + 14.0));
  const drainageBand = 0.92 + smoothStep(90, 900, riverDistance) * 0.22;
  const valleyMass = 0.92 + smoothStep(260, 1700, riverDistance) * 0.28;
  return clamp(shoulder * elevation * slope * belowSnow * clump * meadowBreak * drainageBand * valleyMass * 2.08, 0, 0.84);
}

function scenicWaterClearingAt(x: number, z: number, cameraPosition: Vec3): boolean {
  if (Math.abs(x - scenicRiverCenter(z)) < 14.0) return true;
  const viewSign = cameraPosition[2] >= 240 ? -1 : 1;
  const checks = [
    { z: cameraPosition[2] + viewSign * 360, lateral: -330, rx: 100, rz: 60 },
    { z: cameraPosition[2] + viewSign * 430, lateral: 76, rx: 152, rz: 92 },
    { z: cameraPosition[2] + viewSign * 1080, lateral: -218, rx: 108, rz: 64 },
    { z: cameraPosition[2] + viewSign * 1660, lateral: 132, rx: 140, rz: 80 },
  ];
  for (const lake of checks) {
    const cx = scenicRiverCenter(lake.z) + lake.lateral;
    const dx = (x - cx) / lake.rx;
    const dz = (z - lake.z) / lake.rz;
    if (dx * dx + dz * dz < 1.08) return true;
  }
  return false;
}

function buildScenicVegetationInstances(cameraPosition: Vec3, preserveNearTerrainVegetation: boolean): Float32Array {
  const values: number[] = [];
  const step = preserveNearTerrainVegetation ? SCENIC_NEAR_FOREST_STEP : SCENIC_FOREST_STEP;
  const innerClearing = preserveNearTerrainVegetation ? SCENIC_NEAR_FOREST_INNER_CLEARING : SCENIC_FOREST_INNER_CLEARING;
  const densityScale = preserveNearTerrainVegetation ? 0.84 : 0.94;
  const minGX = Math.floor((cameraPosition[0] - SCENIC_FOREST_RADIUS) / step);
  const maxGX = Math.ceil((cameraPosition[0] + SCENIC_FOREST_RADIUS) / step);
  const minGZ = Math.floor((cameraPosition[2] - SCENIC_FOREST_RADIUS) / step);
  const maxGZ = Math.ceil((cameraPosition[2] + SCENIC_FOREST_RADIUS) / step);
  for (let gz = minGZ; gz <= maxGZ; gz++) {
    for (let gx = minGX; gx <= maxGX; gx++) {
      const jx = (hashGrid01(gx, gz, 11) - 0.5) * step * 0.92;
      const jz = (hashGrid01(gx, gz, 23) - 0.5) * step * 0.92;
      const x = gx * step + jx;
      const z = gz * step + jz;
      const dx = x - cameraPosition[0];
      const dz = z - cameraPosition[2];
      const distance = Math.hypot(dx, dz);
      if (distance < innerClearing || distance > SCENIC_FOREST_RADIUS) continue;

      if (scenicWaterClearingAt(x, z, cameraPosition)) continue;

      const physicalY = terrainHeight(x, z);
      const visualY = scenicFarTerrainHeight(x, z);
      const normal = scenicFarTerrainNormal(x, z, 18);
      const density = scenicForestDensity(x, z, visualY, physicalY, normal[1]);
      const treeRoll = hashGrid01(gx, gz, 37);
      const localClump = smoothStep(0.22, 0.86, valueNoise2(x * 0.026 + 31.0, z * 0.026 - 18.0));
      if (treeRoll <= density * densityScale * (0.42 + localClump * 0.70)) {
        const nearScale = mix(1.08, 1.18, smoothStep(360, 1500, distance));
        const distantBoost = smoothStep(1500, 3200, distance);
        const closeHero = 1.0 - smoothStep(160, 760, distance);
        const scale = (8.8 + hashGrid01(gx, gz, 41) * 12.8 + density * 5.0 + closeHero * 6.4) * nearScale * (1 + distantBoost * 0.20);
        values.push(x, visualY - 0.16, z, scale, 1, hashGrid01(gx, gz, 53) * 100.0, density, hashGrid01(gx, gz, 59) * 0.82);
        if (density > 0.52 && localClump > 0.58 && distance > innerClearing + step * 0.5 && distance < 4200 && hashGrid01(gx, gz, 61) < density * 0.42) {
          const ox = (hashGrid01(gx, gz, 89) - 0.5) * step * 0.72;
          const oz = (hashGrid01(gx, gz, 97) - 0.5) * step * 0.72;
          const cx = x + ox;
          const cz = z + oz;
          const cy = scenicFarTerrainHeight(cx, cz);
          const clusterScale = scale * (0.50 + hashGrid01(gx, gz, 101) * 0.48);
          values.push(cx, cy - 0.16, cz, clusterScale, 1, hashGrid01(gx, gz, 103) * 100.0, density, hashGrid01(gx, gz, 107) * 0.82);
        }
        continue;
      }

      const rockDensity = clamp(
        (1 - normal[1]) * 0.68
          + smoothStep(62, 156, visualY) * 0.22
          + ridge2(x * 0.010 + 7.0, z * 0.010 - 3.0) * 0.18
          - smoothStep(0.18, 0.70, density) * 0.18,
        0,
        0.72,
      );
      if (visualY > 18 && hashGrid01(gx, gz, 67) < rockDensity * 0.28) {
        const scale = 1.25 + hashGrid01(gx, gz, 71) * 3.2 + (1 - normal[1]) * 1.6;
        values.push(x, visualY - 0.08, z, scale, 2, hashGrid01(gx, gz, 79) * 100.0, rockDensity, hashGrid01(gx, gz, 83));
      }
    }
  }
  return new Float32Array(values);
}

const TERRAIN_SHADER = /* wgsl */`
struct Scene {
  viewProj: mat4x4<f32>,
  camera: vec4<f32>,
  sun: vec4<f32>,
  params: vec4<f32>,
  visual: vec4<f32>,
};
@group(0) @binding(0) var<uniform> scene: Scene;

struct ShadowData {
  lightViewProj: mat4x4<f32>,
  params: vec4<f32>,
};
@group(1) @binding(0) var<uniform> shadow: ShadowData;
@group(1) @binding(1) var shadowDepth: texture_depth_2d;
@group(1) @binding(2) var shadowSampler: sampler_comparison;

fn sample_sun_shadow(world: vec3<f32>, n: vec3<f32>) -> f32 {
  if (shadow.params.x < 0.5) { return 1.0; }
  let lightClip = shadow.lightViewProj * vec4<f32>(world, 1.0);
  if (lightClip.w <= 0.0) { return 1.0; }
  let ndc = lightClip.xyz / lightClip.w;
  if (ndc.x < -1.0 || ndc.x > 1.0 || ndc.y < -1.0 || ndc.y > 1.0 || ndc.z > 1.0) { return 1.0; }
  let uv = vec2<f32>(ndc.x * 0.5 + 0.5, ndc.y * -0.5 + 0.5);
  let sunDir = normalize(scene.sun.xyz);
  let slope = clamp(1.0 - max(dot(n, sunDir), 0.0), 0.0, 1.0);
  let bias = shadow.params.z * (1.0 + slope * 4.0);
  let compareDepth = ndc.z - bias;
  let texel = shadow.params.y;
  var sum = 0.0;
  for (var oy = -1; oy <= 1; oy = oy + 1) {
    for (var ox = -1; ox <= 1; ox = ox + 1) {
      let offset = vec2<f32>(f32(ox), f32(oy)) * texel;
      sum = sum + textureSampleCompareLevel(shadowDepth, shadowSampler, uv + offset, compareDepth);
    }
  }
  return sum / 9.0;
}

struct VertexIn {
  @location(0) localPosition: vec4<f32>,
  @location(1) normalAo: vec4<f32>,
  @location(2) material: vec4<u32>,
  @location(3) originScale: vec4<f32>,
};
struct VertexOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) material: vec4<f32>,
  @location(3) ao: f32,
};

@vertex
fn vs_main(input: VertexIn) -> VertexOut {
  var out: VertexOut;
  out.world = input.originScale.xyz + input.localPosition.xyz * input.originScale.w;
  out.normal = normalize(input.normalAo.xyz * 2.0 - vec3<f32>(1.0));
  out.material = vec4<f32>(
    f32(input.material.x),
    f32(input.material.y) / 255.0,
    f32(input.material.z) / 255.0,
    f32(input.material.w) / 255.0
  );
  out.ao = input.normalAo.w;
  out.clip = scene.viewProj * vec4<f32>(out.world, 1.0);
  return out;
}

fn hash_u32(x: u32) -> u32 {
  var h = x;
  h = h ^ (h >> 16u);
  h = h * 0x7feb352du;
  h = h ^ (h >> 15u);
  h = h * 0x846ca68bu;
  h = h ^ (h >> 16u);
  return h;
}

fn hash2i(p: vec2<i32>) -> u32 {
  let x = bitcast<u32>(p.x);
  let y = bitcast<u32>(p.y);
  return hash_u32((x * 0x8da6b343u) ^ (y * 0xd8163841u));
}

fn hash01(p: vec2<i32>) -> f32 {
  return f32(hash2i(p) & 0x00ffffffu) / 16777215.0;
}

fn fade2(t: vec2<f32>) -> vec2<f32> {
  return t * t * t * (t * (t * 6.0 - vec2<f32>(15.0)) + vec2<f32>(10.0));
}

// Fast hash-based value noise. It avoids sine/hash texture lookups and is cheap enough
// to use per-fragment for procedural grass, dirt, rock, and snow detail.
fn fast_noise2(p: vec2<f32>) -> f32 {
  let i = vec2<i32>(i32(floor(p.x)), i32(floor(p.y)));
  let f = p - vec2<f32>(f32(i.x), f32(i.y));
  let u = fade2(f);
  let a = hash01(i);
  let b = hash01(i + vec2<i32>(1, 0));
  let c = hash01(i + vec2<i32>(0, 1));
  let d = hash01(i + vec2<i32>(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}

fn fbm2(p0: vec2<f32>) -> f32 {
  var p = p0;
  var sum = 0.0;
  var amp = 0.5;
  var norm = 0.0;
  for (var i = 0; i < 4; i = i + 1) {
    sum = sum + fast_noise2(p) * amp;
    norm = norm + amp;
    p = p * 2.03 + vec2<f32>(13.7, -9.2);
    amp = amp * 0.5;
  }
  return sum / max(norm, 0.0001);
}

fn warped_fbm2(p: vec2<f32>) -> f32 {
  let warp = vec2<f32>(
    fbm2(p * 0.47 + vec2<f32>(18.2, -7.1)),
    fbm2(p * 0.47 + vec2<f32>(-31.3, 14.8))
  ) * 3.0;
  return fbm2(p + warp);
}

struct DetailNoise {
  large: f32,
  medium: f32,
  fine: f32,
  fleck: f32,
};

fn detail_noise(world: vec3<f32>) -> DetailNoise {
  let uv = world.xz;
  let large = warped_fbm2(uv * 0.032 + vec2<f32>(world.y * 0.006, -world.y * 0.004));
  let medium = fbm2(uv * 0.145 + vec2<f32>(large * 3.1, large * -2.4));
  let fine = fast_noise2(uv * 0.92 + vec2<f32>(medium * 4.0, large * 3.0));
  let fleck = smoothstep(0.28, 0.92, fast_noise2(uv * 2.35 + vec2<f32>(world.y * 0.12, -world.y * 0.07)));
  let strength = clamp(scene.params.z * 0.24, 0.0, 0.82);
  return DetailNoise(large * strength, medium * strength, fine * strength, clamp(fleck * strength, 0.0, 1.0));
}

fn material_color(m: vec4<f32>, world: vec3<f32>, n: vec3<f32>) -> vec3<f32> {
  let id = i32(round(m.x));
  let biome = clamp(m.y, 0.0, 1.0);
  let wetness = clamp(m.z, 0.0, 1.0);
  let snowMask = clamp(m.w, 0.0, 1.0);
  let d = detail_noise(world);
  let slope = clamp(n.y, 0.0, 1.0);
  let steep = 1.0 - slope;

  if (id == 1) {
    let strata = 0.5 + 0.5 * sin(world.y * 0.78 + world.x * 0.035 + d.large * 2.0);
    let crack = smoothstep(0.35, 0.95, abs(d.medium));
    let lichen = smoothstep(0.35, 0.85, d.large) * slope * 0.18;
    // Grey/brown slope variation: a large-scale mask biased by face steepness
    // splits rock between warm iron-brown bands and cool grey-blue stone.
    // Brightness is kept near the old flat base so it can't blow out under the
    // existing cinematic lighting multipliers.
    let warmMask = smoothstep(-0.34, 0.52, d.large + steep * 0.30);
    let warmRock = vec3<f32>(0.196, 0.166, 0.130);
    let coldRock = vec3<f32>(0.150, 0.160, 0.166);
    var color = mix(coldRock, warmRock, warmMask);
    color = color + vec3<f32>(0.066, 0.064, 0.058) * strata;
    color = color - vec3<f32>(0.050, 0.052, 0.050) * crack;
    color = color + vec3<f32>(0.056, 0.124, 0.040) * lichen * (1.0 - snowMask * 0.45);
    color = mix(color, vec3<f32>(0.126, 0.148, 0.148), wetness * 0.30);
    color = mix(color, vec3<f32>(0.98, 1.08, 1.16), snowMask * 0.76);
    color = color + d.fine * vec3<f32>(0.020, 0.021, 0.020);
    return color;
  }

  if (id == 2) {
    let drift = max(snowMask, smoothstep(-0.25, 0.75, d.large));
    let ice = smoothstep(0.10, 0.90, d.medium);
    let exposed = smoothstep(0.40, 0.95, steep);
    var snow = mix(vec3<f32>(1.02, 1.12, 1.22), vec3<f32>(1.34, 1.38, 1.36), drift);
    snow = mix(snow, vec3<f32>(0.82, 0.94, 1.08), ice * 0.18);
    snow = mix(snow, vec3<f32>(0.56, 0.58, 0.56), exposed * 0.30);
    snow = snow + d.fine * vec3<f32>(0.020, 0.024, 0.030);
    return snow;
  }

  if (id == 3) {
    let moisture = max(wetness, smoothstep(-0.55, 0.45, d.large));
    let gravel = d.fleck;
    var dirt = mix(vec3<f32>(0.155, 0.145, 0.095), vec3<f32>(0.070, 0.090, 0.078), moisture * 0.52);
    dirt = mix(dirt, vec3<f32>(0.300, 0.270, 0.185), gravel * 0.12);
    dirt = dirt + d.fine * vec3<f32>(0.012, 0.014, 0.010);
    return dirt;
  }

  let grassPatch = smoothstep(-0.58, 0.80, d.medium);
  let blade = smoothstep(-0.42, 0.92, d.fine);
  let dirtMask = smoothstep(0.34, 0.94, -d.large * 0.50 + steep * 0.42);
  let snowDust = max(snowMask * 0.48, smoothstep(260.0, 420.0, world.y) * smoothstep(0.48, 0.92, slope));
  let valleyGrass = mix(vec3<f32>(0.016, 0.128, 0.032), vec3<f32>(0.285, 0.585, 0.110), grassPatch);
  let alpineGrass = mix(vec3<f32>(0.028, 0.150, 0.040), vec3<f32>(0.315, 0.535, 0.112), grassPatch);
  var grass = mix(valleyGrass, alpineGrass, biome * 0.42);
  grass = mix(grass, vec3<f32>(0.140, 0.305, 0.070), blade * 0.18);
  let forestStipple = smoothstep(0.08, 0.62, d.large * 0.72 + d.medium * 0.24) * smoothstep(0.32, 0.95, slope);
  grass = mix(grass, vec3<f32>(0.010, 0.060, 0.022), forestStipple * (0.42 + biome * 0.22));
  let soil = vec3<f32>(0.142, 0.132, 0.080) + d.fine * vec3<f32>(0.010, 0.009, 0.006);
  var color = mix(grass, soil, dirtMask * 0.045);
  color = mix(color, vec3<f32>(0.050, 0.108, 0.074), wetness * 0.14);
  color = mix(color, vec3<f32>(0.86, 0.92, 0.90), snowDust * 0.18);
  return color;
}

fn material_debug_color(m: vec4<f32>) -> vec3<f32> {
  let id = i32(round(m.x));
  if (id == 1) { return vec3<f32>(0.50, 0.50, 0.56); }
  if (id == 2) { return vec3<f32>(0.78, 0.94, 1.00); }
  if (id == 3) { return vec3<f32>(0.72, 0.45, 0.18); }
  return vec3<f32>(0.22, 0.78, 0.28);
}

fn material_mask_debug_color(m: vec4<f32>) -> vec3<f32> {
  return vec3<f32>(m.y, m.z, m.w);
}

fn saturate(x: f32) -> f32 {
  return clamp(x, 0.0, 1.0);
}

fn tone_map(color: vec3<f32>) -> vec3<f32> {
  let exposed = max(color * max(scene.visual.x, 0.01), vec3<f32>(0.0));
  let mapped = exposed / (exposed + vec3<f32>(1.0));
  let gamma = pow(mapped, vec3<f32>(1.0 / 2.2));
  let luma = dot(gamma, vec3<f32>(0.2126, 0.7152, 0.0722));
  let saturated = mix(vec3<f32>(luma), gamma, 1.27);
  return clamp((saturated - vec3<f32>(0.5)) * 1.16 + vec3<f32>(0.5), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn cinematic_light(color: vec3<f32>, n: vec3<f32>, world: vec3<f32>, ao: f32) -> vec3<f32> {
  let sunDir = normalize(scene.sun.xyz);
  let viewDir = normalize(scene.camera.xyz - world);
  let sunHeight = saturate(sunDir.y);
  let direct = saturate(dot(n, sunDir));
  let lowSun = saturate(1.0 - sunHeight * 1.25);
  let face = pow(direct, 1.10);
  let halfLambert = pow(direct * 0.5 + 0.5, 3.4);
  let shadowShape = 0.008 + face * 2.34 + halfLambert * 0.040;
  let warmSun = mix(vec3<f32>(1.86, 1.02, 0.44), vec3<f32>(1.12, 0.92, 0.66), sunHeight);
  let skyAmbient = mix(vec3<f32>(0.012, 0.032, 0.060), vec3<f32>(0.095, 0.160, 0.220), saturate(n.y * 0.5 + 0.5));
  let groundBounce = vec3<f32>(0.34, 0.20, 0.070) * saturate(1.0 - n.y) * 0.075;
  let rim = pow(1.0 - saturate(dot(n, viewDir)), 2.8) * vec3<f32>(0.10, 0.15, 0.19);
  let landformShade = mix(0.34, 1.20, smoothstep(-0.18, 0.92, dot(n, normalize(vec3<f32>(-sunDir.x, 0.18, -sunDir.z)))));
  let hollow = smoothstep(-0.35, 0.76, fbm2(world.xz * 0.018 + vec2<f32>(world.y * 0.018, -world.y * 0.011)));
  let shadowCast = smoothstep(-0.18, 0.76, fbm2(world.xz * 0.010 + vec2<f32>(sunDir.x, sunDir.z) * world.y * 0.060 + vec2<f32>(31.0, -17.0)));
  let grazingShadow = mix(0.055, 1.18, max(hollow * 0.64, shadowCast * 0.92)) * mix(0.22, 1.0, direct * 0.70 + saturate(n.y) * 0.30);
  let sunWash = warmSun * lowSun * (0.06 + pow(saturate(dot(normalize(world - scene.camera.xyz), sunDir)) * 0.5 + 0.5, 2.7) * 0.17);
  let sunShadow = sample_sun_shadow(world, n);
  var lit = color * (skyAmbient * 0.20 + warmSun * shadowShape * landformShade * grazingShadow * sunShadow + groundBounce + rim + sunWash);
  let goldenSlope = smoothstep(0.08, 0.86, direct + saturate(n.y) * 0.18) * lowSun;
  lit = lit + color * warmSun * goldenSlope * 0.20 * sunShadow;
  let broadTerrainShadow = smoothstep(-0.34, 0.50, fbm2(world.xz * 0.0036 + vec2<f32>(world.y * 0.010, -world.y * 0.006) + vec2<f32>(-19.0, 31.0)));
  let longShadow = mix(0.28, 1.18, broadTerrainShadow) * mix(0.72, 1.0, direct * 0.58 + saturate(n.y) * 0.42);
  lit = lit * mix(1.0, longShadow, lowSun * 0.92);
  let graded = max((lit - vec3<f32>(0.022)) * (1.56 + lowSun * 0.24) + vec3<f32>(0.022), vec3<f32>(0.0));
  return graded * mix(0.26, 1.0, ao);
}

fn apply_atmosphere(color: vec3<f32>, world: vec3<f32>) -> vec3<f32> {
  let d = distance(scene.camera.xyz, world);
  let atmosphere = max(scene.visual.y, 0.0);
  let distanceFog = max(d - 480.0, 0.0);
  let fog = saturate(1.0 - exp(-distanceFog * 0.00025 * scene.params.y * atmosphere));
  let heightFog = saturate((world.y - scene.camera.y + 150.0) / 420.0);
  let sunDir = normalize(scene.sun.xyz);
  let sunSide = pow(saturate(dot(normalize(world - scene.camera.xyz), sunDir)) * 0.5 + 0.5, 2.1);
  let lowSun = saturate(1.0 - sunDir.y * 1.35);
  let hazeBlue = vec3<f32>(0.50, 0.60, 0.70);
  let hazeGold = vec3<f32>(1.72, 0.94, 0.32);
  let fogColor = mix(hazeBlue, hazeGold, saturate(sunSide * 0.86 + lowSun * 0.03));
  let aerial = mix(color, fogColor, min(0.38, fog * (0.46 + heightFog * 0.08)));
  let glare = pow(sunSide, 3.8) * fog * lowSun;
  let leftWorld = saturate(1.0 - smoothstep(-260.0, 1220.0, world.x - scene.camera.x + d * 0.10));
  let lowAngleVeil = leftWorld * lowSun * smoothstep(240.0, 1900.0, d) * (1.0 - smoothstep(3600.0, 5200.0, d));
  return aerial + hazeGold * (glare * 0.82 + lowAngleVeil * 0.26);
}

fn procedural_forest_shadow(world: vec3<f32>, n: vec3<f32>, m: vec4<f32>) -> f32 {
  let grassReceiver = 1.0 - step(0.5, abs(m.x - 0.0));
  let mudReceiver = 1.0 - step(0.5, abs(m.x - 3.0));
  let receiverMaterial = max(grassReceiver, mudReceiver * 0.58);
  let receiverSlope = smoothstep(0.28, 0.74, n.y);
  let snowClear = 1.0 - smoothstep(0.20, 0.72, m.w);
  var shadowDir = vec2<f32>(-scene.sun.x, -scene.sun.z);
  shadowDir = shadowDir / max(length(shadowDir), 0.001);
  let sideDir = vec2<f32>(-shadowDir.y, shadowDir.x);
  let p = vec2<f32>(dot(world.xz, sideDir), dot(world.xz, shadowDir));
  let forestPatch = smoothstep(-0.28, 0.42, fbm2(world.xz * 0.010 + vec2<f32>(12.0, -9.0)) + m.y * 0.26 - m.w * 0.52);
  let broadCanopy = smoothstep(-0.40, 0.50, fbm2(world.xz * 0.0046 + vec2<f32>(-36.0, 18.0)) - m.w * 0.38);
  let longBands = smoothstep(0.06, 0.78, fast_noise2(vec2<f32>(p.x * 0.054, p.y * 0.013)));
  let brokenBands = smoothstep(-0.04, 0.70, fast_noise2(vec2<f32>(p.x * 0.138 + 17.0, p.y * 0.030 - 11.0)));
  let canopyBreakup = smoothstep(-0.24, 0.78, fbm2(vec2<f32>(p.x * 0.085, p.y * 0.052) + vec2<f32>(21.0, -8.0)));
  let lowSun = saturate(1.24 - scene.sun.y * 1.78);
  let distanceFade = 1.0 - smoothstep(3000.0, 4550.0, distance(scene.camera.xyz, world));
  let cover = max(forestPatch, broadCanopy * 0.72);
  let valleyGradient = smoothstep(-900.0, 820.0, scene.camera.z - world.z);
  return clamp(receiverMaterial * receiverSlope * snowClear * cover * longBands * brokenBands * (0.36 + canopyBreakup * 0.84) * lowSun * distanceFade * (1.62 + valleyGradient * 0.34), 0.0, 0.94);
}

fn chunk_debug_color(world: vec3<f32>) -> vec3<f32> {
  let cell = vec2<i32>(i32(floor(world.x / 32.0)), i32(floor(world.z / 32.0)));
  let h = hash2i(cell);
  let r = f32((h >> 0u) & 255u) / 255.0;
  let g = f32((h >> 8u) & 255u) / 255.0;
  let b = f32((h >> 16u) & 255u) / 255.0;
  return mix(vec3<f32>(0.18, 0.22, 0.28), vec3<f32>(r, g, b), 0.82);
}

@fragment
fn fs_main(input: VertexOut) -> @location(0) vec4<f32> {
  let n = normalize(input.normal);
  let debugView = i32(round(scene.sun.w));
  if (debugView == 1) {
    return vec4<f32>(n * 0.5 + vec3<f32>(0.5), 1.0);
  }
  if (debugView == 2) {
    return vec4<f32>(material_debug_color(input.material), 1.0);
  }
  if (debugView == 3) {
    return vec4<f32>(vec3<f32>(input.ao), 1.0);
  }
  if (debugView == 4) {
    return vec4<f32>(chunk_debug_color(input.world), 1.0);
  }
  if (debugView == 7) {
    return vec4<f32>(material_mask_debug_color(input.material), 1.0);
  }
  if (debugView == 8) {
    return vec4<f32>(mix(vec3<f32>(0.10, 0.28, 0.08), vec3<f32>(0.66, 0.70, 0.92), input.material.y), 1.0);
  }
  if (debugView == 9) {
    return vec4<f32>(mix(vec3<f32>(0.16, 0.11, 0.07), vec3<f32>(0.06, 0.66, 0.90), input.material.z), 1.0);
  }
  if (debugView == 10) {
    return vec4<f32>(mix(vec3<f32>(0.10, 0.12, 0.16), vec3<f32>(0.92, 0.98, 1.00), input.material.w), 1.0);
  }

  var color = material_color(input.material, input.world, n);
  if (scene.visual.w > 0.5) {
    color = cinematic_light(color, n, input.world, input.ao);
    let snowPreserve = max(input.material.w, 1.0 - step(0.5, abs(input.material.x - 2.0)));
    color = mix(color, color * vec3<f32>(0.84, 1.00, 1.22) + vec3<f32>(0.05, 0.075, 0.10) * snowPreserve, snowPreserve * 0.42);
    let grassPreserve = 1.0 - step(0.5, abs(input.material.x));
    color = mix(color, color * vec3<f32>(0.84, 1.10, 0.78), grassPreserve * 0.18);
    var forestShadow = procedural_forest_shadow(input.world, n, input.material);
    if (shadow.params.x > 0.5) {
      // Real sun shadows cover the near region; fade the procedural forest-shadow
      // approximation out there so the two don't double-darken, while keeping it
      // for the mid-distance band beyond the shadow map's reach.
      let realCoverage = 1.0 - smoothstep(520.0, 980.0, distance(scene.camera.xyz, input.world));
      forestShadow = forestShadow * (1.0 - realCoverage);
    }
    color = color * (1.0 - forestShadow);
    color = apply_atmosphere(color, input.world);
    color = tone_map(color);
  } else {
    let sunDir = normalize(scene.sun.xyz);
    let diffuse = max(dot(n, sunDir), 0.0) * sample_sun_shadow(input.world, n);
    let sky = 0.35 + 0.30 * clamp(n.y, 0.0, 1.0);
    let rim = pow(1.0 - max(dot(n, normalize(scene.camera.xyz - input.world)), 0.0), 2.0) * 0.08;
    color *= (sky + diffuse * 0.95 + rim) * input.ao;
    color = apply_atmosphere(color, input.world);
  }
  return vec4<f32>(color, 1.0);
}
`;

const SKY_SHADER = /* wgsl */`
struct Scene {
  viewProj: mat4x4<f32>,
  camera: vec4<f32>,
  sun: vec4<f32>,
  params: vec4<f32>,
  visual: vec4<f32>,
};
@group(0) @binding(0) var<uniform> scene: Scene;

struct VertexOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  let x = f32((vertexIndex << 1u) & 2u);
  let y = f32(vertexIndex & 2u);
  var out: VertexOut;
  out.clip = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  out.uv = vec2<f32>(x, y);
  return out;
}

fn saturate(x: f32) -> f32 {
  return clamp(x, 0.0, 1.0);
}

fn hash21(p: vec2<f32>) -> f32 {
  let q = fract(vec2<f32>(dot(p, vec2<f32>(127.1, 311.7)), dot(p, vec2<f32>(269.5, 183.3))));
  return fract(sin(q.x + q.y) * 43758.5453);
}

fn noise2(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2<f32>(1.0, 0.0));
  let c = hash21(i + vec2<f32>(0.0, 1.0));
  let d = hash21(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn tone_map(color: vec3<f32>) -> vec3<f32> {
  let exposed = max(color * max(scene.visual.x, 0.01) * 0.88, vec3<f32>(0.0));
  let mapped = exposed / (exposed + vec3<f32>(1.0));
  let gamma = pow(mapped, vec3<f32>(1.0 / 2.2));
  let luma = dot(gamma, vec3<f32>(0.2126, 0.7152, 0.0722));
  return clamp(mix(vec3<f32>(luma), gamma, 1.22), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn cloud_puff(uv: vec2<f32>, center: vec2<f32>, radius: vec2<f32>) -> f32 {
  let p = (uv - center) / radius;
  return 1.0 - smoothstep(0.42, 1.0, dot(p, p));
}

@fragment
fn fs_main(input: VertexOut) -> @location(0) vec4<f32> {
  let rawUv = input.uv;
  let uv = input.uv;
  let horizon = saturate(uv.y);
  let zenith = vec3<f32>(0.34, 0.54, 0.78);
  let horizonBlue = vec3<f32>(0.82, 0.89, 0.93);
  let lowGold = vec3<f32>(2.08, 1.06, 0.32);
  let sunDir = normalize(scene.sun.xyz);
  let sunScreen = vec2<f32>(clamp(0.082 + sunDir.x * 0.030, 0.035, 0.13), clamp(0.43 - sunDir.y * 0.10, 0.34, 0.48));
  let sunDist = distance(uv, sunScreen);
  let sunDisk = 1.0 - smoothstep(0.004, 0.048, sunDist);
  let sunBloom = exp(-sunDist * 5.10) * 3.05;
  let sunAura = exp(-sunDist * 2.18) * (1.0 - smoothstep(0.10, 0.98, uv.y));
  let leftHaze = exp(-distance(uv, vec2<f32>(0.018, 0.48)) * 1.14) * smoothstep(0.02, 0.92, uv.y);
  let valleyGlow = exp(-distance(uv, vec2<f32>(0.065, 0.50)) * 1.82) * smoothstep(0.02, 0.90, uv.y);
  let rawValleyGlow = exp(-distance(rawUv, vec2<f32>(0.14, 0.44)) * 2.18);
  let horizonGlow = pow(horizon, 1.34) * (0.64 + 1.08 * saturate(1.0 - sunDir.y));
  var color = mix(zenith, horizonBlue, pow(horizon, 0.72));
  color = mix(color, lowGold, horizonGlow * (0.09 + sunAura * 0.14 + sunBloom * 0.055));
  color += vec3<f32>(2.34, 1.06, 0.28) * (sunBloom * 1.05 + sunDisk * 5.2);
  color += vec3<f32>(1.68, 0.76, 0.22) * sunAura * 0.80;
  color += vec3<f32>(2.08, 0.92, 0.22) * leftHaze * 1.22;
  color += vec3<f32>(1.95, 0.88, 0.24) * valleyGlow * 1.06;
  color += vec3<f32>(1.44, 0.68, 0.22) * rawValleyGlow * 0.34;
  let sunWall = (1.0 - smoothstep(0.02, 0.66, uv.x)) * smoothstep(0.14, 0.84, uv.y);
  color += vec3<f32>(1.56, 0.66, 0.18) * sunWall * 0.68;
  let cloudBase = noise2(uv * vec2<f32>(5.4, 2.4) + vec2<f32>(scene.params.x * 0.006, 7.3));
  let cloudFine = noise2(uv * vec2<f32>(16.0, 6.0) + vec2<f32>(-4.1, scene.params.x * 0.010));
  let cloudWisp = noise2(uv * vec2<f32>(34.0, 12.0) + vec2<f32>(13.2, -8.0));
  let cloudField = cloudBase * 0.58 + cloudFine * 0.30 + cloudWisp * 0.12;
  let cloudBand = smoothstep(0.60, 0.82, cloudField);
  let cloudZone = smoothstep(0.014, 0.060, uv.y) * (1.0 - smoothstep(0.28, 0.64, uv.y));
  let cloudBreakup = smoothstep(0.28, 0.74, noise2(uv * vec2<f32>(2.2, 1.1) + vec2<f32>(21.0, -5.0)));
  let proceduralCloud = cloudBand * cloudZone * cloudBreakup;
  let puffRight = cloud_puff(uv, vec2<f32>(0.78, 0.095), vec2<f32>(0.205, 0.050))
    + cloud_puff(uv, vec2<f32>(0.91, 0.122), vec2<f32>(0.155, 0.044))
    + cloud_puff(uv, vec2<f32>(0.66, 0.155), vec2<f32>(0.128, 0.042));
  let puffMid = cloud_puff(uv, vec2<f32>(0.48, 0.120), vec2<f32>(0.118, 0.040))
    + cloud_puff(uv, vec2<f32>(0.56, 0.170), vec2<f32>(0.135, 0.044));
  let puffLeft = cloud_puff(uv, vec2<f32>(0.19, 0.145), vec2<f32>(0.165, 0.050))
    + cloud_puff(uv, vec2<f32>(0.09, 0.230), vec2<f32>(0.190, 0.058));
  let rawClouds = cloud_puff(rawUv, vec2<f32>(1.56, 0.20), vec2<f32>(0.42, 0.084))
    + cloud_puff(rawUv, vec2<f32>(1.78, 0.27), vec2<f32>(0.28, 0.070))
    + cloud_puff(rawUv, vec2<f32>(0.78, 0.24), vec2<f32>(0.24, 0.062));
  let authoredCloudBand = smoothstep(0.050, 0.11, uv.y)
    * (1.0 - smoothstep(0.18, 0.34, uv.y))
    * smoothstep(0.32, 0.58, uv.x);
  let cloudMask = clamp(max(max(max(proceduralCloud * 0.90, authoredCloudBand * 0.86), rawClouds * 0.82), puffRight * 1.10 + puffMid * 0.94 + puffLeft * 0.78), 0.0, 1.0);
  let cloudLight = mix(vec3<f32>(1.54, 1.58, 1.46), vec3<f32>(2.42, 1.50, 0.64), saturate(1.0 - sunDist * 1.10));
  let cloudShade = vec3<f32>(1.02, 1.05, 1.00);
  let cloudTint = mix(cloudShade, cloudLight, smoothstep(0.18, 0.92, 1.0 - sunDist));
  color = mix(color, cloudTint, smoothstep(0.02, 0.78, cloudMask) * 1.10);
  color += vec3<f32>(0.20, 0.13, 0.040) * cloudMask * saturate(1.0 - sunDist * 0.92);
  color = mix(color, vec3<f32>(0.76, 0.84, 0.90), pow(horizon, 5.0) * scene.visual.y * 0.018);
  return vec4<f32>(tone_map(color), 1.0);
}
`;

const CLUSTER_CULL_SHADER = /* wgsl */`
struct CullParams {
  planes: array<vec4<f32>, 6>,
  viewProj: mat4x4<f32>,
  counts: vec4<u32>,
  viewport: vec4<f32>,
};

struct IndirectIndexedArgs {
  indexCount: u32,
  instanceCount: u32,
  firstIndex: u32,
  baseVertex: i32,
  firstInstance: u32,
};

@group(0) @binding(0) var<storage, read> clusterBounds: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> indirectArgs: array<IndirectIndexedArgs>;
@group(0) @binding(2) var<uniform> params: CullParams;
@group(1) @binding(0) var hiZDepth: texture_2d<f32>;
@group(1) @binding(1) var<storage, read_write> hiZCounters: array<atomic<u32>, 2>;

fn cluster_visible(bounds: vec4<f32>) -> bool {
  var visible = true;
  for (var i = 0u; i < 6u; i = i + 1u) {
    let plane = params.planes[i];
    let distance = dot(plane.xyz, bounds.xyz) + plane.w;
    if (distance < -bounds.w) {
      visible = false;
    }
  }
  return visible;
}

fn projected_occluded(bounds: vec4<f32>) -> bool {
  if (params.viewport.z < 0.5 || params.counts.w <= 1u) {
    return false;
  }

  var minUv = vec2<f32>(100000.0, 100000.0);
  var maxUv = vec2<f32>(-100000.0, -100000.0);
  var nearestDepth = 1.0;
  let r = max(bounds.w, 0.0);

  for (var corner = 0u; corner < 8u; corner = corner + 1u) {
    let sx = select(-1.0, 1.0, (corner & 1u) != 0u);
    let sy = select(-1.0, 1.0, (corner & 2u) != 0u);
    let sz = select(-1.0, 1.0, (corner & 4u) != 0u);
    let world = bounds.xyz + vec3<f32>(sx, sy, sz) * r;
    let clip = params.viewProj * vec4<f32>(world, 1.0);
    if (clip.w <= 0.001) {
      return false;
    }
    let ndc = clip.xyz / clip.w;
    if (ndc.z <= 0.0 || ndc.z >= 1.0) {
      return false;
    }
    let uv = vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
    minUv = min(minUv, uv);
    maxUv = max(maxUv, uv);
    nearestDepth = min(nearestDepth, ndc.z);
  }

  if (minUv.x < 0.0 || minUv.y < 0.0 || maxUv.x > 1.0 || maxUv.y > 1.0) {
    return false;
  }

  let rectPixels = max((maxUv - minUv) * params.viewport.xy, vec2<f32>(1.0, 1.0));
  let mipF = clamp(ceil(log2(max(rectPixels.x, rectPixels.y))), 0.0, f32(params.counts.w - 1u));
  let mip = i32(u32(mipF));
  let mipDims = vec2<f32>(textureDimensions(hiZDepth, mip));
  let maxCoord = vec2<i32>(mipDims - vec2<f32>(1.0, 1.0));
  let minCoord = clamp(vec2<i32>(floor(minUv * mipDims)), vec2<i32>(0, 0), maxCoord);
  let rectMaxCoord = clamp(vec2<i32>(floor(maxUv * mipDims)), vec2<i32>(0, 0), maxCoord);

  var farthestDepth = textureLoad(hiZDepth, minCoord, mip).x;
  farthestDepth = max(farthestDepth, textureLoad(hiZDepth, vec2<i32>(rectMaxCoord.x, minCoord.y), mip).x);
  farthestDepth = max(farthestDepth, textureLoad(hiZDepth, vec2<i32>(minCoord.x, rectMaxCoord.y), mip).x);
  farthestDepth = max(farthestDepth, textureLoad(hiZDepth, rectMaxCoord, mip).x);
  return farthestDepth < nearestDepth - params.viewport.w;
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) id: vec3<u32>) {
  let cluster = id.x;
  if (cluster >= params.counts.x) {
    return;
  }
  var firstIndex = indirectArgs[cluster].firstIndex;
  var count = indirectArgs[cluster].indexCount;
  if (params.counts.z > 0u) {
    firstIndex = cluster * params.counts.z;
    count = 0u;
    if (firstIndex < params.counts.y) {
      count = min(params.counts.z, params.counts.y - firstIndex);
    }
  }
  let bounds = clusterBounds[cluster];
  if (!cluster_visible(bounds)) {
    count = 0u;
  } else if (params.viewport.z > 0.5) {
    atomicAdd(&hiZCounters[0], 1u);
    if (projected_occluded(bounds)) {
      atomicAdd(&hiZCounters[1], 1u);
      count = 0u;
    }
  }
  indirectArgs[cluster].indexCount = count;
  indirectArgs[cluster].instanceCount = 1u;
  indirectArgs[cluster].firstIndex = firstIndex;
  indirectArgs[cluster].baseVertex = 0;
  indirectArgs[cluster].firstInstance = 0u;
}
`;

const TERRAIN_ARENA_CULL_SHADER = /* wgsl */`
struct CullParams {
  planes: array<vec4<f32>, 6>,
  viewProj: mat4x4<f32>,
  counts: vec4<u32>,
  viewport: vec4<f32>,
};

struct IndirectIndexedArgs {
  indexCount: u32,
  instanceCount: u32,
  firstIndex: u32,
  baseVertex: i32,
  firstInstance: u32,
};

@group(0) @binding(0) var<storage, read> clusterBounds: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> sourceArgs: array<IndirectIndexedArgs>;
@group(0) @binding(2) var<storage, read_write> compactArgs: array<IndirectIndexedArgs>;
@group(0) @binding(3) var<uniform> params: CullParams;
@group(1) @binding(0) var hiZDepth: texture_2d<f32>;
@group(1) @binding(1) var<storage, read_write> visibilityCounters: array<atomic<u32>, 2>;

fn cluster_visible(bounds: vec4<f32>) -> bool {
  var visible = true;
  for (var i = 0u; i < 6u; i = i + 1u) {
    let plane = params.planes[i];
    let distance = dot(plane.xyz, bounds.xyz) + plane.w;
    if (distance < -bounds.w) {
      visible = false;
    }
  }
  return visible;
}

fn projected_occluded(bounds: vec4<f32>) -> bool {
  if (params.viewport.z < 0.5 || params.counts.w <= 1u) {
    return false;
  }

  var minUv = vec2<f32>(100000.0, 100000.0);
  var maxUv = vec2<f32>(-100000.0, -100000.0);
  var nearestDepth = 1.0;
  let r = max(bounds.w, 0.0);

  for (var corner = 0u; corner < 8u; corner = corner + 1u) {
    let sx = select(-1.0, 1.0, (corner & 1u) != 0u);
    let sy = select(-1.0, 1.0, (corner & 2u) != 0u);
    let sz = select(-1.0, 1.0, (corner & 4u) != 0u);
    let world = bounds.xyz + vec3<f32>(sx, sy, sz) * r;
    let clip = params.viewProj * vec4<f32>(world, 1.0);
    if (clip.w <= 0.001) {
      return false;
    }
    let ndc = clip.xyz / clip.w;
    if (ndc.z <= 0.0 || ndc.z >= 1.0) {
      return false;
    }
    let uv = vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
    minUv = min(minUv, uv);
    maxUv = max(maxUv, uv);
    nearestDepth = min(nearestDepth, ndc.z);
  }

  if (minUv.x < 0.0 || minUv.y < 0.0 || maxUv.x > 1.0 || maxUv.y > 1.0) {
    return false;
  }

  let rectPixels = max((maxUv - minUv) * params.viewport.xy, vec2<f32>(1.0, 1.0));
  let mipF = clamp(ceil(log2(max(rectPixels.x, rectPixels.y))), 0.0, f32(params.counts.w - 1u));
  let mip = i32(u32(mipF));
  let mipDims = vec2<f32>(textureDimensions(hiZDepth, mip));
  let maxCoord = vec2<i32>(mipDims - vec2<f32>(1.0, 1.0));
  let minCoord = clamp(vec2<i32>(floor(minUv * mipDims)), vec2<i32>(0, 0), maxCoord);
  let rectMaxCoord = clamp(vec2<i32>(floor(maxUv * mipDims)), vec2<i32>(0, 0), maxCoord);

  var farthestDepth = textureLoad(hiZDepth, minCoord, mip).x;
  farthestDepth = max(farthestDepth, textureLoad(hiZDepth, vec2<i32>(rectMaxCoord.x, minCoord.y), mip).x);
  farthestDepth = max(farthestDepth, textureLoad(hiZDepth, vec2<i32>(minCoord.x, rectMaxCoord.y), mip).x);
  farthestDepth = max(farthestDepth, textureLoad(hiZDepth, rectMaxCoord, mip).x);
  return farthestDepth < nearestDepth - params.viewport.w;
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) id: vec3<u32>) {
  let cluster = id.x;
  if (cluster >= params.counts.x) {
    return;
  }

  let args = sourceArgs[cluster];
  if (args.indexCount == 0u || args.instanceCount == 0u) {
    return;
  }

  let bounds = clusterBounds[cluster];
  if (!cluster_visible(bounds)) {
    return;
  }

  if (params.viewport.z > 0.5 && projected_occluded(bounds)) {
    atomicAdd(&visibilityCounters[1], 1u);
    return;
  }

  let slot = atomicAdd(&visibilityCounters[0], 1u);
  if (slot < params.counts.y) {
    compactArgs[slot] = args;
  }
}
`;

const DEPTH_PYRAMID_FIRST_SHADER = /* wgsl */`
@group(0) @binding(0) var sourceDepth: texture_depth_2d;
@group(0) @binding(1) var outMip: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(outMip);
  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }
  let depth = textureLoad(sourceDepth, vec2<i32>(id.xy), 0);
  textureStore(outMip, vec2<i32>(id.xy), vec4<f32>(depth, 0.0, 0.0, 0.0));
}
`;

const DEPTH_PYRAMID_MIP_SHADER = /* wgsl */`
@group(0) @binding(0) var sourceMip: texture_2d<f32>;
@group(0) @binding(1) var outMip: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dstDims = textureDimensions(outMip);
  if (id.x >= dstDims.x || id.y >= dstDims.y) {
    return;
  }
  let srcDims = textureDimensions(sourceMip);
  let base = vec2<i32>(id.xy * 2u);
  var farthest = 0.0;
  for (var oy = 0; oy < 2; oy = oy + 1) {
    for (var ox = 0; ox < 2; ox = ox + 1) {
      let coord = min(base + vec2<i32>(ox, oy), vec2<i32>(srcDims) - vec2<i32>(1, 1));
      farthest = max(farthest, textureLoad(sourceMip, coord, 0).x);
    }
  }
  textureStore(outMip, vec2<i32>(id.xy), vec4<f32>(farthest, 0.0, 0.0, 0.0));
}
`;

const WATER_SHADER = /* wgsl */`
struct Scene {
  viewProj: mat4x4<f32>,
  camera: vec4<f32>,
  sun: vec4<f32>,
  params: vec4<f32>,
  visual: vec4<f32>,
};
@group(0) @binding(0) var<uniform> scene: Scene;
struct VertexIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) material: f32,
  @location(3) ao: f32,
};
struct VertexOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) edge: f32,
};
@vertex
fn vs_main(input: VertexIn) -> VertexOut {
  var pos = input.position;
  let t = scene.params.x;
  pos.y += sin(pos.x * 0.16 + t * 1.35) * 0.026 + sin(pos.z * 0.12 - t * 1.0) * 0.020;
  var out: VertexOut;
  out.world = pos;
  out.edge = input.ao;
  out.clip = scene.viewProj * vec4<f32>(pos, 1.0);
  return out;
}
fn water_wave_normal(p: vec2<f32>, t: f32) -> vec3<f32> {
  // Three world-space directional sine bands. World-space (not view-space)
  // phase keeps the surface stable as the camera moves; amp*freq is kept small
  // so the perturbed normal stays gentle for calm alpine water.
  var slope = vec2<f32>(0.0, 0.0);
  let dA = vec2<f32>(0.86, 0.50);
  let phA = dot(p, dA) * 0.085 + t * 1.15;
  slope = slope + dA * (0.55 * 0.085 * cos(phA));
  let dB = vec2<f32>(-0.30, 0.95);
  let phB = dot(p, dB) * 0.142 - t * 0.85;
  slope = slope + dB * (0.32 * 0.142 * cos(phB));
  let dC = vec2<f32>(0.65, -0.76);
  let phC = dot(p, dC) * 0.265 + t * 1.6;
  slope = slope + dC * (0.14 * 0.265 * cos(phC));
  return normalize(vec3<f32>(-slope.x, 1.0, -slope.y));
}

@fragment
fn fs_main(input: VertexOut) -> @location(0) vec4<f32> {
  let t = scene.params.x;
  let sunDir = normalize(scene.sun.xyz);
  let sun = max(sunDir.y, 0.0);
  let viewDir = normalize(scene.camera.xyz - input.world);
  let n = water_wave_normal(input.world.xz, t);
  let ndv = max(dot(n, viewDir), 0.0);
  let fresnel = pow(1.0 - ndv, 5.0);

  // Depth tint: edge is 0 at the deep channel center and rises toward shallow
  // banks / lake rims, so deep water reads dark teal-blue and shallow lighter.
  let shallow = clamp(input.edge, 0.0, 1.0);
  let deepColor = vec3<f32>(0.011, 0.057, 0.086);
  let shallowColor = vec3<f32>(0.052, 0.166, 0.182);
  var color = mix(deepColor, shallowColor, shallow * 0.82);

  // Grazing angles pick up sky/horizon color through fresnel.
  let skyTint = mix(vec3<f32>(0.090, 0.205, 0.285), vec3<f32>(0.430, 0.560, 0.680), sun);
  color = mix(color, skyTint, fresnel * 0.62);

  // Sun glint off the perturbed normal, clamped so it tone-maps instead of blowing out.
  let refl = reflect(-sunDir, n);
  let glint = pow(max(dot(refl, viewDir), 0.0), 90.0) * (0.55 + sun * 0.85);
  color = color + vec3<f32>(1.95, 1.36, 0.66) * min(glint, 3.0);

  // Edge foam with downstream flow: streaks advect along world z over time.
  let flow = input.world.z * 0.055 - t * 0.6;
  let streak = sin(input.world.x * 0.50 + flow * 3.0) * 0.5 + 0.5;
  let ripple = sin(input.world.x * 1.30 - flow * 5.0 + input.world.z * 0.20) * 0.5 + 0.5;
  let foamNoise = clamp(streak * 0.62 + ripple * 0.48, 0.0, 1.0);
  let foamMask = smoothstep(0.60, 1.0, shallow) * foamNoise;
  color = mix(color, vec3<f32>(0.80, 0.91, 0.93), foamMask * 0.48);

  let d = distance(scene.camera.xyz, input.world);
  let fog = clamp(1.0 - exp(-max(d - 220.0, 0.0) * 0.00040 * scene.params.y * max(scene.visual.y, 0.0)), 0.0, 0.34);
  let sunSide = pow(clamp(dot(normalize(input.world - scene.camera.xyz), sunDir) * 0.5 + 0.5, 0.0, 1.0), 3.0);
  let lowSun = clamp(1.0 - sunDir.y * 1.35, 0.0, 1.0);
  let waterFog = mix(vec3<f32>(0.36, 0.50, 0.60), vec3<f32>(0.96, 0.62, 0.28), clamp(sunSide * 0.66 + lowSun * 0.08, 0.0, 1.0));
  color = mix(color, waterFog, fog * 0.86);
  color = pow((color * scene.visual.x) / (color * scene.visual.x + vec3<f32>(1.0)), vec3<f32>(1.0 / 2.2));
  return vec4<f32>(color, 1.0);
}
`;

const BEACON_SHADER = /* wgsl */`
struct Scene {
  viewProj: mat4x4<f32>,
  camera: vec4<f32>,
  sun: vec4<f32>,
  params: vec4<f32>,
  visual: vec4<f32>,
};
@group(0) @binding(0) var<uniform> scene: Scene;

struct VertexIn {
  @location(0) local: vec3<f32>,
  @location(1) shade: f32,
  @location(2) base: vec3<f32>,
  @location(3) radius: f32,
};
struct VertexOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) color: vec3<f32>,
};

@vertex
fn vs_main(input: VertexIn) -> VertexOut {
  let pulse = 1.0 + sin(scene.params.x * 4.2 + input.base.x * 0.017 + input.base.z * 0.011) * 0.09;
  let radius = abs(input.radius);
  let world = input.base + input.local * radius * pulse;
  let dirtyRegion = input.radius < 0.0;
  var out: VertexOut;
  out.clip = scene.viewProj * vec4<f32>(world, 1.0);
  let beaconColor = mix(vec3<f32>(0.08, 0.30, 0.34), vec3<f32>(0.38, 0.78, 0.68), input.shade);
  let dirtyColor = mix(vec3<f32>(0.95, 0.20, 0.05), vec3<f32>(1.0, 0.82, 0.18), input.shade);
  out.color = select(beaconColor, dirtyColor, dirtyRegion);
  return out;
}

@fragment
fn fs_main(input: VertexOut) -> @location(0) vec4<f32> {
  return vec4<f32>(input.color, 0.58);
}
`;

const VEGETATION_SHADER = /* wgsl */`
struct Scene {
  viewProj: mat4x4<f32>,
  camera: vec4<f32>,
  sun: vec4<f32>,
  params: vec4<f32>,
  visual: vec4<f32>,
};
@group(0) @binding(0) var<uniform> scene: Scene;

const VEG_SHRUB_LOD_SQ: f32 = ${VEGETATION_SHRUB_LOD_DISTANCE * VEGETATION_SHRUB_LOD_DISTANCE};
const VEG_ROCK_LOD_SQ: f32 = ${VEGETATION_ROCK_LOD_DISTANCE * VEGETATION_ROCK_LOD_DISTANCE};
const VEG_SMALL_PINE_LOD_SQ: f32 = ${VEGETATION_SMALL_PINE_LOD_DISTANCE * VEGETATION_SMALL_PINE_LOD_DISTANCE};
const VEG_SMALL_PINE_SCALE: f32 = ${VEGETATION_SMALL_PINE_SCALE};

struct VertexIn {
  @location(0) local: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) part: f32,
  @location(3) base: vec3<f32>,
  @location(4) scale: f32,
  @location(5) kind: f32,
  @location(6) seed: f32,
  @location(7) tint: f32,
  @location(8) aspect: f32,
};
struct VertexOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) part: f32,
  @location(3) kind: f32,
  @location(4) tint: f32,
  @location(5) seed: f32,
};
@vertex
fn vs_main(input: VertexIn) -> VertexOut {
  let dx = input.base.x - scene.camera.x;
  let dz = input.base.z - scene.camera.z;
  let distSq = dx * dx + dz * dz;
  var lodPasses = true;
  if (input.kind < 0.5) {
    lodPasses = distSq <= VEG_SHRUB_LOD_SQ;
  } else if (input.kind >= 1.5) {
    lodPasses = distSq <= VEG_ROCK_LOD_SQ;
  } else if (input.scale < VEG_SMALL_PINE_SCALE) {
    lodPasses = distSq <= VEG_SMALL_PINE_LOD_SQ;
  }
  var visible = 0.0;
  if (input.kind >= 1.5 && input.part >= 2.5) {
    visible = 1.0;
  } else if (input.kind < 0.5 && input.part >= 1.5 && input.part < 2.5) {
    visible = 1.0;
  } else if (input.kind >= 0.5 && input.kind < 1.5 && input.part < 1.5) {
    visible = 1.0;
  }
  if (!lodPasses) { visible = 0.0; }
  let windable = select(0.0, 1.0, input.kind < 1.5 && input.part > 0.5);
  let stiffness = mix(1.0, 0.34, clamp(input.aspect, 0.0, 1.0));
  let wind = sin(scene.params.x * 1.8 + input.seed + input.base.x * 0.04) * 0.055 * input.local.y * input.scale * windable * stiffness;
  let aspect = clamp(input.aspect, 0.0, 1.0);
  let rockSquash = select(1.0, 0.62 + aspect * 0.26, input.kind >= 1.5);
  let crownWidthX = select(1.0, 0.86 + aspect * 0.28, input.kind >= 0.5 && input.kind < 1.5);
  let crownWidthZ = select(1.0, 1.08 - aspect * 0.16, input.kind >= 0.5 && input.kind < 1.5);
  let p = vec3<f32>(
    input.local.x * input.scale * visible * crownWidthX + wind,
    input.local.y * input.scale * visible * rockSquash,
    input.local.z * input.scale * visible * crownWidthZ
  );
  let world = input.base + p;
  var out: VertexOut;
  out.world = world;
  out.normal = normalize(input.normal);
  out.part = input.part;
  out.kind = input.kind;
  out.tint = input.tint;
  out.seed = input.seed;
  out.clip = scene.viewProj * vec4<f32>(world, 1.0);
  return out;
}
@fragment
fn fs_main(input: VertexOut) -> @location(0) vec4<f32> {
  let n = normalize(input.normal);
  let sunDir = normalize(scene.sun.xyz);
  let diffuse = max(dot(n, sunDir), 0.0);
  let warmSun = mix(vec3<f32>(1.72, 0.78, 0.26), vec3<f32>(1.0, 0.84, 0.58), max(sunDir.y, 0.0));
  let variation = fract(input.world.x * 0.071 + input.world.z * 0.043 + input.kind * 0.37 + input.seed * 0.013);
  var color = mix(vec3<f32>(0.003, 0.022, 0.010), vec3<f32>(0.074, 0.176, 0.040), variation);
  if (input.part < 0.5) {
    color = vec3<f32>(0.20, 0.116, 0.054);
  } else if (input.kind < 0.5) {
    color = mix(vec3<f32>(0.032, 0.088, 0.028), vec3<f32>(0.156, 0.266, 0.072), clamp(input.tint + variation * 0.18, 0.0, 1.0));
  } else if (input.kind >= 1.5) {
    let lichen = smoothstep(0.36, 0.92, input.tint + variation * 0.24);
    color = mix(vec3<f32>(0.23, 0.22, 0.20), vec3<f32>(0.47, 0.40, 0.31), variation * 0.62);
    color = mix(color, vec3<f32>(0.22, 0.29, 0.17), lichen * 0.20);
  }
  let ambient = mix(vec3<f32>(0.007, 0.020, 0.040), vec3<f32>(0.062, 0.112, 0.060), max(n.y, 0.0));
  let selfShade = mix(0.26, 1.16, smoothstep(-0.2, 0.9, n.y + diffuse * 0.34));
  color *= (ambient + warmSun * (0.060 + diffuse * 1.92)) * selfShade;
  let d = distance(scene.camera.xyz, input.world);
  let fog = clamp(1.0 - exp(-max(d - 460.0, 0.0) * 0.00030 * scene.params.y * max(scene.visual.y, 0.0)), 0.0, 0.24);
  let sunSide = pow(clamp(dot(normalize(input.world - scene.camera.xyz), sunDir) * 0.5 + 0.5, 0.0, 1.0), 3.0);
  let lowSun = clamp(1.0 - sunDir.y * 1.35, 0.0, 1.0);
  let haze = mix(vec3<f32>(0.34, 0.46, 0.56), vec3<f32>(0.96, 0.62, 0.26), clamp(sunSide * 0.68 + lowSun * 0.08, 0.0, 1.0));
  color = mix(color, haze, fog);
  if (scene.visual.w > 0.5) {
    color = pow((color * scene.visual.x) / (color * scene.visual.x + vec3<f32>(1.0)), vec3<f32>(1.0 / 2.2));
  }
  return vec4<f32>(color, 1.0);
}
`;

const SHADOW_CASTER_SHADER = /* wgsl */`
struct ShadowCast {
  lightViewProj: mat4x4<f32>,
  params: vec4<f32>,
};
@group(0) @binding(0) var<uniform> shadow: ShadowCast;

struct VertexIn {
  @location(0) localPosition: vec4<f32>,
  @location(3) originScale: vec4<f32>,
};

@vertex
fn vs_main(input: VertexIn) -> @builtin(position) vec4<f32> {
  let world = input.originScale.xyz + input.localPosition.xyz * input.originScale.w;
  return shadow.lightViewProj * vec4<f32>(world, 1.0);
}
`;

const SHADOW_VEGETATION_CASTER_SHADER = /* wgsl */`
struct ShadowCast {
  lightViewProj: mat4x4<f32>,
  params: vec4<f32>,
};
@group(0) @binding(0) var<uniform> shadow: ShadowCast;

struct VertexIn {
  @location(0) local: vec3<f32>,
  @location(2) part: f32,
  @location(3) base: vec3<f32>,
  @location(4) scale: f32,
  @location(5) kind: f32,
  @location(8) aspect: f32,
};

@vertex
fn vs_main(input: VertexIn) -> @builtin(position) vec4<f32> {
  var visible = 0.0;
  if (input.kind >= 1.5 && input.part >= 2.5) {
    visible = 1.0;
  } else if (input.kind < 0.5 && input.part >= 1.5 && input.part < 2.5) {
    visible = 1.0;
  } else if (input.kind >= 0.5 && input.kind < 1.5 && input.part < 1.5) {
    visible = 1.0;
  }
  let aspect = clamp(input.aspect, 0.0, 1.0);
  let rockSquash = select(1.0, 0.62 + aspect * 0.26, input.kind >= 1.5);
  let crownWidthX = select(1.0, 0.86 + aspect * 0.28, input.kind >= 0.5 && input.kind < 1.5);
  let crownWidthZ = select(1.0, 1.08 - aspect * 0.16, input.kind >= 0.5 && input.kind < 1.5);
  let p = vec3<f32>(
    input.local.x * input.scale * visible * crownWidthX,
    input.local.y * input.scale * visible * rockSquash,
    input.local.z * input.scale * visible * crownWidthZ
  );
  let world = input.base + p;
  return shadow.lightViewProj * vec4<f32>(world, 1.0);
}
`;

function makeTreeMesh() {
  const verts = [];
  const add = (p: number[], n: number[], part: number) => verts.push(p[0], p[1], p[2], n[0], n[1], n[2], part);
  const sides = 8;
  const layers = [
    { y: 0.13, r: 0.58, apex: [0, 1.42, 0] },
    { y: 0.38, r: 0.50, apex: [0, 1.72, 0] },
    { y: 0.66, r: 0.38, apex: [0, 1.34, 0] },
    { y: 0.94, r: 0.26, apex: [0, 1.58, 0] },
  ];
  for (let layer = 0; layer < layers.length; layer++) {
    const { y, r, apex } = layers[layer];
    for (let i = 0; i < sides; i++) {
      const a = i / sides * Math.PI * 2;
      const b = (i + 1) / sides * Math.PI * 2;
      const p0 = [Math.cos(a) * r, y, Math.sin(a) * r];
      const p1 = [Math.cos(b) * r, y, Math.sin(b) * r];
      const n = [Math.cos(a + Math.PI / sides), 0.55, Math.sin(a + Math.PI / sides)];
      add(apex, n, 1); add(p0, n, 1); add(p1, n, 1);
    }
  }
  // crossed trunk quads
  const trunk = [
    [[-0.08, 0, 0], [0.08, 0, 0], [0.08, 0.48, 0], [-0.08, 0.48, 0]],
    [[0, 0, -0.08], [0, 0, 0.08], [0, 0.48, 0.08], [0, 0.48, -0.08]],
  ];
  for (const q of trunk) {
    const n = [0, 0, 1];
    add(q[0], n, 0); add(q[1], n, 0); add(q[2], n, 0);
    add(q[0], n, 0); add(q[2], n, 0); add(q[3], n, 0);
  }

  // Shrub and rock variants share the vegetation draw. The vertex shader
  // collapses inactive variant parts per instance kind.
  for (let i = 0; i < sides; i++) {
    const a = i / sides * Math.PI * 2;
    const b = (i + 1) / sides * Math.PI * 2;
    const p0 = [Math.cos(a) * 0.48, 0.03, Math.sin(a) * 0.48];
    const p1 = [Math.cos(b) * 0.48, 0.03, Math.sin(b) * 0.48];
    const apex = [Math.cos(a + Math.PI / sides) * 0.08, 0.56, Math.sin(a + Math.PI / sides) * 0.08];
    const n = [Math.cos(a + Math.PI / sides) * 0.45, 0.72, Math.sin(a + Math.PI / sides) * 0.45];
    add(apex, n, 2); add(p0, n, 2); add(p1, n, 2);
  }

  const rockRing = [
    [0.58, 0.06, 0.00],
    [0.30, 0.02, 0.42],
    [-0.24, 0.05, 0.45],
    [-0.56, 0.03, 0.08],
    [-0.32, 0.07, -0.38],
    [0.28, 0.04, -0.48],
  ];
  const rockTop = [0.03, 0.56, -0.02];
  const rockBase = [0.00, 0.00, 0.00];
  for (let i = 0; i < rockRing.length; i++) {
    const p0 = rockRing[i];
    const p1 = rockRing[(i + 1) % rockRing.length];
    const mid = [(p0[0] + p1[0]) * 0.5, 0.30, (p0[2] + p1[2]) * 0.5];
    const len = Math.hypot(mid[0], 0.55, mid[2]) || 1;
    const n = [mid[0] / len, 0.55 / len, mid[2] / len];
    add(rockTop, n, 3); add(p0, n, 3); add(p1, n, 3);
    add(rockBase, [0, -1, 0], 3); add(p1, [0, -1, 0], 3); add(p0, [0, -1, 0], 3);
  }
  return new Float32Array(verts);
}

function makeBeaconMesh(): Float32Array {
  const top = [0, 1, 0];
  const bottom = [0, -1, 0];
  const ring = [
    [1, 0, 0],
    [0, 0, 1],
    [-1, 0, 0],
    [0, 0, -1],
  ];
  const verts: number[] = [];
  const add = (p: number[], shade: number) => verts.push(p[0], p[1], p[2], shade);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    add(top, 1); add(a, 0.72); add(b, 0.72);
    add(bottom, 0.42); add(b, 0.72); add(a, 0.72);
  }
  return new Float32Array(verts);
}

export class Renderer {
  canvas: HTMLCanvasElement;
  device!: GPUDevice;
  context!: GPUCanvasContext;
  format!: GPUTextureFormat;
  depthTexture?: GPUTexture;
  uniformBuffer!: GPUBuffer;
  uniformBindGroup!: GPUBindGroup;
  skyPipeline!: GPURenderPipeline;
  terrainPipeline!: GPURenderPipeline;
  waterPipeline!: GPURenderPipeline;
  vegetationPipeline!: GPURenderPipeline;
  beaconPipeline!: GPURenderPipeline;
  terrainArenaPipeline!: GPURenderPipeline;
  shadowCasterPipeline!: GPURenderPipeline;
  shadowVegetationCasterPipeline!: GPURenderPipeline;
  shadowCasterBindGroupLayout!: GPUBindGroupLayout;
  shadowSampleBindGroupLayout!: GPUBindGroupLayout;
  shadowUniformBuffer!: GPUBuffer;
  shadowCasterBindGroup!: GPUBindGroup;
  shadowSampleBindGroup!: GPUBindGroup;
  shadowDepthTexture!: GPUTexture;
  shadowDepthView!: GPUTextureView;
  lightViewProj: Mat4 = mat4Identity();
  terrainArenaCullPipeline!: GPUComputePipeline;
  terrainArenaCullBindGroupLayout!: GPUBindGroupLayout;
  clusterCullPipeline!: GPUComputePipeline;
  clusterCullBindGroupLayout!: GPUBindGroupLayout;
  clusterCullOcclusionBindGroupLayout!: GPUBindGroupLayout;
  depthPyramidFirstPipeline!: GPUComputePipeline;
  depthPyramidMipPipeline!: GPUComputePipeline;
  depthPyramidFirstBindGroupLayout!: GPUBindGroupLayout;
  depthPyramidMipBindGroupLayout!: GPUBindGroupLayout;
  depthPyramid: DepthPyramidResources | null = null;
  depthPyramidReady = false;
  depthPyramidViewProj: Mat4 | null = null;
  hiZOcclusionCounterBuffer!: GPUBuffer;
  hiZOcclusionReadbackBuffer!: GPUBuffer;
  hiZOcclusionReadbackPending = false;
  hiZOcclusionReadbackReady = false;
  hiZOcclusion: HiZOcclusionCounters = { tested: 0, culled: 0 };
  uploadRing!: GpuUploadRing;
  terrainArena!: TerrainGpuArena;
  treeVertexBuffer!: GPUBuffer;
  treeVertexCount = 0;
  vegetationBatchBuffer: GPUBuffer | null = null;
  vegetationBatchCapacityBytes = 0;
  vegetationBatchBytes = 0;
  vegetationBatchScratch = new Float32Array(0);
  shadowVegetationBatchBuffer: GPUBuffer | null = null;
  shadowVegetationBatchCapacityBytes = 0;
  shadowVegetationBatchScratch = new Float32Array(0);
  beaconVertexBuffer!: GPUBuffer;
  beaconVertexCount = 0;
  chunks = new Map<string, RenderableChunk>();
  vegetation = new Map<string, VegetationPatch>();
  scenicVegetation: VegetationPatch | null = null;
  gameMarkers: GameMarkerBatch | null = null;
  debugMarkers: GameMarkerBatch | null = null;
  water: IndexedMesh | null = null;
  farTerrain: TerrainMesh | null = null;
  lastWaterCenter = { x: Infinity, z: Infinity };
  lastFarTerrainCenter = { x: Infinity, z: Infinity };
  lastFarTerrainCameraPosition = { x: Infinity, z: Infinity };
  lastFarTerrainCameraMoveSeconds = 0;
  lastTerrainReplayCameraPosition = { x: Infinity, y: Infinity, z: Infinity };
  lastTerrainReplayCameraMoveSeconds = 0;
  stats: RendererStats = {
    drawCalls: 0,
    terrainTriangles: 0,
    farTerrainTriangles: 0,
    terrainClusters: 0,
    culledTerrainClusters: 0,
    terrainClusterDrawCalls: 0,
    terrainClusterDrawsSkipped: 0,
    vegetationInstances: 0,
    vegetationLodCulledInstances: 0,
    vegetationDrawCalls: 0,
    visibleVegetationPatches: 0,
    culledVegetationPatches: 0,
    gameMarkers: 0,
    debugMarkers: 0,
    visibleTerrainChunks: 0,
    culledTerrainChunks: 0,
    depthPyramidMips: 0,
    hiZOcclusionTestedClusters: 0,
    hiZOcclusionCulledClusters: 0,
    hiZOcclusionTestedBatches: 0,
    hiZOcclusionCulledBatches: 0,
  };
  settings: RendererSettings = { ...DEFAULT_RENDERER_SETTINGS };
  capabilities: RuntimeCapabilities = {
    webgpu: false,
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    sharedArrayBufferAvailable: typeof SharedArrayBuffer !== 'undefined',
    workerBufferMode: 'transferable',
    maxTextureDimension2D: 0,
    maxBufferSizeMB: 0,
    maxStorageBufferBindingSizeMB: 0,
    timestampQuery: false,
    multiDrawIndirect: false,
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async init(): Promise<void> {
    if (!('gpu' in navigator)) {
      throw new Error('WebGPU is not available in this browser. Try current Chrome, Edge, Firefox Nightly, or Safari Technology Preview with WebGPU enabled.');
    }
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter found.');
    this.capabilities = detectCapabilities(adapter);
    const requiredFeatures: GPUFeatureName[] = [];
    if (this.capabilities.multiDrawIndirect) requiredFeatures.push(MULTI_DRAW_INDIRECT_FEATURE);
    this.device = await adapter.requestDevice(requiredFeatures.length > 0 ? { requiredFeatures } : undefined);
    this.capabilities.multiDrawIndirect = this.device.features.has(MULTI_DRAW_INDIRECT_FEATURE);
    this.uploadRing = new GpuUploadRing(this.device);
    this.hiZOcclusionCounterBuffer = this.device.createBuffer({
      label: 'hi-z occlusion counters',
      size: HIZ_OCCLUSION_COUNTER_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    this.hiZOcclusionReadbackBuffer = this.device.createBuffer({
      label: 'hi-z occlusion counter readback',
      size: HIZ_OCCLUSION_COUNTER_BYTES,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    void this.device.lost.then(info => {
      this.capabilities.deviceLostReason = `${info.reason}${info.message ? `: ${info.message}` : ''}`;
      console.error(`WebGPU device lost: ${this.capabilities.deviceLostReason}`);
    });
    this.device.onuncapturederror = (event) => {
      const message = event.error?.message ?? String(event.error);
      console.error('[WebGPU error]', message);
    };
    const context = this.canvas.getContext('webgpu');
    if (!context) throw new Error('Failed to create WebGPU canvas context.');
    this.context = context;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });

    this.uniformBuffer = this.device.createBuffer({
      label: 'scene uniforms',
      size: 16 * 4 + 4 * 4 * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    });
    this.uniformBindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
    const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

    // Shadow map resources (Phase 8). The shadow uniform holds the light
    // view-projection plus packed params (x=enabled, y=texelSize, z=bias).
    this.shadowUniformBuffer = this.device.createBuffer({
      label: 'shadow uniforms',
      size: 16 * 4 + 4 * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.shadowDepthTexture = this.device.createTexture({
      label: 'sun shadow depth',
      size: { width: SHADOW_MAP_SIZE, height: SHADOW_MAP_SIZE },
      format: DEPTH_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.shadowDepthView = this.shadowDepthTexture.createView();
    const shadowSampler = this.device.createSampler({
      label: 'shadow comparison sampler',
      compare: 'less',
      magFilter: 'linear',
      minFilter: 'linear',
    });
    this.shadowCasterBindGroupLayout = this.device.createBindGroupLayout({
      label: 'shadow caster bind group layout',
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
    });
    this.shadowSampleBindGroupLayout = this.device.createBindGroupLayout({
      label: 'shadow sample bind group layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
      ],
    });
    this.shadowCasterBindGroup = this.device.createBindGroup({
      layout: this.shadowCasterBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.shadowUniformBuffer } }],
    });
    this.shadowSampleBindGroup = this.device.createBindGroup({
      layout: this.shadowSampleBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.shadowUniformBuffer } },
        { binding: 1, resource: this.shadowDepthView },
        { binding: 2, resource: shadowSampler },
      ],
    });
    const terrainPipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout, this.shadowSampleBindGroupLayout],
    });
    const shadowCasterPipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.shadowCasterBindGroupLayout],
    });

    this.clusterCullBindGroupLayout = this.device.createBindGroupLayout({
      label: 'cluster cull bind group layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    this.terrainArenaCullBindGroupLayout = this.device.createBindGroupLayout({
      label: 'terrain arena cull bind group layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    this.clusterCullOcclusionBindGroupLayout = this.device.createBindGroupLayout({
      label: 'cluster cull occlusion bind group layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    this.depthPyramidFirstBindGroupLayout = this.device.createBindGroupLayout({
      label: 'depth pyramid first bind group layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'depth' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: DEPTH_PYRAMID_FORMAT } },
      ],
    });
    this.depthPyramidMipBindGroupLayout = this.device.createBindGroupLayout({
      label: 'depth pyramid mip bind group layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: DEPTH_PYRAMID_FORMAT } },
      ],
    });
    const clusterCullPipelineLayout = this.device.createPipelineLayout({
      label: 'cluster cull pipeline layout',
      bindGroupLayouts: [this.clusterCullBindGroupLayout, this.clusterCullOcclusionBindGroupLayout],
    });
    const terrainArenaCullPipelineLayout = this.device.createPipelineLayout({
      label: 'terrain arena cull pipeline layout',
      bindGroupLayouts: [this.terrainArenaCullBindGroupLayout, this.clusterCullOcclusionBindGroupLayout],
    });
    const depthPyramidFirstPipelineLayout = this.device.createPipelineLayout({
      label: 'depth pyramid first pipeline layout',
      bindGroupLayouts: [this.depthPyramidFirstBindGroupLayout],
    });
    const depthPyramidMipPipelineLayout = this.device.createPipelineLayout({
      label: 'depth pyramid mip pipeline layout',
      bindGroupLayouts: [this.depthPyramidMipBindGroupLayout],
    });

    const terrainModule = this.createShaderModuleChecked('terrain shader', TERRAIN_SHADER);
    const skyModule = this.createShaderModuleChecked('sky shader', SKY_SHADER);
    const clusterCullModule = this.createShaderModuleChecked('cluster cull shader', CLUSTER_CULL_SHADER);
    const terrainArenaCullModule = this.createShaderModuleChecked('terrain arena cull shader', TERRAIN_ARENA_CULL_SHADER);
    const depthPyramidFirstModule = this.createShaderModuleChecked('depth pyramid first shader', DEPTH_PYRAMID_FIRST_SHADER);
    const depthPyramidMipModule = this.createShaderModuleChecked('depth pyramid mip shader', DEPTH_PYRAMID_MIP_SHADER);
    const waterModule = this.createShaderModuleChecked('water shader', WATER_SHADER);
    const beaconModule = this.createShaderModuleChecked('beacon shader', BEACON_SHADER);
    const vegetationModule = this.createShaderModuleChecked('vegetation shader', VEGETATION_SHADER);

    const terrainVertexLayout: GPUVertexBufferLayout = {
      arrayStride: PACKED_TERRAIN_VERTEX_STRIDE,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'unorm16x4' },
        { shaderLocation: 1, offset: 8, format: 'unorm8x4' },
        { shaderLocation: 2, offset: 12, format: 'uint8x4' },
      ],
    };
    const terrainOriginLayout: GPUVertexBufferLayout = {
      arrayStride: 4 * 4,
      stepMode: 'instance',
      attributes: [
        { shaderLocation: 3, offset: 0, format: 'float32x4' },
      ],
    };
    const terrainArenaOriginLayout: GPUVertexBufferLayout = {
      arrayStride: TERRAIN_ARENA_ORIGIN_STRIDE,
      attributes: [
        { shaderLocation: 3, offset: 0, format: 'float32x4' },
      ],
    };
    const floatTerrainVertexLayout: GPUVertexBufferLayout = {
      arrayStride: FLOAT_TERRAIN_VERTEX_FLOATS * 4,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' },
        { shaderLocation: 2, offset: 6 * 4, format: 'float32' },
        { shaderLocation: 3, offset: 7 * 4, format: 'float32' },
      ],
    };

    this.skyPipeline = this.device.createRenderPipeline({
      label: 'sky pipeline',
      layout: pipelineLayout,
      vertex: { module: skyModule, entryPoint: 'vs_main' },
      fragment: { module: skyModule, entryPoint: 'fs_main', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'always' },
    });

    this.terrainPipeline = this.device.createRenderPipeline({
      label: 'terrain pipeline',
      layout: terrainPipelineLayout,
      vertex: { module: terrainModule, entryPoint: 'vs_main', buffers: [terrainVertexLayout, terrainOriginLayout] },
      fragment: { module: terrainModule, entryPoint: 'fs_main', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
    });

    this.terrainArenaPipeline = this.device.createRenderPipeline({
      label: 'terrain arena pipeline',
      layout: terrainPipelineLayout,
      vertex: { module: terrainModule, entryPoint: 'vs_main', buffers: [terrainVertexLayout, terrainArenaOriginLayout] },
      fragment: { module: terrainModule, entryPoint: 'fs_main', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
    });

    const shadowCasterModule = this.createShaderModuleChecked('shadow caster shader', SHADOW_CASTER_SHADER);
    this.shadowCasterPipeline = this.device.createRenderPipeline({
      label: 'shadow caster pipeline',
      layout: shadowCasterPipelineLayout,
      vertex: { module: shadowCasterModule, entryPoint: 'vs_main', buffers: [terrainVertexLayout, terrainArenaOriginLayout] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: DEPTH_FORMAT,
        depthWriteEnabled: true,
        depthCompare: 'less',
        depthBias: 2,
        depthBiasSlopeScale: 3,
        depthBiasClamp: 0,
      },
    });

    const shadowVegetationCasterModule = this.createShaderModuleChecked('shadow vegetation caster shader', SHADOW_VEGETATION_CASTER_SHADER);
    this.shadowVegetationCasterPipeline = this.device.createRenderPipeline({
      label: 'shadow vegetation caster pipeline',
      layout: shadowCasterPipelineLayout,
      vertex: {
        module: shadowVegetationCasterModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 7 * 4,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' },
              { shaderLocation: 2, offset: 6 * 4, format: 'float32' },
            ],
          },
          {
            arrayStride: 8 * 4,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 3, offset: 0, format: 'float32x3' },
              { shaderLocation: 4, offset: 3 * 4, format: 'float32' },
              { shaderLocation: 5, offset: 4 * 4, format: 'float32' },
              { shaderLocation: 6, offset: 5 * 4, format: 'float32' },
              { shaderLocation: 7, offset: 6 * 4, format: 'float32' },
              { shaderLocation: 8, offset: 7 * 4, format: 'float32' },
            ],
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: DEPTH_FORMAT,
        depthWriteEnabled: true,
        depthCompare: 'less',
        depthBias: 2,
        depthBiasSlopeScale: 3,
        depthBiasClamp: 0,
      },
    });

    this.clusterCullPipeline = this.device.createComputePipeline({
      label: 'cluster cull pipeline',
      layout: clusterCullPipelineLayout,
      compute: { module: clusterCullModule, entryPoint: 'cs_main' },
    });
    this.terrainArenaCullPipeline = this.device.createComputePipeline({
      label: 'terrain arena cull pipeline',
      layout: terrainArenaCullPipelineLayout,
      compute: { module: terrainArenaCullModule, entryPoint: 'cs_main' },
    });
    this.depthPyramidFirstPipeline = this.device.createComputePipeline({
      label: 'depth pyramid first pipeline',
      layout: depthPyramidFirstPipelineLayout,
      compute: { module: depthPyramidFirstModule, entryPoint: 'cs_main' },
    });
    this.depthPyramidMipPipeline = this.device.createComputePipeline({
      label: 'depth pyramid mip pipeline',
      layout: depthPyramidMipPipelineLayout,
      compute: { module: depthPyramidMipModule, entryPoint: 'cs_main' },
    });

    this.waterPipeline = this.device.createRenderPipeline({
      label: 'water pipeline',
      layout: pipelineLayout,
      vertex: { module: waterModule, entryPoint: 'vs_main', buffers: [floatTerrainVertexLayout] },
      fragment: {
        module: waterModule,
        entryPoint: 'fs_main',
        targets: [{
          format: this.format,
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
    });

    const beaconMesh = makeBeaconMesh();
    this.beaconVertexCount = beaconMesh.length / 4;
    this.beaconVertexBuffer = this.createBufferWithData(beaconMesh, GPUBufferUsage.VERTEX, 'beacon mesh');
    this.beaconPipeline = this.device.createRenderPipeline({
      label: 'beacon pipeline',
      layout: pipelineLayout,
      vertex: {
        module: beaconModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 4 * 4,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 3 * 4, format: 'float32' },
            ],
          },
          {
            arrayStride: 4 * 4,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 2, offset: 0, format: 'float32x3' },
              { shaderLocation: 3, offset: 3 * 4, format: 'float32' },
            ],
          },
        ],
      },
      fragment: {
        module: beaconModule,
        entryPoint: 'fs_main',
        targets: [{
          format: this.format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'less' },
    });

    const treeMesh = makeTreeMesh();
    this.treeVertexCount = treeMesh.length / 7;
    this.treeVertexBuffer = this.createBufferWithData(treeMesh, GPUBufferUsage.VERTEX, 'tree mesh');
    this.vegetationPipeline = this.device.createRenderPipeline({
      label: 'vegetation pipeline',
      layout: pipelineLayout,
      vertex: {
        module: vegetationModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 7 * 4,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' },
              { shaderLocation: 2, offset: 6 * 4, format: 'float32' },
            ],
          },
          {
            arrayStride: 8 * 4,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 3, offset: 0, format: 'float32x3' },
              { shaderLocation: 4, offset: 3 * 4, format: 'float32' },
              { shaderLocation: 5, offset: 4 * 4, format: 'float32' },
              { shaderLocation: 6, offset: 5 * 4, format: 'float32' },
              { shaderLocation: 7, offset: 6 * 4, format: 'float32' },
              { shaderLocation: 8, offset: 7 * 4, format: 'float32' },
            ],
          },
        ],
      },
      fragment: { module: vegetationModule, entryPoint: 'fs_main', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
    });

    this.terrainArena = new TerrainGpuArena(this.device, this.terrainArenaCullBindGroupLayout);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  updateSettings(nextSettings: Partial<RendererSettings> = {}): void {
    const previousNearTerrainEnabled = this.settings.nearTerrainEnabled;
    this.settings = {
      ...this.settings,
      ...nextSettings,
      fogDensity: clamp(Number(nextSettings.fogDensity ?? this.settings.fogDensity), 0, 3),
      materialDetail: clamp(Number(nextSettings.materialDetail ?? this.settings.materialDetail), 0, 2),
      exposure: clamp(Number(nextSettings.exposure ?? this.settings.exposure), 0.4, 2.4),
      atmosphereStrength: clamp(Number(nextSettings.atmosphereStrength ?? this.settings.atmosphereStrength), 0, 2.5),
      skyEnabled: nextSettings.skyEnabled ?? this.settings.skyEnabled,
      cinematicLighting: nextSettings.cinematicLighting ?? this.settings.cinematicLighting,
      shadowsEnabled: nextSettings.shadowsEnabled ?? this.settings.shadowsEnabled,
      debugView: clamp(Number(nextSettings.debugView ?? this.settings.debugView), 0, DEBUG_VIEW_SNOW_MASK),
      waterOpacity: clamp(Number(nextSettings.waterOpacity ?? this.settings.waterOpacity), 0, 1),
      animationSpeed: clamp(Number(nextSettings.animationSpeed ?? this.settings.animationSpeed), 0, 4),
    };
    if (
      nextSettings.nearTerrainEnabled !== undefined
      && nextSettings.nearTerrainEnabled !== previousNearTerrainEnabled
    ) {
      this.destroyBuffer(this.farTerrain?.vertexBuffer);
      this.destroyBuffer(this.farTerrain?.indexBuffer);
      this.destroyBuffer(this.farTerrain?.originBuffer);
      this.farTerrain = null;
    }
  }

  private createBufferWithData(
    data: Float32Array | Uint32Array | Uint16Array | Uint8Array,
    usage: GPUBufferUsageFlags,
    label: string,
  ): GPUBuffer {
    return this.uploadRing.createBuffer(data, usage, label);
  }

  private destroyBuffer(buffer: GPUBuffer | null | undefined): void {
    if (!buffer) return;
    this.uploadRing.destroyBuffer(buffer);
  }

  private createShaderModuleChecked(label: string, code: string): GPUShaderModule {
    const module = this.device.createShaderModule({ label, code });
    void module.getCompilationInfo().then(info => {
      for (const m of info.messages) {
        const location = `${m.lineNum}:${m.linePos}`;
        const prefix = `[WebGPU shader ${m.type} in "${label}" at ${location}]`;
        if (m.type === 'error') console.error(prefix, m.message);
        else if (m.type === 'warning') console.warn(prefix, m.message);
        else console.info(prefix, m.message);
      }
    }).catch(error => {
      console.warn(`[WebGPU compilation info "${label}" failed]`, error);
    });
    return module;
  }

  private createDepthPyramid(width: number, height: number): DepthPyramidResources {
    if (!this.depthTexture) throw new Error('Depth texture is not initialized.');
    const mipLevels = Math.max(1, Math.floor(Math.log2(Math.max(width, height))) + 1);
    const texture = this.device.createTexture({
      label: 'hi-z depth pyramid',
      size: { width, height, depthOrArrayLayers: 1 },
      mipLevelCount: mipLevels,
      format: DEPTH_PYRAMID_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });
    const mipViews = Array.from({ length: mipLevels }, (_, mip) => texture.createView({
      label: `hi-z mip ${mip}`,
      baseMipLevel: mip,
      mipLevelCount: 1,
    }));
    const firstBindGroup = this.device.createBindGroup({
      label: 'hi-z first bind group',
      layout: this.depthPyramidFirstBindGroupLayout,
      entries: [
        { binding: 0, resource: this.depthTexture.createView() },
        { binding: 1, resource: mipViews[0] },
      ],
    });
    const mipBindGroups: GPUBindGroup[] = [];
    for (let mip = 1; mip < mipLevels; mip++) {
      mipBindGroups.push(this.device.createBindGroup({
        label: `hi-z mip ${mip} bind group`,
        layout: this.depthPyramidMipBindGroupLayout,
        entries: [
          { binding: 0, resource: mipViews[mip - 1] },
          { binding: 1, resource: mipViews[mip] },
        ],
      }));
    }
    const clusterCullBindGroup = this.device.createBindGroup({
      label: 'hi-z cluster cull bind group',
      layout: this.clusterCullOcclusionBindGroupLayout,
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: { buffer: this.hiZOcclusionCounterBuffer } },
      ],
    });
    let bytes = 0;
    for (let mip = 0; mip < mipLevels; mip++) {
      bytes += Math.max(1, width >> mip) * Math.max(1, height >> mip) * Float32Array.BYTES_PER_ELEMENT;
    }
    return { texture, firstBindGroup, mipBindGroups, clusterCullBindGroup, mipLevels, bytes };
  }

  resize(): void {
    if (!this.device) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width === width && this.canvas.height === height && this.depthTexture && this.depthPyramid) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.depthTexture?.destroy();
    this.depthPyramid?.texture.destroy();
    this.depthPyramidReady = false;
    this.depthPyramidViewProj = null;
    this.depthTexture = this.device.createTexture({
      label: 'depth texture',
      size: [width, height],
      format: DEPTH_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.depthPyramid = this.createDepthPyramid(width, height);
  }

  createChunkMesh(
    key: string,
    vertices: Uint8Array,
    indices: Uint32Array,
    frame: TerrainPackFrame,
    bounds: SphereBounds,
    stats: ChunkMeshStats = {},
  ): void {
    this.removeChunk(key);
    if (!vertices || !indices || indices.length === 0) return;
    const lodSeamMask = Math.max(0, Math.trunc(stats.lodSeamMask ?? 0)) & LOD_SEAM_MASK_ALL;
    const nextStats: ChunkMeshStats = {
      ...stats,
      lodSeamMask,
    };
    const clusterBounds = buildTerrainClusterBounds(vertices, indices, frame);
    const clusterCount = clusterBounds.length / 4;
    const chunk = this.terrainArena.uploadChunk(
      key,
      vertices,
      indices,
      frame,
      clusterBounds,
      bounds,
      nextStats,
      lodSeamMask,
    );
    chunk.clusterCount = clusterCount;
    this.chunks.set(key, chunk);
  }

  getChunkLodSeamMask(key: string): number {
    return this.chunks.get(key)?.lodSeamMask ?? 0;
  }

  removeChunk(key: string): void {
    const chunk = this.chunks.get(key);
    if (chunk) {
      this.terrainArena.removeChunk(key);
      this.chunks.delete(key);
    }
    this.removeVegetationPatch(key);
  }

  createVegetationPatch(key: string, instances: Float32Array): void {
    this.removeVegetationPatch(key);
    if (!instances || instances.length === 0) return;
    const usableFloats = Math.floor(instances.length / VEGETATION_INSTANCE_FLOATS) * VEGETATION_INSTANCE_FLOATS;
    if (usableFloats <= 0) return;
    const retainedInstances = new Float32Array(instances.subarray(0, usableFloats));
    if (!this.settings.nearTerrainEnabled) {
      for (let i = 0; i + 7 < retainedInstances.length; i += VEGETATION_INSTANCE_FLOATS) {
        retainedInstances[i + 1] = scenicFarTerrainHeight(retainedInstances[i + 0], retainedInstances[i + 2]) - 0.18;
      }
    }
    const instanceCount = Math.floor(retainedInstances.length / VEGETATION_INSTANCE_FLOATS);
    const bounds = vegetationPatchBounds(retainedInstances);
    this.vegetation.set(key, {
      instances: retainedInstances,
      instanceCount,
      instanceBytes: retainedInstances.byteLength,
      bounds,
    });
  }

  private updateScenicVegetation(cameraPosition: Vec3): void {
    const instances = buildScenicVegetationInstances(cameraPosition, this.settings.nearTerrainEnabled);
    if (instances.length <= 0) {
      this.scenicVegetation = null;
      return;
    }
    const instanceCount = Math.floor(instances.length / VEGETATION_INSTANCE_FLOATS);
    this.scenicVegetation = {
      instances,
      instanceCount,
      instanceBytes: instances.byteLength,
      bounds: vegetationPatchBounds(instances),
    };
  }

  removeVegetationPatch(key: string): void {
    this.vegetation.delete(key);
  }

  private ensureVegetationBatchCapacity(byteLength: number): GPUBuffer {
    const requiredBytes = roundUp4(Math.max(4, byteLength));
    if (this.vegetationBatchBuffer && this.vegetationBatchCapacityBytes >= requiredBytes) return this.vegetationBatchBuffer;
    this.destroyBuffer(this.vegetationBatchBuffer);
    this.vegetationBatchBuffer = this.device.createBuffer({
      label: 'visible vegetation batch',
      size: requiredBytes,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.vegetationBatchCapacityBytes = requiredBytes;
    return this.vegetationBatchBuffer;
  }

  private updateVegetationBatch(visiblePatches: VegetationPatch[], cameraPosition: Vec3): VegetationBatchResult {
    void cameraPosition;
    let totalInstances = 0;
    for (const patch of visiblePatches) totalInstances += patch.instanceCount;
    const floats = totalInstances * VEGETATION_INSTANCE_FLOATS;
    if (floats <= 0 || visiblePatches.length === 0) {
      this.vegetationBatchBytes = 0;
      return { buffer: null, instanceCount: 0, lodCulledInstances: 0 };
    }
    if (this.vegetationBatchScratch.length < floats) {
      this.vegetationBatchScratch = new Float32Array(floats);
    }
    let offset = 0;
    for (const patch of visiblePatches) {
      const usable = patch.instanceCount * VEGETATION_INSTANCE_FLOATS;
      this.vegetationBatchScratch.set(patch.instances.subarray(0, usable), offset);
      offset += usable;
    }
    const batch = this.vegetationBatchScratch.subarray(0, floats);
    const buffer = this.ensureVegetationBatchCapacity(batch.byteLength);
    this.device.queue.writeBuffer(buffer, 0, batch);
    this.vegetationBatchBytes = batch.byteLength;
    return { buffer, instanceCount: totalInstances, lodCulledInstances: 0 };
  }

  // True if the patch's bounding sphere may intersect the directional shadow
  // ortho box. Tested in light clip space (ortho => w = 1) with a per-axis
  // margin of radius / half-extent so a patch straddling the box edge is kept.
  // Used to gather shadow casters by the light frustum instead of the camera
  // frustum, so trees just off-screen still cast shadows into view.
  private patchInLightBox(bounds: SphereBounds): boolean {
    const lvp = this.lightViewProj;
    const x = bounds.center[0], y = bounds.center[1], z = bounds.center[2];
    const ndcX = lvp[0] * x + lvp[4] * y + lvp[8] * z + lvp[12];
    const ndcY = lvp[1] * x + lvp[5] * y + lvp[9] * z + lvp[13];
    const ndcZ = lvp[2] * x + lvp[6] * y + lvp[10] * z + lvp[14];
    const m = bounds.radius / SHADOW_ORTHO_HALF;
    return ndcX >= -1 - m && ndcX <= 1 + m
      && ndcY >= -1 - m && ndcY <= 1 + m
      && ndcZ >= -m && ndcZ <= 1 + m;
  }

  private ensureShadowVegetationBatchCapacity(byteLength: number): GPUBuffer {
    const requiredBytes = roundUp4(Math.max(4, byteLength));
    if (this.shadowVegetationBatchBuffer && this.shadowVegetationBatchCapacityBytes >= requiredBytes) return this.shadowVegetationBatchBuffer;
    this.destroyBuffer(this.shadowVegetationBatchBuffer);
    this.shadowVegetationBatchBuffer = this.device.createBuffer({
      label: 'shadow vegetation batch',
      size: requiredBytes,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.shadowVegetationBatchCapacityBytes = requiredBytes;
    return this.shadowVegetationBatchBuffer;
  }

  // Pack all near vegetation patches inside the light box into one instance
  // buffer for the shadow caster pass. Unlike updateVegetationBatch this is not
  // camera-frustum culled, so off-screen casters are included; the far scenic
  // forest layer is excluded (it lives outside this.vegetation).
  private updateShadowVegetationBatch(patches: VegetationPatch[]): { buffer: GPUBuffer | null; instanceCount: number } {
    let totalInstances = 0;
    for (const patch of patches) totalInstances += patch.instanceCount;
    const floats = totalInstances * VEGETATION_INSTANCE_FLOATS;
    if (floats <= 0) return { buffer: null, instanceCount: 0 };
    if (this.shadowVegetationBatchScratch.length < floats) {
      this.shadowVegetationBatchScratch = new Float32Array(floats);
    }
    let offset = 0;
    for (const patch of patches) {
      const usable = patch.instanceCount * VEGETATION_INSTANCE_FLOATS;
      this.shadowVegetationBatchScratch.set(patch.instances.subarray(0, usable), offset);
      offset += usable;
    }
    const batch = this.shadowVegetationBatchScratch.subarray(0, floats);
    const buffer = this.ensureShadowVegetationBatchCapacity(batch.byteLength);
    this.device.queue.writeBuffer(buffer, 0, batch);
    return { buffer, instanceCount: totalInstances };
  }

  setGameMarkers(instances: Float32Array): void {
    this.destroyBuffer(this.gameMarkers?.instanceBuffer);
    this.gameMarkers = null;
    if (!instances || instances.length === 0) return;
    const instanceBuffer = this.createBufferWithData(instances, GPUBufferUsage.VERTEX, 'game beacons');
    this.gameMarkers = {
      instanceBuffer,
      instanceCount: instances.length / 4,
      instanceBytes: instances.byteLength,
    };
  }

  setDebugMarkers(instances: Float32Array): void {
    this.destroyBuffer(this.debugMarkers?.instanceBuffer);
    this.debugMarkers = null;
    if (!instances || instances.length === 0) return;
    const instanceBuffer = this.createBufferWithData(instances, GPUBufferUsage.VERTEX, 'debug edit regions');
    this.debugMarkers = {
      instanceBuffer,
      instanceCount: instances.length / 4,
      instanceBytes: instances.byteLength,
    };
  }

  updateWater(cameraPosition: Vec3, force = false): void {
    const dx = cameraPosition[0] - this.lastWaterCenter.x;
    const dz = cameraPosition[2] - this.lastWaterCenter.z;
    if (!force && Math.hypot(dx, dz) < WATER_RECENTER_DISTANCE && this.water) return;
    this.lastWaterCenter = { x: cameraPosition[0], z: cameraPosition[2] };
    this.destroyBuffer(this.water?.vertexBuffer);
    this.destroyBuffer(this.water?.indexBuffer);

    const segments = WATER_SEGMENTS;
    const length = 7600;
    const vertices: number[] = [];
    const indices: number[] = [];
    const riverColumns = [-1.35, -1.0, -0.68, -0.34, 0, 0.34, 0.68, 1.0, 1.35] as const;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const z = cameraPosition[2] + (t - 0.5) * length;
      const scenicBlend = this.settings.nearTerrainEnabled
        ? mix(0.58, 1.0, smoothStep(260, 840, Math.abs(z - cameraPosition[2])))
        : 1.0;
      const center = mix(riverCenter(z), scenicRiverCenter(z), scenicBlend);
      const channelPulse = valueNoise2(z * 0.010 + 17.0, 55.0);
      const foregroundWiden = 1.0 - smoothStep(360, 1350, Math.abs(z - cameraPosition[2]));
      const width = 12.5
        + channelPulse * 7.0
        + foregroundWiden * 8.0
        + smoothStep(900, 2400, Math.abs(z - cameraPosition[2])) * 5.8
        + (this.settings.nearTerrainEnabled ? mix(5.0, 0.0, scenicBlend) : 0.0);
      const sdfCenterY = SCENIC_WATER_LEVEL + 0.16;
      const scenicCenterY = scenicFarTerrainHeight(center, z) + 0.10;
      for (const side of riverColumns) {
        const x = center + side * width;
        const edge = Math.abs(side);
        const terrainWaterY = terrainHeight(x, z) + 0.26;
        const sdfY = Math.min(
          Math.max(sdfCenterY - edge * 0.12, terrainWaterY),
          SCENIC_WATER_LEVEL + 1.35 - edge * 0.05,
        );
        const scenicY = scenicCenterY - edge * 0.18;
        const y = this.settings.nearTerrainEnabled ? mix(sdfY, scenicY + 0.18, scenicBlend) : scenicY;
        vertices.push(x, y, z, 0, 1, 0, 5, edge);
      }
    }
    for (let i = 0; i < segments; i++) {
      const a = i * riverColumns.length;
      const b = (i + 1) * riverColumns.length;
      for (let c = 0; c < riverColumns.length - 1; c++) {
        indices.push(a + c, a + c + 1, b + c, a + c + 1, b + c + 1, b + c);
      }
    }

    const addLake = (centerX: number, centerZ: number, radiusX: number, radiusZ: number, force = false): void => {
      const rotation = (valueNoise2(centerX * 0.007, centerZ * 0.007) - 0.5) * 0.9;
      const c = Math.cos(rotation);
      const s = Math.sin(rotation);
      const scenicGroundY = scenicFarTerrainHeight(centerX, centerZ);
      const physicalGroundY = terrainHeight(centerX, centerZ);
      const groundY = this.settings.nearTerrainEnabled ? Math.min(physicalGroundY, scenicGroundY) : scenicGroundY;
      let maxLakeGroundY = groundY;
      for (let side = 0; side < WATER_LAKE_EDGE_SAMPLES; side++) {
        const angle = side / WATER_LAKE_EDGE_SAMPLES * Math.PI * 2;
        const px = Math.cos(angle) * radiusX;
        const pz = Math.sin(angle) * radiusZ;
        const x = centerX + px * c - pz * s;
        const z = centerZ + px * s + pz * c;
        const edgeGroundY = this.settings.nearTerrainEnabled
          ? Math.min(terrainHeight(x, z), scenicFarTerrainHeight(x, z))
          : scenicFarTerrainHeight(x, z);
        maxLakeGroundY = Math.max(maxLakeGroundY, edgeGroundY);
      }
      const baseWaterY = this.settings.nearTerrainEnabled
        ? Math.max(SCENIC_WATER_LEVEL + 0.14, Math.min(scenicGroundY + 0.16, groundY + 0.34))
        : scenicGroundY + 0.14;
      const edgeRelief = maxLakeGroundY - groundY;
      const waterY = baseWaterY + Math.min(Math.max(edgeRelief, 0), force ? 0.8 : 1.2) * 0.035;
      if (!force && scenicGroundY > SCENIC_WATER_LEVEL + 28.0) return;
      const rings = WATER_LAKE_RINGS;
      const sides = WATER_LAKE_SIDES;
      const ringStarts: number[] = [];
      const centerIndex = vertices.length / FLOAT_TERRAIN_VERTEX_FLOATS;
      vertices.push(centerX, waterY, centerZ, 0, 1, 0, 5, 0);
      for (let ring = 1; ring <= rings; ring++) {
        const radiusT = ring / rings;
        ringStarts[ring] = vertices.length / FLOAT_TERRAIN_VERTEX_FLOATS;
        for (let side = 0; side < sides; side++) {
          const angle = side / sides * Math.PI * 2;
          const wobble = 1 + (valueNoise2(centerX * 0.025 + Math.cos(angle) * 3.0, centerZ * 0.025 + Math.sin(angle) * 3.0) - 0.5) * 0.18;
          const px = Math.cos(angle) * radiusX * radiusT * wobble;
          const pz = Math.sin(angle) * radiusZ * radiusT * wobble;
          const x = centerX + px * c - pz * s;
          const z = centerZ + px * s + pz * c;
          const edge = smoothStep(0.56, 1.0, radiusT);
          const y = waterY - edge * 0.045;
          vertices.push(x, y, z, 0, 1, 0, 5, edge);
        }
      }
      const firstRing = ringStarts[1];
      for (let side = 0; side < sides; side++) {
        const next = (side + 1) % sides;
        indices.push(centerIndex, firstRing + next, firstRing + side);
      }
      for (let ring = 1; ring < rings; ring++) {
        const inner = ringStarts[ring];
        const outer = ringStarts[ring + 1];
        for (let side = 0; side < sides; side++) {
          const next = (side + 1) % sides;
          indices.push(inner + side, inner + next, outer + side, inner + next, outer + next, outer + side);
        }
      }
    };

    const viewSign = cameraPosition[2] >= 240 ? -1 : 1;
    const leftForegroundPondZ = cameraPosition[2] + viewSign * 360;
    addLake(scenicRiverCenter(leftForegroundPondZ) - 330, leftForegroundPondZ, 82, 50, true);
    const foregroundLakeZ = cameraPosition[2] + viewSign * 430;
    addLake(scenicRiverCenter(foregroundLakeZ) + 76, foregroundLakeZ, 118, 70, true);
    const sidePondZ = cameraPosition[2] + viewSign * 1080;
    addLake(scenicRiverCenter(sidePondZ) - 218, sidePondZ, 92, 54, true);
    const farLakeZ = cameraPosition[2] + viewSign * 1660;
    addLake(scenicRiverCenter(farLakeZ) + 132, farLakeZ, 140, 80);

    if (!this.settings.nearTerrainEnabled || this.settings.farTerrainEnabled) {
      const addLowlandLake = (z: number, lateral: number, radiusX: number, radiusZ: number): void => {
        const x = scenicRiverCenter(z) + lateral;
        const h = terrainHeight(x, z);
        if (h > 20.5) return;
        addLake(x, z, radiusX, radiusZ);
      };

      const lakeAnchorZ = Math.round(cameraPosition[2] / 520) * 520;
      for (let i = -5; i <= 5; i++) {
        const z = lakeAnchorZ + i * 520 + (valueNoise2(i * 13.7, lakeAnchorZ * 0.003) - 0.5) * 180;
        const roll = valueNoise2(z * 0.011 + 19.0, i * 3.1);
        if (roll < 0.62) continue;
        const lateral = (valueNoise2(z * 0.016 - 9.0, i * 7.3) - 0.5) * 78;
        addLowlandLake(z, lateral, 16 + roll * 24, 11 + valueNoise2(z * 0.009, 29.0) * 18);
      }
    }

    const vertexArray = new Float32Array(vertices);
    const indexArray = new Uint32Array(indices);
    this.water = {
      vertexBuffer: this.createBufferWithData(vertexArray, GPUBufferUsage.VERTEX, 'river vertices'),
      indexBuffer: this.createBufferWithData(indexArray, GPUBufferUsage.INDEX, 'river indices'),
      indexCount: indexArray.length,
      vertexBytes: vertexArray.byteLength,
      indexBytes: indexArray.byteLength,
    };
  }

  updateFarTerrain(cameraPosition: Vec3, timeSeconds: number, force = false): void {
    const snappedX = Math.round(cameraPosition[0] / FAR_TERRAIN_SNAP) * FAR_TERRAIN_SNAP;
    const snappedZ = Math.round(cameraPosition[2] / FAR_TERRAIN_SNAP) * FAR_TERRAIN_SNAP;
    if (!force && this.farTerrain && snappedX === this.lastFarTerrainCenter.x && snappedZ === this.lastFarTerrainCenter.z) return;

    const previousCameraX = this.lastFarTerrainCameraPosition.x;
    const previousCameraZ = this.lastFarTerrainCameraPosition.z;
    if (
      Number.isFinite(previousCameraX)
      && Number.isFinite(previousCameraZ)
      && Math.hypot(cameraPosition[0] - previousCameraX, cameraPosition[2] - previousCameraZ) > FAR_TERRAIN_CAMERA_MOVE_EPSILON
    ) {
      this.lastFarTerrainCameraMoveSeconds = timeSeconds;
    }
    this.lastFarTerrainCameraPosition = { x: cameraPosition[0], z: cameraPosition[2] };

    const staleDistance = Math.hypot(snappedX - this.lastFarTerrainCenter.x, snappedZ - this.lastFarTerrainCenter.z);
    if (!force && this.farTerrain && staleDistance < FAR_TERRAIN_RECENTER_DISTANCE) return;
    const movingRecently = timeSeconds - this.lastFarTerrainCameraMoveSeconds < FAR_TERRAIN_REBUILD_IDLE_SECONDS;
    if (!force && this.farTerrain && movingRecently) return;

    this.lastFarTerrainCenter = { x: snappedX, z: snappedZ };
    this.destroyBuffer(this.farTerrain?.vertexBuffer);
    this.destroyBuffer(this.farTerrain?.indexBuffer);
    this.destroyBuffer(this.farTerrain?.originBuffer);

    const vertices: number[] = [];
    const indices: number[] = [];

    for (const ring of FAR_TERRAIN_RINGS) {
      const innerRadius = ring === FAR_TERRAIN_RINGS[0] ? 0 : ring.inner;
      const firstVertex = vertices.length / FLOAT_TERRAIN_VERTEX_FLOATS;
      const cells = Math.round((ring.outer * 2) / ring.step);
      const vertsPerSide = cells + 1;
      for (let iz = 0; iz <= cells; iz++) {
        const localZ = -ring.outer + iz * ring.step;
        const z = snappedZ + localZ;
        for (let ix = 0; ix <= cells; ix++) {
          const localX = -ring.outer + ix * ring.step;
          const x = snappedX + localX;
          const physicalY = terrainHeight(x, z) - 0.65;
          const scenicY = scenicFarTerrainHeight(x, z) - 0.65;
          const nearTerrainBlend = this.settings.nearTerrainEnabled
            ? smoothStep(220, 520, Math.hypot(localX, localZ))
            : 1.0;
          const y = physicalY * (1.0 - nearTerrainBlend) + scenicY * nearTerrainBlend;
          const n = scenicFarTerrainNormal(x, z, ring.step * 0.35);
          const mat = scenicTerrainMaterial(x, y, z, n[1], physicalY);
          const ao = scenicFarTerrainAo(x, y, z, n[1], ring.step);
          vertices.push(x, y, z, n[0], n[1], n[2], mat, ao);
        }
      }

      for (let iz = 0; iz < cells; iz++) {
        const localZ = -ring.outer + (iz + 0.5) * ring.step;
        for (let ix = 0; ix < cells; ix++) {
          const localX = -ring.outer + (ix + 0.5) * ring.step;
          const chebyshevDistance = Math.max(Math.abs(localX), Math.abs(localZ));
          if (chebyshevDistance <= innerRadius || chebyshevDistance > ring.outer) continue;
          const a = firstVertex + iz * vertsPerSide + ix;
          const b = a + 1;
          const c = a + vertsPerSide;
          const d = c + 1;
          indices.push(a, b, c, b, d, c);
        }
      }
    }

    const vertexArray = new Float32Array(vertices);
    const indexArray = new Uint32Array(indices);
    const frame = packFrameFromFloatTerrainVertices(vertexArray);
    const packedVertices = packFloatTerrainVertices(vertexArray, frame, (x, y, z, _nx, ny) => {
      const h = terrainHeight(x, z);
      const physicalY = h - 0.65;
      const scenicSnow = smoothStep(
        166 + valueNoise2(x * 0.004 + 21.0, z * 0.004 - 17.0) * 46,
        292,
        y,
      ) * smoothStep(0.24, 0.78, ny);
      const legacySnow = snowMask(x, physicalY, z, ny, h) * 0.30;
      return {
        biome: clamp(biomeMask(x, z, h, ny) + smoothStep(72, 160, y) * 0.22, 0, 1),
        wetness: wetnessMask(x, physicalY, z, ny, h),
        snow: Math.max(legacySnow, scenicSnow),
      };
    });
    this.farTerrain = {
      vertexBuffer: this.createBufferWithData(packedVertices, GPUBufferUsage.VERTEX, 'far terrain vertices'),
      indexBuffer: this.createBufferWithData(indexArray, GPUBufferUsage.INDEX, 'far terrain indices'),
      originBuffer: createTerrainOriginBuffer(this.device, frame, 'far terrain origin'),
      indexCount: indexArray.length,
      vertexBytes: packedVertices.byteLength,
      indexBytes: indexArray.byteLength,
      originBytes: 4 * 4,
    };
    this.updateScenicVegetation(cameraPosition);
  }

  memoryStats(): RendererMemoryStats {
    let terrainClusterCount = 0;
    let terrainLod0Chunks = 0;
    let terrainLod1Chunks = 0;
    let terrainLod2PlusChunks = 0;
    let terrainLodTransitionEdges = 0;
    let terrainLodTransitionMeshChunks = 0;
    let terrainLodTransitionMeshTriangles = 0;
    for (const chunk of this.chunks.values()) {
      terrainClusterCount += chunk.clusterCount;
      if (chunk.stats?.lodTransitionMesh) {
        terrainLodTransitionMeshChunks++;
        terrainLodTransitionMeshTriangles += chunk.indexCount / 3;
      } else {
        const lod = Math.max(0, Math.trunc(chunk.stats?.lod ?? 0));
        if (lod <= 0) terrainLod0Chunks++;
        else if (lod === 1) terrainLod1Chunks++;
        else terrainLod2PlusChunks++;
        terrainLodTransitionEdges += countLodTransitionEdges(chunk.lodSeamMask);
      }
    }
    const chunkMeshBytes = this.terrainArena?.gpuBytes() ?? 0;
    const vegetationBytes = this.vegetationBatchCapacityBytes;
    const farTerrainBytes = this.farTerrain ? (this.farTerrain.vertexBytes ?? 0) + (this.farTerrain.indexBytes ?? 0) + (this.farTerrain.originBytes ?? 0) : 0;
    const waterBytes = this.water ? (this.water.vertexBytes ?? 0) + (this.water.indexBytes ?? 0) : 0;
    const gameMarkerBytes = this.gameMarkers ? (this.gameMarkers.instanceBytes ?? 0) + (this.beaconVertexCount * 4 * 4) : 0;
    const debugMarkerBytes = this.debugMarkers ? (this.debugMarkers.instanceBytes ?? 0) + (this.beaconVertexCount * 4 * 4) : 0;
    const depthPyramidBytes = this.depthPyramid?.bytes ?? 0;
    const uploadRing = this.uploadRing.stats();
    return {
      chunkMeshMB: bytesToMB(chunkMeshBytes),
      vegetationMB: bytesToMB(vegetationBytes),
      farTerrainMB: bytesToMB(farTerrainBytes),
      waterMB: bytesToMB(waterBytes),
      depthPyramidMB: bytesToMB(depthPyramidBytes),
      depthPyramidMips: this.depthPyramid?.mipLevels ?? 0,
      uploadRingMB: bytesToMB(uploadRing.stagingBytes),
      uploadRingPages: uploadRing.pages,
      uploadRingPendingMB: bytesToMB(uploadRing.pendingBytes),
      uploadRingLastFlushMB: bytesToMB(uploadRing.lastFlushBytes),
      uploadRingFallbackUploads: uploadRing.fallbackUploads,
      uploadRingFallbackMB: bytesToMB(uploadRing.fallbackBytes),
      totalMB: bytesToMB(chunkMeshBytes + vegetationBytes + farTerrainBytes + waterBytes + gameMarkerBytes + debugMarkerBytes + depthPyramidBytes + uploadRing.stagingBytes),
      meshCount: this.chunks.size,
      terrainLod0Chunks,
      terrainLod1Chunks,
      terrainLod2PlusChunks,
      terrainLodTransitionEdges,
      terrainLodTransitionMeshChunks,
      terrainLodTransitionMeshTriangles,
      terrainClusterCount,
      vegetationPatchCount: this.vegetation.size + (this.scenicVegetation ? 1 : 0),
    };
  }

  writeUniforms(camera: FlyCamera, viewProj: Mat4, timeSeconds: number): void {
    const sunDirection = this.settings.sunDirection ?? DEFAULT_RENDERER_SETTINGS.sunDirection;
    const sun = new Float32Array([sunDirection[0], sunDirection[1], sunDirection[2], this.settings.debugView]);
    const params = new Float32Array([
      timeSeconds * this.settings.animationSpeed,
      this.settings.fogDensity,
      this.settings.materialDetail,
      this.settings.waterOpacity,
    ]);
    const visual = new Float32Array([
      this.settings.exposure,
      this.settings.atmosphereStrength,
      this.settings.skyEnabled ? 1 : 0,
      this.settings.cinematicLighting ? 1 : 0,
    ]);
    const data = new Float32Array(16 + 4 + 4 + 4 + 4);
    data.set(viewProj, 0);
    data.set([camera.position[0], camera.position[1], camera.position[2], 1], 16);
    data.set(sun, 20);
    data.set(params, 24);
    data.set(visual, 28);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }

  private writeShadowUniforms(camera: FlyCamera): void {
    const sd = this.settings.sunDirection ?? DEFAULT_RENDERER_SETTINGS.sunDirection;
    const len = Math.hypot(sd[0], sd[1], sd[2]) || 1;
    const lx = sd[0] / len, ly = sd[1] / len, lz = sd[2] / len;
    const fwd = camera.forward();
    const cx = camera.position[0] + fwd[0] * SHADOW_LOOKAHEAD;
    const cy = camera.position[1] + fwd[1] * SHADOW_LOOKAHEAD;
    const cz = camera.position[2] + fwd[2] * SHADOW_LOOKAHEAD;
    const center = new Float32Array([cx, cy, cz]);
    const eye = new Float32Array([cx + lx * SHADOW_ORTHO_DEPTH, cy + ly * SHADOW_ORTHO_DEPTH, cz + lz * SHADOW_ORTHO_DEPTH]);
    const up = Math.abs(ly) > 0.95 ? new Float32Array([0, 0, 1]) : new Float32Array([0, 1, 0]);
    const view = mat4LookAt(eye, center, up);
    const proj = mat4Ortho(-SHADOW_ORTHO_HALF, SHADOW_ORTHO_HALF, -SHADOW_ORTHO_HALF, SHADOW_ORTHO_HALF, 1, SHADOW_ORTHO_DEPTH * 2);
    const lvp = mat4Multiply(proj, view);
    // Texel-snap so the shadow texel grid stays fixed in world space while the
    // box translates with the camera. The sun direction is constant, so the box
    // never rotates and snapping translation alone removes edge shimmer. The
    // world origin projects to (lvp[12], lvp[13]) in NDC (ortho => w=1); round
    // it to the nearest texel and fold the sub-texel correction back into the
    // clip-space translation.
    const half = SHADOW_MAP_SIZE / 2;
    const texX = lvp[12] * half;
    const texY = lvp[13] * half;
    lvp[12] += (Math.round(texX) - texX) / half;
    lvp[13] += (Math.round(texY) - texY) / half;
    this.lightViewProj = lvp;
    const data = new Float32Array(16 + 4);
    data.set(this.lightViewProj, 0);
    data[16] = this.settings.shadowsEnabled ? 1 : 0;
    data[17] = 1 / SHADOW_MAP_SIZE;
    data[18] = 0.0016;
    data[19] = 0;
    this.device.queue.writeBuffer(this.shadowUniformBuffer, 0, data);
  }

  private encodeDepthPyramid(encoder: GPUCommandEncoder, viewProj: Mat4): void {
    if (!this.depthPyramid) return;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const firstPass = encoder.beginComputePass({ label: 'hi-z depth copy pass' });
    firstPass.setPipeline(this.depthPyramidFirstPipeline);
    firstPass.setBindGroup(0, this.depthPyramid.firstBindGroup);
    firstPass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
    firstPass.end();

    for (let mip = 1; mip < this.depthPyramid.mipLevels; mip++) {
      const mipWidth = Math.max(1, width >> mip);
      const mipHeight = Math.max(1, height >> mip);
      const pass = encoder.beginComputePass({ label: `hi-z mip ${mip} pass` });
      pass.setPipeline(this.depthPyramidMipPipeline);
      pass.setBindGroup(0, this.depthPyramid.mipBindGroups[mip - 1]);
      pass.dispatchWorkgroups(Math.ceil(mipWidth / 8), Math.ceil(mipHeight / 8));
      pass.end();
    }
    this.depthPyramidReady = true;
    this.depthPyramidViewProj = new Float32Array(viewProj);
  }

  private scheduleHiZOcclusionReadback(): void {
    if (this.hiZOcclusionReadbackPending) return;
    this.hiZOcclusionReadbackPending = true;
    this.hiZOcclusionReadbackBuffer.mapAsync(GPUMapMode.READ)
      .then(() => {
        const data = new Uint32Array(this.hiZOcclusionReadbackBuffer.getMappedRange());
        this.hiZOcclusion = { tested: data[0] ?? 0, culled: data[1] ?? 0 };
        this.hiZOcclusionReadbackBuffer.unmap();
        this.hiZOcclusionReadbackPending = false;
        this.hiZOcclusionReadbackReady = true;
      })
      .catch(() => {
        this.hiZOcclusionReadbackPending = false;
      });
  }

  private updateTerrainReplayMotion(camera: FlyCamera, timeSeconds: number): boolean {
    const previous = this.lastTerrainReplayCameraPosition;
    if (
      Number.isFinite(previous.x)
      && Number.isFinite(previous.y)
      && Number.isFinite(previous.z)
      && Math.hypot(
        camera.position[0] - previous.x,
        camera.position[1] - previous.y,
        camera.position[2] - previous.z,
      ) > TERRAIN_INDIRECT_REPLAY_CAMERA_MOVE_EPSILON
    ) {
      this.lastTerrainReplayCameraMoveSeconds = timeSeconds;
    }
    this.lastTerrainReplayCameraPosition = {
      x: camera.position[0],
      y: camera.position[1],
      z: camera.position[2],
    };
    return timeSeconds - this.lastTerrainReplayCameraMoveSeconds < TERRAIN_INDIRECT_REPLAY_MOVING_SECONDS;
  }

  private terrainIndirectReplaySlots(totalSlots: number, moving: boolean): number {
    const slots = Math.max(0, Math.trunc(totalSlots));
    if (slots <= 0) return 0;
    const maxSlots = moving ? TERRAIN_INDIRECT_REPLAY_MOVING_MAX_SLOTS : TERRAIN_INDIRECT_REPLAY_STABLE_MAX_SLOTS;
    if (!this.hiZOcclusionReadbackReady) {
      return Math.min(slots, maxSlots, TERRAIN_INDIRECT_REPLAY_STARTUP_SLOTS);
    }
    const visible = Math.max(0, Math.trunc(this.hiZOcclusion.tested));
    const target = Math.ceil(visible * TERRAIN_INDIRECT_REPLAY_VISIBLE_MULTIPLIER + TERRAIN_INDIRECT_REPLAY_HEADROOM_SLOTS);
    return Math.min(slots, maxSlots, Math.max(TERRAIN_INDIRECT_REPLAY_MIN_SLOTS, target));
  }

  render(camera: FlyCamera, viewProj: Mat4, timeSeconds: number): RendererStats {
    this.resize();
    this.writeUniforms(camera, viewProj, timeSeconds);
    this.writeShadowUniforms(camera);
    if (this.settings.farTerrainEnabled) this.updateFarTerrain(camera.position, timeSeconds);
    if (this.settings.waterEnabled) this.updateWater(camera.position);
    this.uploadRing.flush();

    let terrainTriangles = 0;
    let farTerrainTriangles = 0;
    let terrainClusters = 0;
    let culledTerrainClusters = 0;
    let terrainClusterDrawCalls = 0;
    let terrainClusterDrawsSkipped = 0;
    let vegetationInstances = 0;
    let vegetationLodCulledInstances = 0;
    let vegetationDrawCalls = 0;
    let visibleVegetationPatches = 0;
    let culledVegetationPatches = 0;
    let gameMarkers = 0;
    let debugMarkers = 0;
    let visibleTerrainChunks = 0;
    let culledTerrainChunks = 0;
    let drawCalls = 0;
    const frustumPlanes = createFrustumPlanes(viewProj);
    const hiZOcclusionEnabled = this.depthPyramidReady
      && this.depthPyramid !== null
      && matricesNear(viewProj, this.depthPyramidViewProj);
    const copyHiZCounters = !this.hiZOcclusionReadbackPending;

    const encoder = this.device.createCommandEncoder({ label: 'frame encoder' });
    encoder.clearBuffer(this.hiZOcclusionCounterBuffer, 0, HIZ_OCCLUSION_COUNTER_BYTES);
    const terrainArenaActive = this.settings.nearTerrainEnabled
      && this.terrainArena.ready
      && this.depthPyramid !== null
      && this.terrainArena.clusterHighWater > 0;
    const terrainArenaTotalSlots = terrainArenaActive ? this.terrainArena.drawSlotCount : 0;
    const terrainArenaReplaySlots = this.terrainIndirectReplaySlots(
      terrainArenaTotalSlots,
      this.updateTerrainReplayMotion(camera, timeSeconds),
    );
    if (terrainArenaActive) {
      this.terrainArena.updateCullParams(
        frustumPlanes,
        viewProj,
        terrainArenaReplaySlots,
        this.canvas.width,
        this.canvas.height,
        this.depthPyramid?.mipLevels ?? 1,
        hiZOcclusionEnabled,
      );
      if (terrainArenaReplaySlots > 0 && this.terrainArena.compactIndirectBuffer) {
        encoder.clearBuffer(this.terrainArena.compactIndirectBuffer, 0, roundUp4(terrainArenaReplaySlots * INDIRECT_INDEXED_ARGS_BYTES));
      }
      const computePass = encoder.beginComputePass({ label: 'terrain arena compact cull pass' });
      computePass.setPipeline(this.terrainArenaCullPipeline);
      computePass.setBindGroup(0, this.terrainArena.createBindGroup());
      if (this.depthPyramid) computePass.setBindGroup(1, this.depthPyramid.clusterCullBindGroup);
      computePass.dispatchWorkgroups(Math.ceil(this.terrainArena.clusterHighWater / 64));
      computePass.end();
    }
    if (copyHiZCounters) {
      encoder.copyBufferToBuffer(this.hiZOcclusionCounterBuffer, 0, this.hiZOcclusionReadbackBuffer, 0, HIZ_OCCLUSION_COUNTER_BYTES);
    }
    const visibleVegetation: VegetationPatch[] = [];
    let vegetationBatchBuffer: GPUBuffer | null = null;
    if (this.settings.vegetationEnabled) {
      for (const patch of this.vegetation.values()) {
        if (!sphereInFrustum(patch.bounds, frustumPlanes)) {
          culledVegetationPatches++;
          continue;
        }
        visibleVegetation.push(patch);
        visibleVegetationPatches++;
      }
      if (this.settings.farTerrainEnabled && this.scenicVegetation) {
        if (sphereInFrustum(this.scenicVegetation.bounds, frustumPlanes)) {
          visibleVegetation.push(this.scenicVegetation);
          visibleVegetationPatches++;
        } else {
          culledVegetationPatches++;
        }
      }
      const vegetationBatch = this.updateVegetationBatch(visibleVegetation, camera.position);
      vegetationBatchBuffer = vegetationBatch.buffer;
      vegetationInstances = vegetationBatch.instanceCount;
      vegetationLodCulledInstances = vegetationBatch.lodCulledInstances;
      if (vegetationBatchBuffer && vegetationInstances > 0) vegetationDrawCalls = 1;
    } else {
      this.vegetationBatchBytes = 0;
    }

    let shadowVegetationBuffer: GPUBuffer | null = null;
    let shadowVegetationInstances = 0;
    if (this.settings.shadowsEnabled && this.settings.vegetationEnabled) {
      const shadowPatches: VegetationPatch[] = [];
      for (const patch of this.vegetation.values()) {
        if (this.patchInLightBox(patch.bounds)) shadowPatches.push(patch);
      }
      const shadowBatch = this.updateShadowVegetationBatch(shadowPatches);
      shadowVegetationBuffer = shadowBatch.buffer;
      shadowVegetationInstances = shadowBatch.instanceCount;
    }

    if (this.settings.shadowsEnabled) {
      const shadowPass = encoder.beginRenderPass({
        label: 'shadow caster pass',
        colorAttachments: [],
        depthStencilAttachment: {
          view: this.shadowDepthView,
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });
      shadowPass.setBindGroup(0, this.shadowCasterBindGroup);
      if (
        terrainArenaActive
        && terrainArenaReplaySlots > 0
        && this.terrainArena.vertexBuffer
        && this.terrainArena.originBuffer
        && this.terrainArena.indexBuffer
        && this.terrainArena.compactIndirectBuffer
      ) {
        shadowPass.setPipeline(this.shadowCasterPipeline);
        shadowPass.setVertexBuffer(0, this.terrainArena.vertexBuffer);
        shadowPass.setVertexBuffer(1, this.terrainArena.originBuffer);
        shadowPass.setIndexBuffer(this.terrainArena.indexBuffer, 'uint32');
        if (this.capabilities.multiDrawIndirect) {
          const multiDrawPass = shadowPass as GPURenderPassEncoder & {
            multiDrawIndexedIndirect: (buffer: GPUBuffer, offset: number, maxDrawCount: number) => void;
          };
          multiDrawPass.multiDrawIndexedIndirect(this.terrainArena.compactIndirectBuffer, 0, terrainArenaReplaySlots);
        } else {
          for (let drawSlot = 0; drawSlot < terrainArenaReplaySlots; drawSlot++) {
            shadowPass.drawIndexedIndirect(this.terrainArena.compactIndirectBuffer, drawSlot * INDIRECT_INDEXED_ARGS_BYTES);
          }
        }
      }
      if (this.settings.vegetationEnabled && shadowVegetationBuffer && shadowVegetationInstances > 0) {
        shadowPass.setPipeline(this.shadowVegetationCasterPipeline);
        shadowPass.setVertexBuffer(0, this.treeVertexBuffer);
        shadowPass.setVertexBuffer(1, shadowVegetationBuffer);
        shadowPass.draw(this.treeVertexCount, shadowVegetationInstances);
      }
      shadowPass.end();
    }

    const colorView = this.context.getCurrentTexture().createView();
    if (!this.depthTexture) throw new Error('Depth texture is not initialized.');
    const depthView = this.depthTexture.createView();
    const pass = encoder.beginRenderPass({
      label: 'main render pass',
      colorAttachments: [{
        view: colorView,
        clearValue: { r: 0.08, g: 0.12, b: 0.17, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: depthView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    pass.setBindGroup(0, this.uniformBindGroup);
    if (this.settings.skyEnabled && this.settings.debugView === 0) {
      pass.setPipeline(this.skyPipeline);
      pass.draw(3);
      drawCalls++;
    }
    pass.setPipeline(this.terrainPipeline);
    pass.setBindGroup(1, this.shadowSampleBindGroup);
    if (this.settings.farTerrainEnabled && this.farTerrain) {
      pass.setVertexBuffer(0, this.farTerrain.vertexBuffer);
      pass.setVertexBuffer(1, this.farTerrain.originBuffer);
      pass.setIndexBuffer(this.farTerrain.indexBuffer, 'uint32');
      pass.drawIndexed(this.farTerrain.indexCount);
      farTerrainTriangles += this.farTerrain.indexCount / 3;
      drawCalls++;
    }

    if (terrainArenaActive && this.terrainArena.vertexBuffer && this.terrainArena.originBuffer && this.terrainArena.indexBuffer && this.terrainArena.compactIndirectBuffer) {
      pass.setPipeline(this.terrainArenaPipeline);
      pass.setVertexBuffer(0, this.terrainArena.vertexBuffer);
      pass.setVertexBuffer(1, this.terrainArena.originBuffer);
      pass.setIndexBuffer(this.terrainArena.indexBuffer, 'uint32');
      if (this.capabilities.multiDrawIndirect && terrainArenaReplaySlots > 0) {
        const multiDrawPass = pass as GPURenderPassEncoder & {
          multiDrawIndexedIndirect: (buffer: GPUBuffer, offset: number, maxDrawCount: number) => void;
        };
        multiDrawPass.multiDrawIndexedIndirect(this.terrainArena.compactIndirectBuffer, 0, terrainArenaReplaySlots);
        drawCalls++;
      } else {
        for (let drawSlot = 0; drawSlot < terrainArenaReplaySlots; drawSlot++) {
          pass.drawIndexedIndirect(this.terrainArena.compactIndirectBuffer, drawSlot * INDIRECT_INDEXED_ARGS_BYTES);
          drawCalls++;
        }
      }
    }

    if (this.gameMarkers && this.gameMarkers.instanceCount > 0) {
      pass.setPipeline(this.beaconPipeline);
      pass.setVertexBuffer(0, this.beaconVertexBuffer);
      pass.setVertexBuffer(1, this.gameMarkers.instanceBuffer);
      pass.draw(this.beaconVertexCount, this.gameMarkers.instanceCount);
      gameMarkers = this.gameMarkers.instanceCount;
      drawCalls++;
    }

    if (this.debugMarkers && this.debugMarkers.instanceCount > 0) {
      pass.setPipeline(this.beaconPipeline);
      pass.setVertexBuffer(0, this.beaconVertexBuffer);
      pass.setVertexBuffer(1, this.debugMarkers.instanceBuffer);
      pass.draw(this.beaconVertexCount, this.debugMarkers.instanceCount);
      debugMarkers = this.debugMarkers.instanceCount;
      drawCalls++;
    }

    if (this.settings.waterEnabled && this.water) {
      pass.setPipeline(this.waterPipeline);
      pass.setVertexBuffer(0, this.water.vertexBuffer);
      pass.setIndexBuffer(this.water.indexBuffer, 'uint32');
      pass.drawIndexed(this.water.indexCount);
      drawCalls++;
    }

    if (this.settings.vegetationEnabled && vegetationBatchBuffer && vegetationInstances > 0) {
      pass.setPipeline(this.vegetationPipeline);
      pass.setVertexBuffer(0, this.treeVertexBuffer);
      pass.setVertexBuffer(1, vegetationBatchBuffer);
      pass.draw(this.treeVertexCount, vegetationInstances);
      drawCalls++;
    }

    pass.end();
    this.encodeDepthPyramid(encoder, viewProj);
    this.device.queue.submit([encoder.finish()]);
    if (copyHiZCounters) this.scheduleHiZOcclusionReadback();

    if (this.settings.nearTerrainEnabled) {
      const activeClusters = this.terrainArena.activeClusters;
      const gpuVisibleClusters = this.hiZOcclusionReadbackReady
        ? Math.min(activeClusters, this.hiZOcclusion.tested)
        : activeClusters;
      terrainClusters = gpuVisibleClusters;
      culledTerrainClusters = Math.max(0, activeClusters - gpuVisibleClusters);
      terrainTriangles = gpuVisibleClusters * TERRAIN_CLUSTER_INDEX_COUNT / 3;
      terrainClusterDrawCalls = terrainArenaReplaySlots;
      terrainClusterDrawsSkipped = culledTerrainClusters;
      visibleTerrainChunks = this.chunks.size;
      culledTerrainChunks = 0;
    }

    this.stats = {
      drawCalls,
      terrainTriangles,
      farTerrainTriangles,
      terrainClusters,
      culledTerrainClusters,
      terrainClusterDrawCalls,
      terrainClusterDrawsSkipped,
      vegetationInstances,
      vegetationLodCulledInstances,
      vegetationDrawCalls,
      visibleVegetationPatches,
      culledVegetationPatches,
      gameMarkers,
      debugMarkers,
      visibleTerrainChunks,
      culledTerrainChunks,
      depthPyramidMips: this.depthPyramid?.mipLevels ?? 0,
      hiZOcclusionTestedClusters: this.hiZOcclusion.tested,
      hiZOcclusionCulledClusters: this.hiZOcclusion.culled,
      hiZOcclusionTestedBatches: this.hiZOcclusion.tested,
      hiZOcclusionCulledBatches: this.hiZOcclusion.culled,
    };
    return this.stats;
  }
}
