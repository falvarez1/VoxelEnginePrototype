import type { CaveGraphSample } from './cave_tiles.ts';
import type { ErosionTileSample } from './erosion_tiles.ts';
import type { WorldgenMaterialWeights, WorldgenTileSample } from './worldgen_tiles.ts';

const FIELD_GRASS = 0;
const FIELD_ROCK = 1;
const FIELD_SNOW = 2;
const FIELD_MUD = 3;
const FIELD_WETNESS = 4;
const FIELD_ROUGHNESS = 5;
const FIELD_FERTILITY = 6;
const FIELD_STABILITY = 7;
const FIELD_SHORELINE = 8;
const FIELD_CAVE_SURFACE = 9;
const FIELD_ROUTE_COST = 10;
const FIELD_BLEND_CONFIDENCE = 11;
const FIELD_COUNT = 12;

export const MATERIAL_TILE_SCHEMA_VERSION = 1;
export const MATERIAL_TILE_GENERATOR_VERSION = 1;
export const MATERIAL_TILE_SIZE = 256;
export const MATERIAL_TILE_RESOLUTION = 17;
export const MATERIAL_TILE_FIELD_NAMES = [
  'grass',
  'rock',
  'snow',
  'mud',
  'wetness',
  'roughness',
  'fertility',
  'stability',
  'shoreline',
  'caveSurface',
  'routeCost',
  'blendConfidence',
] as const;
const MATERIAL_TILE_SAMPLE_PRIORITY = 0;
const MATERIAL_TILE_EXPORT_PRIORITY = 1;
const MATERIAL_TILE_PREFETCH_PRIORITY = 10;
const MATERIAL_TILE_WORKER_QUEUE_LIMIT = 128;

export type MaterialName = 'grass' | 'rock' | 'snow' | 'mud';

export interface MaterialTileWeights extends WorldgenMaterialWeights {}

export interface MaterialTileSample {
  tileX: number;
  tileZ: number;
  weights: MaterialTileWeights;
  dominantMaterialId: number;
  dominantMaterialName: MaterialName;
  wetness: number;
  roughness: number;
  fertility: number;
  stability: number;
  shoreline: number;
  caveSurface: number;
  routeCost: number;
  blendConfidence: number;
}

export interface MaterialTileStats {
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

export interface SerializedMaterialTile {
  key: string;
  tileX: number;
  tileZ: number;
  originX: number;
  originZ: number;
  fields: number[];
  dominantMaterialIds: number[];
}

export interface MaterialTileExport {
  type: 'storm-canyon-material-tiles';
  schemaVersion: 1;
  tileSchemaVersion: typeof MATERIAL_TILE_SCHEMA_VERSION;
  generatorVersion: typeof MATERIAL_TILE_GENERATOR_VERSION;
  capturedAt: number;
  center: { x: number; z: number; tileX: number; tileZ: number };
  radiusTiles: number;
  tileSize: number;
  resolution: number;
  fieldNames: readonly string[];
  stats: MaterialTileStats;
  tiles: SerializedMaterialTile[];
}

export interface MaterialTileProviders {
  worldgen(x: number, z: number): WorldgenTileSample;
  erosion(x: number, z: number): ErosionTileSample;
  cave(x: number, y: number, z: number): CaveGraphSample;
}

export interface NativeMaterialTileBuffer {
  key?: string;
  tileX: number;
  tileZ: number;
  tileSize: number;
  schemaVersion: number;
  generatorVersion: number;
  resolution: number;
  fieldCount: number;
  fields: ArrayLike<number>;
  dominantMaterialIds: ArrayLike<number>;
}

export type MaterialTileWorkerProvider = (tileX: number, tileZ: number) => boolean;

type MaterialTileWorkerRequestReason = 'sample' | 'prefetch' | 'export';

interface MaterialTileRequestOptions {
  reason: MaterialTileWorkerRequestReason;
  priority: number;
}

interface QueuedMaterialTileRequest {
  tileX: number;
  tileZ: number;
  reason: MaterialTileWorkerRequestReason;
  priority: number;
  sequence: number;
}

export interface MaterialTilePersistenceLoadResult {
  tile: SerializedMaterialTile | null;
  invalidated?: boolean;
  records?: number;
}

export interface MaterialTilePersistenceSaveResult {
  pruned?: number;
  records?: number;
}

export interface MaterialTilePersistenceProvider {
  loadTile(key: string, tileX: number, tileZ: number): Promise<MaterialTilePersistenceLoadResult>;
  saveTile(tile: SerializedMaterialTile): Promise<MaterialTilePersistenceSaveResult | void>;
}

interface MaterialTile {
  key: string;
  tileX: number;
  tileZ: number;
  originX: number;
  originZ: number;
  fields: Float32Array;
  dominantMaterialIds: Uint8Array;
  lastUsed: number;
  source: 'typescript' | 'native' | 'persisted';
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
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function sampleIndex(ix: number, iz: number): number {
  return ix + MATERIAL_TILE_RESOLUTION * iz;
}

function fieldIndex(ix: number, iz: number, field: number): number {
  return sampleIndex(ix, iz) * FIELD_COUNT + field;
}

function nearestIndex(local: number): number {
  return Math.max(0, Math.min(MATERIAL_TILE_RESOLUTION - 1, Math.round(local)));
}

function smoothStep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(edge1 - edge0, 0.0001));
  return t * t * (3 - 2 * t);
}

