import {
  biomeMask,
  caveDistance,
  drainageMask,
  erosionMask,
  macroContinent,
  macroMoisture,
  macroTemperature,
  riverCenter,
  snowMask,
  terrainHeight,
  terrainMaterial,
  terrainNormal,
  vegetationMask,
  wetnessMask,
} from './terrain_math.ts';

const FIELD_HEIGHT = 0;
const FIELD_CONTINENT = 1;
const FIELD_MOISTURE = 2;
const FIELD_TEMPERATURE = 3;
const FIELD_DRAINAGE = 4;
const FIELD_EROSION = 5;
const FIELD_VEGETATION = 6;
const FIELD_BIOME = 7;
const FIELD_WETNESS = 8;
const FIELD_SNOW = 9;
const FIELD_NORMAL_Y = 10;
const FIELD_RIVER_CENTER = 11;
const FIELD_MATERIAL = 12;
const FIELD_FLOW_X = 13;
const FIELD_FLOW_Z = 14;
const FIELD_FLOW_ACCUMULATION = 15;
const FIELD_BIOME_MEADOW = 16;
const FIELD_BIOME_RIVER_VALLEY = 17;
const FIELD_BIOME_ALPINE_SNOW = 18;
const FIELD_BIOME_EXPOSED_RIDGE = 19;
const FIELD_BIOME_FOREST_EDGE = 20;
const FIELD_BIOME_DRY_SLOPE = 21;
const FIELD_MATERIAL_GRASS = 22;
const FIELD_MATERIAL_ROCK = 23;
const FIELD_MATERIAL_SNOW = 24;
const FIELD_MATERIAL_MUD = 25;
const FIELD_CAVE_DISTANCE = 26;
const FIELD_CAVE_INFLUENCE = 27;
const FIELD_DRAINAGE_BASIN = 28;
const FIELD_STREAM_ORDER = 29;
const FIELD_CHANNEL_WIDTH = 30;
const FIELD_STREAM_POWER = 31;
const FIELD_COUNT = 32;

export const WORLDGEN_TILE_SCHEMA_VERSION = 4;
export const WORLDGEN_TILE_GENERATOR_VERSION = 5;
export const WORLDGEN_TILE_SIZE = 256;
export const WORLDGEN_TILE_RESOLUTION = 17;
const WORLDGEN_TILE_WORKER_QUEUE_LIMIT = 96;
const WORLDGEN_TILE_PREFETCH_KEEP_RADIUS = 2;
const WORLDGEN_TILE_SAMPLE_PRIORITY = -2000;
const WORLDGEN_TILE_EXPORT_PRIORITY = -1000;
export const WORLDGEN_TILE_FIELD_NAMES = [
  'height',
  'continent',
  'moisture',
  'temperature',
  'drainage',
  'erosion',
  'vegetation',
  'biome',
  'wetness',
  'snow',
  'normalY',
  'riverCenter',
  'material',
  'flowX',
  'flowZ',
  'flowAccumulation',
  'biomeMeadow',
  'biomeRiverValley',
  'biomeAlpineSnow',
  'biomeExposedRidge',
  'biomeForestEdge',
  'biomeDrySlope',
  'materialGrass',
  'materialRock',
  'materialSnow',
  'materialMud',
  'caveDistance',
  'caveInfluence',
  'drainageBasin',
  'streamOrder',
  'channelWidth',
  'streamPower',
] as const;

export interface WorldgenBiomeWeights {
  meadow: number;
  riverValley: number;
  alpineSnow: number;
  exposedRidge: number;
  forestEdge: number;
  drySlope: number;
}

export interface WorldgenMaterialWeights {
  grass: number;
  rock: number;
  snow: number;
  mud: number;
}

export interface WorldgenTileSample {
  tileX: number;
  tileZ: number;
  height: number;
  continent: number;
  moisture: number;
  temperature: number;
  drainage: number;
  erosion: number;
  vegetation: number;
  biome: number;
  wetness: number;
  snow: number;
  normalY: number;
  riverCenter: number;
  material: number;
  biomeId: number;
  waterId: number;
  riverNetworkId: number;
  flowX: number;
  flowZ: number;
  flowAccumulation: number;
  drainageBasinId: number;
  streamOrder: number;
  channelWidth: number;
  streamPower: number;
  biomeWeights: WorldgenBiomeWeights;
  materialWeights: WorldgenMaterialWeights;
  surfaceCaveDistance: number;
  caveInfluence: number;
}

export interface WorldgenTileStats {
  cachedTiles: number;
  maxTiles: number;
  hits: number;
  misses: number;
  evictions: number;
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
  nativeTiles: number;
  persistedTiles: number;
  persistenceLoads: number;
  persistenceHits: number;
  persistenceMisses: number;
  persistencePending: number;
  persistenceSaves: number;
  persistenceFailures: number;
  persistenceInvalidated: number;
  persistencePruned: number;
  persistenceBytes: number;
  prefetchCenters: number;
  prefetchTiles: number;
  tileSize: number;
  resolution: number;
  lastTileKey: string | null;
}

