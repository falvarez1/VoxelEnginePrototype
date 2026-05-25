import {
  caveDistance,
  macroMoisture,
  macroTemperature,
  riverCenter,
  terrainHeight,
  valueNoise2,
} from './terrain_math.ts';

export const CAVE_GRAPH_TILE_SCHEMA_VERSION = 1;
export const CAVE_GRAPH_TILE_GENERATOR_VERSION = 1;
export const CAVE_GRAPH_GENERATOR_VERSION = CAVE_GRAPH_TILE_GENERATOR_VERSION;
export const CAVE_GRAPH_TILE_SIZE = 256;
export const CAVE_GRAPH_PASSAGE_FIELD_COUNT = 16;
export const CAVE_GRAPH_CHAMBER_FIELD_COUNT = 7;
const CAVE_GRAPH_TILE_WORKER_QUEUE_LIMIT = 96;
const CAVE_GRAPH_TILE_PREFETCH_KEEP_RADIUS = 2;
const CAVE_GRAPH_TILE_SAMPLE_PRIORITY = -2000;
const CAVE_GRAPH_TILE_EXPORT_PRIORITY = -1000;

export const CAVE_GRAPH_PASSAGE_FIELD_NAMES = [
  'kind',
  'idValue',
  'branchCell',
  'startX',
  'startY',
  'startZ',
  'endX',
  'endY',
  'endZ',
  'centerX',
  'centerY',
  'centerZ',
  'radius',
  'length',
  'chamberCell',
  'biomeHook',
] as const;

export const CAVE_GRAPH_CHAMBER_FIELD_NAMES = [
  'branchCell',
  'centerX',
  'centerY',
  'centerZ',
  'radius',
  'hasShaft',
  'biomeHook',
] as const;

export type CaveGraphBiomeHook = 'river-canyon' | 'wet-cavern' | 'cold-alpine' | 'dry-ridge';
export type CaveGraphPassageKind = 'trunk' | 'branch' | 'shaft';

export interface CaveGraphPassage {
  id: string;
  kind: CaveGraphPassageKind;
  branchCell: number | null;
  start: [number, number, number];
  end: [number, number, number];
  center: [number, number, number];
  radius: number;
  length: number;
  biomeHook: CaveGraphBiomeHook;
  chamberId: string | null;
}

export interface CaveGraphChamber {
  id: string;
  branchCell: number;
  center: [number, number, number];
  radius: number;
  hasShaft: boolean;
  biomeHook: CaveGraphBiomeHook;
}

export interface CaveGraphTileStats {
  cachedTiles: number;
  maxTiles: number;
  hits: number;
  misses: number;
  evictions: number;
  generatedTiles: number;
  nativeTiles: number;
  persistedTiles: number;
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
  prefetchCenters: number;
  prefetchTiles: number;
  passages: number;
  branches: number;
  chambers: number;
  shafts: number;
  tileSize: number;
  schemaVersion: number;
  generatorVersion: number;
  persistenceMode: 'memory-only' | 'indexeddb+memory';
  persistenceRecords: number;
  persistenceLoads: number;
  persistenceHits: number;
  persistenceMisses: number;
  persistencePending: number;
  persistenceSaves: number;
  persistenceFailures: number;
  persistenceInvalidated: number;
  persistencePruned: number;
  persistenceBytes: number;
  lastTileKey: string | null;
}

export interface CaveGraphProbe {
  tileX: number;
  tileZ: number;
  tileKey: string;
  signedDistance: number;
  nearestPassageId: string | null;
  nearestPassageKind: CaveGraphPassageKind | null;
  nearestPassageDistance: number;
  nearestChamberId: string | null;
  nearestChamberDistance: number;
  biomeHook: CaveGraphBiomeHook | null;
}

export type CaveGraphSample = CaveGraphProbe;

export interface SerializedCaveGraphTile {
  key: string;
  tileX: number;
  tileZ: number;
  originX: number;
  originZ: number;
  passages: CaveGraphPassage[];
  chambers: CaveGraphChamber[];
}