function normalizeWeights(weights: WorldgenMaterialWeights): MaterialTileWeights {
  const grass = Math.max(0, weights.grass);
  const rock = Math.max(0, weights.rock);
  const snow = Math.max(0, weights.snow);
  const mud = Math.max(0, weights.mud);
  const total = Math.max(0.0001, grass + rock + snow + mud);
  return {
    grass: grass / total,
    rock: rock / total,
    snow: snow / total,
    mud: mud / total,
  };
}

function dominantMaterial(weights: MaterialTileWeights): { id: number; name: MaterialName; top: number; second: number } {
  const entries: Array<{ id: number; name: MaterialName; value: number }> = [
    { id: 0, name: 'grass', value: weights.grass },
    { id: 1, name: 'rock', value: weights.rock },
    { id: 2, name: 'snow', value: weights.snow },
    { id: 3, name: 'mud', value: weights.mud },
  ];
  entries.sort((a, b) => b.value - a.value);
  return { id: entries[0].id, name: entries[0].name, top: entries[0].value, second: entries[1]?.value ?? 0 };
}

function composeMaterialSample(
  tileX: number,
  tileZ: number,
  x: number,
  world: WorldgenTileSample,
  erosion: ErosionTileSample,
  cave: CaveGraphSample,
): MaterialTileSample {
  const slope = clamp01(1 - world.normalY);
  const riverDistance = Math.abs(x - world.riverCenter);
  const halfChannel = Math.max(2, world.channelWidth * 0.5);
  const streamActive = world.streamOrder > 0 || world.waterId > 0 || world.channelWidth > 2.5;
  const shorelineWidth = Math.max(8, world.channelWidth * 0.75 + 8);
  const base = normalizeWeights(world.materialWeights);
  const caveSurface = clamp01(Math.max(
    world.caveInfluence,
    1 - Math.min(Math.abs(world.surfaceCaveDistance) / 52, 1),
    1 - Math.min(Math.abs(cave.signedDistance) / 38, 1),
  ));
  const bankDistance = Math.abs(riverDistance - halfChannel);
  const channelEdge = streamActive
    ? 1 - smoothStep(0, shorelineWidth, bankDistance)
    : 0;
  const waterMargin = world.waterId > 0 ? 1 : smoothStep(0.08, 0.72, world.drainage) * smoothStep(0.10, 0.68, world.wetness);
  const shoreline = clamp01(Math.max(channelEdge * 0.55, waterMargin * smoothStep(0.55, 0.95, world.streamPower)));

  const wetness = clamp01(world.wetness * 0.56 + world.drainage * 0.20 + erosion.deposition * 0.12 + shoreline * 0.22);
  const roughness = clamp01(
    slope * 0.38
      + erosion.bedrockExposure * 0.23
      + erosion.thermalErosion * 0.14
      + erosion.hydraulicErosion * 0.10
      + world.erosion * 0.10
      + caveSurface * 0.12,
  );
  const fertility = clamp01(
    world.vegetation * 0.34
      + erosion.soilDepth * 0.26
      + erosion.vegetationRetention * 0.24
      + world.moisture * 0.10
      + wetness * 0.08
      - erosion.bedrockExposure * 0.18
      - slope * 0.08,
  );
  const stability = clamp01(
    1.02
      - erosion.hydraulicErosion * 0.24
      - erosion.thermalErosion * 0.18
      - erosion.sedimentLoad * 0.10
      - erosion.streamPower * 0.20
      - slope * 0.16
      - caveSurface * 0.16
      + erosion.soilDepth * 0.08,
  );

  const weights = normalizeWeights({
    grass: base.grass + fertility * 0.13 + erosion.vegetationRetention * 0.07 - slope * 0.05,
    rock: base.rock + erosion.bedrockExposure * 0.16 + slope * 0.12 + caveSurface * 0.18,
    snow: base.snow + world.snow * 0.16 + smoothStep(90, 170, world.height) * 0.06 - wetness * 0.03,
    mud: base.mud + wetness * 0.12 + shoreline * 0.18 + erosion.deposition * 0.07,
  });
  const dominant = dominantMaterial(weights);
  const routeCost = clamp01(
    roughness * 0.28
      + (1 - stability) * 0.24
      + weights.mud * 0.16
      + weights.snow * 0.11
      + shoreline * 0.12
      + caveSurface * 0.09
      + erosion.streamPower * 0.12
      - fertility * 0.05,
  );
  const blendConfidence = clamp01(0.42 + (dominant.top - dominant.second) * 1.45 + stability * 0.10 - caveSurface * 0.08);

  return {
    tileX,
    tileZ,
    weights,
    dominantMaterialId: dominant.id,
    dominantMaterialName: dominant.name,
    wetness,
    roughness,
    fertility,
    stability,
    shoreline,
    caveSurface,
    routeCost,
    blendConfidence,
  };
}