export interface SerializedWorldgenTile {
  key: string;
  tileX: number;
  tileZ: number;
  originX: number;
  originZ: number;
  fields: number[];
  biomeIds: number[];
  waterIds: number[];
  riverNetworkIds: number[];
}

export interface WorldgenTileExport {
  type: 'storm-canyon-worldgen-tiles';
  schemaVersion: 2;
  tileSchemaVersion: typeof WORLDGEN_TILE_SCHEMA_VERSION;
  generatorVersion: typeof WORLDGEN_TILE_GENERATOR_VERSION;
  capturedAt: number;
  center: { x: number; z: number; tileX: number; tileZ: number };
  radiusTiles: number;
  tileSize: number;
  resolution: number;
  fieldNames: readonly string[];
  stats: WorldgenTileStats;
  tiles: SerializedWorldgenTile[];
}

interface WorldgenTile {
  key: string;
  tileX: number;
  tileZ: number;
  originX: number;
  originZ: number;
  fields: Float32Array;
  biomeIds: Uint8Array;
  waterIds: Uint8Array;
  riverNetworkIds: Uint16Array;
  lastUsed: number;
  source: 'typescript' | 'native' | 'persisted';
}

export type WorldgenTileWorkerProvider = (tileX: number, tileZ: number) => boolean;

type WorldgenTileWorkerRequestReason = 'sample' | 'prefetch' | 'export';

interface WorldgenTileRequestOptions {
  reason: WorldgenTileWorkerRequestReason;
  priority: number;
}

interface QueuedWorldgenTileRequest {
  tileX: number;
  tileZ: number;
  reason: WorldgenTileWorkerRequestReason;
  priority: number;
  sequence: number;
}

export interface WorldgenTilePersistenceLoadResult {
  tile: SerializedWorldgenTile | null;
  invalidated?: boolean;
}

export interface WorldgenTilePersistenceSaveResult {
  pruned?: number;
  records?: number;
}

export interface WorldgenTilePersistenceProvider {
  loadTile(key: string, tileX: number, tileZ: number): Promise<WorldgenTilePersistenceLoadResult>;
  saveTile(tile: SerializedWorldgenTile): Promise<WorldgenTilePersistenceSaveResult | void>;
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

function normalizeBiomeWeights(weights: WorldgenBiomeWeights): WorldgenBiomeWeights {
  const total = Math.max(0.0001, weights.meadow + weights.riverValley + weights.alpineSnow + weights.exposedRidge + weights.forestEdge + weights.drySlope);
  return {
    meadow: weights.meadow / total,
    riverValley: weights.riverValley / total,
    alpineSnow: weights.alpineSnow / total,
    exposedRidge: weights.exposedRidge / total,
    forestEdge: weights.forestEdge / total,
    drySlope: weights.drySlope / total,
  };
}

function biomeWeights(height: number, normalY: number, moisture: number, temperature: number, drainage: number, erosion: number, vegetation: number): WorldgenBiomeWeights {
  const riverValley = clamp01((drainage - 0.52) / 0.34) * clamp01((18.0 - height) / 18.0);
  const alpineSnow = clamp01((height - 38.0) / 28.0) * clamp01((0.56 - temperature) / 0.34);
  const exposedRidge = clamp01((erosion - 0.34) / 0.48) * 0.65 + clamp01((0.58 - normalY) / 0.44) * 0.35;
  const forestEdge = clamp01((vegetation - 0.22) / 0.48) * clamp01((moisture - 0.34) / 0.42);
  const drySlope = clamp01((0.46 - moisture) / 0.38) * clamp01((0.42 - drainage) / 0.42) * clamp01((height - 14.0) / 30.0);
  const occupied = Math.max(riverValley, alpineSnow, exposedRidge, forestEdge, drySlope);
  const meadow = Math.max(0.12, 1.0 - occupied);
  return normalizeBiomeWeights({ meadow, riverValley, alpineSnow, exposedRidge, forestEdge, drySlope });
}

function normalizeMaterialWeights(weights: WorldgenMaterialWeights): WorldgenMaterialWeights {
  const total = Math.max(0.0001, weights.grass + weights.rock + weights.snow + weights.mud);
  return {
    grass: weights.grass / total,
    rock: weights.rock / total,
    snow: weights.snow / total,
    mud: weights.mud / total,
  };
}

function materialWeights(material: number, normalY: number, wetness: number, snow: number, drainage: number, erosion: number, vegetation: number): WorldgenMaterialWeights {
  const materialId = Math.max(0, Math.min(3, Math.round(material)));
  const steepRock = clamp01((0.66 - normalY) / 0.48);
  const rock = (materialId === 1 ? 0.72 : 0.08) + erosion * 0.46 + steepRock * 0.34;
  const snowWeight = (materialId === 2 ? 0.76 : 0.04) + snow * 0.74 + clamp01((normalY - 0.35) / 0.65) * snow * 0.20;
  const mud = (materialId === 3 ? 0.76 : 0.04) + wetness * 0.48 + drainage * 0.22;
  const grass = (materialId === 0 ? 0.72 : 0.08) + vegetation * 0.42 + clamp01(normalY - 0.28) * (1.0 - snow * 0.55) * 0.20;
  return normalizeMaterialWeights({
    grass: grass * (1.0 - snow * 0.42) * (1.0 - steepRock * 0.30),
    rock: rock * (1.0 - wetness * 0.18),
    snow: snowWeight * (1.0 - drainage * 0.16),
    mud: mud * (1.0 - snow * 0.28),
  });
}

function dominantBiomeId(weights: WorldgenBiomeWeights): number {
  const values = [weights.meadow, weights.riverValley, weights.alpineSnow, weights.exposedRidge, weights.forestEdge, weights.drySlope];
  let best = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[best]) best = i;
  }
  return best;
}

