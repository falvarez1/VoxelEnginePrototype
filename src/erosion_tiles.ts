import {
  drainageMask,
  erosionMask,
  macroMoisture,
  riverCenter,
  terrainHeight,
  terrainNormal,
  vegetationMask,
  wetnessMask,
} from './terrain_math.ts';

const FIELD_HEIGHT = 0;
const FIELD_SLOPE = 1;
const FIELD_DRAINAGE = 2;
const FIELD_STREAM_POWER = 3;
const FIELD_THERMAL_EROSION = 4;
const FIELD_HYDRAULIC_EROSION = 5;
const FIELD_DEPOSITION = 6;
const FIELD_SEDIMENT_LOAD = 7;
const FIELD_BEDROCK_EXPOSURE = 8;
const FIELD_SOIL_DEPTH = 9;
const FIELD_VEGETATION_RETENTION = 10;
const FIELD_COUNT = 11;

export const EROSION_TILE_SCHEMA_VERSION = 1;
export const EROSION_TILE_GENERATOR_VERSION = 1;
export const EROSION_TILE_SIZE = 256;
export const EROSION_TILE_RESOLUTION = 17;
export const EROSION_TILE_FIELD_NAMES = [
  'height',
  'slope',
  'drainage',
  'streamPower',
  'thermalErosion',
  'hydraulicErosion',
  'deposition',
  'sedimentLoad',
  'bedrockExposure',
  'soilDepth',
  'vegetationRetention',
] as const;
const EROSION_TILE_SAMPLE_PRIORITY = 0;
const EROSION_TILE_EXPORT_PRIORITY = 1;
const EROSION_TILE_PREFETCH_PRIORITY = 10;
const EROSION_TILE_WORKER_QUEUE_LIMIT = 128;

export interface ErosionTileSample {
  tileX: number;
  tileZ: number;
  height: number;
  slope: number;
  drainage: number;
  streamPower: number;
  thermalErosion: number;
  hydraulicErosion: number;
  deposition: number;
  sedimentLoad: number;
  bedrockExposure: number;
  soilDepth: number;
  vegetationRetention: number;
}

export interface ErosionTileStats {
  cachedTiles: number;
  maxTiles: number;
  hits: number;
  misses: number;
  evictions: number;
  nativeTiles: number;
  persistedTiles: number;
  generatedTiles: number;
  generatedSamples: number;
  workerRequests: number;
  workerResponses: number;
  workerPending: number;
  workerQueued: number;
  workerQueueDropped: number;
  workerQueueReprioritized: number;
  workerQueueBestPriority: number | null;
  workerQueueCenterKey: string | null;
  workerQueueLastDispatchedKey: string | null;
  workerRejected: number;
  workerAdoptedTiles: number;
  workerBytes: number;
  persistenceLoads: number;
  persistenceHits: number;
  persistenceMisses: number;
  persistencePending: number;
  persistenceSaves: number;
  persistenceFailures: number;
  persistenceInvalidated: number;
  persistencePruned: number;
  persistenceRecords: number;
  persistenceBytes: number;
  prefetchCenters: number;
  prefetchTiles: number;
  tileSize: number;
  resolution: number;
  schemaVersion: number;
  generatorVersion: number;
  lastTileKey: string | null;
}

export interface SerializedErosionTile {
  key: string;
  tileX: number;
  tileZ: number;
  originX: number;
  originZ: number;
  fields: number[];
}

export interface ErosionTileExport {
  type: 'storm-canyon-erosion-tiles';
  schemaVersion: 1;
  tileSchemaVersion: typeof EROSION_TILE_SCHEMA_VERSION;
  generatorVersion: typeof EROSION_TILE_GENERATOR_VERSION;
  capturedAt: number;
  center: { x: number; z: number; tileX: number; tileZ: number };
  radiusTiles: number;
  tileSize: number;
  resolution: number;
  fieldNames: readonly string[];
  stats: ErosionTileStats;
  tiles: SerializedErosionTile[];
}

interface ErosionTile {
  key: string;
  tileX: number;
  tileZ: number;
  originX: number;
  originZ: number;
  fields: Float32Array;
  lastUsed: number;
  source: 'typescript' | 'native' | 'persisted';
}