function writeMaterialSample(fields: Float32Array, ids: Uint8Array, ix: number, iz: number, sample: MaterialTileSample): void {
  fields[fieldIndex(ix, iz, FIELD_GRASS)] = sample.weights.grass;
  fields[fieldIndex(ix, iz, FIELD_ROCK)] = sample.weights.rock;
  fields[fieldIndex(ix, iz, FIELD_SNOW)] = sample.weights.snow;
  fields[fieldIndex(ix, iz, FIELD_MUD)] = sample.weights.mud;
  fields[fieldIndex(ix, iz, FIELD_WETNESS)] = sample.wetness;
  fields[fieldIndex(ix, iz, FIELD_ROUGHNESS)] = sample.roughness;
  fields[fieldIndex(ix, iz, FIELD_FERTILITY)] = sample.fertility;
  fields[fieldIndex(ix, iz, FIELD_STABILITY)] = sample.stability;
  fields[fieldIndex(ix, iz, FIELD_SHORELINE)] = sample.shoreline;
  fields[fieldIndex(ix, iz, FIELD_CAVE_SURFACE)] = sample.caveSurface;
  fields[fieldIndex(ix, iz, FIELD_ROUTE_COST)] = sample.routeCost;
  fields[fieldIndex(ix, iz, FIELD_BLEND_CONFIDENCE)] = sample.blendConfidence;
  ids[sampleIndex(ix, iz)] = sample.dominantMaterialId;
}