function classifyWaterId(x: number, z: number, height: number, drainage: number): number {
  const dist = Math.abs(x - riverCenter(z));
  if (dist < 10.0 && height < 12.0) return 1; // river
  if (drainage > 0.74 && height < 10.5) return 2; // pond/lake candidate
  return 0;
}

function flowDirection(x: number, z: number): { x: number; z: number } {
  const step = 8.0;
  const dx = terrainHeight(x - step, z) - terrainHeight(x + step, z);
  const dz = terrainHeight(x, z - step) - terrainHeight(x, z + step);
  const len = Math.hypot(dx, dz);
  if (len <= 0.0001) return { x: 0, z: 0 };
  return { x: dx / len, z: dz / len };
}

interface DrainageNetworkSample {
  flowX: number;
  flowZ: number;
  accumulation: number;
  basinId: number;
  streamOrder: number;
  channelWidth: number;
  streamPower: number;
  waterId: number;
  riverNetworkId: number;
}

function drainageBasinId(x: number, z: number): number {
  const longitudinal = Math.floor((z + 8192.0) / 512.0);
  const lateral = Math.floor((riverCenter(z) + x + 4096.0) / 128.0);
  return ((longitudinal * 257 + lateral * 97) & 0xffff) || 1;
}

function flowAccumulationEstimate(x: number, z: number, height: number, normalY: number, drainage: number, wetness: number): number {
  const local = drainage * 0.36 + wetness * 0.18 + (1.0 - normalY) * 0.12;
  let incoming = 0;
  let weightSum = 0;
  const directions = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
  ] as const;
  for (const radius of [24.0, 48.0, 96.0, 160.0] as const) {
    const ringWeight = radius === 24.0 ? 0.88 : radius === 48.0 ? 0.64 : radius === 96.0 ? 0.42 : 0.26;
    for (const [dx, dz] of directions) {
      const length = Math.hypot(dx, dz);
      const sx = x + (dx / length) * radius;
      const sz = z + (dz / length) * radius;
      const sourceHeight = terrainHeight(sx, sz);
      const sourceNormal = terrainNormal(sx, sz);
      const sourceDrainage = drainageMask(sx, sz, sourceHeight);
      const sourceFlow = flowDirection(sx, sz);
      const toSampleX = (x - sx) / radius;
      const toSampleZ = (z - sz) / radius;
      const alignment = clamp01((sourceFlow.x * toSampleX + sourceFlow.z * toSampleZ - 0.18) / 0.82);
      const downhill = clamp01((sourceHeight - height + radius * 0.025) / (10.0 + radius * 0.12));
      const trunkBias = clamp01((64.0 - Math.abs(sx - riverCenter(sz))) / 64.0);
      const sourceWater = sourceDrainage * 0.62 + macroMoisture(sx, sz) * 0.22 + (1.0 - sourceNormal[1]) * 0.16;
      incoming += (alignment * downhill * sourceWater + trunkBias * sourceDrainage * 0.16) * ringWeight;
      weightSum += ringWeight;
    }
  }
  const neighborhood = weightSum > 0 ? incoming / weightSum : 0;
  return clamp01(local + neighborhood * 0.92);
}

function streamOrderFor(x: number, z: number, height: number, drainage: number, accumulation: number): number {
  const mainRiver = clamp01((18.0 - Math.abs(x - riverCenter(z))) / 18.0) * clamp01((18.0 - height) / 18.0);
  if (mainRiver > 0.48) return 4;
  if (accumulation > 0.88 && drainage > 0.58) return 3;
  if (accumulation > 0.70 && drainage > 0.50) return 2;
  if (accumulation > 0.50 && drainage > 0.44) return 1;
  return 0;
}