export interface CaveGraphTileExport {
  type: 'storm-canyon-cave-graph-tiles';
  schemaVersion: 1;
  tileSchemaVersion: typeof CAVE_GRAPH_TILE_SCHEMA_VERSION;
  generatorVersion: typeof CAVE_GRAPH_TILE_GENERATOR_VERSION;
  capturedAt: number;
  center: { x: number; z: number; tileX: number; tileZ: number };
  radiusTiles: number;
  tileSize: number;
  stats: CaveGraphTileStats;
  tiles: SerializedCaveGraphTile[];
}

export interface CaveGraphTilePersistenceLoadResult {
  tile: SerializedCaveGraphTile | null;
  invalidated?: boolean;
}

export interface CaveGraphTilePersistenceSaveResult {
  pruned?: number;
  records?: number;
}

export interface CaveGraphTilePersistenceProvider {
  loadTile(key: string, tileX: number, tileZ: number): Promise<CaveGraphTilePersistenceLoadResult>;
  saveTile(tile: SerializedCaveGraphTile): Promise<CaveGraphTilePersistenceSaveResult | void>;
}

export interface NativeCaveGraphTileBuffer {
  key?: string;
  tileX: number;
  tileZ: number;
  tileSize: number;
  schemaVersion: number;
  generatorVersion: number;
  passageFieldCount: number;
  chamberFieldCount: number;
  passageCount: number;
  chamberCount: number;
  passages: ArrayLike<number>;
  chambers: ArrayLike<number>;
}

export type CaveGraphTileWorkerProvider = (tileX: number, tileZ: number) => boolean;

type CaveGraphTileWorkerRequestReason = 'sample' | 'prefetch' | 'export';

interface CaveGraphTileRequestOptions {
  reason: CaveGraphTileWorkerRequestReason;
  priority: number;
}

interface QueuedCaveGraphTileRequest {
  tileX: number;
  tileZ: number;
  reason: CaveGraphTileWorkerRequestReason;
  priority: number;
  sequence: number;
}

interface CaveGraphTile {
  key: string;
  tileX: number;
  tileZ: number;
  originX: number;
  originZ: number;
  passages: CaveGraphPassage[];
  chambers: CaveGraphChamber[];
  lastUsed: number;
  source: 'generated' | 'native' | 'persisted';
}