function bilinear(tile: MaterialTile, lx: number, lz: number, field: number): number {
  const x0 = Math.max(0, Math.min(MATERIAL_TILE_RESOLUTION - 2, Math.floor(lx)));
  const z0 = Math.max(0, Math.min(MATERIAL_TILE_RESOLUTION - 2, Math.floor(lz)));
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

function serializeTile(tile: MaterialTile): SerializedMaterialTile {
  return {
    key: tile.key,
    tileX: tile.tileX,
    tileZ: tile.tileZ,
    originX: tile.originX,
    originZ: tile.originZ,
    fields: Array.from(tile.fields),
    dominantMaterialIds: Array.from(tile.dominantMaterialIds),
  };
}

export function serializedMaterialTileFromNativeBuffer(buffer: NativeMaterialTileBuffer): SerializedMaterialTile | null {
  const expectedSamples = MATERIAL_TILE_RESOLUTION * MATERIAL_TILE_RESOLUTION;
  const expectedFields = expectedSamples * FIELD_COUNT;
  if (
    buffer.schemaVersion !== MATERIAL_TILE_SCHEMA_VERSION
    || buffer.generatorVersion !== MATERIAL_TILE_GENERATOR_VERSION
    || buffer.tileSize !== MATERIAL_TILE_SIZE
    || buffer.resolution !== MATERIAL_TILE_RESOLUTION
    || buffer.fieldCount !== FIELD_COUNT
    || buffer.fields.length !== expectedFields
    || buffer.dominantMaterialIds.length !== expectedSamples
  ) {
    return null;
  }
  return {
    key: buffer.key || tileKey(buffer.tileX, buffer.tileZ),
    tileX: buffer.tileX,
    tileZ: buffer.tileZ,
    originX: buffer.tileX * MATERIAL_TILE_SIZE,
    originZ: buffer.tileZ * MATERIAL_TILE_SIZE,
    fields: Array.from(buffer.fields, value => Number(value) || 0),
    dominantMaterialIds: Array.from(buffer.dominantMaterialIds, value => Math.max(0, Math.min(255, Number(value) | 0))),
  };
}

export class MaterialTileCache {
  private readonly tiles = new Map<string, MaterialTile>();
  private readonly pendingWorkerTiles = new Set<string>();
  private readonly queuedWorkerTiles = new Map<string, QueuedMaterialTileRequest>();
  private readonly pendingPersistenceLoads = new Set<string>();
  private readonly missingPersistenceTiles = new Set<string>();
  private stamp = 0;
  private requestSequence = 0;
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
  private prefetchCenters = 0;
  private prefetchTiles = 0;
  private lastPrefetchKey: string | null = null;
  private lastTileKey: string | null = null;

  constructor(
    private readonly providers: MaterialTileProviders,
    private readonly maxTiles = 64,
    private workerProvider?: MaterialTileWorkerProvider,
    private persistenceProvider?: MaterialTilePersistenceProvider,
  ) {}

  setWorkerProvider(provider: MaterialTileWorkerProvider | undefined): void {
    this.workerProvider = provider;
  }

  setPersistenceProvider(provider: MaterialTilePersistenceProvider | undefined): void {
    this.persistenceProvider = provider;
  }

  sample(x: number, z: number): MaterialTileSample {
    const tileX = Math.floor(x / MATERIAL_TILE_SIZE);
    const tileZ = Math.floor(z / MATERIAL_TILE_SIZE);
    const tile = this.getTile(tileX, tileZ, { reason: 'sample', priority: MATERIAL_TILE_SAMPLE_PRIORITY });
    const lx = (x - tile.originX) / MATERIAL_TILE_SIZE * (MATERIAL_TILE_RESOLUTION - 1);
    const lz = (z - tile.originZ) / MATERIAL_TILE_SIZE * (MATERIAL_TILE_RESOLUTION - 1);
    const weights = normalizeWeights({
      grass: bilinear(tile, lx, lz, FIELD_GRASS),
      rock: bilinear(tile, lx, lz, FIELD_ROCK),
      snow: bilinear(tile, lx, lz, FIELD_SNOW),
      mud: bilinear(tile, lx, lz, FIELD_MUD),
    });
    const dominant = dominantMaterial(weights);
    return {
      tileX,
      tileZ,
      weights,
      dominantMaterialId: dominant.id,
      dominantMaterialName: dominant.name,
      wetness: clamp01(bilinear(tile, lx, lz, FIELD_WETNESS)),
      roughness: clamp01(bilinear(tile, lx, lz, FIELD_ROUGHNESS)),
      fertility: clamp01(bilinear(tile, lx, lz, FIELD_FERTILITY)),
      stability: clamp01(bilinear(tile, lx, lz, FIELD_STABILITY)),
      shoreline: clamp01(bilinear(tile, lx, lz, FIELD_SHORELINE)),
      caveSurface: clamp01(bilinear(tile, lx, lz, FIELD_CAVE_SURFACE)),
      routeCost: clamp01(bilinear(tile, lx, lz, FIELD_ROUTE_COST)),
      blendConfidence: clamp01(bilinear(tile, lx, lz, FIELD_BLEND_CONFIDENCE)),
    };
  }

  ensureTilesAround(x: number, z: number, radiusTiles = 1): number {
    const centerTileX = Math.floor(x / MATERIAL_TILE_SIZE);
    const centerTileZ = Math.floor(z / MATERIAL_TILE_SIZE);
    const radius = Math.max(0, Math.min(4, Math.floor(radiusTiles)));
    const prefetchKey = `${centerTileX},${centerTileZ},${radius}`;
    if (this.lastPrefetchKey === prefetchKey) return 0;
    this.lastPrefetchKey = prefetchKey;
    this.prefetchCenters++;
    let touched = 0;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        this.getTile(centerTileX + dx, centerTileZ + dz, {
          reason: 'prefetch',
          priority: MATERIAL_TILE_PREFETCH_PRIORITY + dx * dx + dz * dz,
        });
        touched++;
      }
    }
    this.workerQueueCenterKey = tileKey(centerTileX, centerTileZ);
    this.dropStalePrefetchRequests(centerTileX, centerTileZ, radius + 1);
    this.prefetchTiles += touched;
    return touched;
  }

  stats(): MaterialTileStats {
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
      tileSize: MATERIAL_TILE_SIZE,
      resolution: MATERIAL_TILE_RESOLUTION,
      schemaVersion: MATERIAL_TILE_SCHEMA_VERSION,
      generatorVersion: MATERIAL_TILE_GENERATOR_VERSION,
      lastTileKey: this.lastTileKey,
    };
  }

  exportTilesAround(x: number, z: number, radiusTiles = 1): MaterialTileExport {
    const tileX = Math.floor(x / MATERIAL_TILE_SIZE);
    const tileZ = Math.floor(z / MATERIAL_TILE_SIZE);
    const radius = Math.max(0, Math.min(4, Math.floor(radiusTiles)));
    const tiles: SerializedMaterialTile[] = [];
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        tiles.push(serializeTile(this.getTile(tileX + dx, tileZ + dz, {
          reason: 'export',
          priority: MATERIAL_TILE_EXPORT_PRIORITY + dx * dx + dz * dz,
        })));
      }
    }
    return {
      type: 'storm-canyon-material-tiles',
      schemaVersion: 1,
      tileSchemaVersion: MATERIAL_TILE_SCHEMA_VERSION,
      generatorVersion: MATERIAL_TILE_GENERATOR_VERSION,
      capturedAt: Date.now(),
      center: { x, z, tileX, tileZ },
      radiusTiles: radius,
      tileSize: MATERIAL_TILE_SIZE,
      resolution: MATERIAL_TILE_RESOLUTION,
      fieldNames: MATERIAL_TILE_FIELD_NAMES,
      stats: this.stats(),
      tiles,
    };
  }

  adoptWorkerTile(tile: SerializedMaterialTile, byteLength?: number): boolean {
    const key = tile.key || tileKey(tile.tileX, tile.tileZ);
    this.pendingWorkerTiles.delete(key);
    this.queuedWorkerTiles.delete(key);
    this.missingPersistenceTiles.delete(key);
    this.workerResponses++;
    const next = this.tileFromSerialized(tile, 'native');
    if (!next) {
      this.pumpWorkerQueue();
      return false;
    }
    this.tiles.set(key, next);
    this.workerAdoptedTiles++;
    this.workerBytes += byteLength ?? next.fields.byteLength + next.dominantMaterialIds.byteLength;
    this.evictIfNeeded();
    this.savePersistedTile(serializeTile(next));
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
    request: MaterialTileRequestOptions = { reason: 'sample', priority: MATERIAL_TILE_SAMPLE_PRIORITY },
  ): MaterialTile {
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
    const tile = this.generateTile(tileX, tileZ);
    this.tiles.set(key, tile);
    this.evictIfNeeded();
    return tile;
  }

  private generateTile(tileX: number, tileZ: number): MaterialTile {
    const originX = tileX * MATERIAL_TILE_SIZE;
    const originZ = tileZ * MATERIAL_TILE_SIZE;
    const fields = new Float32Array(MATERIAL_TILE_RESOLUTION * MATERIAL_TILE_RESOLUTION * FIELD_COUNT);
    const dominantMaterialIds = new Uint8Array(MATERIAL_TILE_RESOLUTION * MATERIAL_TILE_RESOLUTION);
    for (let iz = 0; iz < MATERIAL_TILE_RESOLUTION; iz++) {
      const z = originZ + iz / (MATERIAL_TILE_RESOLUTION - 1) * MATERIAL_TILE_SIZE;
      for (let ix = 0; ix < MATERIAL_TILE_RESOLUTION; ix++) {
        const x = originX + ix / (MATERIAL_TILE_RESOLUTION - 1) * MATERIAL_TILE_SIZE;
        const world = this.providers.worldgen(x, z);
        const erosion = this.providers.erosion(x, z);
        const cave = this.providers.cave(x, world.height - 6, z);
        writeMaterialSample(fields, dominantMaterialIds, ix, iz, composeMaterialSample(tileX, tileZ, x, world, erosion, cave));
      }
    }
    this.generatedTiles++;
    this.generatedSamples += MATERIAL_TILE_RESOLUTION * MATERIAL_TILE_RESOLUTION;
    return {
      key: tileKey(tileX, tileZ),
      tileX,
      tileZ,
      originX,
      originZ,
      fields,
      dominantMaterialIds,
      lastUsed: ++this.stamp,
      source: 'typescript',
    };
  }

  private evictIfNeeded(): void {
    while (this.tiles.size > this.maxTiles) {
      let oldestKey: string | null = null;
      let oldestUse = Number.POSITIVE_INFINITY;
      for (const [key, tile] of this.tiles.entries()) {
        if (tile.lastUsed < oldestUse) {
          oldestUse = tile.lastUsed;
          oldestKey = key;
        }
      }
      if (!oldestKey) return;
      this.tiles.delete(oldestKey);
      this.queuedWorkerTiles.delete(oldestKey);
      this.pendingWorkerTiles.delete(oldestKey);
      this.pendingPersistenceLoads.delete(oldestKey);
      this.missingPersistenceTiles.delete(oldestKey);
      this.evictions++;
    }
  }

  private requestWorkerTile(tileX: number, tileZ: number, key: string, request: MaterialTileRequestOptions): void {
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

  private bestQueuedWorkerRequest(): QueuedMaterialTileRequest | null {
    return this.bestQueuedWorkerEntry()?.[1] ?? null;
  }

  private bestQueuedWorkerEntry(): [string, QueuedMaterialTileRequest] | null {
    let best: [string, QueuedMaterialTileRequest] | null = null;
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

  private worstQueuedWorkerEntry(): [string, QueuedMaterialTileRequest] | null {
    let worst: [string, QueuedMaterialTileRequest] | null = null;
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
    while (this.queuedWorkerTiles.size > MATERIAL_TILE_WORKER_QUEUE_LIMIT) {
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

  private tileFromSerialized(
    tile: SerializedMaterialTile,
    source: MaterialTile['source'],
    lastUsed = ++this.stamp,
  ): MaterialTile | null {
    const key = tile.key || tileKey(tile.tileX, tile.tileZ);
    const expectedSamples = MATERIAL_TILE_RESOLUTION * MATERIAL_TILE_RESOLUTION;
    const expectedFields = expectedSamples * FIELD_COUNT;
    if (
      !Number.isFinite(tile.tileX)
      || !Number.isFinite(tile.tileZ)
      || tile.originX !== tile.tileX * MATERIAL_TILE_SIZE
      || tile.originZ !== tile.tileZ * MATERIAL_TILE_SIZE
      || tile.fields.length !== expectedFields
      || tile.dominantMaterialIds.length !== expectedSamples
    ) {
      return null;
    }
    return {
      key,
      tileX: tile.tileX,
      tileZ: tile.tileZ,
      originX: tile.originX,
      originZ: tile.originZ,
      fields: Float32Array.from(tile.fields),
      dominantMaterialIds: Uint8Array.from(tile.dominantMaterialIds),
      lastUsed,
      source,
    };
  }

  private adoptPersistedTile(tile: SerializedMaterialTile): boolean {
    const key = tile.key || tileKey(tile.tileX, tile.tileZ);
    const existing = this.tiles.get(key);
    if (existing?.source === 'native' || existing?.source === 'persisted') return false;
    const next = this.tileFromSerialized(tile, 'persisted', existing?.lastUsed);
    if (!next) return false;
    this.tiles.set(key, next);
    this.queuedWorkerTiles.delete(key);
    this.persistenceBytes += next.fields.byteLength + next.dominantMaterialIds.byteLength;
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

  private savePersistedTile(tile: SerializedMaterialTile): void {
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