function channelWidthFor(streamOrder: number, accumulation: number, drainage: number): number {
  if (streamOrder <= 0) return 0;
  return 1.5 + streamOrder * streamOrder * 1.35 + accumulation * 8.0 + drainage * 3.0;
}

function streamPowerFor(streamOrder: number, accumulation: number, drainage: number, normalY: number): number {
  if (streamOrder <= 0) return 0;
  return clamp01(accumulation * 0.48 + drainage * 0.22 + (1.0 - normalY) * 0.20 + streamOrder * 0.10);
}

function classifyNetworkWaterId(x: number, z: number, height: number, drainage: number, streamOrder: number, channelWidth: number): number {
  if (streamOrder >= 3 || channelWidth >= 12.0) return 1;
  if (streamOrder > 0 && height < 20.0) return 1;
  return classifyWaterId(x, z, height, drainage);
}

function classifyRiverNetworkId(x: number, z: number, waterId: number, flowAccumulation: number, basinId: number, streamOrder: number): number {
  if (waterId === 0 && streamOrder <= 0 && flowAccumulation < 0.72) return 0;
  const channel = Math.floor((riverCenter(z) + x + 4096.0) / 48.0);
  return ((basinId * 131 + channel * 17 + streamOrder * 4099) & 0xffff) || 1;
}

function drainageNetworkSample(x: number, z: number, height: number, normalY: number, drainage: number, wetness: number): DrainageNetworkSample {
  const flow = flowDirection(x, z);
  const accumulation = flowAccumulationEstimate(x, z, height, normalY, drainage, wetness);
  const basinId = drainageBasinId(x, z);
  const streamOrder = streamOrderFor(x, z, height, drainage, accumulation);
  const channelWidth = channelWidthFor(streamOrder, accumulation, drainage);
  const streamPower = streamPowerFor(streamOrder, accumulation, drainage, normalY);
  const waterId = classifyNetworkWaterId(x, z, height, drainage, streamOrder, channelWidth);
  return {
    flowX: flow.x,
    flowZ: flow.z,
    accumulation,
    basinId,
    streamOrder,
    channelWidth,
    streamPower,
    waterId,
    riverNetworkId: classifyRiverNetworkId(x, z, waterId, accumulation, basinId, streamOrder),
  };
}

function sampleIndex(ix: number, iz: number): number {
  return ix + WORLDGEN_TILE_RESOLUTION * iz;
}

function fieldIndex(ix: number, iz: number, field: number): number {
  return sampleIndex(ix, iz) * FIELD_COUNT + field;
}

function nearestIndex(local: number): number {
  return Math.max(0, Math.min(WORLDGEN_TILE_RESOLUTION - 1, Math.round(local)));
}