export type ErosionTileWorkerProvider = (tileX: number, tileZ: number) => boolean;

type ErosionTileWorkerRequestReason = 'sample' | 'prefetch' | 'export';

interface ErosionTileRequestOptions {
  reason: ErosionTileWorkerRequestReason;
  priority: number;
}

interface QueuedErosionTileRequest {
  tileX: number;
  tileZ: number;
  reason: ErosionTileWorkerRequestReason;
  priority: number;
  sequence: number;
}

export interface ErosionTilePersistenceLoadResult {
  tile: SerializedErosionTile | null;
  invalidated?: boolean;
  records?: number;
}

export interface ErosionTilePersistenceSaveResult {
  pruned?: number;
  records?: number;
}

export interface ErosionTilePersistenceProvider {
  loadTile(key: string, tileX: number, tileZ: number): Promise<ErosionTilePersistenceLoadResult>;
  saveTile(tile: SerializedErosionTile): Promise<ErosionTilePersistenceSaveResult | void>;
}

function tileKey(tileX: number, tileZ: number): string {
  return `${tileX},${tileZ}`;
}

function tileDistanceSq(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function sampleIndex(ix: number, iz: number): number {
  return ix + EROSION_TILE_RESOLUTION * iz;
}

function fieldIndex(ix: number, iz: number, field: number): number {
  return sampleIndex(ix, iz) * FIELD_COUNT + field;
}

function nearestIndex(local: number): number {
  return Math.max(0, Math.min(EROSION_TILE_RESOLUTION - 1, Math.round(local)));
}

function bilinear(tile: ErosionTile, lx: number, lz: number, field: number): number {
  const x0 = Math.max(0, Math.min(EROSION_TILE_RESOLUTION - 2, Math.floor(lx)));
  const z0 = Math.max(0, Math.min(EROSION_TILE_RESOLUTION - 2, Math.floor(lz)));
  const x1 = x0 + 1;
  const z1 = z0 + 1;
  const tx = clamp01(lx - x0);
  const tz = clamp01(lz - z0);
  const a = tile.fields[fieldIndex(x0, z0, field)];
  const b = tile.fields[fieldIndex(x1, z0, field)];
  const c = tile.fields[fieldIndex(x0, z1, field)];
  const d = tile.fields[fieldIndex(x1, z1, field)];
  const ab = a + (b - a) * tx;
  const cd = c + (d - c) * tx;
  return ab + (cd - ab) * tz;
}

function localRelief(x: number, z: number, height: number): number {
  let minHeight = height;
  let maxHeight = height;
  for (const [dx, dz] of [[-24, 0], [24, 0], [0, -24], [0, 24], [-17, -17], [17, -17], [-17, 17], [17, 17]] as const) {
    const h = terrainHeight(x + dx, z + dz);
    minHeight = Math.min(minHeight, h);
    maxHeight = Math.max(maxHeight, h);
  }
  return clamp01((maxHeight - minHeight) / 42.0);
}

function streamPowerEstimate(x: number, z: number, height: number, normalY: number, drainage: number, wetness: number): number {
  const moisture = macroMoisture(x, z);
  const slope = clamp01(1.0 - normalY);
  const riverInfluence = clamp01((42.0 - Math.abs(x - riverCenter(z))) / 42.0) * clamp01((22.0 - height) / 22.0);
  return clamp01(drainage * 0.42 + wetness * 0.18 + moisture * 0.12 + slope * 0.22 + riverInfluence * 0.06);
}

function writeSample(tile: ErosionTile, ix: number, iz: number): void {
  const stride = EROSION_TILE_SIZE / (EROSION_TILE_RESOLUTION - 1);
  const x = tile.originX + ix * stride;
  const z = tile.originZ + iz * stride;
  const height = terrainHeight(x, z);
  const normal = terrainNormal(x, z);
  const slope = clamp01(1.0 - normal[1]);
  const drainage = drainageMask(x, z, height);
  const wetness = wetnessMask(x, height, z, normal[1], height);
  const heuristicErosion = erosionMask(x, z, height, normal[1]);
  const relief = localRelief(x, z, height);
  const vegetation = vegetationMask(x, z, height, normal[1], drainage, heuristicErosion);
  const streamPower = streamPowerEstimate(x, z, height, normal[1], drainage, wetness);
  const thermalErosion = clamp01(slope * 0.62 + relief * 0.30 + heuristicErosion * 0.18);
  const hydraulicErosion = clamp01(streamPower * 0.58 + drainage * wetness * 0.34 + relief * drainage * 0.16);
  const sedimentLoad = clamp01(thermalErosion * 0.42 + hydraulicErosion * 0.50 + streamPower * 0.22);
  const deposition = clamp01((1.0 - slope) * drainage * 0.42 + wetness * 0.30 + (1.0 - streamPower) * sedimentLoad * 0.36);
  const bedrockExposure = clamp01(thermalErosion * 0.48 + hydraulicErosion * 0.34 + slope * 0.28 - deposition * 0.30);
  const soilDepth = clamp01(deposition * 0.58 + vegetation * 0.30 + (1.0 - bedrockExposure) * 0.24);
  const vegetationRetention = clamp01(vegetation * 0.54 + soilDepth * 0.36 - streamPower * 0.16 - thermalErosion * 0.12);
  const base = fieldIndex(ix, iz, 0);
  tile.fields[base + FIELD_HEIGHT] = height;
  tile.fields[base + FIELD_SLOPE] = slope;
  tile.fields[base + FIELD_DRAINAGE] = drainage;
  tile.fields[base + FIELD_STREAM_POWER] = streamPower;
  tile.fields[base + FIELD_THERMAL_EROSION] = thermalErosion;
  tile.fields[base + FIELD_HYDRAULIC_EROSION] = hydraulicErosion;
  tile.fields[base + FIELD_DEPOSITION] = deposition;
  tile.fields[base + FIELD_SEDIMENT_LOAD] = sedimentLoad;
  tile.fields[base + FIELD_BEDROCK_EXPOSURE] = bedrockExposure;
  tile.fields[base + FIELD_SOIL_DEPTH] = soilDepth;
  tile.fields[base + FIELD_VEGETATION_RETENTION] = vegetationRetention;
}

function makeTile(tileX: number, tileZ: number, stamp: number): ErosionTile {
  const tile: ErosionTile = {
    key: tileKey(tileX, tileZ),
    tileX,
    tileZ,
    originX: tileX * EROSION_TILE_SIZE,
    originZ: tileZ * EROSION_TILE_SIZE,
    fields: new Float32Array(EROSION_TILE_RESOLUTION * EROSION_TILE_RESOLUTION * FIELD_COUNT),
    lastUsed: stamp,
    source: 'typescript',
  };
  for (let iz = 0; iz < EROSION_TILE_RESOLUTION; iz++) {
    for (let ix = 0; ix < EROSION_TILE_RESOLUTION; ix++) writeSample(tile, ix, iz);
  }
  return tile;
}

function serializeTile(tile: ErosionTile): SerializedErosionTile {
  return {
    key: tile.key,
    tileX: tile.tileX,
    tileZ: tile.tileZ,
    originX: tile.originX,
    originZ: tile.originZ,
    fields: Array.from(tile.fields),
  };
}

export class ErosionTileCache {
  private readonly tiles = new Map<string, ErosionTile>();
  private readonly pendingWorkerTiles = new Set<string>();
  private readonly queuedWorkerTiles = new Map<string, QueuedErosionTileRequest>();
  private readonly pendingPersistenceLoads = new Set<string>();
  private readonly missingPersistenceTiles = new Set<string>();
  private stamp = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private generatedTiles = 0;
  private generatedSamples = 0;
  private workerRequests = 0;
  private workerResponses = 0;
  private workerRejected = 0;
  private workerAdoptedTiles = 0;
  private workerBytes = 0;
  private workerQueueDropped = 0;
  private workerQueueReprioritized = 0;
  private workerQueueCenterKey: string | null = null;
  private workerQueueLastDispatchedKey: string | null = null;
  private persistenceLoads = 0;
  private persistenceHits = 0;
  private persistenceMisses = 0;
  private persistenceSaves = 0;
  private persistenceFailures = 0;
  private persistenceInvalidated = 0;
  private persistencePruned = 0;
  private persistenceRecords = 0;
  private persistenceBytes = 0;
  private requestSequence = 0;
  private prefetchCenters = 0;
  private prefetchTiles = 0;
  private lastPrefetchKey: string | null = null;
  private lastTileKey: string | null = null;

  constructor(
    private readonly maxTiles = 64,
    private workerProvider?: ErosionTileWorkerProvider,
    private persistenceProvider?: ErosionTilePersistenceProvider,
  ) {}

  setWorkerProvider(provider: ErosionTileWorkerProvider | undefined): void {
    this.workerProvider = provider;
  }

  setPersistenceProvider(provider: ErosionTilePersistenceProvider | undefined): void {
    this.persistenceProvider = provider;
  }

  sample(x: number, z: number): ErosionTileSample {
    const tileX = Math.floor(x / EROSION_TILE_SIZE);
    const tileZ = Math.floor(z / EROSION_TILE_SIZE);
    const tile = this.getTile(tileX, tileZ);
    const stride = EROSION_TILE_SIZE / (EROSION_TILE_RESOLUTION - 1);
    const lx = (x - tile.originX) / stride;
    const lz = (z - tile.originZ) / stride;
    return {
      tileX,
      tileZ,
      height: bilinear(tile, lx, lz, FIELD_HEIGHT),
      slope: clamp01(bilinear(tile, lx, lz, FIELD_SLOPE)),
      drainage: clamp01(bilinear(tile, lx, lz, FIELD_DRAINAGE)),
      streamPower: clamp01(bilinear(tile, lx, lz, FIELD_STREAM_POWER)),
      thermalErosion: clamp01(bilinear(tile, lx, lz, FIELD_THERMAL_EROSION)),
      hydraulicErosion: clamp01(bilinear(tile, lx, lz, FIELD_HYDRAULIC_EROSION)),
      deposition: clamp01(bilinear(tile, lx, lz, FIELD_DEPOSITION)),
      sedimentLoad: clamp01(bilinear(tile, lx, lz, FIELD_SEDIMENT_LOAD)),
      bedrockExposure: clamp01(bilinear(tile, lx, lz, FIELD_BEDROCK_EXPOSURE)),
      soilDepth: clamp01(bilinear(tile, lx, lz, FIELD_SOIL_DEPTH)),
      vegetationRetention: clamp01(bilinear(tile, lx, lz, FIELD_VEGETATION_RETENTION)),
    };
  }

  ensureTilesAround(x: number, z: number, radiusTiles = 1): number {
    const tileX = Math.floor(x / EROSION_TILE_SIZE);
    const tileZ = Math.floor(z / EROSION_TILE_SIZE);
    const radius = Math.max(0, Math.min(4, Math.floor(radiusTiles)));
    const prefetchKey = `${tileX},${tileZ},${radius}`;
    if (this.lastPrefetchKey === prefetchKey) return 0;
    this.lastPrefetchKey = prefetchKey;
    this.prefetchCenters++;
    let touched = 0;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        this.prefetchTile(tileX + dx, tileZ + dz, {
          reason: 'prefetch',
          priority: EROSION_TILE_PREFETCH_PRIORITY + dx * dx + dz * dz,
        });
        touched++;
      }
    }
    this.workerQueueCenterKey = tileKey(tileX, tileZ);
    this.dropStalePrefetchRequests(tileX, tileZ, radius + 1);
    this.prefetchTiles += touched;
    return touched;
  }

  private prefetchTile(tileX: number, tileZ: number, request: ErosionTileRequestOptions): void {
    const key = tileKey(tileX, tileZ);
    const existing = this.tiles.get(key);
    if (existing) {
      if (existing.source === 'typescript') {
        this.requestPersistedTile(tileX, tileZ, key);
        this.requestWorkerTile(tileX, tileZ, key, request);
      }
      return;
    }
    this.requestPersistedTile(tileX, tileZ, key);
    this.requestWorkerTile(tileX, tileZ, key, request);
  }

  stats(): ErosionTileStats {
    const bestQueued = this.bestQueuedWorkerRequest();
    return {
      cachedTiles: this.tiles.size,
      maxTiles: this.maxTiles,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      nativeTiles: [...this.tiles.values()].filter(tile => tile.source === 'native').length,
      persistedTiles: [...this.tiles.values()].filter(tile => tile.source === 'persisted').length,
      generatedTiles: this.generatedTiles,
      generatedSamples: this.generatedSamples,
      workerRequests: this.workerRequests,
      workerResponses: this.workerResponses,
      workerPending: this.pendingWorkerTiles.size,
      workerQueued: this.queuedWorkerTiles.size,
      workerQueueDropped: this.workerQueueDropped,
      workerQueueReprioritized: this.workerQueueReprioritized,
      workerQueueBestPriority: bestQueued?.priority ?? null,
      workerQueueCenterKey: this.workerQueueCenterKey,
      workerQueueLastDispatchedKey: this.workerQueueLastDispatchedKey,
      workerRejected: this.workerRejected,
      workerAdoptedTiles: this.workerAdoptedTiles,
      workerBytes: this.workerBytes,
      persistenceLoads: this.persistenceLoads,
      persistenceHits: this.persistenceHits,
      persistenceMisses: this.persistenceMisses,
      persistencePending: this.pendingPersistenceLoads.size,
      persistenceSaves: this.persistenceSaves,
      persistenceFailures: this.persistenceFailures,
      persistenceInvalidated: this.persistenceInvalidated,
      persistencePruned: this.persistencePruned,
      persistenceRecords: this.persistenceRecords,
      persistenceBytes: this.persistenceBytes,
      prefetchCenters: this.prefetchCenters,
      prefetchTiles: this.prefetchTiles,
      tileSize: EROSION_TILE_SIZE,
      resolution: EROSION_TILE_RESOLUTION,
      schemaVersion: EROSION_TILE_SCHEMA_VERSION,
      generatorVersion: EROSION_TILE_GENERATOR_VERSION,
      lastTileKey: this.lastTileKey,
    };
  }

  exportTilesAround(x: number, z: number, radiusTiles = 1): ErosionTileExport {
    const tileX = Math.floor(x / EROSION_TILE_SIZE);
    const tileZ = Math.floor(z / EROSION_TILE_SIZE);
    const radius = Math.max(0, Math.min(4, Math.floor(radiusTiles)));
    const tiles: SerializedErosionTile[] = [];
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        tiles.push(serializeTile(this.getTile(tileX + dx, tileZ + dz, {
          reason: 'export',
          priority: EROSION_TILE_EXPORT_PRIORITY + dx * dx + dz * dz,
        })));
      }
    }
    return {
      type: 'storm-canyon-erosion-tiles',
      schemaVersion: 1,
      tileSchemaVersion: EROSION_TILE_SCHEMA_VERSION,
      generatorVersion: EROSION_TILE_GENERATOR_VERSION,
      capturedAt: Date.now(),
      center: { x, z, tileX, tileZ },
      radiusTiles: radius,
      tileSize: EROSION_TILE_SIZE,
      resolution: EROSION_TILE_RESOLUTION,
      fieldNames: EROSION_TILE_FIELD_NAMES,
      stats: this.stats(),
      tiles,
    };
  }

  adoptWorkerTile(tile: SerializedErosionTile, byteLength?: number): boolean {
    const key = tile.key || tileKey(tile.tileX, tile.tileZ);
    this.pendingWorkerTiles.delete(key);
    this.queuedWorkerTiles.delete(key);
    this.missingPersistenceTiles.delete(key);
    this.workerResponses++;
    const expectedFields = EROSION_TILE_RESOLUTION * EROSION_TILE_RESOLUTION * FIELD_COUNT;
    if (tile.fields.length !== expectedFields) return false;
    const next: ErosionTile = {
      key,
      tileX: tile.tileX,
      tileZ: tile.tileZ,
      originX: tile.originX,
      originZ: tile.originZ,
      fields: Float32Array.from(tile.fields),
      lastUsed: ++this.stamp,
      source: 'native',
    };
    this.tiles.set(key, next);
    this.workerAdoptedTiles++;
    this.workerBytes += byteLength ?? next.fields.byteLength;
    this.evictIfNeeded();
    this.savePersistedTile(tile);
    this.pumpWorkerQueue();
    return true;
  }

  markWorkerTileFailed(key: string): void {
    this.pendingWorkerTiles.delete(key);
    this.queuedWorkerTiles.delete(key);
    this.pumpWorkerQueue();
  }

  pumpWorkerQueue(maxDispatches = Number.POSITIVE_INFINITY): number {
    if (!this.workerProvider) return 0;
    let dispatched = 0;
    while (this.queuedWorkerTiles.size > 0 && dispatched < maxDispatches) {
      const next = this.bestQueuedWorkerEntry();
      if (!next) break;
      const [key, request] = next;
      if (this.pendingWorkerTiles.has(key)) {
        this.queuedWorkerTiles.delete(key);
        continue;
      }
      const existing = this.tiles.get(key);
      if (existing?.source === 'native' || existing?.source === 'persisted') {
        this.queuedWorkerTiles.delete(key);
        continue;
      }
      if (!this.workerProvider(request.tileX, request.tileZ)) {
        this.workerRejected++;
        break;
      }
      this.queuedWorkerTiles.delete(key);
      this.pendingWorkerTiles.add(key);
      this.workerRequests++;
      this.workerQueueLastDispatchedKey = key;
      dispatched++;
    }
    return dispatched;
  }

  private getTile(
    tileX: number,
    tileZ: number,
    request: ErosionTileRequestOptions = { reason: 'sample', priority: EROSION_TILE_SAMPLE_PRIORITY },
  ): ErosionTile {
    const key = tileKey(tileX, tileZ);
    this.lastTileKey = key;
    const existing = this.tiles.get(key);
    if (existing) {
      existing.lastUsed = ++this.stamp;
      this.hits++;
      if (existing.source === 'typescript') {
        this.requestPersistedTile(tileX, tileZ, key);
        this.requestWorkerTile(tileX, tileZ, key, request);
      }
      return existing;
    }
    this.misses++;
    this.requestPersistedTile(tileX, tileZ, key);
    this.requestWorkerTile(tileX, tileZ, key, request);
    const tile = makeTile(tileX, tileZ, ++this.stamp);
    this.tiles.set(key, tile);
    this.generatedTiles++;
    this.generatedSamples += EROSION_TILE_RESOLUTION * EROSION_TILE_RESOLUTION;
    this.evictIfNeeded();
    return tile;
  }

  private evictIfNeeded(): void {
    while (this.tiles.size > this.maxTiles) {
      let oldestKey: string | null = null;
      let oldestStamp = Number.POSITIVE_INFINITY;
      for (const [key, tile] of this.tiles) {
        if (tile.lastUsed < oldestStamp) {
          oldestKey = key;
          oldestStamp = tile.lastUsed;
        }
      }
      if (!oldestKey) return;
      this.tiles.delete(oldestKey);
      this.queuedWorkerTiles.delete(oldestKey);
      this.pendingPersistenceLoads.delete(oldestKey);
      this.missingPersistenceTiles.delete(oldestKey);
      this.evictions++;
    }
  }

  private requestWorkerTile(tileX: number, tileZ: number, key: string, request: ErosionTileRequestOptions): void {
    if (!this.workerProvider || this.pendingWorkerTiles.has(key)) return;
    const existingTile = this.tiles.get(key);
    if (existingTile?.source === 'native' || existingTile?.source === 'persisted') return;
    const existingRequest = this.queuedWorkerTiles.get(key);
    if (existingRequest) {
      if (request.priority < existingRequest.priority || (request.reason === 'sample' && existingRequest.reason !== 'sample')) {
        existingRequest.priority = request.priority;
        existingRequest.reason = request.reason;
        existingRequest.sequence = ++this.requestSequence;
        this.workerQueueReprioritized++;
      }
      this.pumpWorkerQueue();
      return;
    }
    this.queuedWorkerTiles.set(key, {
      tileX,
      tileZ,
      reason: request.reason,
      priority: request.priority,
      sequence: ++this.requestSequence,
    });
    this.trimWorkerQueue();
    this.pumpWorkerQueue();
  }

  private bestQueuedWorkerRequest(): QueuedErosionTileRequest | null {
    return this.bestQueuedWorkerEntry()?.[1] ?? null;
  }

  private bestQueuedWorkerEntry(): [string, QueuedErosionTileRequest] | null {
    let best: [string, QueuedErosionTileRequest] | null = null;
    for (const entry of this.queuedWorkerTiles) {
      const [, request] = entry;
      if (
        !best
        || request.priority < best[1].priority
        || (request.priority === best[1].priority && request.sequence < best[1].sequence)
      ) {
        best = entry;
      }
    }
    return best;
  }

  private worstQueuedWorkerEntry(): [string, QueuedErosionTileRequest] | null {
    let worst: [string, QueuedErosionTileRequest] | null = null;
    for (const entry of this.queuedWorkerTiles) {
      const [, request] = entry;
      if (
        !worst
        || request.priority > worst[1].priority
        || (request.priority === worst[1].priority && request.sequence > worst[1].sequence)
      ) {
        worst = entry;
      }
    }
    return worst;
  }

  private trimWorkerQueue(): void {
    while (this.queuedWorkerTiles.size > EROSION_TILE_WORKER_QUEUE_LIMIT) {
      const worst = this.worstQueuedWorkerEntry();
      if (!worst) return;
      this.queuedWorkerTiles.delete(worst[0]);
      this.workerQueueDropped++;
    }
  }

  private dropStalePrefetchRequests(centerTileX: number, centerTileZ: number, keepRadius: number): void {
    const maxDistanceSq = keepRadius * keepRadius;
    for (const [key, request] of this.queuedWorkerTiles) {
      if (request.reason !== 'prefetch') continue;
      if (tileDistanceSq(request.tileX, request.tileZ, centerTileX, centerTileZ) <= maxDistanceSq) continue;
      this.queuedWorkerTiles.delete(key);
      this.workerQueueDropped++;
    }
  }

  private adoptPersistedTile(tile: SerializedErosionTile): boolean {
    const key = tile.key || tileKey(tile.tileX, tile.tileZ);
    const existing = this.tiles.get(key);
    if (existing?.source === 'native') return false;
    const expectedFields = EROSION_TILE_RESOLUTION * EROSION_TILE_RESOLUTION * FIELD_COUNT;
    if (tile.fields.length !== expectedFields) return false;
    const next: ErosionTile = {
      key,
      tileX: tile.tileX,
      tileZ: tile.tileZ,
      originX: tile.originX,
      originZ: tile.originZ,
      fields: Float32Array.from(tile.fields),
      lastUsed: existing?.lastUsed ?? ++this.stamp,
      source: 'persisted',
    };
    this.tiles.set(key, next);
    this.queuedWorkerTiles.delete(key);
    this.persistenceBytes += next.fields.byteLength;
    this.evictIfNeeded();
    return true;
  }

  private requestPersistedTile(tileX: number, tileZ: number, key: string): void {
    if (!this.persistenceProvider || this.pendingPersistenceLoads.has(key) || this.missingPersistenceTiles.has(key)) return;
    const existing = this.tiles.get(key);
    if (existing?.source === 'native' || existing?.source === 'persisted') return;
    this.pendingPersistenceLoads.add(key);
    this.persistenceLoads++;
    this.persistenceProvider.loadTile(key, tileX, tileZ)
      .then(result => {
        this.pendingPersistenceLoads.delete(key);
        this.persistenceRecords = result.records ?? this.persistenceRecords;
        if (result.invalidated) this.persistenceInvalidated++;
        const tile = result.tile;
        if (!tile) {
          this.persistenceMisses++;
          this.missingPersistenceTiles.add(key);
          return;
        }
        this.persistenceHits++;
        this.adoptPersistedTile(tile);
      })
      .catch(() => {
        this.pendingPersistenceLoads.delete(key);
        this.persistenceFailures++;
      });
  }

  private savePersistedTile(tile: SerializedErosionTile): void {
    if (!this.persistenceProvider) return;
    this.persistenceSaves++;
    this.persistenceProvider.saveTile(tile)
      .then(result => {
        this.missingPersistenceTiles.delete(tile.key);
        if (result && typeof result === 'object') {
          this.persistencePruned += result.pruned ?? 0;
          this.persistenceRecords = result.records ?? this.persistenceRecords;
        }
      })
      .catch(() => {
        this.persistenceFailures++;
      });
  }
}