interface BranchMetadata {
  cell: number;
  branchZ: number;
  side: number;
  branchCx: number;
  branchCy: number;
  branchRadius: number;
  branchCenter: [number, number, number];
  branchStart: [number, number, number];
  branchEnd: [number, number, number];
  end: [number, number, number];
  chamberRadius: number;
  hasShaft: boolean;
  shaftCenter: [number, number, number];
  shaftStart: [number, number, number];
  shaftEnd: [number, number, number];
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

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function pointAt(center: [number, number, number], direction: [number, number, number], distance: number): [number, number, number] {
  return [
    center[0] + direction[0] * distance,
    center[1] + direction[1] * distance,
    center[2] + direction[2] * distance,
  ];
}

function trunkPoint(z: number): { center: [number, number, number]; radius: number } {
  const x = riverCenter(z + 95.0) + (valueNoise2(z * 0.018, 101.1) * 2.0 - 1.0) * 14.0;
  const y = 1.5 + (valueNoise2(z * 0.020 + 13.0, 52.2) * 2.0 - 1.0) * 8.0;
  const radius = 5.0 + 3.0 * valueNoise2(z * 0.033 + 7.0, 33.7);
  return { center: [x, y, z], radius };
}

function branchMetadata(cell: number): BranchMetadata {
  const branchZ = cell * 128.0 + (valueNoise2(cell * 0.73, 12.0) * 2.0 - 1.0) * 18.0;
  const side = valueNoise2(cell * 1.17 + 5.0, 23.0) > 0.5 ? 1.0 : -1.0;
  const branchCx = riverCenter(branchZ + 95.0) + (valueNoise2(branchZ * 0.018, 101.1) * 2.0 - 1.0) * 14.0;
  const branchCy = 0.5 + (valueNoise2(branchZ * 0.020 + 13.0, 52.2) * 2.0 - 1.0) * 7.0;
  const branchRadius = 2.8 + 1.6 * valueNoise2(cell * 0.41 - 8.0, 19.0);
  const branchCenter: [number, number, number] = [branchCx + side * 38.0, branchCy, branchZ];
  const branchDirection = normalize3(side, 0.04, 0.16);
  const branchStart = pointAt(branchCenter, branchDirection, -48.0);
  const branchEnd = pointAt(branchCenter, branchDirection, 48.0);
  const end: [number, number, number] = [branchCx + side * 86.0, branchCy + 1.5, branchZ];
  const chamberRadius = 5.5 + 3.0 * valueNoise2(cell * 0.29, 31.0);
  const hasShaft = valueNoise2(cell * 0.19, 55.0) > 0.55;
  const shaftCenter: [number, number, number] = [end[0], end[1] + 9.0, end[2]];
  const shaftDirection = normalize3(0.10, 1.0, 0.05);
  const shaftStart = pointAt(shaftCenter, shaftDirection, -14.0);
  const shaftEnd = pointAt(shaftCenter, shaftDirection, 14.0);
  return {
    cell,
    branchZ,
    side,
    branchCx,
    branchCy,
    branchRadius,
    branchCenter,
    branchStart,
    branchEnd,
    end,
    chamberRadius,
    hasShaft,
    shaftCenter,
    shaftStart,
    shaftEnd,
  };
}

function cloneVec3(value: [number, number, number]): [number, number, number] {
  return [value[0], value[1], value[2]];
}

function biomeHookFor(x: number, y: number, z: number): CaveGraphBiomeHook {
  const moisture = macroMoisture(x, z);
  const temperature = macroTemperature(x, z);
  const height = terrainHeight(x, z);
  if (Math.abs(x - riverCenter(z)) < 28.0 && y < 8.0) return 'river-canyon';
  if (moisture > 0.58 && y < height - 10.0) return 'wet-cavern';
  if (temperature < 0.46 || height > 48.0) return 'cold-alpine';
  return 'dry-ridge';
}

const CAVE_GRAPH_PASSAGE_KINDS: readonly CaveGraphPassageKind[] = ['trunk', 'branch', 'shaft'];
const CAVE_GRAPH_BIOME_HOOKS: readonly CaveGraphBiomeHook[] = ['river-canyon', 'wet-cavern', 'cold-alpine', 'dry-ridge'];

function finiteField(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function roundedField(value: number): number | null {
  return Number.isFinite(value) ? Math.round(value) : null;
}

function passageId(kind: CaveGraphPassageKind, idValue: number): string {
  return `${kind}:${idValue}`;
}

function chamberId(cell: number): string {
  return `chamber:${cell}`;
}

export function serializedCaveGraphTileFromNativeBuffer(buffer: NativeCaveGraphTileBuffer): SerializedCaveGraphTile | null {
  if (
    buffer.schemaVersion !== CAVE_GRAPH_TILE_SCHEMA_VERSION
    || buffer.generatorVersion !== CAVE_GRAPH_TILE_GENERATOR_VERSION
    || buffer.tileSize !== CAVE_GRAPH_TILE_SIZE
    || buffer.passageFieldCount !== CAVE_GRAPH_PASSAGE_FIELD_COUNT
    || buffer.chamberFieldCount !== CAVE_GRAPH_CHAMBER_FIELD_COUNT
  ) {
    return null;
  }
  if (
    buffer.passageCount < 0
    || buffer.chamberCount < 0
    || buffer.passages.length !== buffer.passageCount * CAVE_GRAPH_PASSAGE_FIELD_COUNT
    || buffer.chambers.length !== buffer.chamberCount * CAVE_GRAPH_CHAMBER_FIELD_COUNT
  ) {
    return null;
  }

  const passages: CaveGraphPassage[] = [];
  for (let index = 0; index < buffer.passageCount; index++) {
    const base = index * CAVE_GRAPH_PASSAGE_FIELD_COUNT;
    const kind = CAVE_GRAPH_PASSAGE_KINDS[roundedField(buffer.passages[base + 0]) ?? -1];
    const idValue = roundedField(buffer.passages[base + 1]);
    const branchCellValue = roundedField(buffer.passages[base + 2]);
    const startX = finiteField(buffer.passages[base + 3]);
    const startY = finiteField(buffer.passages[base + 4]);
    const startZ = finiteField(buffer.passages[base + 5]);
    const endX = finiteField(buffer.passages[base + 6]);
    const endY = finiteField(buffer.passages[base + 7]);
    const endZ = finiteField(buffer.passages[base + 8]);
    const centerX = finiteField(buffer.passages[base + 9]);
    const centerY = finiteField(buffer.passages[base + 10]);
    const centerZ = finiteField(buffer.passages[base + 11]);
    const radius = finiteField(buffer.passages[base + 12]);
    const length = finiteField(buffer.passages[base + 13]);
    const chamberCell = roundedField(buffer.passages[base + 14]);
    const biomeHook = CAVE_GRAPH_BIOME_HOOKS[roundedField(buffer.passages[base + 15]) ?? -1];
    if (
      !kind
      || idValue === null
      || startX === null
      || startY === null
      || startZ === null
      || endX === null
      || endY === null
      || endZ === null
      || centerX === null
      || centerY === null
      || centerZ === null
      || radius === null
      || radius <= 0
      || length === null
      || length <= 0
      || (kind !== 'trunk' && branchCellValue === null)
      || (kind !== 'trunk' && chamberCell === null)
      || !biomeHook
    ) {
      return null;
    }
    passages.push({
      id: passageId(kind, idValue),
      kind,
      branchCell: kind === 'trunk' ? null : branchCellValue,
      start: [startX, startY, startZ],
      end: [endX, endY, endZ],
      center: [centerX, centerY, centerZ],
      radius,
      length,
      biomeHook,
      chamberId: kind === 'trunk' ? null : chamberId(chamberCell),
    });
  }

  const chambers: CaveGraphChamber[] = [];
  for (let index = 0; index < buffer.chamberCount; index++) {
    const base = index * CAVE_GRAPH_CHAMBER_FIELD_COUNT;
    const branchCell = roundedField(buffer.chambers[base + 0]);
    const centerX = finiteField(buffer.chambers[base + 1]);
    const centerY = finiteField(buffer.chambers[base + 2]);
    const centerZ = finiteField(buffer.chambers[base + 3]);
    const radius = finiteField(buffer.chambers[base + 4]);
    const hasShaft = roundedField(buffer.chambers[base + 5]);
    const biomeHook = CAVE_GRAPH_BIOME_HOOKS[roundedField(buffer.chambers[base + 6]) ?? -1];
    if (
      branchCell === null
      || centerX === null
      || centerY === null
      || centerZ === null
      || radius === null
      || radius <= 0
      || (hasShaft !== 0 && hasShaft !== 1)
      || !biomeHook
    ) {
      return null;
    }
    chambers.push({
      id: chamberId(branchCell),
      branchCell,
      center: [centerX, centerY, centerZ],
      radius,
      hasShaft: hasShaft === 1,
      biomeHook,
    });
  }

  return {
    key: buffer.key || tileKey(buffer.tileX, buffer.tileZ),
    tileX: buffer.tileX,
    tileZ: buffer.tileZ,
    originX: buffer.tileX * CAVE_GRAPH_TILE_SIZE,
    originZ: buffer.tileZ * CAVE_GRAPH_TILE_SIZE,
    passages,
    chambers,
  };
}

function segmentDistance(point: [number, number, number], start: [number, number, number], end: [number, number, number]): number {
  const vx = end[0] - start[0];
  const vy = end[1] - start[1];
  const vz = end[2] - start[2];
  const wx = point[0] - start[0];
  const wy = point[1] - start[1];
  const wz = point[2] - start[2];
  const denom = vx * vx + vy * vy + vz * vz || 1;
  const t = clamp01((wx * vx + wy * vy + wz * vz) / denom);
  return Math.hypot(point[0] - (start[0] + vx * t), point[1] - (start[1] + vy * t), point[2] - (start[2] + vz * t));
}

function segmentIntersectsTile(start: [number, number, number], end: [number, number, number], minX: number, maxX: number, minZ: number, maxZ: number, margin: number): boolean {
  const sx0 = Math.min(start[0], end[0]) - margin;
  const sx1 = Math.max(start[0], end[0]) + margin;
  const sz0 = Math.min(start[2], end[2]) - margin;
  const sz1 = Math.max(start[2], end[2]) + margin;
  return sx1 >= minX && sx0 <= maxX && sz1 >= minZ && sz0 <= maxZ;
}

function pointIntersectsTile(point: [number, number, number], radius: number, minX: number, maxX: number, minZ: number, maxZ: number): boolean {
  return point[0] + radius >= minX && point[0] - radius <= maxX && point[2] + radius >= minZ && point[2] - radius <= maxZ;
}

function makeTile(tileX: number, tileZ: number, stamp: number): CaveGraphTile {
  const originX = tileX * CAVE_GRAPH_TILE_SIZE;
  const originZ = tileZ * CAVE_GRAPH_TILE_SIZE;
  const minX = originX;
  const maxX = originX + CAVE_GRAPH_TILE_SIZE;
  const minZ = originZ;
  const maxZ = originZ + CAVE_GRAPH_TILE_SIZE;
  const margin = 48.0;
  const passages: CaveGraphPassage[] = [];
  const chambers: CaveGraphChamber[] = [];

  const trunkStartZ = Math.floor((minZ - margin) / 64.0) * 64.0;
  const trunkEndZ = maxZ + margin;
  for (let z = trunkStartZ; z <= trunkEndZ; z += 64.0) {
    const a = trunkPoint(z);
    const b = trunkPoint(z + 64.0);
    if (!segmentIntersectsTile(a.center, b.center, minX, maxX, minZ, maxZ, 12.0)) continue;
    const center: [number, number, number] = [
      (a.center[0] + b.center[0]) * 0.5,
      (a.center[1] + b.center[1]) * 0.5,
      (a.center[2] + b.center[2]) * 0.5,
    ];
    passages.push({
      id: `trunk:${Math.floor(z / 64.0)}`,
      kind: 'trunk',
      branchCell: null,
      start: a.center,
      end: b.center,
      center,
      radius: (a.radius + b.radius) * 0.5,
      length: 64.0,
      biomeHook: biomeHookFor(center[0], center[1], center[2]),
      chamberId: null,
    });
  }

  const branchStartCell = Math.floor((minZ - 192.0) / 128.0) - 1;
  const branchEndCell = Math.ceil((maxZ + 192.0) / 128.0) + 1;
  for (let cell = branchStartCell; cell <= branchEndCell; cell++) {
    const branch = branchMetadata(cell);
    const chamberId = `chamber:${cell}`;
    if (segmentIntersectsTile(branch.branchStart, branch.branchEnd, minX, maxX, minZ, maxZ, branch.branchRadius + 8.0)) {
      passages.push({
        id: `branch:${cell}`,
        kind: 'branch',
        branchCell: cell,
        start: branch.branchStart,
        end: branch.branchEnd,
        center: branch.branchCenter,
        radius: branch.branchRadius,
        length: 96.0,
        biomeHook: biomeHookFor(branch.branchCenter[0], branch.branchCenter[1], branch.branchCenter[2]),
        chamberId,
      });
    }
    if (pointIntersectsTile(branch.end, branch.chamberRadius + 8.0, minX, maxX, minZ, maxZ)) {
      chambers.push({
        id: chamberId,
        branchCell: cell,
        center: branch.end,
        radius: branch.chamberRadius,
        hasShaft: branch.hasShaft,
        biomeHook: biomeHookFor(branch.end[0], branch.end[1], branch.end[2]),
      });
    }
    if (branch.hasShaft && segmentIntersectsTile(branch.shaftStart, branch.shaftEnd, minX, maxX, minZ, maxZ, 8.0)) {
      passages.push({
        id: `shaft:${cell}`,
        kind: 'shaft',
        branchCell: cell,
        start: branch.shaftStart,
        end: branch.shaftEnd,
        center: branch.shaftCenter,
        radius: 2.2,
        length: 28.0,
        biomeHook: biomeHookFor(branch.shaftCenter[0], branch.shaftCenter[1], branch.shaftCenter[2]),
        chamberId,
      });
    }
  }

  return {
    key: tileKey(tileX, tileZ),
    tileX,
    tileZ,
    originX,
    originZ,
    passages,
    chambers,
    lastUsed: stamp,
    source: 'generated',
  };
}

function serializeTile(tile: CaveGraphTile): SerializedCaveGraphTile {
  return {
    key: tile.key,
    tileX: tile.tileX,
    tileZ: tile.tileZ,
    originX: tile.originX,
    originZ: tile.originZ,
    passages: tile.passages.map(passage => ({
      ...passage,
      start: cloneVec3(passage.start),
      end: cloneVec3(passage.end),
      center: cloneVec3(passage.center),
    })),
    chambers: tile.chambers.map(chamber => ({ ...chamber, center: cloneVec3(chamber.center) })),
  };
}

function serializedTileBytes(tile: SerializedCaveGraphTile): number {
  return JSON.stringify(tile).length;
}

export class CaveGraphTileCache {
  private readonly tiles = new Map<string, CaveGraphTile>();
  private readonly pendingWorkerTiles = new Set<string>();
  private readonly queuedWorkerTiles = new Map<string, QueuedCaveGraphTileRequest>();
  private readonly pendingPersistenceLoads = new Set<string>();
  private readonly missingPersistenceTiles = new Set<string>();
  private stamp = 0;
  private requestSequence = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private generatedTiles = 0;
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
  private persistenceRecords = 0;
  private persistenceBytes = 0;
  private prefetchCenters = 0;
  private prefetchTiles = 0;
  private lastPrefetchKey: string | null = null;
  private workerQueueCenterKey: string | null = null;
  private workerQueueLastDispatchedKey: string | null = null;
  private lastTileKey: string | null = null;

  constructor(
    private readonly maxTiles = 64,
    private workerProvider?: CaveGraphTileWorkerProvider,
    private persistenceProvider?: CaveGraphTilePersistenceProvider,
  ) {}

  setWorkerProvider(provider: CaveGraphTileWorkerProvider | undefined): void {
    this.workerProvider = provider;
  }

  setPersistenceProvider(provider: CaveGraphTilePersistenceProvider | undefined): void {
    this.persistenceProvider = provider;
  }

  ensureTilesAround(x: number, z: number, radiusTiles = 1): number {
    const tileX = Math.floor(x / CAVE_GRAPH_TILE_SIZE);
    const tileZ = Math.floor(z / CAVE_GRAPH_TILE_SIZE);
    const radius = Math.max(0, Math.min(4, Math.floor(radiusTiles)));
    const prefetchKey = `${tileX},${tileZ},${radius}`;
    if (this.lastPrefetchKey === prefetchKey) return 0;
    this.lastPrefetchKey = prefetchKey;
    this.workerQueueCenterKey = tileKey(tileX, tileZ);
    this.dropStalePrefetchRequests(tileX, tileZ, radius + CAVE_GRAPH_TILE_PREFETCH_KEEP_RADIUS);
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

  private prefetchTile(tileX: number, tileZ: number, request: CaveGraphTileRequestOptions): void {
    const key = tileKey(tileX, tileZ);
    const existing = this.tiles.get(key);
    if (existing) {
      if (existing.source === 'generated') {
        this.requestPersistedTile(tileX, tileZ, key);
        this.requestWorkerTile(tileX, tileZ, key, request);
      }
      return;
    }
    this.requestPersistedTile(tileX, tileZ, key);
    this.requestWorkerTile(tileX, tileZ, key, request);
  }

  sample(x: number, y: number, z: number): CaveGraphProbe {
    const tileX = Math.floor(x / CAVE_GRAPH_TILE_SIZE);
    const tileZ = Math.floor(z / CAVE_GRAPH_TILE_SIZE);
    const tile = this.getTile(tileX, tileZ, { reason: 'sample', priority: CAVE_GRAPH_TILE_SAMPLE_PRIORITY });
    const point: [number, number, number] = [x, y, z];
    let nearestPassage: CaveGraphPassage | null = null;
    let nearestPassageDistance = Number.POSITIVE_INFINITY;
    for (const passage of tile.passages) {
      const distance = segmentDistance(point, passage.start, passage.end) - passage.radius;
      if (distance < nearestPassageDistance) {
        nearestPassageDistance = distance;
        nearestPassage = passage;
      }
    }
    let nearestChamber: CaveGraphChamber | null = null;
    let nearestChamberDistance = Number.POSITIVE_INFINITY;
    for (const chamber of tile.chambers) {
      const distance = Math.hypot(x - chamber.center[0], y - chamber.center[1], z - chamber.center[2]) - chamber.radius;
      if (distance < nearestChamberDistance) {
        nearestChamberDistance = distance;
        nearestChamber = chamber;
      }
    }
    return {
      tileX,
      tileZ,
      tileKey: tile.key,
      signedDistance: caveDistance(x, y, z),
      nearestPassageId: nearestPassage?.id ?? null,
      nearestPassageKind: nearestPassage?.kind ?? null,
      nearestPassageDistance,
      nearestChamberId: nearestChamber?.id ?? null,
      nearestChamberDistance,
      biomeHook: nearestPassage?.biomeHook ?? nearestChamber?.biomeHook ?? null,
    };
  }

  stats(): CaveGraphTileStats {
    const tiles = [...this.tiles.values()];
    const bestQueued = this.bestQueuedWorkerRequest();
    const passages = tiles.reduce((sum, tile) => sum + tile.passages.length, 0);
    const branches = tiles.reduce((sum, tile) => sum + tile.passages.filter(passage => passage.kind === 'branch').length, 0);
    const shafts = tiles.reduce((sum, tile) => sum + tile.passages.filter(passage => passage.kind === 'shaft').length, 0);
    const chambers = tiles.reduce((sum, tile) => sum + tile.chambers.length, 0);
    return {
      cachedTiles: this.tiles.size,
      maxTiles: this.maxTiles,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      generatedTiles: this.generatedTiles,
      nativeTiles: tiles.filter(tile => tile.source === 'native').length,
      persistedTiles: tiles.filter(tile => tile.source === 'persisted').length,
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
      prefetchCenters: this.prefetchCenters,
      prefetchTiles: this.prefetchTiles,
      passages,
      branches,
      chambers,
      shafts,
      tileSize: CAVE_GRAPH_TILE_SIZE,
      schemaVersion: CAVE_GRAPH_TILE_SCHEMA_VERSION,
      generatorVersion: CAVE_GRAPH_TILE_GENERATOR_VERSION,
      persistenceMode: this.persistenceProvider ? 'indexeddb+memory' : 'memory-only',
      persistenceRecords: this.persistenceRecords,
      persistenceLoads: this.persistenceLoads,
      persistenceHits: this.persistenceHits,
      persistenceMisses: this.persistenceMisses,
      persistencePending: this.pendingPersistenceLoads.size,
      persistenceSaves: this.persistenceSaves,
      persistenceFailures: this.persistenceFailures,
      persistenceInvalidated: this.persistenceInvalidated,
      persistencePruned: this.persistencePruned,
      persistenceBytes: this.persistenceBytes,
      lastTileKey: this.lastTileKey,
    };
  }

  exportTilesAround(x: number, z: number, radiusTiles = 1): CaveGraphTileExport {
    const tileX = Math.floor(x / CAVE_GRAPH_TILE_SIZE);
    const tileZ = Math.floor(z / CAVE_GRAPH_TILE_SIZE);
    const radius = Math.max(0, Math.min(4, Math.floor(radiusTiles)));
    const tiles: SerializedCaveGraphTile[] = [];
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const tile = this.getTile(tileX + dx, tileZ + dz, {
          reason: 'export',
          priority: CAVE_GRAPH_TILE_EXPORT_PRIORITY + dx * dx + dz * dz,
        });
        tiles.push(serializeTile(tile));
      }
    }
    return {
      type: 'storm-canyon-cave-graph-tiles',
      schemaVersion: 1,
      tileSchemaVersion: CAVE_GRAPH_TILE_SCHEMA_VERSION,
      generatorVersion: CAVE_GRAPH_TILE_GENERATOR_VERSION,
      capturedAt: Date.now(),
      center: { x, z, tileX, tileZ },
      radiusTiles: radius,
      tileSize: CAVE_GRAPH_TILE_SIZE,
      stats: this.stats(),
      tiles,
    };
  }

  private getTile(
    tileX: number,
    tileZ: number,
    request: CaveGraphTileRequestOptions = { reason: 'sample', priority: CAVE_GRAPH_TILE_SAMPLE_PRIORITY },
  ): CaveGraphTile {
    const key = tileKey(tileX, tileZ);
    this.lastTileKey = key;
    const existing = this.tiles.get(key);
    if (existing) {
      existing.lastUsed = ++this.stamp;
      this.hits++;
      if (existing.source === 'generated') {
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
    this.evictIfNeeded();
    this.savePersistedTile(serializeTile(tile));
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
      this.pendingWorkerTiles.delete(oldestKey);
      this.pendingPersistenceLoads.delete(oldestKey);
      this.missingPersistenceTiles.delete(oldestKey);
      this.evictions++;
    }
  }

  adoptWorkerTile(tile: SerializedCaveGraphTile, byteLength = serializedTileBytes(tile)): boolean {
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
    this.workerBytes += byteLength;
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

  private adoptPersistedTile(tile: SerializedCaveGraphTile): boolean {
    const key = tile.key || tileKey(tile.tileX, tile.tileZ);
    const existing = this.tiles.get(key);
    if (existing?.source === 'native' || existing?.source === 'persisted') return false;
    const next = this.tileFromSerialized(tile, 'persisted', existing?.lastUsed);
    if (!next) return false;
    this.tiles.set(key, next);
    this.persistenceBytes += serializedTileBytes(tile);
    this.evictIfNeeded();
    return true;
  }

  private tileFromSerialized(tile: SerializedCaveGraphTile, source: CaveGraphTile['source'], lastUsed = ++this.stamp): CaveGraphTile | null {
    const key = tile.key || tileKey(tile.tileX, tile.tileZ);
    if (
      !Number.isFinite(tile.tileX)
      || !Number.isFinite(tile.tileZ)
      || tile.originX !== tile.tileX * CAVE_GRAPH_TILE_SIZE
      || tile.originZ !== tile.tileZ * CAVE_GRAPH_TILE_SIZE
    ) {
      return null;
    }
    return {
      key,
      tileX: tile.tileX,
      tileZ: tile.tileZ,
      originX: tile.originX,
      originZ: tile.originZ,
      passages: tile.passages.map(passage => ({
        ...passage,
        start: cloneVec3(passage.start),
        end: cloneVec3(passage.end),
        center: cloneVec3(passage.center),
      })),
      chambers: tile.chambers.map(chamber => ({ ...chamber, center: cloneVec3(chamber.center) })),
      lastUsed,
      source,
    };
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

  private savePersistedTile(tile: SerializedCaveGraphTile): void {
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

  private requestWorkerTile(tileX: number, tileZ: number, key: string, request: CaveGraphTileRequestOptions): void {
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

  private bestQueuedWorkerRequest(): QueuedCaveGraphTileRequest | null {
    return this.bestQueuedWorkerEntry()?.[1] ?? null;
  }

  private bestQueuedWorkerEntry(): [string, QueuedCaveGraphTileRequest] | null {
    let best: [string, QueuedCaveGraphTileRequest] | null = null;
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

  private worstQueuedWorkerEntry(): [string, QueuedCaveGraphTileRequest] | null {
    let worst: [string, QueuedCaveGraphTileRequest] | null = null;
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
    while (this.queuedWorkerTiles.size > CAVE_GRAPH_TILE_WORKER_QUEUE_LIMIT) {
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