function writeSample(tile: WorldgenTile, ix: number, iz: number): void {
  const stride = WORLDGEN_TILE_SIZE / (WORLDGEN_TILE_RESOLUTION - 1);
  const x = tile.originX + ix * stride;
  const z = tile.originZ + iz * stride;
  const height = terrainHeight(x, z);
  const normal = terrainNormal(x, z);
  const drainage = drainageMask(x, z, height);
  const erosion = erosionMask(x, z, height, normal[1]);
  const vegetation = vegetationMask(x, z, height, normal[1], drainage, erosion);
  const wetness = wetnessMask(x, height, z, normal[1], height);
  const snow = snowMask(x, height, z, normal[1], height);
  const moisture = macroMoisture(x, z);
  const temperature = macroTemperature(x, z);
  const network = drainageNetworkSample(x, z, height, normal[1], drainage, wetness);
  const material = terrainMaterial(x, height, z, normal[1]);
  const weights = biomeWeights(height, normal[1], moisture, temperature, drainage, erosion, vegetation);
  const materials = materialWeights(material, normal[1], wetness, snow, drainage, erosion, vegetation);
  const surfaceCaveDistance = caveDistance(x, height - 8.0, z);
  const caveInfluence = clamp01((20.0 - Math.abs(surfaceCaveDistance)) / 20.0);
  const base = fieldIndex(ix, iz, 0);
  tile.fields[base + FIELD_HEIGHT] = height;
  tile.fields[base + FIELD_CONTINENT] = macroContinent(x, z);
  tile.fields[base + FIELD_MOISTURE] = moisture;
  tile.fields[base + FIELD_TEMPERATURE] = temperature;
  tile.fields[base + FIELD_DRAINAGE] = drainage;
  tile.fields[base + FIELD_EROSION] = erosion;
  tile.fields[base + FIELD_VEGETATION] = vegetation;
  tile.fields[base + FIELD_BIOME] = biomeMask(x, z, height, normal[1]);
  tile.fields[base + FIELD_WETNESS] = wetness;
  tile.fields[base + FIELD_SNOW] = snow;
  tile.fields[base + FIELD_NORMAL_Y] = normal[1];
  tile.fields[base + FIELD_RIVER_CENTER] = riverCenter(z);
  tile.fields[base + FIELD_MATERIAL] = material;
  tile.fields[base + FIELD_FLOW_X] = network.flowX;
  tile.fields[base + FIELD_FLOW_Z] = network.flowZ;
  tile.fields[base + FIELD_FLOW_ACCUMULATION] = network.accumulation;
  tile.fields[base + FIELD_BIOME_MEADOW] = weights.meadow;
  tile.fields[base + FIELD_BIOME_RIVER_VALLEY] = weights.riverValley;
  tile.fields[base + FIELD_BIOME_ALPINE_SNOW] = weights.alpineSnow;
  tile.fields[base + FIELD_BIOME_EXPOSED_RIDGE] = weights.exposedRidge;
  tile.fields[base + FIELD_BIOME_FOREST_EDGE] = weights.forestEdge;
  tile.fields[base + FIELD_BIOME_DRY_SLOPE] = weights.drySlope;
  tile.fields[base + FIELD_MATERIAL_GRASS] = materials.grass;
  tile.fields[base + FIELD_MATERIAL_ROCK] = materials.rock;
  tile.fields[base + FIELD_MATERIAL_SNOW] = materials.snow;
  tile.fields[base + FIELD_MATERIAL_MUD] = materials.mud;
  tile.fields[base + FIELD_CAVE_DISTANCE] = surfaceCaveDistance;
  tile.fields[base + FIELD_CAVE_INFLUENCE] = caveInfluence;
  tile.fields[base + FIELD_DRAINAGE_BASIN] = network.basinId;
  tile.fields[base + FIELD_STREAM_ORDER] = network.streamOrder;
  tile.fields[base + FIELD_CHANNEL_WIDTH] = network.channelWidth;
  tile.fields[base + FIELD_STREAM_POWER] = network.streamPower;
  const index = sampleIndex(ix, iz);
  tile.biomeIds[index] = dominantBiomeId(weights);
  tile.waterIds[index] = network.waterId;
  tile.riverNetworkIds[index] = network.riverNetworkId;
}

function makeTile(tileX: number, tileZ: number, stamp: number): WorldgenTile {
  const tile: WorldgenTile = {
    key: tileKey(tileX, tileZ),
    tileX,
    tileZ,
    originX: tileX * WORLDGEN_TILE_SIZE,
    originZ: tileZ * WORLDGEN_TILE_SIZE,
    fields: new Float32Array(WORLDGEN_TILE_RESOLUTION * WORLDGEN_TILE_RESOLUTION * FIELD_COUNT),
    biomeIds: new Uint8Array(WORLDGEN_TILE_RESOLUTION * WORLDGEN_TILE_RESOLUTION),
    waterIds: new Uint8Array(WORLDGEN_TILE_RESOLUTION * WORLDGEN_TILE_RESOLUTION),
    riverNetworkIds: new Uint16Array(WORLDGEN_TILE_RESOLUTION * WORLDGEN_TILE_RESOLUTION),
    lastUsed: stamp,
    source: 'typescript',
  };
  for (let iz = 0; iz < WORLDGEN_TILE_RESOLUTION; iz++) {
    for (let ix = 0; ix < WORLDGEN_TILE_RESOLUTION; ix++) {
      writeSample(tile, ix, iz);
    }
  }
  return tile;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function bilinear(tile: WorldgenTile, lx: number, lz: number, field: number): number {
  const x0 = Math.max(0, Math.min(WORLDGEN_TILE_RESOLUTION - 2, Math.floor(lx)));
  const z0 = Math.max(0, Math.min(WORLDGEN_TILE_RESOLUTION - 2, Math.floor(lz)));
  const x1 = x0 + 1;
  const z1 = z0 + 1;
  const tx = clamp01(lx - x0);
  const tz = clamp01(lz - z0);
  const a = tile.fields[fieldIndex(x0, z0, field)];
  const b = tile.fields[fieldIndex(x1, z0, field)];
  const c = tile.fields[fieldIndex(x0, z1, field)];
  const d = tile.fields[fieldIndex(x1, z1, field)];
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}

export class WorldgenTileCache {
  private readonly tiles = new Map<string, WorldgenTile>();
  private readonly pendingWorkerTiles = new Set<string>();
  private readonly queuedWorkerTiles = new Map<string, QueuedWorldgenTileRequest>();
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
  private workerQueueDropped = 0;
  private workerQueueReprioritized = 0;
  private workerRejected = 0;
  private workerAdoptedTiles = 0;
  private workerBytes = 0;
  private persistenceLoads = 0;
  private persistenceHits = 0;
  private persistenceMisses = 0;
  private persistenceSaves = 0;
  private persistenceFailures = 0;
  private persistenceInvalidated = 0;
  private persistencePruned = 0;
  private persistenceBytes = 0;
  private prefetchCenters = 0;
  private prefetchTiles = 0;
  private lastPrefetchKey: string | null = null;
  private workerQueueCenterKey: string | null = null;
  private workerQueueLastDispatchedKey: string | null = null;
  private lastTileKey: string | null = null;

  constructor(
    private readonly maxTiles = 64,
    private workerProvider?: WorldgenTileWorkerProvider,
    private persistenceProvider?: WorldgenTilePersistenceProvider,
  ) {}

  setWorkerProvider(provider: WorldgenTileWorkerProvider | undefined): void {
    this.workerProvider = provider;
  }

  setPersistenceProvider(provider: WorldgenTilePersistenceProvider | undefined): void {
    this.persistenceProvider = provider;
  }

  sample(x: number, z: number): WorldgenTileSample {
    const tileX = Math.floor(x / WORLDGEN_TILE_SIZE);
    const tileZ = Math.floor(z / WORLDGEN_TILE_SIZE);
    const tile = this.getTile(tileX, tileZ, { reason: 'sample', priority: WORLDGEN_TILE_SAMPLE_PRIORITY });
    const stride = WORLDGEN_TILE_SIZE / (WORLDGEN_TILE_RESOLUTION - 1);
    const lx = (x - tile.originX) / stride;
    const lz = (z - tile.originZ) / stride;
    const nearest = sampleIndex(nearestIndex(lx), nearestIndex(lz));
    const nearestBase = nearest * FIELD_COUNT;
    const weights = normalizeBiomeWeights({
      meadow: clamp01(bilinear(tile, lx, lz, FIELD_BIOME_MEADOW)),
      riverValley: clamp01(bilinear(tile, lx, lz, FIELD_BIOME_RIVER_VALLEY)),
      alpineSnow: clamp01(bilinear(tile, lx, lz, FIELD_BIOME_ALPINE_SNOW)),
      exposedRidge: clamp01(bilinear(tile, lx, lz, FIELD_BIOME_EXPOSED_RIDGE)),
      forestEdge: clamp01(bilinear(tile, lx, lz, FIELD_BIOME_FOREST_EDGE)),
      drySlope: clamp01(bilinear(tile, lx, lz, FIELD_BIOME_DRY_SLOPE)),
    });
    const materials = normalizeMaterialWeights({
      grass: clamp01(bilinear(tile, lx, lz, FIELD_MATERIAL_GRASS)),
      rock: clamp01(bilinear(tile, lx, lz, FIELD_MATERIAL_ROCK)),
      snow: clamp01(bilinear(tile, lx, lz, FIELD_MATERIAL_SNOW)),
      mud: clamp01(bilinear(tile, lx, lz, FIELD_MATERIAL_MUD)),
    });
    return {
      tileX,
      tileZ,
      height: bilinear(tile, lx, lz, FIELD_HEIGHT),
      continent: bilinear(tile, lx, lz, FIELD_CONTINENT),
      moisture: clamp01(bilinear(tile, lx, lz, FIELD_MOISTURE)),
      temperature: clamp01(bilinear(tile, lx, lz, FIELD_TEMPERATURE)),
      drainage: clamp01(bilinear(tile, lx, lz, FIELD_DRAINAGE)),
      erosion: clamp01(bilinear(tile, lx, lz, FIELD_EROSION)),
      vegetation: clamp01(bilinear(tile, lx, lz, FIELD_VEGETATION)),
      biome: clamp01(bilinear(tile, lx, lz, FIELD_BIOME)),
      wetness: clamp01(bilinear(tile, lx, lz, FIELD_WETNESS)),
      snow: clamp01(bilinear(tile, lx, lz, FIELD_SNOW)),
      normalY: clamp01(bilinear(tile, lx, lz, FIELD_NORMAL_Y)),
      riverCenter: bilinear(tile, lx, lz, FIELD_RIVER_CENTER),
      material: bilinear(tile, lx, lz, FIELD_MATERIAL),
      biomeId: tile.biomeIds[nearest],
      waterId: tile.waterIds[nearest],
      riverNetworkId: tile.riverNetworkIds[nearest],
      flowX: bilinear(tile, lx, lz, FIELD_FLOW_X),
      flowZ: bilinear(tile, lx, lz, FIELD_FLOW_Z),
      flowAccumulation: clamp01(bilinear(tile, lx, lz, FIELD_FLOW_ACCUMULATION)),
      drainageBasinId: Math.round(tile.fields[nearestBase + FIELD_DRAINAGE_BASIN]),
      streamOrder: Math.round(tile.fields[nearestBase + FIELD_STREAM_ORDER]),
      channelWidth: Math.max(0, bilinear(tile, lx, lz, FIELD_CHANNEL_WIDTH)),
      streamPower: clamp01(bilinear(tile, lx, lz, FIELD_STREAM_POWER)),
      biomeWeights: weights,
      materialWeights: materials,
      surfaceCaveDistance: bilinear(tile, lx, lz, FIELD_CAVE_DISTANCE),
      caveInfluence: clamp01(bilinear(tile, lx, lz, FIELD_CAVE_INFLUENCE)),
    };
  }

  ensureTilesAround(x: number, z: number, radiusTiles = 1): number {
    const tileX = Math.floor(x / WORLDGEN_TILE_SIZE);
    const tileZ = Math.floor(z / WORLDGEN_TILE_SIZE);
    const radius = Math.max(0, Math.min(4, Math.floor(radiusTiles)));
    const prefetchKey = `${tileX},${tileZ},${radius}`;
    if (this.lastPrefetchKey === prefetchKey) return 0;
    this.lastPrefetchKey = prefetchKey;
    this.workerQueueCenterKey = tileKey(tileX, tileZ);
    this.dropStalePrefetchRequests(tileX, tileZ, radius + WORLDGEN_TILE_PREFETCH_KEEP_RADIUS);
    this.prefetchCenters++;
    const candidates: { dx: number; dz: number; distanceSq: number }[] = [];
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        candidates.push({ dx, dz, distanceSq: dx * dx + dz * dz });
      }
    }
    candidates.sort((a, b) => a.distanceSq - b.distanceSq || Math.abs(a.dx) + Math.abs(a.dz) - Math.abs(b.dx) - Math.abs(b.dz));
    let touched = 0;
    for (const candidate of candidates) {
      this.prefetchTile(tileX + candidate.dx, tileZ + candidate.dz, {
        reason: 'prefetch',
        priority: candidate.distanceSq,
      });
      touched++;
    }
    this.prefetchTiles += touched;
    return touched;
  }

  private prefetchTile(tileX: number, tileZ: number, request: WorldgenTileRequestOptions): void {
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

  stats(): WorldgenTileStats {
    const bestQueued = this.bestQueuedWorkerRequest();
    return {
      cachedTiles: this.tiles.size,
      maxTiles: this.maxTiles,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
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
      nativeTiles: [...this.tiles.values()].filter(tile => tile.source === 'native').length,
      persistedTiles: [...this.tiles.values()].filter(tile => tile.source === 'persisted').length,
      persistenceLoads: this.persistenceLoads,
      persistenceHits: this.persistenceHits,
      persistenceMisses: this.persistenceMisses,
      persistencePending: this.pendingPersistenceLoads.size,
      persistenceSaves: this.persistenceSaves,
      persistenceFailures: this.persistenceFailures,
      persistenceInvalidated: this.persistenceInvalidated,
      persistencePruned: this.persistencePruned,
      persistenceBytes: this.persistenceBytes,
      prefetchCenters: this.prefetchCenters,
      prefetchTiles: this.prefetchTiles,
      tileSize: WORLDGEN_TILE_SIZE,
      resolution: WORLDGEN_TILE_RESOLUTION,
      lastTileKey: this.lastTileKey,
    };
  }

  exportTilesAround(x: number, z: number, radiusTiles = 1): WorldgenTileExport {
    const tileX = Math.floor(x / WORLDGEN_TILE_SIZE);
    const tileZ = Math.floor(z / WORLDGEN_TILE_SIZE);
    const radius = Math.max(0, Math.min(4, Math.floor(radiusTiles)));
    const tiles: SerializedWorldgenTile[] = [];
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const tile = this.getTile(tileX + dx, tileZ + dz, {
          reason: 'export',
          priority: WORLDGEN_TILE_EXPORT_PRIORITY + dx * dx + dz * dz,
        });
        tiles.push({
          key: tile.key,
          tileX: tile.tileX,
          tileZ: tile.tileZ,
          originX: tile.originX,
          originZ: tile.originZ,
          fields: Array.from(tile.fields),
          biomeIds: Array.from(tile.biomeIds),
          waterIds: Array.from(tile.waterIds),
          riverNetworkIds: Array.from(tile.riverNetworkIds),
        });
      }
    }
    return {
      type: 'storm-canyon-worldgen-tiles',
      schemaVersion: 2,
      tileSchemaVersion: WORLDGEN_TILE_SCHEMA_VERSION,
      generatorVersion: WORLDGEN_TILE_GENERATOR_VERSION,
      capturedAt: Date.now(),
      center: { x, z, tileX, tileZ },
      radiusTiles: radius,
      tileSize: WORLDGEN_TILE_SIZE,
      resolution: WORLDGEN_TILE_RESOLUTION,
      fieldNames: WORLDGEN_TILE_FIELD_NAMES,
      stats: this.stats(),
      tiles,
    };
  }

  private getTile(
    tileX: number,
    tileZ: number,
    request: WorldgenTileRequestOptions = { reason: 'sample', priority: WORLDGEN_TILE_SAMPLE_PRIORITY },
  ): WorldgenTile {
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
    this.generatedSamples += WORLDGEN_TILE_RESOLUTION * WORLDGEN_TILE_RESOLUTION;
    this.evictIfNeeded();
    return tile;
  }

  private evictIfNeeded(): void {
    while (this.tiles.size > this.maxTiles) {
      let oldestKey: string | null = null;
      let oldestStamp = Number.POSITIVE_INFINITY;
      for (const [key, tile] of this.tiles) {
        if (tile.lastUsed < oldestStamp) {
          oldestStamp = tile.lastUsed;
          oldestKey = key;
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

  adoptWorkerTile(tile: SerializedWorldgenTile): boolean {
    const key = tile.key || tileKey(tile.tileX, tile.tileZ);
    this.pendingWorkerTiles.delete(key);
    this.queuedWorkerTiles.delete(key);
    this.missingPersistenceTiles.delete(key);
    this.workerResponses++;
    const expectedSamples = WORLDGEN_TILE_RESOLUTION * WORLDGEN_TILE_RESOLUTION;
    const expectedFields = expectedSamples * FIELD_COUNT;
    if (tile.fields.length !== expectedFields || tile.biomeIds.length !== expectedSamples || tile.waterIds.length !== expectedSamples || tile.riverNetworkIds.length !== expectedSamples) {
      return false;
    }
    const next: WorldgenTile = {
      key,
      tileX: tile.tileX,
      tileZ: tile.tileZ,
      originX: tile.originX,
      originZ: tile.originZ,
      fields: Float32Array.from(tile.fields),
      biomeIds: Uint8Array.from(tile.biomeIds),
      waterIds: Uint8Array.from(tile.waterIds),
      riverNetworkIds: Uint16Array.from(tile.riverNetworkIds),
      lastUsed: ++this.stamp,
      source: 'native',
    };
    this.tiles.set(key, next);
    this.workerAdoptedTiles++;
    this.workerBytes += next.fields.byteLength + next.biomeIds.byteLength + next.waterIds.byteLength + next.riverNetworkIds.byteLength;
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

  private adoptPersistedTile(tile: SerializedWorldgenTile): boolean {
    const key = tile.key || tileKey(tile.tileX, tile.tileZ);
    const existing = this.tiles.get(key);
    if (existing?.source === 'native') return false;
    const expectedSamples = WORLDGEN_TILE_RESOLUTION * WORLDGEN_TILE_RESOLUTION;
    const expectedFields = expectedSamples * FIELD_COUNT;
    if (tile.fields.length !== expectedFields || tile.biomeIds.length !== expectedSamples || tile.waterIds.length !== expectedSamples || tile.riverNetworkIds.length !== expectedSamples) {
      return false;
    }
    const next: WorldgenTile = {
      key,
      tileX: tile.tileX,
      tileZ: tile.tileZ,
      originX: tile.originX,
      originZ: tile.originZ,
      fields: Float32Array.from(tile.fields),
      biomeIds: Uint8Array.from(tile.biomeIds),
      waterIds: Uint8Array.from(tile.waterIds),
      riverNetworkIds: Uint16Array.from(tile.riverNetworkIds),
      lastUsed: existing?.lastUsed ?? ++this.stamp,
      source: 'persisted',
    };
    this.tiles.set(key, next);
    this.queuedWorkerTiles.delete(key);
    this.persistenceBytes += next.fields.byteLength + next.biomeIds.byteLength + next.waterIds.byteLength + next.riverNetworkIds.byteLength;
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

  private savePersistedTile(tile: SerializedWorldgenTile): void {
    if (!this.persistenceProvider) return;
    this.persistenceSaves++;
    this.persistenceProvider.saveTile(tile)
      .then(result => {
        this.persistencePruned += result && typeof result === 'object' ? result.pruned ?? 0 : 0;
      })
      .catch(() => {
        this.persistenceFailures++;
      });
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

  private requestWorkerTile(tileX: number, tileZ: number, key: string, request: WorldgenTileRequestOptions): void {
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

  private bestQueuedWorkerRequest(): QueuedWorldgenTileRequest | null {
    return this.bestQueuedWorkerEntry()?.[1] ?? null;
  }

  private bestQueuedWorkerEntry(): [string, QueuedWorldgenTileRequest] | null {
    let best: [string, QueuedWorldgenTileRequest] | null = null;
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

  private worstQueuedWorkerEntry(): [string, QueuedWorldgenTileRequest] | null {
    let worst: [string, QueuedWorldgenTileRequest] | null = null;
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
    while (this.queuedWorkerTiles.size > WORLDGEN_TILE_WORKER_QUEUE_LIMIT) {
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
}
