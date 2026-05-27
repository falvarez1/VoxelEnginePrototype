import { FlyCamera, add, scale, vec3, normalize } from './math.ts';
import { Renderer } from './renderer.ts';
import { EngineConsole } from './console.ts';
import { registerEngineConsoleCommands } from './console_commands.ts';
import { createSettingsPanel, type BrushInspectorBar, type BrushInspectorPanelState, type BrushPresetPanelState, type EditHistoryPanelItem, type RegionDiffPanelItem, type RegionDiffPanelState, type SettingsPanel } from './settings_panel.ts';
import { RuntimeProfiler } from './profiler.ts';
import { CompressedChunkCache, type PersistedChunkMesh } from './chunk_cache.ts';
import { RegionStore, releaseRegionSnapshotPayloads, type RegionChunkPayloadInfo, type RegionPayloadHashAudit, type RegionPayloadInspection, type RegionSlotInfo, type RegionSnapshot } from './region_store.ts';
import {
  REGION_BUNDLE_MIME_TYPE,
  decodeRegionBundle,
  decodeRegionSnapshot,
  encodeRegionBundle,
  encodeRegionSnapshotWithStats,
} from './region_file.ts';
import { createPayloadCompressionStats, type PayloadCompressionStats } from './chunk_codec.ts';
import { StormCanyonGame, type GameSnapshot } from './game.ts';
import {
  biomeMask,
  caveDistance,
  drainageMask,
  erosionMask,
  macroContinent,
  macroMoisture,
  macroTemperature,
  riverCenter,
  terrainHeight,
  terrainMaterial,
  terrainNormal,
  snowMask,
  vegetationMask,
  wetnessMask,
} from './terrain_math.ts';
import { WorldgenTileCache, type SerializedWorldgenTile, type WorldgenBiomeWeights, type WorldgenMaterialWeights, type WorldgenTileStats } from './worldgen_tiles.ts';
import {
  CaveGraphTileCache,
  serializedCaveGraphTileFromNativeBuffer,
  type CaveGraphBiomeHook,
  type CaveGraphPassageKind,
  type CaveGraphTileStats,
} from './cave_tiles.ts';
import { ErosionTileCache, type ErosionTileStats, type SerializedErosionTile } from './erosion_tiles.ts';
import {
  MaterialTileCache,
  serializedMaterialTileFromNativeBuffer,
  type MaterialTileSample,
  type MaterialTileStats,
  type SerializedMaterialTile,
} from './material_tiles.ts';
import { ErosionTileIndexedDbStore } from './erosion_tile_store.ts';
import { WorldgenTileIndexedDbStore } from './worldgen_tile_store.ts';
import { CaveGraphTileIndexedDbStore } from './cave_tile_store.ts';
import { MaterialTileIndexedDbStore } from './material_tile_store.ts';
import {
  buildTerrainLodTransitionCases,
  buildTerrainLodTransitionMesh,
  chunkRangeDistance,
  lodSpan,
  parseTerrainChunkKey as parseKey,
  planTerrainLodRequests,
  sampleTerrainLodTransitionGeometryPosition,
  summarizeTerrainLodPlan,
  terrainChunkKey as keyOf,
  type TerrainLodPlanSummary,
  type TerrainLodRequest,
  type TerrainLodTransitionCellCase,
  type TerrainLodTransitionSamplePoint,
  type TerrainLodTransitionSide,
  type TerrainLodTransitionMesh,
} from './terrain_lod.ts';
import {
  FLOAT_TERRAIN_VERTEX_FLOATS,
  boundsFromFloatTerrainVertices,
  packFloatTerrainVertices,
  packFrameFromFloatTerrainVertices,
} from './terrain_mesh.ts';
import type {
  BrowserWorkerBenchmarkSummary,
  BrushShape,
  ChunkJob,
  ChunkMessage,
  ChunkState,
  CaveGraphTileMessage,
  DensitySliceSnapshot,
  ErosionTileMessage,
  EditHistoryBranch,
  EditOperation,
  EngineSettings,
  LodTransitionMeshMessage,
  MaterialTileMessage,
  RegionDiffSummary,
  RegionEditBranchDiffSample,
  RegionEditDiffSample,
  RegionChangedEditDiffSample,
  RuntimeCapabilities,
  RuntimeProfile,
  StreamerCounts,
  StreamerStats,
  WorkerOutboundMessage,
  WorkerScratchStats,
  WorldgenTileMessage,
} from './engine_contracts';
import type { Vec3 } from './math.ts';

type ChunkRequest = Omit<ChunkJob, 'version' | 'editVersion'>;
type SharedGenerateQueue = {
  buffer: SharedArrayBuffer;
  ints: Int32Array;
  sequence: number;
};
type SharedRemeshPage = {
  buffer: SharedArrayBuffer;
  densitySamples: Int16Array;
};
type SharedResultArena = {
  buffer: SharedArrayBuffer;
  bytes: Uint8Array;
  slots: SharedResultSlot[];
};
type SharedResultSlot = {
  index: number;
  generation: number;
  state: 'free' | 'pending' | 'cached';
  key?: string;
};
type ChunkWorker = Worker & {
  currentJobs?: ChunkJob[];
  pendingJobsRemaining?: number;
  currentWorldgenTileKey?: string;
  currentErosionTileKey?: string;
  currentMaterialTileKey?: string;
  currentCaveGraphTileKey?: string;
  currentLodTransitionMeshSignature?: string;
  scratchStats?: WorkerScratchStats;
  sharedGenerateQueue?: SharedGenerateQueue;
  sharedRemeshPage?: SharedRemeshPage;
  sharedResultArena?: SharedResultArena;
};
type RegionBrowserAction = 'load' | 'diff' | 'export' | 'inspect' | 'comparePayload' | 'verifyPayload' | 'clear' | 'refresh' | 'exportBundle' | 'importBundle' | 'exportMaintenanceReport' | 'pruneOldest' | 'dryRunRetention' | 'applyRetention';
type RegionRetentionPolicyId = 'custom' | 'compact' | 'standard' | 'archive';

interface ChunkCachePayload {
  vertices: Uint8Array;
  indices: Uint32Array;
  densitySamples: Int16Array;
  vegetation: Float32Array;
  copiedBytes: number;
  borrowedBytes: number;
  ownsArrays: boolean;
  onRelease?: () => void;
}

interface PendingChunkResult {
  worker: ChunkWorker;
  msg: ChunkMessage;
}

interface DensitySliceCapture extends DensitySliceSnapshot {
  capturedAt: number;
}

interface StoredDensitySliceCapture extends Omit<DensitySliceCapture, 'values'> {
  values: number[];
}

interface SerializedDensitySliceSnapshot extends Omit<DensitySliceSnapshot, 'values'> {
  values: number[];
}

interface DensityCaptureSet {
  id: string;
  name: string;
  captures: DensitySliceCapture[];
  selectedIndex: number;
  createdAt: number;
  updatedAt: number;
}

interface StoredDensityCaptureSet {
  id?: string;
  name?: string;
  captures?: StoredDensitySliceCapture[];
  selectedIndex?: number;
  createdAt?: number;
  updatedAt?: number;
}

interface DensityCaptureLibrary {
  sets: DensityCaptureSet[];
  selectedSetIndex: number;
}

interface StoredDensityCaptureLibrary {
  sets?: StoredDensityCaptureSet[];
  selectedSetIndex?: number;
  captures?: StoredDensitySliceCapture[];
  selectedIndex?: number;
  name?: string;
}

interface DensitySliceDiffSummary {
  status: 'compared' | 'missing-current' | 'missing-capture' | 'incompatible';
  comparedAt: number;
  currentKey: string;
  captureKey: string;
  cells: number;
  changedCells: number;
  meanAbsMeters: number;
  maxAbsMeters: number;
}

interface RegionImportPreview {
  fileName: string;
  fileSize: number;
  decodedAt: number;
  snapshot: RegionSnapshot;
  diff: RegionDiffSummary;
}

interface RegionMergeResult {
  mode: 'chunks' | 'edits';
  consumedPayloads: boolean;
  importedChunks: number;
  importedEdits: number;
}

interface RegionBrowserState {
  filter: string;
  savedOnly: boolean;
  retentionPolicyId: RegionRetentionPolicyId;
  retentionMaxSlots: number;
  retentionMaxMB: number;
  payloadFilter: string;
}

interface RegionPayloadComparisonEndpoint {
  key: string;
  name: string;
  savedAt: number;
  chunkCount: number;
  editCount: number;
  rawBytes: number;
  encodedBytes: number;
  savedBytes: number;
}

interface RegionPayloadChunkDelta {
  key: string;
  state: 'common' | 'baseline-only' | 'compared-only';
  baselineRawBytes: number;
  comparedRawBytes: number;
  rawByteDelta: number;
  baselineEncodedBytes: number;
  comparedEncodedBytes: number;
  encodedByteDelta: number;
  baselineCodecs: string;
  comparedCodecs: string;
  codecChanged: boolean;
}

interface RegionPayloadComparison {
  comparedAt: number;
  baseline: RegionPayloadComparisonEndpoint;
  compared: RegionPayloadComparisonEndpoint;
  commonChunks: number;
  matchingCommonChunks: number;
  changedCommonChunks: number;
  baselineOnlyChunks: number;
  comparedOnlyChunks: number;
  smallerChunks: number;
  largerChunks: number;
  codecChangedChunks: number;
  rawByteDelta: number;
  encodedByteDelta: number;
  savedByteDelta: number;
  largestDeltas: RegionPayloadChunkDelta[];
}

type AutoQualityPressure = 'manual' | 'warming' | 'steady' | 'constrained' | 'headroom';

interface AutoQualityState {
  enabled: boolean;
  level: number;
  pressure: AutoQualityPressure;
  reason: string;
  startedAt: number;
  lastAdjustmentAt: number;
  adjustments: number;
  slowFrames: number;
  fastFrames: number;
  captures: QualityRuntimeCapture[];
}

interface QualityRuntimeCapture {
  capturedAt: number;
  label: string;
  settings: EngineSettings;
  autoQuality: Omit<AutoQualityState, 'captures'> & { captureCount: number; levelName: string };
  browserWorkerBenchmark?: BrowserWorkerBenchmarkCapture | null;
  worldgen: WorldgenSnapshot;
  frame: {
    samples: number;
    lastMs: number;
    avgMs: number;
    p95Ms: number;
    targetMs: number;
  };
  renderer: RuntimeProfile & {
    drawCalls: number;
    terrainTriangles: number;
    visibleTerrainChunks: number;
    culledTerrainChunks: number;
    visibleTerrainClusters: number;
    culledTerrainClusters: number;
    terrainClusterDrawCalls: number;
    terrainClusterDrawsSkipped: number;
    hiZOcclusionTestedClusters: number;
    hiZOcclusionCulledClusters: number;
    hiZOcclusionTestedBatches: number;
    hiZOcclusionCulledBatches: number;
    vegetationLodCulledInstances: number;
    vegetationDrawCalls: number;
    visibleVegetationPatches: number;
    culledVegetationPatches: number;
  };
  streamer: StreamerStats & StreamerCounts;
  capabilities: RuntimeCapabilities;
}

interface WorldgenProbe {
  label: string;
  x: number;
  y: number;
  z: number;
  height: number;
  riverCenter: number;
  riverDistance: number;
  normalY: number;
  continent: number;
  moisture: number;
  temperature: number;
  drainage: number;
  erosion: number;
  vegetation: number;
  biome: number;
  wetness: number;
  snow: number;
  caveDistance: number;
  surfaceCaveDistance: number;
  caveInfluence: number;
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
  erosionTile: {
    thermal: number;
    hydraulic: number;
    deposition: number;
    sediment: number;
    bedrock: number;
    soil: number;
    retention: number;
  };
  materialField: MaterialTileSample;
  biomeWeights: WorldgenBiomeWeights;
  materialWeights: WorldgenMaterialWeights;
  tileX: number;
  tileZ: number;
  caveGraphTileKey: string;
  caveGraphPassageId: string | null;
  caveGraphPassageKind: CaveGraphPassageKind | null;
  caveGraphPassageDistance: number;
  caveGraphChamberId: string | null;
  caveGraphChamberDistance: number;
  caveGraphBiomeHook: CaveGraphBiomeHook | null;
}

interface WorldgenSnapshot {
  camera: WorldgenProbe;
  brush: WorldgenProbe;
  tileStats: WorldgenTileStats;
  caveGraphStats: CaveGraphTileStats;
  erosionTileStats: ErosionTileStats;
  materialTileStats: MaterialTileStats;
}

interface BrowserWorkerBenchmarkTrend {
  comparedToCapturedAt: number;
  generateDeltaPct: number;
  cachedRemeshDeltaPct: number;
  editRemeshDeltaPct: number;
  overallDeltaPct: number;
  direction: 'faster' | 'similar' | 'slower';
}

interface BrowserWorkerBenchmarkCapture {
  capturedAt: number;
  benchmarkId: string;
  settings: EngineSettings;
  autoQuality: Omit<AutoQualityState, 'captures'> & { captureCount: number; levelName: string };
  capabilities: RuntimeCapabilities;
  result: BrowserWorkerBenchmarkSummary;
  trend: BrowserWorkerBenchmarkTrend | null;
}

interface RegionRetentionPolicy {
  id: Exclude<RegionRetentionPolicyId, 'custom'>;
  label: string;
  maxSlots: number;
  maxMB: number;
}

interface RegionRetentionPlan {
  policyId: RegionRetentionPolicyId;
  policyLabel: string;
  maxSlots: number;
  maxEncodedBytes: number;
  beforeSlots: number;
  beforeEncodedBytes: number;
  afterSlots: number;
  afterEncodedBytes: number;
  pruned: RegionSlotInfo[];
}

interface RegionMaintenanceEvent {
  id: number;
  at: number;
  action: string;
  summary: string;
}

interface InputOptions {
  setStreamRadius?: (radius: number) => void;
  getBrushOptions?: () => BrushOptions;
}

interface MovementTestConfig {
  keyCodes: string[];
  delayMs: number;
  durationMs: number;
}

interface FrameProbeSample {
  t: number;
  total: number;
  sections: Record<string, number>;
}

interface FrameProbeState {
  samples: FrameProbeSample[];
  maxBySection: Record<string, number>;
}

interface BrushOptions {
  radius: number;
  distance: number;
  type: EditOperation['type'];
  shape: BrushShape;
  direction: Vec3;
  length: number;
  falloff: number;
  material: number;
  strength: number;
}

type BrushPresetSettings = Pick<
  EngineSettings,
  | 'brushMode'
  | 'brushShape'
  | 'editRadius'
  | 'brushDistance'
  | 'brushLength'
  | 'brushFalloff'
  | 'brushPreviewEnabled'
  | 'paintMaterial'
  | 'brushStrength'
>;

interface BrushPreset {
  id: string;
  name: string;
  settings: BrushPresetSettings;
  createdAt: number;
  updatedAt: number;
}

const CHUNK_WORLD_SIZE = 32; // must match native/voxel_core.c: 32 cells * 1m
const MIN_STREAM_RADIUS = 3;
const MAX_STREAM_RADIUS = 20;
const FALLBACK_STREAM_RADIUS = 7;
const DEFAULT_STREAM_RADIUS = readInitialStreamRadius();
const ALTITUDE_BOOST_START = 96;
const ALTITUDE_BOOST_CHUNK_STEP = 64;
const VIEW_FOCUS_STREAM_MIN_ALTITUDE = 112;
const VIEW_FOCUS_STREAM_TARGET_Y = 18;
const VERTICAL_CHUNKS = [-1, 0, 1, 2];
const MAX_QUEUE = 7200;
const MAX_NEW_CHUNK_REQUESTS_PER_FRAME = 96;
const EVICT_HYSTERESIS_CHUNKS = 2.5;
const MAX_EDIT_OPERATIONS = 512;
const MAX_EDIT_BRANCHES = 12;
const MAX_REGION_EDIT_DIFF_SAMPLES = 6;
const DENSITY_GRID_N = 33;
const SHARED_REMESH_DENSITY_SAMPLES = DENSITY_GRID_N * DENSITY_GRID_N * DENSITY_GRID_N;
const DENSITY_SCALE = 256;
const DENSITY_CAPTURE_STORAGE_KEY = 'stormCanyon.densityCapture.v1';
const DENSITY_CAPTURE_LIBRARY_STORAGE_KEY = 'stormCanyon.densityCaptures.v1';
const MAX_DENSITY_CAPTURES = 16;
const MAX_DENSITY_CAPTURE_SETS = 8;
const DEBUG_VIEW_DENSITY_SLICE = 5;
const DEBUG_VIEW_DIRTY_REGIONS = 6;
const DEBUG_VIEW_MATERIAL_MASKS = 7;
const DEBUG_VIEW_SNOW_MASK = 10;
const DENSITY_AXIS_X = 0;
const DENSITY_AXIS_Y = 1;
const DENSITY_AXIS_Z = 2;
const DIAGNOSTIC_UI_UPDATE_INTERVAL_MS = 250;
const DIAGNOSTIC_CAMERA_MOVE_EPSILON = 0.025;
const DIAGNOSTIC_CAMERA_MOVING_SECONDS = 0.45;
const QUALITY_PRESET_LOW = 0;
const QUALITY_PRESET_BALANCED = 1;
const QUALITY_PRESET_HIGH = 2;
const QUALITY_PRESET_ULTRA = 3;
const QUALITY_PRESET_AUTO = 4;
const AUTO_QUALITY_TARGET_FRAME_MS = 16.7;
const AUTO_QUALITY_SLOW_FRAME_MS = 23;
const AUTO_QUALITY_FAST_FRAME_MS = 12.5;
const AUTO_QUALITY_WARMUP_MS = 5000;
const AUTO_QUALITY_COOLDOWN_MS = 8000;
const AUTO_QUALITY_SLOW_FRAMES = 90;
const AUTO_QUALITY_FAST_FRAMES = 240;
const MAX_QUALITY_CAPTURES = 8;
const BRUSH_MODE_CARVE = 0;
const BRUSH_MODE_BUILD = 1;
const BRUSH_MODE_PAINT = 2;
const BRUSH_MODE_SMOOTH = 3;
const BRUSH_MODE_FLATTEN = 4;
const BRUSH_SHAPE_SPHERE = 0;
const BRUSH_SHAPE_BOX = 1;
const BRUSH_SHAPE_CAPSULE = 2;
const PAINT_MATERIAL_GRASS = 0;
const PAINT_MATERIAL_ROCK = 1;
const PAINT_MATERIAL_SNOW = 2;
const PAINT_MATERIAL_MUD = 3;
const REGION_SLOTS = [
  { key: 'default', name: 'Region A' },
  { key: 'region-b', name: 'Region B' },
  { key: 'region-c', name: 'Region C' },
  { key: 'region-d', name: 'Region D' },
] as const;
const REGION_RETENTION_POLICIES: RegionRetentionPolicy[] = [
  { id: 'compact', label: 'Compact', maxSlots: 2, maxMB: 128 },
  { id: 'standard', label: 'Standard', maxSlots: REGION_SLOTS.length, maxMB: 256 },
  { id: 'archive', label: 'Archive', maxSlots: REGION_SLOTS.length, maxMB: 1024 },
];
const MAX_CHUNK_RESULT_ADOPTIONS_PER_FRAME = 2;
const MAX_CHUNK_RESULT_ADOPTION_MS_PER_FRAME = 4.0;
const MAX_MOVING_CHUNK_RESULT_ADOPTIONS_PER_FRAME = 1;
const MAX_MOVING_CHUNK_RESULT_ADOPTION_MS_PER_FRAME = 1.5;
const STREAMING_CAMERA_MOVE_EPSILON = 0.025;
const STREAMING_CAMERA_MOVING_SECONDS = 0.22;
const SHARED_GENERATE_BATCH_SIZE = 4;
const SHARED_GENERATE_HEADER_INTS = 4;
const SHARED_GENERATE_JOB_INTS = 10;
const SHARED_GENERATE_QUEUE_INTS = SHARED_GENERATE_HEADER_INTS + SHARED_GENERATE_BATCH_SIZE * SHARED_GENERATE_JOB_INTS;
const SHARED_GENERATE_STATUS = 0;
const SHARED_GENERATE_COUNT = 1;
const SHARED_GENERATE_SEQUENCE = 2;
const SHARED_GENERATE_JOB_BASE = 4;
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
const SHARED_RESULT_ARENA_BYTES = 12 * 1024 * 1024;
const SHARED_RESULT_SLOT_COUNT = 64;
const LOD_TRANSITION_MESH_KEY = '__runtime_lod_transition_mesh__';

function chunkCoord(v: number): number { return Math.floor(v / CHUNK_WORLD_SIZE); }
function clampInt(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v | 0)); }
function readInitialStreamRadius(): number {
  const params = new URLSearchParams(window.location.search);
  let savedRadius = null;
  try {
    savedRadius = localStorage.getItem('stormCanyon.streamRadius');
  } catch {
    savedRadius = null;
  }
  const raw = params.get('radius') ?? params.get('r') ?? savedRadius ?? String(FALLBACK_STREAM_RADIUS);
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? clampInt(parsed, MIN_STREAM_RADIUS, MAX_STREAM_RADIUS) : FALLBACK_STREAM_RADIUS;
}

const ENGINE_SETTINGS_STORAGE_KEY = 'stormCanyon.engineSettings.v20';
const BRUSH_PRESET_STORAGE_KEY = 'stormCanyon.brushPresets.v1';
const BROWSER_WORKER_BENCHMARK_STORAGE_KEY = 'stormCanyon.browserWorkerBenchmarks.v1';
const REGION_SLOT_NAMES_STORAGE_KEY = 'stormCanyon.regionSlotNames.v1';
const REGION_BROWSER_STATE_STORAGE_KEY = 'stormCanyon.regionBrowserState.v1';
const REGION_MAINTENANCE_HISTORY_STORAGE_KEY = 'stormCanyon.regionMaintenanceHistory.v1';
const MAX_BRUSH_PRESETS = 12;
const MAX_REGION_MAINTENANCE_EVENTS = 12;
const MAX_BROWSER_WORKER_BENCHMARK_CAPTURES = 8;
const BROWSER_WORKER_BENCHMARK_TIMEOUT_MS = 30000;
const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  streamRadius: DEFAULT_STREAM_RADIUS,
  streamingEnabled: true,
  terrainLodEnabled: false,
  nearTerrainEnabled: true,
  farTerrainEnabled: true,
  waterEnabled: true,
  vegetationEnabled: true,
  gameMarkersEnabled: false,
  overlayPanelVisible: true,
  settingsPanelVisible: true,
  densityPanelVisible: true,
  regionBrowserPanelVisible: true,
  qualityPreset: QUALITY_PRESET_BALANCED,
  fogDensity: 0.42,
  materialDetail: 0.68,
  exposure: 1.54,
  atmosphereStrength: 1.10,
  skyEnabled: true,
  cinematicLighting: true,
  debugView: 0,
  waterOpacity: 0.93,
  animationSpeed: 1,
  cameraSpeed: 38,
  fastMultiplier: 3,
  fov: 54,
  editRadius: 9,
  brushDistance: 34,
  brushMode: BRUSH_MODE_CARVE,
  brushShape: BRUSH_SHAPE_SPHERE,
  brushLength: 18,
  brushFalloff: 0.75,
  brushPreviewEnabled: false,
  paintMaterial: PAINT_MATERIAL_ROCK,
  brushStrength: 0.55,
  regionSlot: 0,
  densitySliceAxis: DENSITY_AXIS_Y,
  densitySliceIndex: Math.floor(DENSITY_GRID_N / 2),
  densitySliceFollowCamera: true,
  sunAzimuth: 250,
  sunElevation: 8,
};

const worldgenTileCache = new WorldgenTileCache();
const caveGraphTileCache = new CaveGraphTileCache();
const erosionTileCache = new ErosionTileCache();
const materialTileCache = new MaterialTileCache({
  worldgen: (x, z) => worldgenTileCache.sample(x, z),
  erosion: (x, z) => erosionTileCache.sample(x, z),
  cave: (x, y, z) => caveGraphTileCache.sample(x, y, z),
});

function clampNumber(value: unknown, lo: number, hi: number, fallback = lo): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function nativeLodTransitionSideId(side: TerrainLodTransitionSide): number {
  if (side === 'negX') return 0;
  if (side === 'posX') return 1;
  if (side === 'negZ') return 2;
  return 3;
}

function transitionCaseSample(
  transitionCase: TerrainLodTransitionCellCase,
  role: 'coarseFace' | 'neighborCell',
  corner: number,
): TerrainLodTransitionCellCase['samples'][number] | null {
  return transitionCase.samples.find(sample => sample.role === role && sample.corner === corner) ?? null;
}

function buildNativeLodTransitionMeshPayload(cases: readonly TerrainLodTransitionCellCase[]): {
  cellCount: number;
  missingSampleCells: number;
  sides: Uint8Array;
  combinedCases: Uint32Array;
  samples: Float32Array;
} | null {
  const candidates = cases.filter(transitionCase => transitionCase.missingSamples === 0 && transitionCase.crossesSurface);
  if (candidates.length <= 0) return null;
  const sampleCount = 12;
  const floatsPerSample = 4;
  const sides = new Uint8Array(candidates.length);
  const combinedCases = new Uint32Array(candidates.length);
  const samples = new Float32Array(candidates.length * sampleCount * floatsPerSample);
  let writeCell = 0;
  let cursor = 0;
  for (const transitionCase of candidates) {
    const ordered: Array<TerrainLodTransitionCellCase['samples'][number]> = [];
    for (let corner = 0; corner < 4; corner++) {
      const sample = transitionCaseSample(transitionCase, 'coarseFace', corner);
      if (!sample || sample.density === null) break;
      ordered.push(sample);
    }
    if (ordered.length === 4) {
      for (let corner = 0; corner < 8; corner++) {
        const sample = transitionCaseSample(transitionCase, 'neighborCell', corner);
        if (!sample || sample.density === null) break;
        ordered.push(sample);
      }
    }
    if (ordered.length !== sampleCount) continue;
    sides[writeCell] = nativeLodTransitionSideId(transitionCase.side);
    combinedCases[writeCell] = transitionCase.combinedCase >>> 0;
    for (const sample of ordered) {
      const [x, y, z] = sampleTerrainLodTransitionGeometryPosition(sample, transitionCase.side);
      samples[cursor++] = x;
      samples[cursor++] = y;
      samples[cursor++] = z;
      samples[cursor++] = sample.density ?? 0;
    }
    writeCell++;
  }
  if (writeCell <= 0) return null;
  return {
    cellCount: cases.length,
    missingSampleCells: cases.filter(transitionCase => transitionCase.missingSamples > 0).length,
    sides: sides.subarray(0, writeCell),
    combinedCases: combinedCases.subarray(0, writeCell),
    samples: samples.subarray(0, writeCell * sampleCount * floatsPerSample),
  };
}

function buildPackedRuntimeLodTransitionMesh(mesh: TerrainLodTransitionMesh): {
  vertices: Uint8Array;
  indices: Uint32Array;
  frame: ReturnType<typeof packFrameFromFloatTerrainVertices>;
  bounds: ReturnType<typeof boundsFromFloatTerrainVertices>;
} | null {
  const vertexCount = mesh.vertices.length;
  if (vertexCount <= 0 || mesh.indices.length < 3) return null;

  const normals = new Float32Array(vertexCount * 3);
  for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
    const ia = mesh.indices[i];
    const ib = mesh.indices[i + 1];
    const ic = mesh.indices[i + 2];
    if (ia >= vertexCount || ib >= vertexCount || ic >= vertexCount) continue;
    const a = mesh.vertices[ia];
    const b = mesh.vertices[ib];
    const c = mesh.vertices[ic];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const acx = c.x - a.x;
    const acy = c.y - a.y;
    const acz = c.z - a.z;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    normals[ia * 3 + 0] += nx; normals[ia * 3 + 1] += ny; normals[ia * 3 + 2] += nz;
    normals[ib * 3 + 0] += nx; normals[ib * 3 + 1] += ny; normals[ib * 3 + 2] += nz;
    normals[ic * 3 + 0] += nx; normals[ic * 3 + 1] += ny; normals[ic * 3 + 2] += nz;
  }

  const floatVertices = new Float32Array(vertexCount * FLOAT_TERRAIN_VERTEX_FLOATS);
  for (let i = 0; i < vertexCount; i++) {
    const vertex = mesh.vertices[i];
    let nx = normals[i * 3 + 0];
    let ny = normals[i * 3 + 1];
    let nz = normals[i * 3 + 2];
    const len = Math.hypot(nx, ny, nz);
    if (len > 0.00001) {
      nx /= len; ny /= len; nz /= len;
    } else {
      const fallback = terrainNormal(vertex.x, vertex.z, 4);
      nx = fallback[0]; ny = fallback[1]; nz = fallback[2];
    }
    const material = terrainMaterial(vertex.x, vertex.y, vertex.z, ny);
    const ao = clampNumber(0.42 + 0.58 * (ny * 0.5 + 0.5), 0.22, 1, 0.75);
    const offset = i * FLOAT_TERRAIN_VERTEX_FLOATS;
    floatVertices[offset + 0] = vertex.x;
    floatVertices[offset + 1] = vertex.y;
    floatVertices[offset + 2] = vertex.z;
    floatVertices[offset + 3] = nx;
    floatVertices[offset + 4] = ny;
    floatVertices[offset + 5] = nz;
    floatVertices[offset + 6] = material;
    floatVertices[offset + 7] = ao;
  }

  const frame = packFrameFromFloatTerrainVertices(floatVertices);
  const packedVertices = packFloatTerrainVertices(floatVertices, frame, (x, y, z, _nx, ny) => {
    const h = terrainHeight(x, z);
    return {
      biome: biomeMask(x, z, h, ny),
      wetness: wetnessMask(x, y, z, ny, h),
      snow: snowMask(x, y, z, ny, h),
    };
  });
  return {
    vertices: packedVertices,
    indices: new Uint32Array(mesh.indices),
    frame,
    bounds: boundsFromFloatTerrainVertices(floatVertices),
  };
}

function readSavedEngineSettings(): Partial<EngineSettings> {
  try {
    const raw = localStorage.getItem(ENGINE_SETTINGS_STORAGE_KEY);
    return raw ? JSON.parse(raw) as Partial<EngineSettings> : {};
  } catch {
    return {};
  }
}

function readBooleanUrlOverride(...names: string[]): boolean | null {
  const params = new URLSearchParams(window.location.search);
  for (const name of names) {
    if (!params.has(name)) continue;
    const raw = (params.get(name) ?? '').toLowerCase();
    if (raw === '' || raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  }
  return null;
}

function parseBooleanLike(value: string | null | undefined): boolean | null {
  if (value === null || value === undefined) return null;
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === '' || raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  return null;
}

function parseNumberLike(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function readMovementTestConfigFromUrl(): MovementTestConfig | null {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('test.move') ?? params.get('moveTest') ?? params.get('autoMove');
  if (!raw) return null;
  const keyCodes: string[] = [];
  const aliases: Record<string, string> = {
    w: 'KeyW',
    forward: 'KeyW',
    fwd: 'KeyW',
    s: 'KeyS',
    back: 'KeyS',
    backward: 'KeyS',
    a: 'KeyA',
    left: 'KeyA',
    d: 'KeyD',
    right: 'KeyD',
    strafe: 'KeyD',
    space: 'Space',
    up: 'Space',
    ascend: 'Space',
    ctrl: 'ControlLeft',
    control: 'ControlLeft',
    down: 'ControlLeft',
    descend: 'ControlLeft',
    shift: 'ShiftLeft',
    fast: 'ShiftLeft',
    alt: 'AltLeft',
    slow: 'AltLeft',
  };
  for (const token of raw.split(/[,+\s]+/)) {
    const normalized = token.trim().toLowerCase();
    if (!normalized || normalized === '0' || normalized === 'false' || normalized === 'off') continue;
    const keyCode = aliases[normalized] ?? (token.startsWith('Key') || token === 'Space' ? token : '');
    if (keyCode && !keyCodes.includes(keyCode)) keyCodes.push(keyCode);
  }
  if (keyCodes.length === 0) return null;
  const durationMs = clampNumber(parseNumberLike(params.get('test.moveMs') ?? params.get('moveMs')) ?? 5000, 100, 120000, 5000);
  const delayMs = clampNumber(parseNumberLike(params.get('test.moveDelayMs') ?? params.get('moveDelayMs')) ?? 3000, 0, 120000, 3000);
  return { keyCodes, delayMs, durationMs };
}

function parseSettingValueForUrl(key: keyof EngineSettings, value: string): EngineSettings[keyof EngineSettings] | null {
  const fallback = DEFAULT_ENGINE_SETTINGS[key];
  if (typeof fallback === 'boolean') return parseBooleanLike(value);
  const parsed = parseNumberLike(value);
  return parsed === null ? null : parsed;
}

function applyUrlSettingOverrides(settings: EngineSettings): EngineSettings {
  const params = new URLSearchParams(window.location.search);
  const next: Partial<EngineSettings> = { ...settings };
  const settingKeys = new Set<keyof EngineSettings>(Object.keys(DEFAULT_ENGINE_SETTINGS) as Array<keyof EngineSettings>);

  const applySetting = (key: string, value: string | null): void => {
    if (!settingKeys.has(key as keyof EngineSettings) || value === null) return;
    const parsed = parseSettingValueForUrl(key as keyof EngineSettings, value);
    if (parsed !== null) {
      (next as Record<string, unknown>)[key] = parsed;
    }
  };

  for (const [key, value] of params.entries()) {
    if (key.startsWith('set.')) applySetting(key.slice(4), value);
    else if (key.startsWith('settings.')) applySetting(key.slice(9), value);
  }

  const radius = parseNumberLike(params.get('radius') ?? params.get('r'));
  if (radius !== null) next.streamRadius = radius;
  const lodOverride = readBooleanUrlOverride('lod', 'terrainLod', 'terrainLodEnabled');
  if (lodOverride !== null) next.terrainLodEnabled = lodOverride;
  return sanitizeEngineSettings(next);
}

function applyUrlCameraOverrides(camera: FlyCamera): void {
  const params = new URLSearchParams(window.location.search);
  const packed = params.get('camera') ?? params.get('cam');
  if (packed) {
    const values = packed.split(',').map(value => Number(value.trim()));
    if (values.length >= 3 && values.slice(0, 3).every(Number.isFinite)) {
      camera.position[0] = values[0];
      camera.position[1] = values[1];
      camera.position[2] = values[2];
    }
    if (Number.isFinite(values[3])) camera.yaw = values[3];
    if (Number.isFinite(values[4])) camera.pitch = values[4];
    if (Number.isFinite(values[5])) camera.fovDegrees = values[5];
  }
  const x = parseNumberLike(params.get('cameraX') ?? params.get('camX'));
  const y = parseNumberLike(params.get('cameraY') ?? params.get('camY'));
  const z = parseNumberLike(params.get('cameraZ') ?? params.get('camZ'));
  if (x !== null) camera.position[0] = x;
  if (y !== null) camera.position[1] = y;
  if (z !== null) camera.position[2] = z;
  const yaw = parseNumberLike(params.get('cameraYaw') ?? params.get('yaw'));
  const pitch = parseNumberLike(params.get('cameraPitch') ?? params.get('pitch'));
  const fov = parseNumberLike(params.get('cameraFov') ?? params.get('fov'));
  if (yaw !== null) camera.yaw = yaw;
  if (pitch !== null) camera.pitch = pitch;
  if (fov !== null) camera.fovDegrees = fov;
}

function sanitizeEngineSettings(raw: Partial<EngineSettings> = {}): EngineSettings {
  const needsVisualDefaultMigration = raw.exposure === undefined
    && raw.atmosphereStrength === undefined
    && raw.skyEnabled === undefined
    && raw.cinematicLighting === undefined;
  const migratedFogDensity = needsVisualDefaultMigration && Number(raw.fogDensity) === 1
    ? DEFAULT_ENGINE_SETTINGS.fogDensity
    : raw.fogDensity;
  const migratedMaterialDetail = needsVisualDefaultMigration && Number(raw.materialDetail) === 1
    ? DEFAULT_ENGINE_SETTINGS.materialDetail
    : raw.materialDetail;
  const migratedWaterOpacity = needsVisualDefaultMigration && Number(raw.waterOpacity) === 0.68
    ? DEFAULT_ENGINE_SETTINGS.waterOpacity
    : raw.waterOpacity;
  const migratedSunAzimuth = needsVisualDefaultMigration && Number(raw.sunAzimuth) === 42
    ? DEFAULT_ENGINE_SETTINGS.sunAzimuth
    : raw.sunAzimuth;
  const migratedSunElevation = needsVisualDefaultMigration && Number(raw.sunElevation) === 58
    ? DEFAULT_ENGINE_SETTINGS.sunElevation
    : raw.sunElevation;
  return {
    streamRadius: clampInt(raw.streamRadius ?? DEFAULT_ENGINE_SETTINGS.streamRadius, MIN_STREAM_RADIUS, MAX_STREAM_RADIUS),
    streamingEnabled: raw.streamingEnabled !== false,
    terrainLodEnabled: raw.terrainLodEnabled === true,
    nearTerrainEnabled: raw.nearTerrainEnabled === true,
    farTerrainEnabled: raw.farTerrainEnabled !== false,
    waterEnabled: raw.waterEnabled !== false,
    vegetationEnabled: raw.vegetationEnabled !== false,
    gameMarkersEnabled: raw.gameMarkersEnabled === true,
    overlayPanelVisible: raw.overlayPanelVisible !== false,
    settingsPanelVisible: raw.settingsPanelVisible !== false,
    densityPanelVisible: raw.densityPanelVisible !== false,
    regionBrowserPanelVisible: raw.regionBrowserPanelVisible !== false,
    qualityPreset: clampInt(raw.qualityPreset ?? DEFAULT_ENGINE_SETTINGS.qualityPreset, QUALITY_PRESET_LOW, QUALITY_PRESET_AUTO),
    fogDensity: clampNumber(migratedFogDensity, 0, 2.2, DEFAULT_ENGINE_SETTINGS.fogDensity),
    materialDetail: clampNumber(migratedMaterialDetail, 0, 1.8, DEFAULT_ENGINE_SETTINGS.materialDetail),
    exposure: clampNumber(raw.exposure, 0.55, 1.8, DEFAULT_ENGINE_SETTINGS.exposure),
    atmosphereStrength: clampNumber(raw.atmosphereStrength, 0, 2, DEFAULT_ENGINE_SETTINGS.atmosphereStrength),
    skyEnabled: raw.skyEnabled !== false,
    cinematicLighting: raw.cinematicLighting !== false,
    debugView: clampNumber(raw.debugView, 0, DEBUG_VIEW_SNOW_MASK, DEFAULT_ENGINE_SETTINGS.debugView),
    waterOpacity: clampNumber(migratedWaterOpacity, 0.15, 1, DEFAULT_ENGINE_SETTINGS.waterOpacity),
    animationSpeed: clampNumber(raw.animationSpeed, 0, 2, DEFAULT_ENGINE_SETTINGS.animationSpeed),
    cameraSpeed: clampNumber(raw.cameraSpeed, 8, 150, DEFAULT_ENGINE_SETTINGS.cameraSpeed),
    fastMultiplier: clampNumber(raw.fastMultiplier, 1, 6, DEFAULT_ENGINE_SETTINGS.fastMultiplier),
    fov: clampNumber(raw.fov, 45, 95, DEFAULT_ENGINE_SETTINGS.fov),
    editRadius: clampNumber(raw.editRadius, 2, 22, DEFAULT_ENGINE_SETTINGS.editRadius),
    brushDistance: clampNumber(raw.brushDistance, 8, 96, DEFAULT_ENGINE_SETTINGS.brushDistance),
    brushMode: clampInt(raw.brushMode ?? DEFAULT_ENGINE_SETTINGS.brushMode, BRUSH_MODE_CARVE, BRUSH_MODE_FLATTEN),
    brushShape: clampInt(raw.brushShape ?? DEFAULT_ENGINE_SETTINGS.brushShape, BRUSH_SHAPE_SPHERE, BRUSH_SHAPE_CAPSULE),
    brushLength: clampNumber(raw.brushLength, 2, 64, DEFAULT_ENGINE_SETTINGS.brushLength),
    brushFalloff: clampNumber(raw.brushFalloff, 0, 8, DEFAULT_ENGINE_SETTINGS.brushFalloff),
    brushPreviewEnabled: raw.brushPreviewEnabled === true,
    paintMaterial: clampInt(raw.paintMaterial ?? DEFAULT_ENGINE_SETTINGS.paintMaterial, PAINT_MATERIAL_GRASS, PAINT_MATERIAL_MUD),
    brushStrength: clampNumber(raw.brushStrength, 0.05, 1, DEFAULT_ENGINE_SETTINGS.brushStrength),
    regionSlot: clampInt(raw.regionSlot ?? DEFAULT_ENGINE_SETTINGS.regionSlot, 0, REGION_SLOTS.length - 1),
    densitySliceAxis: clampInt(raw.densitySliceAxis ?? DEFAULT_ENGINE_SETTINGS.densitySliceAxis, DENSITY_AXIS_X, DENSITY_AXIS_Z),
    densitySliceIndex: clampInt(raw.densitySliceIndex ?? DEFAULT_ENGINE_SETTINGS.densitySliceIndex, 0, DENSITY_GRID_N - 1),
    densitySliceFollowCamera: raw.densitySliceFollowCamera !== false,
    sunAzimuth: clampNumber(migratedSunAzimuth, 0, 360, DEFAULT_ENGINE_SETTINGS.sunAzimuth),
    sunElevation: clampNumber(migratedSunElevation, 5, 85, DEFAULT_ENGINE_SETTINGS.sunElevation),
  };
}

function recommendedQualityPreset(capabilities?: RuntimeCapabilities): number {
  const cores = Math.max(1, navigator.hardwareConcurrency || 4);
  const deviceMemory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0);
  const maxBuffer = capabilities?.maxBufferSizeMB ?? 0;
  const maxStorage = capabilities?.maxStorageBufferBindingSizeMB ?? 0;
  const sharedReady = capabilities?.crossOriginIsolated === true && capabilities?.sharedArrayBufferAvailable === true;
  if (cores <= 4 || (maxBuffer > 0 && maxBuffer < 512)) return QUALITY_PRESET_LOW;
  if (cores >= 12 && maxBuffer >= 1536 && maxStorage >= 512 && (deviceMemory === 0 || deviceMemory >= 8)) return QUALITY_PRESET_ULTRA;
  if (cores >= 8 && maxBuffer >= 1024 && sharedReady) return QUALITY_PRESET_HIGH;
  return QUALITY_PRESET_BALANCED;
}

function applyQualityPreset(settings: EngineSettings, capabilities?: RuntimeCapabilities): EngineSettings {
  const next = { ...settings };
  const requestedPreset = next.qualityPreset;
  const effectivePreset = requestedPreset === QUALITY_PRESET_AUTO ? recommendedQualityPreset(capabilities) : requestedPreset;
  if (effectivePreset === QUALITY_PRESET_LOW) {
    next.streamRadius = Math.min(next.streamRadius, 5);
    next.materialDetail = 0.36;
    next.fogDensity = 0.44;
    next.exposure = 1.34;
    next.atmosphereStrength = 0.92;
    next.skyEnabled = true;
    next.cinematicLighting = true;
    next.waterOpacity = 0.84;
    next.vegetationEnabled = false;
    next.qualityPreset = requestedPreset;
    return next;
  }
  if (effectivePreset === QUALITY_PRESET_HIGH) {
    next.streamRadius = Math.max(next.streamRadius, 10);
    next.materialDetail = 0.84;
    next.fogDensity = 0.50;
    next.exposure = 1.46;
    next.atmosphereStrength = 1.04;
    next.skyEnabled = true;
    next.cinematicLighting = true;
    next.waterOpacity = 0.91;
    next.vegetationEnabled = true;
    next.qualityPreset = requestedPreset;
    return next;
  }
  if (effectivePreset === QUALITY_PRESET_ULTRA) {
    next.streamRadius = Math.max(next.streamRadius, 14);
    next.materialDetail = 0.92;
    next.fogDensity = 0.52;
    next.exposure = 1.48;
    next.atmosphereStrength = 1.08;
    next.skyEnabled = true;
    next.cinematicLighting = true;
    next.waterOpacity = 0.92;
    next.vegetationEnabled = true;
    next.qualityPreset = requestedPreset;
    return next;
  }
  next.streamRadius = DEFAULT_ENGINE_SETTINGS.streamRadius;
  next.materialDetail = DEFAULT_ENGINE_SETTINGS.materialDetail;
  next.fogDensity = DEFAULT_ENGINE_SETTINGS.fogDensity;
  next.exposure = DEFAULT_ENGINE_SETTINGS.exposure;
  next.atmosphereStrength = DEFAULT_ENGINE_SETTINGS.atmosphereStrength;
  next.skyEnabled = DEFAULT_ENGINE_SETTINGS.skyEnabled;
  next.cinematicLighting = DEFAULT_ENGINE_SETTINGS.cinematicLighting;
  next.waterOpacity = DEFAULT_ENGINE_SETTINGS.waterOpacity;
  next.vegetationEnabled = true;
  next.qualityPreset = requestedPreset;
  return next;
}

function autoQualityLevelFromPreset(preset: number): number {
  if (preset === QUALITY_PRESET_LOW) return 0;
  if (preset === QUALITY_PRESET_HIGH) return 2;
  if (preset === QUALITY_PRESET_ULTRA) return 3;
  return 1;
}

function autoQualityLevelName(level: number): string {
  return ['low', 'balanced', 'high', 'ultra'][clampInt(level, 0, 3)] ?? 'balanced';
}

function autoQualitySettingsForLevel(settings: EngineSettings, level: number): EngineSettings {
  const next = { ...settings, qualityPreset: QUALITY_PRESET_AUTO };
  const normalized = clampInt(level, 0, 3);
  if (normalized === 0) {
    next.streamRadius = Math.min(next.streamRadius, 5);
    next.materialDetail = 0.36;
    next.fogDensity = 0.48;
    next.exposure = 1.44;
    next.atmosphereStrength = 0.96;
    next.skyEnabled = true;
    next.cinematicLighting = true;
    next.waterOpacity = 0.86;
    next.vegetationEnabled = false;
    next.farTerrainEnabled = true;
    return next;
  }
  if (normalized === 2) {
    next.streamRadius = Math.max(next.streamRadius, 10);
    next.materialDetail = 0.84;
    next.fogDensity = 0.54;
    next.exposure = 1.58;
    next.atmosphereStrength = 1.12;
    next.skyEnabled = true;
    next.cinematicLighting = true;
    next.waterOpacity = 0.93;
    next.vegetationEnabled = true;
    next.farTerrainEnabled = true;
    return next;
  }
  if (normalized === 3) {
    next.streamRadius = Math.max(next.streamRadius, 14);
    next.materialDetail = 0.92;
    next.fogDensity = 0.58;
    next.exposure = 1.60;
    next.atmosphereStrength = 1.16;
    next.skyEnabled = true;
    next.cinematicLighting = true;
    next.waterOpacity = 0.94;
    next.vegetationEnabled = true;
    next.farTerrainEnabled = true;
    return next;
  }
  next.streamRadius = DEFAULT_ENGINE_SETTINGS.streamRadius;
  next.materialDetail = DEFAULT_ENGINE_SETTINGS.materialDetail;
  next.fogDensity = DEFAULT_ENGINE_SETTINGS.fogDensity;
  next.exposure = DEFAULT_ENGINE_SETTINGS.exposure;
  next.atmosphereStrength = DEFAULT_ENGINE_SETTINGS.atmosphereStrength;
  next.skyEnabled = true;
  next.cinematicLighting = true;
  next.waterOpacity = DEFAULT_ENGINE_SETTINGS.waterOpacity;
  next.vegetationEnabled = true;
  next.farTerrainEnabled = true;
  return next;
}

function qualityCaptureFileName(capturedAt: number): string {
  return `storm-canyon-quality-capture-${new Date(capturedAt).toISOString().replace(/[:.]/g, '-')}.json`;
}

function browserWorkerBenchmarkHistoryFileName(exportedAt: number): string {
  return `storm-canyon-worker-benchmarks-${new Date(exportedAt).toISOString().replace(/[:.]/g, '-')}.json`;
}

function worldgenTileFileName(capturedAt: number): string {
  return `storm-canyon-worldgen-tiles-${new Date(capturedAt).toISOString().replace(/[:.]/g, '-')}.json`;
}

function browserWorkerBenchmarkId(): string {
  return `browser-worker-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function benchmarkDeltaPct(current: number, previous: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return 0;
  return ((current - previous) / previous) * 100;
}

function computeBenchmarkTrend(
  current: BrowserWorkerBenchmarkSummary,
  previous?: BrowserWorkerBenchmarkCapture,
): BrowserWorkerBenchmarkTrend | null {
  if (!previous) return null;
  const generateDeltaPct = benchmarkDeltaPct(current.avgGenerateMs, previous.result.avgGenerateMs);
  const cachedRemeshDeltaPct = benchmarkDeltaPct(current.avgCachedRemeshMs, previous.result.avgCachedRemeshMs);
  const editRemeshDeltaPct = benchmarkDeltaPct(current.avgEditRemeshMs, previous.result.avgEditRemeshMs);
  const smoothRemeshDeltaPct = benchmarkDeltaPct(current.avgSmoothRemeshMs ?? current.avgEditRemeshMs, previous.result.avgSmoothRemeshMs ?? previous.result.avgEditRemeshMs);
  const flattenRemeshDeltaPct = benchmarkDeltaPct(current.avgFlattenRemeshMs ?? current.avgEditRemeshMs, previous.result.avgFlattenRemeshMs ?? previous.result.avgEditRemeshMs);
  const overallDeltaPct = (generateDeltaPct + cachedRemeshDeltaPct + editRemeshDeltaPct + smoothRemeshDeltaPct + flattenRemeshDeltaPct) / 5;
  return {
    comparedToCapturedAt: previous.capturedAt,
    generateDeltaPct,
    cachedRemeshDeltaPct,
    editRemeshDeltaPct,
    overallDeltaPct,
    direction: overallDeltaPct < -5 ? 'faster' : overallDeltaPct > 5 ? 'slower' : 'similar',
  };
}

function normalizeBrowserWorkerBenchmarkCaptures(raw: unknown): BrowserWorkerBenchmarkCapture[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((capture): capture is BrowserWorkerBenchmarkCapture => {
      const candidate = capture as BrowserWorkerBenchmarkCapture;
      return Boolean(
        candidate
        && typeof candidate.capturedAt === 'number'
        && typeof candidate.benchmarkId === 'string'
        && candidate.result
        && typeof candidate.result.avgGenerateMs === 'number'
        && typeof candidate.result.avgCachedRemeshMs === 'number'
        && typeof candidate.result.avgEditRemeshMs === 'number'
        && Array.isArray(candidate.result.scenes),
      );
    })
    .slice(0, MAX_BROWSER_WORKER_BENCHMARK_CAPTURES);
}

function sortBrowserWorkerBenchmarkCaptures(captures: BrowserWorkerBenchmarkCapture[]): BrowserWorkerBenchmarkCapture[] {
  return [...captures].sort((a, b) => b.capturedAt - a.capturedAt);
}

function recomputeBrowserWorkerBenchmarkTrends(captures: BrowserWorkerBenchmarkCapture[]): BrowserWorkerBenchmarkCapture[] {
  const sorted = sortBrowserWorkerBenchmarkCaptures(captures).slice(0, MAX_BROWSER_WORKER_BENCHMARK_CAPTURES);
  return sorted.map((capture, index) => ({
    ...capture,
    trend: computeBenchmarkTrend(capture.result, sorted[index + 1]),
  }));
}

function normalizeImportedBrowserWorkerBenchmarkCaptures(raw: unknown): BrowserWorkerBenchmarkCapture[] {
  if (!raw || typeof raw !== 'object') return normalizeBrowserWorkerBenchmarkCaptures(raw);
  const source = raw as {
    captures?: unknown;
    browserWorkerBenchmarks?: unknown;
    runtime?: { browserWorkerBenchmarks?: unknown };
    recentCaptures?: Array<{ browserWorkerBenchmark?: unknown }>;
    capture?: { browserWorkerBenchmark?: unknown };
  } | null | undefined;
  const candidates = [
    source?.captures,
    source?.browserWorkerBenchmarks,
    source?.runtime?.browserWorkerBenchmarks,
    source?.capture?.browserWorkerBenchmark ? [source.capture.browserWorkerBenchmark] : undefined,
    ...(Array.isArray(source?.recentCaptures)
      ? source.recentCaptures.map(capture => capture.browserWorkerBenchmark ? [capture.browserWorkerBenchmark] : undefined)
      : []),
  ];
  const captures: BrowserWorkerBenchmarkCapture[] = [];
  for (const candidate of candidates) captures.push(...normalizeBrowserWorkerBenchmarkCaptures(candidate));
  const byId = new Map<string, BrowserWorkerBenchmarkCapture>();
  for (const capture of captures) byId.set(capture.benchmarkId, capture);
  return recomputeBrowserWorkerBenchmarkTrends([...byId.values()]);
}

function mergeBrowserWorkerBenchmarkCaptures(
  current: BrowserWorkerBenchmarkCapture[],
  imported: BrowserWorkerBenchmarkCapture[],
): BrowserWorkerBenchmarkCapture[] {
  const byId = new Map<string, BrowserWorkerBenchmarkCapture>();
  for (const capture of [...current, ...imported]) byId.set(capture.benchmarkId, capture);
  return recomputeBrowserWorkerBenchmarkTrends([...byId.values()]);
}

function loadBrowserWorkerBenchmarkCaptures(): BrowserWorkerBenchmarkCapture[] {
  try {
    const raw = localStorage.getItem(BROWSER_WORKER_BENCHMARK_STORAGE_KEY);
    return raw ? recomputeBrowserWorkerBenchmarkTrends(normalizeBrowserWorkerBenchmarkCaptures(JSON.parse(raw))) : [];
  } catch {
    return [];
  }
}

function saveBrowserWorkerBenchmarkCaptures(captures: BrowserWorkerBenchmarkCapture[]): void {
  try {
    localStorage.setItem(
      BROWSER_WORKER_BENCHMARK_STORAGE_KEY,
      JSON.stringify(captures.slice(0, MAX_BROWSER_WORKER_BENCHMARK_CAPTURES)),
    );
  } catch {
    // Benchmark history is diagnostic only.
  }
}

function formatBrowserWorkerBenchmark(captures: BrowserWorkerBenchmarkCapture[], running: boolean): string {
  if (running) return 'Worker bench: running dedicated WASM worker capture...';
  const latest = captures[0];
  if (!latest) return 'Worker bench: no browser capture yet';
  const trend = latest.trend
    ? ` | ${latest.trend.direction}, ${latest.trend.overallDeltaPct >= 0 ? '+' : ''}${latest.trend.overallDeltaPct.toFixed(1)}% vs previous`
    : ' | first capture';
  return `Worker bench: gen ${latest.result.avgGenerateMs.toFixed(1)} ms, cached ${latest.result.avgCachedRemeshMs.toFixed(1)} ms, edit ${latest.result.avgEditRemeshMs.toFixed(1)} ms, smooth ${(latest.result.avgSmoothRemeshMs ?? latest.result.avgEditRemeshMs).toFixed(1)} ms, flatten ${(latest.result.avgFlattenRemeshMs ?? latest.result.avgEditRemeshMs).toFixed(1)} ms (${latest.result.chunks} chunks)${trend}`;
}

function runBrowserWorkerBenchmark(): Promise<BrowserWorkerBenchmarkSummary> {
  const benchmarkId = browserWorkerBenchmarkId();
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'voxel-browser-benchmark-worker' });
  let settled = false;
  let timeout = 0;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeout);
      worker.terminate();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    timeout = window.setTimeout(() => fail(new Error('Browser worker benchmark timed out.')), BROWSER_WORKER_BENCHMARK_TIMEOUT_MS);
    worker.onmessage = (ev: MessageEvent<WorkerOutboundMessage>) => {
      const msg = ev.data;
      if (msg.type === 'ready') {
        worker.postMessage({ type: 'runBenchmark', benchmarkId });
        return;
      }
      if (msg.type === 'benchmarkResult' && msg.benchmarkId === benchmarkId) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(msg.result);
        return;
      }
      if (msg.type === 'error') fail(new Error(`${msg.message}\n${msg.stack ?? ''}`));
    };
    worker.onerror = (ev) => fail(new Error(`Browser worker benchmark failed: ${ev.message}`));
    worker.postMessage({ type: 'init' });
  });
}

function loadEngineSettings(): EngineSettings {
  const saved = readSavedEngineSettings();
  return applyUrlSettingOverrides(sanitizeEngineSettings({ ...DEFAULT_ENGINE_SETTINGS, ...saved }));
}

function saveEngineSettings(settings: EngineSettings): void {
  try {
    localStorage.setItem(ENGINE_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    localStorage.setItem('stormCanyon.streamRadius', String(settings.streamRadius));
  } catch {
    // localStorage can be disabled in strict browser profiles.
  }
}

function cachePayloadForChunkMessage(msg: ChunkMessage): ChunkCachePayload {
  if (!msg.stats?.sharedResultArena) {
    return {
      vertices: msg.vertices,
      indices: msg.indices,
      densitySamples: msg.densitySamples,
      vegetation: msg.vegetation,
      copiedBytes: 0,
      borrowedBytes: 0,
      ownsArrays: true,
    };
  }
  const vertices = new Uint8Array(msg.vertices);
  const indices = new Uint32Array(msg.indices);
  const densitySamples = new Int16Array(msg.densitySamples);
  const vegetation = new Float32Array(msg.vegetation);
  return {
    vertices,
    indices,
    densitySamples,
    vegetation,
    copiedBytes: vertices.byteLength + indices.byteLength + densitySamples.byteLength + vegetation.byteLength,
    borrowedBytes: 0,
    ownsArrays: true,
  };
}

function sunDirectionFromSettings(settings: EngineSettings): [number, number, number] {
  const azimuth = settings.sunAzimuth * Math.PI / 180;
  const elevation = settings.sunElevation * Math.PI / 180;
  const horizontal = Math.cos(elevation);
  return [
    Math.sin(azimuth) * horizontal,
    Math.sin(elevation),
    Math.cos(azimuth) * horizontal,
  ];
}

function applyEngineSettings(settings: EngineSettings, camera: FlyCamera, renderer: Renderer, streamer: ChunkStreamer): void {
  streamer.setStreamRadius(settings.streamRadius);
  streamer.setStreamingEnabled(settings.streamingEnabled);
  streamer.setTerrainLodEnabled(settings.terrainLodEnabled);
  camera.speed = settings.cameraSpeed;
  camera.fastMultiplier = settings.fastMultiplier;
  camera.fovDegrees = settings.fov;
  renderer.updateSettings({
    nearTerrainEnabled: settings.nearTerrainEnabled,
    farTerrainEnabled: settings.farTerrainEnabled,
    waterEnabled: settings.waterEnabled,
    vegetationEnabled: settings.vegetationEnabled,
    fogDensity: settings.fogDensity,
    materialDetail: settings.materialDetail,
    exposure: settings.exposure,
    atmosphereStrength: settings.atmosphereStrength,
    skyEnabled: settings.skyEnabled,
    cinematicLighting: settings.cinematicLighting,
    debugView: settings.debugView,
    waterOpacity: settings.waterOpacity,
    animationSpeed: settings.animationSpeed,
    sunDirection: sunDirectionFromSettings(settings),
  });
}

function applyPanelVisibility(
  settings: EngineSettings,
  overlay: HTMLElement,
  settingsRoot: HTMLElement,
  densityPanel: HTMLElement,
  regionBrowser: HTMLElement,
): void {
  overlay.hidden = !settings.overlayPanelVisible;
  settingsRoot.hidden = !settings.settingsPanelVisible;
  if (!settings.densityPanelVisible) densityPanel.hidden = true;
  if (!settings.regionBrowserPanelVisible) regionBrowser.hidden = true;
}

function brushTypeFromMode(mode: number): EditOperation['type'] {
  if (mode === BRUSH_MODE_FLATTEN) return 'flattenDensity';
  if (mode === BRUSH_MODE_SMOOTH) return 'smoothDensity';
  if (mode === BRUSH_MODE_PAINT) return 'paintMaterial';
  return mode === BRUSH_MODE_BUILD ? 'addSphere' : 'subtractSphere';
}

function brushModeLabel(mode: number): string {
  if (mode === BRUSH_MODE_FLATTEN) return 'Flatten';
  if (mode === BRUSH_MODE_SMOOTH) return 'Smooth';
  if (mode === BRUSH_MODE_PAINT) return 'Paint';
  if (mode === BRUSH_MODE_BUILD) return 'Build';
  return 'Carve';
}

function brushShapeFromMode(mode: number): BrushShape {
  if (mode === BRUSH_SHAPE_BOX) return 'box';
  if (mode === BRUSH_SHAPE_CAPSULE) return 'capsule';
  return 'sphere';
}

function brushShapeLabel(shape: BrushShape): string {
  if (shape === 'box') return 'Box';
  if (shape === 'capsule') return 'Capsule';
  return 'Sphere';
}

function paintMaterialLabel(material: number): string {
  if (material === PAINT_MATERIAL_ROCK) return 'Rock';
  if (material === PAINT_MATERIAL_SNOW) return 'Snow';
  if (material === PAINT_MATERIAL_MUD) return 'Mud';
  return 'Grass';
}

function brushPresetSettingsFrom(settings: EngineSettings): BrushPresetSettings {
  return {
    brushMode: settings.brushMode,
    brushShape: settings.brushShape,
    editRadius: settings.editRadius,
    brushDistance: settings.brushDistance,
    brushLength: settings.brushLength,
    brushFalloff: settings.brushFalloff,
    brushPreviewEnabled: settings.brushPreviewEnabled,
    paintMaterial: settings.paintMaterial,
    brushStrength: settings.brushStrength,
  };
}

function brushPresetSettingsKey(settings: BrushPresetSettings): string {
  return [
    settings.brushMode,
    settings.brushShape,
    settings.editRadius.toFixed(2),
    settings.brushDistance.toFixed(1),
    settings.brushLength.toFixed(1),
    settings.brushFalloff.toFixed(2),
    settings.brushPreviewEnabled ? 1 : 0,
    settings.paintMaterial,
    settings.brushStrength.toFixed(2),
  ].join(':');
}

function brushPresetLabel(settings: BrushPresetSettings): string {
  const shape = brushShapeLabel(brushShapeFromMode(settings.brushShape));
  if (settings.brushMode === BRUSH_MODE_PAINT) return `Paint ${paintMaterialLabel(settings.paintMaterial)} ${shape}`;
  return `${brushModeLabel(settings.brushMode)} ${shape}`;
}

function brushPresetDetail(settings: BrushPresetSettings): string {
  const shape = brushShapeFromMode(settings.brushShape);
  const material = settings.brushMode === BRUSH_MODE_PAINT ? ` | ${paintMaterialLabel(settings.paintMaterial)}` : '';
  const strength = settings.brushMode === BRUSH_MODE_SMOOTH || settings.brushMode === BRUSH_MODE_FLATTEN
    ? ` | strength ${settings.brushStrength.toFixed(2)}`
    : '';
  const falloff = settings.brushMode === BRUSH_MODE_CARVE || settings.brushMode === BRUSH_MODE_BUILD
    ? ` | falloff ${settings.brushFalloff.toFixed(2)}m`
    : '';
  const length = shape === 'capsule' ? ` | length ${settings.brushLength.toFixed(1)}m` : '';
  return `r ${settings.editRadius.toFixed(1)}m @ ${settings.brushDistance.toFixed(0)}m${length}${falloff}${strength}${material}${settings.brushPreviewEnabled ? ' | preview' : ''}`;
}

function sanitizeBrushPresetName(name: unknown, fallback: string): string {
  const raw = typeof name === 'string' ? name.trim() : '';
  const clean = raw.replace(/\s+/g, ' ').slice(0, 36);
  return clean || fallback;
}

function normalizeBrushPreset(raw: unknown, fallbackIndex: number): BrushPreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Partial<BrushPreset> & { settings?: Partial<EngineSettings> };
  const sanitizedSettings = sanitizeEngineSettings({
    ...DEFAULT_ENGINE_SETTINGS,
    ...(record.settings ?? {}),
  });
  const settings = brushPresetSettingsFrom(sanitizedSettings);
  const createdAt = Number.isFinite(Number(record.createdAt)) ? Number(record.createdAt) : Date.now();
  const updatedAt = Number.isFinite(Number(record.updatedAt)) ? Number(record.updatedAt) : createdAt;
  return {
    id: typeof record.id === 'string' && record.id ? record.id.slice(0, 80) : `brush-preset-${fallbackIndex}`,
    name: sanitizeBrushPresetName(record.name, `Brush ${fallbackIndex + 1}`),
    settings,
    createdAt,
    updatedAt,
  };
}

function loadBrushPresets(): BrushPreset[] {
  try {
    const raw = localStorage.getItem(BRUSH_PRESET_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const presets: BrushPreset[] = [];
    for (let i = 0; i < parsed.length && presets.length < MAX_BRUSH_PRESETS; i++) {
      const preset = normalizeBrushPreset(parsed[i], i);
      if (!preset || seen.has(preset.id)) continue;
      seen.add(preset.id);
      presets.push(preset);
    }
    return presets;
  } catch {
    return [];
  }
}

function saveBrushPresets(presets: BrushPreset[]): void {
  try {
    localStorage.setItem(BRUSH_PRESET_STORAGE_KEY, JSON.stringify(presets.slice(0, MAX_BRUSH_PRESETS)));
  } catch {
    // localStorage can be disabled in strict browser profiles.
  }
}

function newBrushPresetId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `brush-${Date.now().toString(36)}-${Math.floor(Math.random() * 100000).toString(36)}`;
}

function createBrushPresetPanelState(presets: BrushPreset[], settings: EngineSettings): BrushPresetPanelState {
  const currentKey = brushPresetSettingsKey(brushPresetSettingsFrom(settings));
  return {
    count: presets.length,
    maxPresets: MAX_BRUSH_PRESETS,
    items: presets.map(preset => ({
      id: preset.id,
      name: preset.name,
      detail: brushPresetDetail(preset.settings),
      active: brushPresetSettingsKey(preset.settings) === currentKey,
    })),
  };
}

function editOperationLabel(edit: EditOperation): string {
  const shape = brushShapeLabel(editShape(edit));
  if (edit.type === 'addSphere') return `Build ${shape}`;
  if (edit.type === 'paintMaterial') return `Paint ${paintMaterialLabel(edit.material ?? PAINT_MATERIAL_GRASS)}`;
  if (edit.type === 'smoothDensity') return `Smooth ${shape}`;
  if (edit.type === 'flattenDensity') return `Flatten ${shape}`;
  return `Carve ${shape}`;
}

function editOperationDetail(edit: EditOperation): string {
  const parts = [
    `#${edit.id}`,
    `r ${edit.radius.toFixed(1)}m`,
    `${edit.x.toFixed(0)}, ${edit.y.toFixed(0)}, ${edit.z.toFixed(0)}`,
  ];
  const shape = editShape(edit);
  if (shape === 'capsule') parts.push(`len ${editLength(edit).toFixed(1)}m`);
  if ((edit.type === 'subtractSphere' || edit.type === 'addSphere') && (edit.falloff ?? 0) > 0) {
    parts.push(`falloff ${(edit.falloff ?? 0).toFixed(1)}m`);
  }
  if ((edit.type === 'smoothDensity' || edit.type === 'flattenDensity') && edit.strength !== undefined) {
    parts.push(`strength ${edit.strength.toFixed(2)}x`);
  }
  if (edit.type === 'paintMaterial') parts.push(`mat ${paintMaterialLabel(edit.material ?? PAINT_MATERIAL_GRASS)}`);
  return parts.join(' | ');
}

function editBranchLabel(branch: EditHistoryBranch): string {
  const head = branch.edits[branch.edits.length - 1];
  return head ? `Branch ${branch.id}: ${editOperationLabel(head)}` : `Branch ${branch.id}`;
}

function editBranchDetail(branch: EditHistoryBranch): string {
  const base = branch.baseEditId > 0 ? `base #${branch.baseEditId}` : 'base start';
  const edits = `${branch.edits.length} edit${branch.edits.length === 1 ? '' : 's'}`;
  const created = new Date(branch.createdAt).toLocaleTimeString();
  return `${base} | ${edits} | ${created}`;
}

function regionEditDiffSample(
  edit: EditOperation,
  index: number,
  state: RegionEditDiffSample['state'],
): RegionEditDiffSample {
  return {
    id: edit.id,
    index,
    state,
    label: editOperationLabel(edit),
    detail: editOperationDetail(edit),
  };
}

function regionEditBranchDiffSample(
  branch: EditHistoryBranch,
  state: RegionEditBranchDiffSample['state'],
): RegionEditBranchDiffSample {
  return {
    id: branch.id,
    state,
    label: editBranchLabel(branch),
    detail: editBranchDetail(branch),
    baseEditId: branch.baseEditId,
    baseEditCount: branch.baseEditCount,
    editCount: branch.edits.length,
  };
}

function editHistoryPanelItems(streamer: ChunkStreamer, limit = 10): EditHistoryPanelItem[] {
  const active = streamer.editLog.slice(-limit).reverse().map(edit => ({
    id: edit.id,
    label: editOperationLabel(edit),
    detail: editOperationDetail(edit),
    state: 'active' as const,
  }));
  const remaining = Math.max(0, limit - active.length);
  const redo = remaining > 0
    ? streamer.undoneEdits.slice(-remaining).reverse().map(edit => ({
      id: edit.id,
      label: editOperationLabel(edit),
      detail: editOperationDetail(edit),
      state: 'redo' as const,
    }))
    : [];
  const remainingAfterRedo = Math.max(0, limit - active.length - redo.length);
  const branches = remainingAfterRedo > 0
    ? streamer.editBranches.slice(0, remainingAfterRedo).map(branch => ({
      id: branch.id,
      label: editBranchLabel(branch),
      detail: editBranchDetail(branch),
      state: 'branch' as const,
    }))
    : [];
  return [...active, ...redo, ...branches];
}

function sampleWorldgenProbe(position: Vec3, label: string): WorldgenProbe {
  const x = position[0];
  const z = position[2];
  const tile = worldgenTileCache.sample(x, z);
  const caveGraph = caveGraphTileCache.sample(x, position[1], z);
  const erosionTile = erosionTileCache.sample(x, z);
  const materialField = materialTileCache.sample(x, z);
  return {
    label,
    x,
    y: position[1],
    z,
    height: tile.height,
    riverCenter: tile.riverCenter,
    riverDistance: Math.abs(x - tile.riverCenter),
    normalY: tile.normalY,
    continent: tile.continent,
    moisture: tile.moisture,
    temperature: tile.temperature,
    drainage: tile.drainage,
    erosion: tile.erosion,
    vegetation: tile.vegetation,
    biome: tile.biome,
    wetness: tile.wetness,
    snow: tile.snow,
    caveDistance: caveGraph.signedDistance,
    surfaceCaveDistance: tile.surfaceCaveDistance,
    caveInfluence: tile.caveInfluence,
    material: tile.material,
    biomeId: tile.biomeId,
    waterId: tile.waterId,
    riverNetworkId: tile.riverNetworkId,
    flowX: tile.flowX,
    flowZ: tile.flowZ,
    flowAccumulation: tile.flowAccumulation,
    drainageBasinId: tile.drainageBasinId,
    streamOrder: tile.streamOrder,
    channelWidth: tile.channelWidth,
    streamPower: tile.streamPower,
    erosionTile: {
      thermal: erosionTile.thermalErosion,
      hydraulic: erosionTile.hydraulicErosion,
      deposition: erosionTile.deposition,
      sediment: erosionTile.sedimentLoad,
      bedrock: erosionTile.bedrockExposure,
      soil: erosionTile.soilDepth,
      retention: erosionTile.vegetationRetention,
    },
    materialField,
    biomeWeights: tile.biomeWeights,
    materialWeights: tile.materialWeights,
    tileX: tile.tileX,
    tileZ: tile.tileZ,
    caveGraphTileKey: caveGraph.tileKey,
    caveGraphPassageId: caveGraph.nearestPassageId,
    caveGraphPassageKind: caveGraph.nearestPassageKind,
    caveGraphPassageDistance: caveGraph.nearestPassageDistance,
    caveGraphChamberId: caveGraph.nearestChamberId,
    caveGraphChamberDistance: caveGraph.nearestChamberDistance,
    caveGraphBiomeHook: caveGraph.biomeHook,
  };
}

function proceduralWorldgenProbe(position: Vec3, label: string): WorldgenProbe {
  const x = position[0];
  const y = position[1];
  const z = position[2];
  const height = terrainHeight(x, z);
  const normal = terrainNormal(x, z);
  const normalY = normal[1];
  const river = riverCenter(z);
  const wetness = wetnessMask(x, height, z, normalY, height);
  const snow = snowMask(x, height, z, normalY, height);
  const biome = biomeMask(x, z, height, normalY);
  const drainage = drainageMask(x, z);
  const erosion = erosionMask(x, z);
  const vegetation = vegetationMask(x, height, z, normalY);
  const cave = caveDistance(x, y, z);
  const material = terrainMaterial(x, height, z, normalY);
  const biomeWeights: WorldgenBiomeWeights = {
    meadow: Math.max(0, 1 - biome),
    riverValley: Math.max(0, 1 - Math.min(Math.abs(x - river) / 96, 1)),
    alpineSnow: snow,
    exposedRidge: Math.max(0, 1 - normalY),
    forestEdge: vegetation,
    drySlope: Math.max(0, 1 - wetness),
  };
  const materialWeights: WorldgenMaterialWeights = {
    grass: material === 0 ? 1 : 0,
    rock: material === 1 ? 1 : 0,
    snow: material === 2 ? 1 : 0,
    mud: material === 3 ? 1 : 0,
  };
  const materialField: MaterialTileSample = {
    tileX: Math.floor(x / 256),
    tileZ: Math.floor(z / 256),
    weights: materialWeights,
    dominantMaterialId: material,
    dominantMaterialName: material === 1 ? 'rock' : material === 2 ? 'snow' : material === 3 ? 'mud' : 'grass',
    wetness,
    roughness: Math.max(0.2, 1 - normalY),
    fertility: vegetation,
    stability: Math.max(0, Math.min(1, normalY + 0.15)),
    shoreline: Math.max(0, 1 - Math.min(Math.abs(x - river) / 48, 1)),
    caveSurface: Math.max(0, 1 - Math.min(Math.abs(cave) / 16, 1)),
    routeCost: Math.max(0, Math.min(1, (1 - normalY) * 0.8 + Math.max(0, height - y) * 0.01)),
    blendConfidence: 0.75,
  };
  return {
    label,
    x,
    y,
    z,
    height,
    riverCenter: river,
    riverDistance: Math.abs(x - river),
    normalY,
    continent: macroContinent(x, z),
    moisture: macroMoisture(x, z),
    temperature: macroTemperature(x, z),
    drainage,
    erosion,
    vegetation,
    biome,
    wetness,
    snow,
    caveDistance: cave,
    surfaceCaveDistance: cave,
    caveInfluence: Math.max(0, 1 - Math.min(Math.abs(cave) / 32, 1)),
    material,
    biomeId: 0,
    waterId: Math.abs(x - river) < 14 ? 1 : 0,
    riverNetworkId: 0,
    flowX: 0,
    flowZ: 1,
    flowAccumulation: drainage,
    drainageBasinId: 0,
    streamOrder: Math.max(0, Math.round(drainage * 4)),
    channelWidth: Math.max(0, 8 + drainage * 28),
    streamPower: drainage,
    erosionTile: {
      thermal: erosion,
      hydraulic: drainage,
      deposition: Math.max(0, wetness - erosion * 0.4),
      sediment: drainage * wetness,
      bedrock: Math.max(0, 1 - normalY),
      soil: Math.max(0, vegetation * (1 - snow)),
      retention: vegetation,
    },
    materialField,
    biomeWeights,
    materialWeights,
    tileX: Math.floor(x / 256),
    tileZ: Math.floor(z / 256),
    caveGraphTileKey: `${Math.floor(x / 256)},${Math.floor(z / 256)}`,
    caveGraphPassageId: null,
    caveGraphPassageKind: null,
    caveGraphPassageDistance: cave,
    caveGraphChamberId: null,
    caveGraphChamberDistance: cave,
    caveGraphBiomeHook: null,
  };
}

function worldgenSnapshot(camera: FlyCamera, settings: EngineSettings): WorldgenSnapshot {
  const brushTarget = add(camera.position, scale(camera.forward(), settings.brushDistance));
  const brush = proceduralWorldgenProbe(brushTarget, 'brush');
  const cameraProbe = proceduralWorldgenProbe(camera.position, 'camera');
  return {
    camera: cameraProbe,
    brush,
    tileStats: worldgenTileCache.stats(),
    caveGraphStats: caveGraphTileCache.stats(),
    erosionTileStats: erosionTileCache.stats(),
    materialTileStats: materialTileCache.stats(),
  };
}

function biomeIdLabel(id: number): string {
  if (id === 1) return 'River';
  if (id === 2) return 'Snow';
  if (id === 3) return 'Ridge';
  if (id === 4) return 'Forest';
  if (id === 5) return 'Dry';
  return 'Meadow';
}

function biomeWeight(probe: WorldgenProbe): number {
  if (probe.biomeId === 1) return probe.biomeWeights.riverValley;
  if (probe.biomeId === 2) return probe.biomeWeights.alpineSnow;
  if (probe.biomeId === 3) return probe.biomeWeights.exposedRidge;
  if (probe.biomeId === 4) return probe.biomeWeights.forestEdge;
  if (probe.biomeId === 5) return probe.biomeWeights.drySlope;
  return probe.biomeWeights.meadow;
}

function dominantMaterialWeight(probe: WorldgenProbe): string {
  const entries: [string, number][] = [
    ['grass', probe.materialWeights.grass],
    ['rock', probe.materialWeights.rock],
    ['snow', probe.materialWeights.snow],
    ['mud', probe.materialWeights.mud],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return `${entries[0][0]} ${entries[0][1].toFixed(2)}`;
}

function formatMaterialFieldProbe(probe: WorldgenProbe): string {
  const field = probe.materialField;
  return `${field.dominantMaterialName} ${field.weights[field.dominantMaterialName].toFixed(2)} rough ${field.roughness.toFixed(2)} fert ${field.fertility.toFixed(2)} stable ${field.stability.toFixed(2)} shore ${field.shoreline.toFixed(2)} cave ${field.caveSurface.toFixed(2)} route ${field.routeCost.toFixed(2)}`;
}

function formatSignedDistance(value: number, digits = 0): string {
  return Number.isFinite(value) ? `${value.toFixed(digits)}m` : 'n/a';
}

function formatCaveGraphProbe(probe: WorldgenProbe): string {
  const passage = probe.caveGraphPassageId
    ? `pass ${probe.caveGraphPassageKind ?? 'unknown'} ${probe.caveGraphPassageId} ${formatSignedDistance(probe.caveGraphPassageDistance)}`
    : 'pass none';
  const chamber = probe.caveGraphChamberId
    ? `chamber ${probe.caveGraphChamberId} ${formatSignedDistance(probe.caveGraphChamberDistance)}`
    : 'chamber none';
  const hook = probe.caveGraphBiomeHook ?? 'none';
  return `graph ${probe.caveGraphTileKey} ${passage}, ${chamber}, hook ${hook}`;
}

function formatWorldgenProbe(probe: WorldgenProbe): string {
  const network = probe.riverNetworkId > 0 ? ` net ${probe.riverNetworkId}` : '';
  const erosion = `eth ${probe.erosionTile.thermal.toFixed(2)}/${probe.erosionTile.hydraulic.toFixed(2)} dep ${probe.erosionTile.deposition.toFixed(2)} sed ${probe.erosionTile.sediment.toFixed(2)} soil ${probe.erosionTile.soil.toFixed(2)}`;
  return `${probe.label}: h ${probe.height.toFixed(1)}m, river ${probe.riverDistance.toFixed(0)}m${network}, basin ${probe.drainageBasinId} o${probe.streamOrder} w${probe.channelWidth.toFixed(1)}m p${probe.streamPower.toFixed(2)}, cave ${probe.caveDistance.toFixed(1)}m/surf ${probe.surfaceCaveDistance.toFixed(1)}m, ${formatCaveGraphProbe(probe)}, flow ${probe.flowAccumulation.toFixed(2)}, ${erosion}, ${biomeIdLabel(probe.biomeId)} ${biomeWeight(probe).toFixed(2)}, mat ${dominantMaterialWeight(probe)}, field ${formatMaterialFieldProbe(probe)}, cont ${probe.continent.toFixed(2)}, moist ${probe.moisture.toFixed(2)}, temp ${probe.temperature.toFixed(2)}, drain ${probe.drainage.toFixed(2)}, eros ${probe.erosion.toFixed(2)}, veg ${probe.vegetation.toFixed(2)}, ${paintMaterialLabel(Math.round(probe.material))}`;
}

function formatInspectorPercent(value: number): string {
  return `${Math.round(clampNumber(value, 0, 1, 0) * 100)}%`;
}

function inspectorBar(
  group: string,
  label: string,
  value: number,
  valueLabel = formatInspectorPercent(value),
  tone: BrushInspectorBar['tone'] = 'mask',
): BrushInspectorBar {
  return {
    group,
    label,
    value: clampNumber(value, 0, 1, 0),
    valueLabel,
    tone,
  };
}

function brushCoreExtent(options: BrushOptions): number {
  const radius = Math.max(0, options.radius);
  if (options.shape === 'box') return radius * Math.sqrt(3);
  if (options.shape === 'capsule') return radius + Math.max(0, options.length) * 0.5;
  return radius;
}

function createBrushInspectorState(camera: FlyCamera, settings: EngineSettings, brush: BrushOptions): BrushInspectorPanelState {
  const target = add(camera.position, scale(brush.direction, brush.distance));
  const probe = proceduralWorldgenProbe(target, 'brush');
  const influenceRadius = Math.max(0.001, brushInfluenceRadius(brush));
  const coreExtent = brushCoreExtent(brush);
  const falloff = brush.type === 'subtractSphere' || brush.type === 'addSphere'
    ? clampNumber(brush.falloff, 0, 8, 0)
    : 0;
  const heightDelta = target[1] - probe.height;
  const surfaceCoverage = Math.max(0, 1 - Math.min(Math.abs(heightDelta) / influenceRadius, 1));
  const caveCoverage = Math.max(0, 1 - Math.min(Math.abs(probe.caveDistance) / influenceRadius, 1));
  const materialLabel = paintMaterialLabel(Math.round(probe.material));
  const paintLabel = brush.type === 'paintMaterial' ? ` | Paint ${paintMaterialLabel(brush.material)}` : '';
  const strengthLabel = brush.type === 'smoothDensity' || brush.type === 'flattenDensity' ? ` | strength ${brush.strength.toFixed(2)}` : '';
  const waterLabel = probe.waterId > 0 ? `water ${probe.waterId}` : 'dry';

  return {
    summary: `${brushModeLabel(settings.brushMode)} ${brushShapeLabel(brush.shape)} | r ${brush.radius.toFixed(1)}m | influence ${influenceRadius.toFixed(1)}m | falloff ${falloff.toFixed(2)}m${paintLabel}${strengthLabel}`,
    detail: `Target ${target[0].toFixed(1)}, ${target[1].toFixed(1)}, ${target[2].toFixed(1)} | surface ${heightDelta >= 0 ? '+' : ''}${heightDelta.toFixed(1)}m | ${biomeIdLabel(probe.biomeId)} / ${materialLabel} | river ${probe.riverDistance.toFixed(0)}m | cave ${probe.caveDistance.toFixed(1)}m | ${waterLabel}`,
    bars: [
      inspectorBar('Influence', 'Core extent', coreExtent / influenceRadius, `${coreExtent.toFixed(1)}m`, 'core'),
      inspectorBar('Influence', 'Falloff band', falloff / influenceRadius, `${falloff.toFixed(2)}m`, 'falloff'),
      inspectorBar('Influence', 'Surface cover', surfaceCoverage, formatInspectorPercent(surfaceCoverage), 'core'),
      inspectorBar('Influence', 'Cave cover', caveCoverage, formatInspectorPercent(caveCoverage), 'cave'),
      inspectorBar('Materials', 'Grass', probe.materialWeights.grass, formatInspectorPercent(probe.materialWeights.grass), 'grass'),
      inspectorBar('Materials', 'Rock', probe.materialWeights.rock, formatInspectorPercent(probe.materialWeights.rock), 'rock'),
      inspectorBar('Materials', 'Snow', probe.materialWeights.snow, formatInspectorPercent(probe.materialWeights.snow), 'snow'),
      inspectorBar('Materials', 'Mud', probe.materialWeights.mud, formatInspectorPercent(probe.materialWeights.mud), 'mud'),
      inspectorBar('Material Field', 'Roughness', probe.materialField.roughness, formatInspectorPercent(probe.materialField.roughness), 'rock'),
      inspectorBar('Material Field', 'Fertility', probe.materialField.fertility, formatInspectorPercent(probe.materialField.fertility), 'grass'),
      inspectorBar('Material Field', 'Stability', probe.materialField.stability, formatInspectorPercent(probe.materialField.stability), 'mask'),
      inspectorBar('Material Field', 'Shoreline', probe.materialField.shoreline, formatInspectorPercent(probe.materialField.shoreline), 'water'),
      inspectorBar('Material Field', 'Cave surf', probe.materialField.caveSurface, formatInspectorPercent(probe.materialField.caveSurface), 'cave'),
      inspectorBar('Material Field', 'Route cost', probe.materialField.routeCost, formatInspectorPercent(probe.materialField.routeCost), 'mud'),
      inspectorBar('Material Field', 'Blend conf', probe.materialField.blendConfidence, formatInspectorPercent(probe.materialField.blendConfidence), 'biome'),
      inspectorBar('Biomes', 'Meadow', probe.biomeWeights.meadow, formatInspectorPercent(probe.biomeWeights.meadow), 'biome'),
      inspectorBar('Biomes', 'River', probe.biomeWeights.riverValley, formatInspectorPercent(probe.biomeWeights.riverValley), 'water'),
      inspectorBar('Biomes', 'Snow', probe.biomeWeights.alpineSnow, formatInspectorPercent(probe.biomeWeights.alpineSnow), 'snow'),
      inspectorBar('Biomes', 'Ridge', probe.biomeWeights.exposedRidge, formatInspectorPercent(probe.biomeWeights.exposedRidge), 'rock'),
      inspectorBar('Biomes', 'Forest', probe.biomeWeights.forestEdge, formatInspectorPercent(probe.biomeWeights.forestEdge), 'grass'),
      inspectorBar('Biomes', 'Dry', probe.biomeWeights.drySlope, formatInspectorPercent(probe.biomeWeights.drySlope), 'mud'),
      inspectorBar('Masks', 'Drainage', probe.drainage, formatInspectorPercent(probe.drainage), 'water'),
      inspectorBar('Masks', 'Erosion', probe.erosion, formatInspectorPercent(probe.erosion), 'mask'),
      inspectorBar('Masks', 'Vegetation', probe.vegetation, formatInspectorPercent(probe.vegetation), 'grass'),
      inspectorBar('Masks', 'Wetness', probe.wetness, formatInspectorPercent(probe.wetness), 'water'),
      inspectorBar('Masks', 'Snow mask', probe.snow, formatInspectorPercent(probe.snow), 'snow'),
    ],
  };
}

function formatWorldgenTileStats(stats: WorldgenTileStats): string {
  const bestPriority = stats.workerQueueBestPriority === null ? '-' : stats.workerQueueBestPriority.toFixed(0);
  const queueOwner = stats.workerQueueCenterKey ? ` center ${stats.workerQueueCenterKey}` : '';
  const lastDispatched = stats.workerQueueLastDispatchedKey ? ` dispatched ${stats.workerQueueLastDispatchedKey}` : '';
  return `${stats.cachedTiles}/${stats.maxTiles} cached (${stats.nativeTiles} native/${stats.persistedTiles} persisted), hits/misses ${stats.hits}/${stats.misses}, evictions ${stats.evictions}, generated ${stats.generatedTiles} tiles/${stats.generatedSamples} samples, prefetch ${stats.prefetchCenters}/${stats.prefetchTiles}, worker req/resp/pending/queued ${stats.workerRequests}/${stats.workerResponses}/${stats.workerPending}/${stats.workerQueued}, queue best/drop/reprio ${bestPriority}/${stats.workerQueueDropped}/${stats.workerQueueReprioritized}${queueOwner}${lastDispatched}, rejected ${stats.workerRejected}, adopted ${stats.workerAdoptedTiles}, ${(stats.workerBytes / (1024 * 1024)).toFixed(2)} MB, persisted load/hit/miss/pending/save/fail/invalid/pruned ${stats.persistenceLoads}/${stats.persistenceHits}/${stats.persistenceMisses}/${stats.persistencePending}/${stats.persistenceSaves}/${stats.persistenceFailures}/${stats.persistenceInvalidated}/${stats.persistencePruned}, ${(stats.persistenceBytes / (1024 * 1024)).toFixed(2)} MB, ${stats.tileSize}m ${stats.resolution}x${stats.resolution}${stats.lastTileKey ? `, last ${stats.lastTileKey}` : ''}`;
}

function formatCaveGraphStats(stats: CaveGraphTileStats): string {
  const last = stats.lastTileKey ? `, last ${stats.lastTileKey}` : '';
  const bestPriority = stats.workerQueueBestPriority === null ? '-' : stats.workerQueueBestPriority.toFixed(0);
  const queueOwner = stats.workerQueueCenterKey ? ` center ${stats.workerQueueCenterKey}` : '';
  const lastDispatched = stats.workerQueueLastDispatchedKey ? ` dispatched ${stats.workerQueueLastDispatchedKey}` : '';
  return `${stats.cachedTiles}/${stats.maxTiles} cached (${stats.nativeTiles} native/${stats.persistedTiles} persisted), pass/branch/chamb/shaft ${stats.passages}/${stats.branches}/${stats.chambers}/${stats.shafts}, hits/misses ${stats.hits}/${stats.misses}, evictions ${stats.evictions}, prefetch ${stats.prefetchCenters}/${stats.prefetchTiles}, generated ${stats.generatedTiles}, worker req/resp/pending/queued ${stats.workerRequests}/${stats.workerResponses}/${stats.workerPending}/${stats.workerQueued}, queue best/drop/reprio ${bestPriority}/${stats.workerQueueDropped}/${stats.workerQueueReprioritized}${queueOwner}${lastDispatched}, rejected ${stats.workerRejected}, adopted ${stats.workerAdoptedTiles}, ${(stats.workerBytes / 1024).toFixed(1)} KB, persisted load/hit/miss/pending/save/fail/invalid/pruned ${stats.persistenceLoads}/${stats.persistenceHits}/${stats.persistenceMisses}/${stats.persistencePending}/${stats.persistenceSaves}/${stats.persistenceFailures}/${stats.persistenceInvalidated}/${stats.persistencePruned}, records ${stats.persistenceRecords}, ${(stats.persistenceBytes / 1024).toFixed(1)} KB, ${stats.persistenceMode}, schema/gen ${stats.schemaVersion}/${stats.generatorVersion}, ${stats.tileSize}m${last}`;
}

function formatErosionTileStats(stats: ErosionTileStats): string {
  const last = stats.lastTileKey ? `, last ${stats.lastTileKey}` : '';
  const bestPriority = stats.workerQueueBestPriority === null ? '-' : stats.workerQueueBestPriority.toFixed(0);
  const queueOwner = stats.workerQueueCenterKey ? ` center ${stats.workerQueueCenterKey}` : '';
  const lastDispatched = stats.workerQueueLastDispatchedKey ? ` dispatched ${stats.workerQueueLastDispatchedKey}` : '';
  return `${stats.cachedTiles}/${stats.maxTiles} cached (${stats.nativeTiles} native/${stats.persistedTiles} persisted), hits/misses ${stats.hits}/${stats.misses}, evictions ${stats.evictions}, prefetch ${stats.prefetchCenters}/${stats.prefetchTiles}, generated ${stats.generatedTiles} tiles/${stats.generatedSamples} samples, worker req/resp/pending/queued ${stats.workerRequests}/${stats.workerResponses}/${stats.workerPending}/${stats.workerQueued}, queue best/drop/reprio ${bestPriority}/${stats.workerQueueDropped}/${stats.workerQueueReprioritized}${queueOwner}${lastDispatched}, rejected ${stats.workerRejected}, adopted ${stats.workerAdoptedTiles}, ${(stats.workerBytes / 1024).toFixed(1)} KB, persisted load/hit/miss/pending/save/fail/invalid/pruned ${stats.persistenceLoads}/${stats.persistenceHits}/${stats.persistenceMisses}/${stats.persistencePending}/${stats.persistenceSaves}/${stats.persistenceFailures}/${stats.persistenceInvalidated}/${stats.persistencePruned}, records ${stats.persistenceRecords}, ${(stats.persistenceBytes / 1024).toFixed(1)} KB, schema/gen ${stats.schemaVersion}/${stats.generatorVersion}, ${stats.tileSize}m ${stats.resolution}x${stats.resolution}${last}`;
}

function formatMaterialTileStats(stats: MaterialTileStats): string {
  const last = stats.lastTileKey ? `, last ${stats.lastTileKey}` : '';
  const bestPriority = stats.workerQueueBestPriority === null ? '-' : stats.workerQueueBestPriority.toFixed(0);
  const queueOwner = stats.workerQueueCenterKey ? ` center ${stats.workerQueueCenterKey}` : '';
  const lastDispatched = stats.workerQueueLastDispatchedKey ? ` dispatched ${stats.workerQueueLastDispatchedKey}` : '';
  return `${stats.cachedTiles}/${stats.maxTiles} cached, native/persisted ${stats.nativeTiles}/${stats.persistedTiles}, hits/misses ${stats.hits}/${stats.misses}, generated ${stats.generatedTiles} tiles/${stats.generatedSamples} samples, worker req/res ${stats.workerRequests}/${stats.workerResponses} queued/pending ${stats.workerQueued}/${stats.workerPending} best ${bestPriority}${queueOwner}${lastDispatched} adopted ${stats.workerAdoptedTiles}, persisted hit/miss/save ${stats.persistenceHits}/${stats.persistenceMisses}/${stats.persistenceSaves} records ${stats.persistenceRecords}, schema/gen ${stats.schemaVersion}/${stats.generatorVersion}, ${stats.tileSize}m ${stats.resolution}x${stats.resolution}${last}`;
}

function editShape(edit: EditOperation): BrushShape {
  return edit.shape ?? 'sphere';
}

function editLength(edit: EditOperation): number {
  return Math.max(0, edit.length ?? 0);
}

function editInfluenceRadius(edit: EditOperation): number {
  const radius = Math.max(0, edit.radius);
  const shape = editShape(edit);
  const falloff = edit.type === 'subtractSphere' || edit.type === 'addSphere'
    ? clampNumber(edit.falloff, 0, 8, 0)
    : 0;
  if (shape === 'box') return radius * Math.sqrt(3) + falloff;
  if (shape === 'capsule') return radius + editLength(edit) * 0.5 + falloff;
  return radius + falloff;
}

function brushInfluenceRadius(options: BrushOptions): number {
  const radius = Math.max(0, options.radius);
  const falloff = options.type === 'subtractSphere' || options.type === 'addSphere'
    ? clampNumber(options.falloff, 0, 8, 0)
    : 0;
  if (options.shape === 'box') return radius * Math.sqrt(3) + falloff;
  if (options.shape === 'capsule') return radius + Math.max(0, options.length) * 0.5 + falloff;
  return radius + falloff;
}

function brushPreviewMarkerInstances(camera: FlyCamera, options: BrushOptions): Float32Array {
  const target = add(camera.position, scale(camera.forward(), options.distance));
  return new Float32Array([target[0], target[1], target[2], Math.max(brushInfluenceRadius(options), 2)]);
}

function combineMarkerInstances(a: Float32Array | null, b: Float32Array | null): Float32Array {
  if (!a?.length) return b ?? new Float32Array();
  if (!b?.length) return a;
  const combined = new Float32Array(a.length + b.length);
  combined.set(a, 0);
  combined.set(b, a.length);
  return combined;
}

function normalizeBrushDirection(direction: Vec3): Vec3 {
  const len = Math.hypot(direction[0], direction[1], direction[2]);
  if (len <= 0.0001) return vec3(0, 0, 1);
  return vec3(direction[0] / len, direction[1] / len, direction[2] / len);
}

function defaultRegionSlotNames(): string[] {
  return REGION_SLOTS.map(slot => slot.name);
}

function sanitizeRegionSlotName(value: unknown, index: number): string {
  const fallback = REGION_SLOTS[index]?.name ?? `Region ${index + 1}`;
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, 40) : fallback;
}

function loadRegionSlotNames(): string[] {
  try {
    const raw = localStorage.getItem(REGION_SLOT_NAMES_STORAGE_KEY);
    const names = raw ? JSON.parse(raw) as unknown[] : [];
    return REGION_SLOTS.map((slot, index) => sanitizeRegionSlotName(names[index] ?? slot.name, index));
  } catch {
    return defaultRegionSlotNames();
  }
}

function saveRegionSlotNames(names: string[]): void {
  try {
    localStorage.setItem(REGION_SLOT_NAMES_STORAGE_KEY, JSON.stringify(REGION_SLOTS.map((_, index) => sanitizeRegionSlotName(names[index], index))));
  } catch {
    // Slot display names are a convenience layer over IndexedDB metadata.
  }
}

function regionSlotFromSettings(settings: EngineSettings, names = defaultRegionSlotNames()): { key: string; name: string; index: number } {
  const index = clampInt(settings.regionSlot, 0, REGION_SLOTS.length - 1);
  const slot = REGION_SLOTS[index];
  return { key: slot.key, name: sanitizeRegionSlotName(names[index] ?? slot.name, index), index };
}

function mixHash(hash: number, value: number): number {
  return Math.imul((hash ^ value) >>> 0, 16777619) >>> 0;
}

function arrayFingerprint(array: ArrayBufferView): number {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let hash = mixHash(2166136261, bytes.byteLength);
  for (let i = 0; i < bytes.length; i++) hash = mixHash(hash, bytes[i]);
  return hash >>> 0;
}

function chunkFingerprint(chunk: PersistedChunkMesh): number {
  let hash = 2166136261;
  hash = mixHash(hash, chunk.cx);
  hash = mixHash(hash, chunk.cy);
  hash = mixHash(hash, chunk.cz);
  hash = mixHash(hash, chunk.lod);
  hash = mixHash(hash, chunk.stats.vertexCount ?? chunk.vertices.byteLength);
  hash = mixHash(hash, chunk.stats.indexCount ?? chunk.indices.length);
  hash = mixHash(hash, chunk.stats.densityCount ?? chunk.densitySamples.length);
  hash = mixHash(hash, arrayFingerprint(chunk.vertices));
  hash = mixHash(hash, arrayFingerprint(chunk.indices));
  hash = mixHash(hash, arrayFingerprint(chunk.densitySamples));
  hash = mixHash(hash, arrayFingerprint(chunk.vegetation));
  return hash >>> 0;
}

function editIdSet(edits: EditOperation[]): Set<number> {
  return new Set(edits.map(edit => edit.id));
}

function editSignature(edit: EditOperation): string {
  const shape = editShape(edit);
  const dx = edit.dx ?? 0;
  const dy = edit.dy ?? 0;
  const dz = edit.dz ?? 1;
  const length = shape === 'capsule' ? editLength(edit) : 0;
  const falloff = edit.type === 'subtractSphere' || edit.type === 'addSphere' ? clampNumber(edit.falloff, 0, 8, 0) : 0;
  const material = edit.type === 'paintMaterial' ? clampInt(edit.material ?? DEFAULT_ENGINE_SETTINGS.paintMaterial, PAINT_MATERIAL_GRASS, PAINT_MATERIAL_MUD) : 0;
  const strength = edit.type === 'smoothDensity' || edit.type === 'flattenDensity' ? clampNumber(edit.strength, 0.05, 1, DEFAULT_ENGINE_SETTINGS.brushStrength) : 0;
  return `${edit.type}:${shape}:${edit.x.toFixed(3)}:${edit.y.toFixed(3)}:${edit.z.toFixed(3)}:${edit.radius.toFixed(3)}:${dx.toFixed(3)}:${dy.toFixed(3)}:${dz.toFixed(3)}:${length.toFixed(3)}:${falloff.toFixed(3)}:${material}:${strength.toFixed(3)}`;
}

function cloneEditOperation(edit: EditOperation): EditOperation {
  return { ...edit };
}

function cloneEditLog(edits: EditOperation[]): EditOperation[] {
  return edits.map(cloneEditOperation);
}

function editBranchOperationCount(branches: EditHistoryBranch[]): number {
  return branches.reduce((total, branch) => total + branch.edits.length, 0);
}

function editBranchSignature(branch: EditHistoryBranch): string {
  return [
    branch.baseEditId,
    branch.baseEditCount,
    ...branch.edits.map(editSignature),
  ].join('|');
}

function editLogsEquivalent(left: EditOperation[], right: EditOperation[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (editSignature(left[i]) !== editSignature(right[i])) return false;
  }
  return true;
}

function editBranchesEquivalent(left: EditHistoryBranch[], right: EditHistoryBranch[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (editBranchSignature(left[i]) !== editBranchSignature(right[i])) return false;
  }
  return true;
}

function countSetIntersection<T>(left: Set<T>, right: Set<T>): number {
  let count = 0;
  for (const value of left) if (right.has(value)) count++;
  return count;
}

function createRegionDiff(
  active: Omit<RegionSnapshot, 'savedAt'>,
  saved: RegionSnapshot | null,
  slotName: string,
): RegionDiffSummary {
  const activeBranches = active.editBranches ?? [];
  const savedBranches = saved?.editBranches ?? [];
  const activeEditIds = editIdSet(active.editLog);
  const savedEditIds = editIdSet(saved?.editLog ?? []);
  const commonEditIds = countSetIntersection(activeEditIds, savedEditIds);
  const activeEditById = new Map(active.editLog.map((edit, index) => [edit.id, { edit, index }]));
  const savedEditById = new Map((saved?.editLog ?? []).map((edit, index) => [edit.id, { edit, index }]));
  let matchingCommonEditIds = 0;
  const changedEditSamples: RegionChangedEditDiffSample[] = [];
  for (const [id, activeEdit] of activeEditById) {
    const savedEdit = savedEditById.get(id);
    if (!savedEdit) continue;
    if (editSignature(activeEdit.edit) === editSignature(savedEdit.edit)) {
      matchingCommonEditIds++;
    } else if (changedEditSamples.length < MAX_REGION_EDIT_DIFF_SAMPLES) {
      changedEditSamples.push({
        id,
        active: regionEditDiffSample(activeEdit.edit, activeEdit.index, 'changed-active'),
        saved: regionEditDiffSample(savedEdit.edit, savedEdit.index, 'changed-saved'),
      });
    }
  }
  const changedCommonEditIds = Math.max(0, commonEditIds - matchingCommonEditIds);
  const activeOnlyEditSamples = active.editLog
    .map((edit, index) => ({ edit, index }))
    .filter(({ edit }) => !savedEditIds.has(edit.id))
    .slice(0, MAX_REGION_EDIT_DIFF_SAMPLES)
    .map(({ edit, index }) => regionEditDiffSample(edit, index, 'active-only'));
  const savedOnlyEditSamples = (saved?.editLog ?? [])
    .map((edit, index) => ({ edit, index }))
    .filter(({ edit }) => !activeEditIds.has(edit.id))
    .slice(0, MAX_REGION_EDIT_DIFF_SAMPLES)
    .map(({ edit, index }) => regionEditDiffSample(edit, index, 'saved-only'));
  const activeBranchSignatures = new Map(activeBranches.map(branch => [editBranchSignature(branch), branch]));
  const savedBranchSignatures = new Map(savedBranches.map(branch => [editBranchSignature(branch), branch]));
  const matchingEditBranches = countSetIntersection(new Set(activeBranchSignatures.keys()), new Set(savedBranchSignatures.keys()));
  const activeOnlyBranchSamples = [...activeBranchSignatures]
    .filter(([signature]) => !savedBranchSignatures.has(signature))
    .slice(0, MAX_REGION_EDIT_DIFF_SAMPLES)
    .map(([, branch]) => regionEditBranchDiffSample(branch, 'active-only'));
  const savedOnlyBranchSamples = [...savedBranchSignatures]
    .filter(([signature]) => !activeBranchSignatures.has(signature))
    .slice(0, MAX_REGION_EDIT_DIFF_SAMPLES)
    .map(([, branch]) => regionEditBranchDiffSample(branch, 'saved-only'));
  if (!saved) {
    return {
      slotName,
      status: 'missing',
      comparedAt: Date.now(),
      savedAt: 0,
      activeChunks: active.chunks.length,
      savedChunks: 0,
      commonChunks: 0,
      matchingCommonChunks: 0,
      changedCommonChunks: 0,
      activeOnlyChunks: active.chunks.length,
      savedOnlyChunks: 0,
      activeEdits: active.editLog.length,
      savedEdits: 0,
      activeRedoEdits: active.undoneEdits.length,
      savedRedoEdits: 0,
      activeEditBranches: active.editBranches?.length ?? 0,
      savedEditBranches: 0,
      activeBranchEdits: editBranchOperationCount(activeBranches),
      savedBranchEdits: 0,
      commonEditIds: 0,
      matchingCommonEditIds: 0,
      changedCommonEditIds: 0,
      activeOnlyEditIds: activeEditIds.size,
      savedOnlyEditIds: 0,
      activeOnlyEditSamples,
      savedOnlyEditSamples: [],
      changedEditSamples: [],
      matchingEditBranches: 0,
      activeOnlyEditBranches: activeBranches.length,
      savedOnlyEditBranches: 0,
      activeOnlyBranchSamples,
      savedOnlyBranchSamples: [],
      savedCompressionRatio: 1,
    };
  }

  const savedFingerprints = new Map<string, number>();
  for (const chunk of saved.chunks) savedFingerprints.set(chunk.key, chunkFingerprint(chunk));

  let commonChunks = 0;
  let matchingCommonChunks = 0;
  let changedCommonChunks = 0;
  let activeOnlyChunks = 0;
  for (const chunk of active.chunks) {
    const savedFingerprint = savedFingerprints.get(chunk.key);
    if (savedFingerprint === undefined) {
      activeOnlyChunks++;
      continue;
    }
    commonChunks++;
    if (chunkFingerprint(chunk) === savedFingerprint) matchingCommonChunks++;
    else changedCommonChunks++;
  }

  return {
    slotName,
    status: 'compared',
    comparedAt: Date.now(),
    savedAt: saved.savedAt,
    activeChunks: active.chunks.length,
    savedChunks: saved.chunks.length,
    commonChunks,
    matchingCommonChunks,
    changedCommonChunks,
    activeOnlyChunks,
    savedOnlyChunks: Math.max(0, saved.chunks.length - commonChunks),
    activeEdits: active.editLog.length,
    savedEdits: saved.editLog.length,
    activeRedoEdits: active.undoneEdits.length,
    savedRedoEdits: saved.undoneEdits.length,
    activeEditBranches: activeBranches.length,
    savedEditBranches: savedBranches.length,
    activeBranchEdits: editBranchOperationCount(activeBranches),
    savedBranchEdits: editBranchOperationCount(savedBranches),
    commonEditIds,
    matchingCommonEditIds,
    changedCommonEditIds,
    activeOnlyEditIds: Math.max(0, activeEditIds.size - commonEditIds),
    savedOnlyEditIds: Math.max(0, savedEditIds.size - commonEditIds),
    activeOnlyEditSamples,
    savedOnlyEditSamples,
    changedEditSamples,
    matchingEditBranches,
    activeOnlyEditBranches: Math.max(0, activeBranches.length - matchingEditBranches),
    savedOnlyEditBranches: Math.max(0, savedBranches.length - matchingEditBranches),
    activeOnlyBranchSamples,
    savedOnlyBranchSamples,
    savedCompressionRatio: saved.compression?.ratio ?? 1,
  };
}

function densityAxisFromSettings(settings: EngineSettings): DensitySliceSnapshot['axis'] {
  if (settings.densitySliceAxis === DENSITY_AXIS_X) return 'x';
  if (settings.densitySliceAxis === DENSITY_AXIS_Z) return 'z';
  return 'y';
}

function cloneDensitySlice(slice: DensitySliceSnapshot, capturedAt = Date.now()): DensitySliceCapture {
  return {
    ...slice,
    values: new Int16Array(slice.values),
    capturedAt,
  };
}

function serializeDensityCapture(capture: DensitySliceCapture): StoredDensitySliceCapture {
  return {
    ...capture,
    values: Array.from(capture.values),
  };
}

function serializeDensitySliceSnapshot(slice: DensitySliceSnapshot | null): SerializedDensitySliceSnapshot | null {
  return slice ? { ...slice, values: Array.from(slice.values) } : null;
}

function densitySetId(): string {
  return `set-${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000).toString(36)}`;
}

function sanitizeDensitySetName(value: unknown, fallback = 'Default Set'): string {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, 36) : fallback;
}

function restoreDensityCapture(raw: unknown): DensitySliceCapture | null {
  const capture = raw as Partial<StoredDensitySliceCapture> | null | undefined;
  if (!capture || !Array.isArray(capture.values)) return null;
  const axis = capture.axis === 'x' || capture.axis === 'z' ? capture.axis : 'y';
  const size = clampInt(Number(capture.size) || DENSITY_GRID_N, 1, DENSITY_GRID_N);
  const values = new Int16Array(size * size);
  for (let i = 0; i < Math.min(values.length, capture.values.length); i++) values[i] = clampInt(Number(capture.values[i]) || 0, -32768, 32767);
  return {
    key: String(capture.key ?? 'capture'),
    cx: clampInt(Number(capture.cx) || 0, -1_000_000, 1_000_000),
    cy: clampInt(Number(capture.cy) || 0, -1_000_000, 1_000_000),
    cz: clampInt(Number(capture.cz) || 0, -1_000_000, 1_000_000),
    axis,
    sliceIndex: clampInt(Number(capture.sliceIndex) || 0, 0, size - 1),
    size,
    scale: clampNumber(capture.scale, 1, 1_000_000, DENSITY_SCALE),
    min: clampNumber(capture.min, -32768, 32767, 0),
    max: clampNumber(capture.max, -32768, 32767, 0),
    values,
    capturedAt: clampNumber(capture.capturedAt, 0, Number.MAX_SAFE_INTEGER, Date.now()),
  };
}

function createDensityCaptureSet(
  captures: DensitySliceCapture[] = [],
  selectedIndex = -1,
  name = 'Default Set',
  id = densitySetId(),
  createdAt = Date.now(),
  updatedAt = Date.now(),
): DensityCaptureSet {
  const limited = captures.slice(-MAX_DENSITY_CAPTURES);
  return {
    id,
    name: sanitizeDensitySetName(name),
    captures: limited,
    selectedIndex: limited.length === 0 ? -1 : clampInt(selectedIndex, 0, limited.length - 1),
    createdAt,
    updatedAt,
  };
}

function serializeDensitySet(set: DensityCaptureSet): StoredDensityCaptureSet {
  return {
    id: set.id,
    name: set.name,
    captures: set.captures.map(serializeDensityCapture),
    selectedIndex: set.selectedIndex,
    createdAt: set.createdAt,
    updatedAt: set.updatedAt,
  };
}

function serializeDensityLibrary(library: DensityCaptureLibrary): StoredDensityCaptureLibrary {
  const selected = selectedDensitySet(library);
  return {
    sets: library.sets.map(serializeDensitySet),
    selectedSetIndex: library.selectedSetIndex,
    captures: selected.captures.map(serializeDensityCapture),
    selectedIndex: selected.selectedIndex,
    name: selected.name,
  };
}

function normalizeDensityLibrary(sets: DensityCaptureSet[], selectedSetIndex: number): DensityCaptureLibrary {
  const limited = sets.length > 0 ? sets.slice(-MAX_DENSITY_CAPTURE_SETS) : [createDensityCaptureSet()];
  return {
    sets: limited,
    selectedSetIndex: clampInt(selectedSetIndex, 0, limited.length - 1),
  };
}

function restoreDensitySet(raw: unknown, fallbackName = 'Imported Set'): DensityCaptureSet | null {
  const stored = raw as Partial<StoredDensityCaptureSet> | null | undefined;
  if (!stored || !Array.isArray(stored.captures)) return null;
  const captures = stored.captures
    .map(restoreDensityCapture)
    .filter((capture): capture is DensitySliceCapture => capture !== null);
  return createDensityCaptureSet(
    captures,
    Number(stored.selectedIndex) || 0,
    sanitizeDensitySetName(stored.name, fallbackName),
    String(stored.id ?? densitySetId()),
    clampNumber(stored.createdAt, 0, Number.MAX_SAFE_INTEGER, Date.now()),
    clampNumber(stored.updatedAt, 0, Number.MAX_SAFE_INTEGER, Date.now()),
  );
}

function restoreDensityLibrary(raw: unknown): DensityCaptureLibrary | null {
  const stored = raw as Partial<StoredDensityCaptureLibrary> | null | undefined;
  if (!stored) return null;
  if (Array.isArray(stored.sets)) {
    const sets = stored.sets
      .map((set, index) => restoreDensitySet(set, `Set ${index + 1}`))
      .filter((set): set is DensityCaptureSet => set !== null);
    return normalizeDensityLibrary(sets, Number(stored.selectedSetIndex) || 0);
  }
  if (!Array.isArray(stored.captures)) return null;
  const set = restoreDensitySet({
    name: stored.name ?? 'Default Set',
    captures: stored.captures,
    selectedIndex: stored.selectedIndex ?? 0,
  }, 'Default Set');
  return set ? normalizeDensityLibrary([set], 0) : null;
}

function restoreImportedDensityLibrary(raw: unknown): DensityCaptureLibrary | null {
  const body = raw as Partial<StoredDensityCaptureLibrary & { type: string }> | null | undefined;
  if (!body || (!Array.isArray(body.captures) && !Array.isArray(body.sets))) return null;
  if (body.type && body.type !== 'density-slice-captures') return null;
  return restoreDensityLibrary(body);
}

function loadDensityCaptureLibrary(): DensityCaptureLibrary {
  try {
    const rawLibrary = localStorage.getItem(DENSITY_CAPTURE_LIBRARY_STORAGE_KEY);
    const library = rawLibrary ? restoreDensityLibrary(JSON.parse(rawLibrary)) : null;
    if (library) return library;
    const rawLegacyCapture = localStorage.getItem(DENSITY_CAPTURE_STORAGE_KEY);
    const legacyCapture = rawLegacyCapture ? restoreDensityCapture(JSON.parse(rawLegacyCapture)) : null;
    return legacyCapture
      ? normalizeDensityLibrary([createDensityCaptureSet([legacyCapture], 0, 'Default Set')], 0)
      : normalizeDensityLibrary([], 0);
  } catch {
    return normalizeDensityLibrary([], 0);
  }
}

function saveDensityCaptureLibrary(library: DensityCaptureLibrary): void {
  try {
    localStorage.setItem(DENSITY_CAPTURE_LIBRARY_STORAGE_KEY, JSON.stringify(serializeDensityLibrary(library)));
  } catch {
    // Capture persistence is diagnostic only; keep the in-memory library when storage is unavailable.
  }
}

function addDensityCapture(library: DensityCaptureLibrary, slice: DensitySliceSnapshot): DensityCaptureLibrary {
  const now = Date.now();
  const sets = library.sets.map((set, index) => {
    if (index !== library.selectedSetIndex) return set;
    const captures = [...set.captures, cloneDensitySlice(slice, now)];
    return createDensityCaptureSet(captures, captures.length - 1, set.name, set.id, set.createdAt, now);
  });
  const next = normalizeDensityLibrary(sets, library.selectedSetIndex);
  saveDensityCaptureLibrary(next);
  return next;
}

function mergeDensityCaptureLibrary(library: DensityCaptureLibrary, imported: DensityCaptureLibrary): DensityCaptureLibrary {
  const importedSets = imported.sets.map(set => createDensityCaptureSet(
    set.captures.map(capture => cloneDensitySlice(capture, capture.capturedAt)),
    set.selectedIndex,
    set.name,
    densitySetId(),
    set.createdAt,
    Date.now(),
  ));
  const next = normalizeDensityLibrary([...library.sets, ...importedSets], library.sets.length + importedSets.length - 1);
  saveDensityCaptureLibrary(next);
  return next;
}

function selectedDensitySet(library: DensityCaptureLibrary): DensityCaptureSet {
  return library.sets[library.selectedSetIndex] ?? library.sets[0] ?? createDensityCaptureSet();
}

function densityCaptureCount(library: DensityCaptureLibrary): number {
  return library.sets.reduce((sum, set) => sum + set.captures.length, 0);
}

function selectedDensityCapture(library: DensityCaptureLibrary): DensitySliceCapture | null {
  const set = selectedDensitySet(library);
  return set.selectedIndex >= 0 ? set.captures[set.selectedIndex] ?? null : null;
}

function selectDensityCapture(library: DensityCaptureLibrary, step: number): DensityCaptureLibrary {
  const sets = library.sets.map((set, index) => {
    if (index !== library.selectedSetIndex || set.captures.length === 0) return set;
    const selectedIndex = (set.selectedIndex + step + set.captures.length) % set.captures.length;
    return { ...set, selectedIndex };
  });
  const next = normalizeDensityLibrary(sets, library.selectedSetIndex);
  saveDensityCaptureLibrary(next);
  return next;
}

function selectDensityCaptureSet(library: DensityCaptureLibrary, step: number): DensityCaptureLibrary {
  if (library.sets.length === 0) return library;
  const next = {
    ...library,
    selectedSetIndex: (library.selectedSetIndex + step + library.sets.length) % library.sets.length,
  };
  saveDensityCaptureLibrary(next);
  return next;
}

function addDensityCaptureSet(library: DensityCaptureLibrary, name: string): DensityCaptureLibrary {
  const next = normalizeDensityLibrary([...library.sets, createDensityCaptureSet([], -1, name)], library.sets.length);
  saveDensityCaptureLibrary(next);
  return next;
}

function renameDensityCaptureSet(library: DensityCaptureLibrary, name: string): DensityCaptureLibrary {
  const now = Date.now();
  const sets = library.sets.map((set, index) => index === library.selectedSetIndex ? { ...set, name: sanitizeDensitySetName(name, set.name), updatedAt: now } : set);
  const next = normalizeDensityLibrary(sets, library.selectedSetIndex);
  saveDensityCaptureLibrary(next);
  return next;
}

function clearDensityCaptures(): DensityCaptureLibrary {
  const next = normalizeDensityLibrary([createDensityCaptureSet()], 0);
  try {
    localStorage.removeItem(DENSITY_CAPTURE_STORAGE_KEY);
    localStorage.removeItem(DENSITY_CAPTURE_LIBRARY_STORAGE_KEY);
  } catch {
    // Diagnostic capture state can remain in memory when storage removal is unavailable.
  }
  return next;
}

function compareDensitySlices(current: DensitySliceSnapshot | null, capture: DensitySliceCapture | null): DensitySliceDiffSummary {
  const comparedAt = Date.now();
  if (!current) {
    return {
      status: 'missing-current',
      comparedAt,
      currentKey: '',
      captureKey: capture?.key ?? '',
      cells: 0,
      changedCells: 0,
      meanAbsMeters: 0,
      maxAbsMeters: 0,
    };
  }
  if (!capture) {
    return {
      status: 'missing-capture',
      comparedAt,
      currentKey: current.key,
      captureKey: '',
      cells: current.values.length,
      changedCells: 0,
      meanAbsMeters: 0,
      maxAbsMeters: 0,
    };
  }
  if (current.axis !== capture.axis || current.size !== capture.size || current.values.length !== capture.values.length) {
    return {
      status: 'incompatible',
      comparedAt,
      currentKey: current.key,
      captureKey: capture.key,
      cells: Math.min(current.values.length, capture.values.length),
      changedCells: 0,
      meanAbsMeters: 0,
      maxAbsMeters: 0,
    };
  }

  let changedCells = 0;
  let sumAbsMeters = 0;
  let maxAbsMeters = 0;
  for (let i = 0; i < current.values.length; i++) {
    const delta = Math.abs((current.values[i] / current.scale) - (capture.values[i] / capture.scale));
    if (delta > 0) changedCells++;
    sumAbsMeters += delta;
    maxAbsMeters = Math.max(maxAbsMeters, delta);
  }
  return {
    status: 'compared',
    comparedAt,
    currentKey: current.key,
    captureKey: capture.key,
    cells: current.values.length,
    changedCells,
    meanAbsMeters: current.values.length > 0 ? sumAbsMeters / current.values.length : 0,
    maxAbsMeters,
  };
}

class ChunkStreamer {
  renderer: Renderer;
  overlay: HTMLElement;
  workerCount: number;
  workers: ChunkWorker[] = [];
  idle: ChunkWorker[] = [];
  queue: ChunkJob[] = [];
  pendingChunkResults: PendingChunkResult[] = [];
  states = new Map<string, ChunkState>();
  cache = new CompressedChunkCache(CHUNK_WORLD_SIZE);
  editLog: EditOperation[] = [];
  undoneEdits: EditOperation[] = [];
  editBranches: EditHistoryBranch[] = [];
  editVersion = 0;
  nextEditId = 1;
  nextEditBranchId = 1;
  version = 1;
  streamingEnabled = true;
  terrainLodEnabled = false;
  baseStreamRadius = DEFAULT_STREAM_RADIUS;
  effectiveStreamRadius = DEFAULT_STREAM_RADIUS;
  currentTargetChunks = 0;
  requiredPlanSignature = '';
  requiredPlan: ChunkRequest[] = [];
  requiredPlanKeys = new Set<string>();
  lastStreamingCameraPosition = { x: Infinity, y: Infinity, z: Infinity };
  lastStreamingCameraMoveTime = 0;
  lastLodPlanSummary: TerrainLodPlanSummary = {
    targetChunks: 0,
    lod0Chunks: 0,
    lod1Chunks: 0,
    lod2PlusChunks: 0,
    transitionEdges: 0,
    transitionFaces: 0,
    transitionFaceBaseCells: 0,
    transitionCells: 0,
    skirtedChunks: 0,
    coveredBaseCells: 0,
    maxLod: 0,
  };
  lastStats: StreamerStats = {
    generated: 0,
    remeshed: 0,
    discarded: 0,
    avgMeshMs: 0,
    uploadMB: 0,
    densityKB: 0,
    overflow: 0,
    editCount: 0,
    redoEditCount: 0,
    editBranchCount: 0,
    editBranchEditCount: 0,
    cacheEntries: 0,
      cacheMB: 0,
      cacheHits: 0,
      cacheMisses: 0,
      pooledArrays: 0,
      pooledMB: 0,
      poolHits: 0,
      poolMisses: 0,
      workerScratchMB: 0,
      workerScratchReuses: 0,
      workerTransferMB: 0,
      workerTransferAllocations: 0,
      sharedQueuePages: 0,
      sharedQueueDispatches: 0,
      sharedQueueBatches: 0,
      sharedQueueBatchMax: 0,
      sharedQueueBytes: 0,
      sharedRemeshPages: 0,
      sharedRemeshDispatches: 0,
      sharedRemeshBytes: 0,
      sharedResultPages: 0,
      sharedResultChunks: 0,
      sharedResultBytes: 0,
      sharedResultCacheCopyBytes: 0,
      sharedResultCacheBorrowedChunks: 0,
      sharedResultCacheBorrowedBytes: 0,
      sharedResultSlotCapacity: 0,
      sharedResultSlotOccupied: 0,
      sharedResultSlotExhaustions: 0,
      sharedResultSlotReleases: 0,
      remeshFallbackDispatches: 0,
      remeshFallbackBytes: 0,
      savedRegionChunks: 0,
      loadedRegionChunks: 0,
      exportedRegionChunks: 0,
      importedRegionChunks: 0,
      regionCompressionRawMB: 0,
      regionCompressionEncodedMB: 0,
      regionCompressionRatio: 1,
      lodPlanTargetChunks: 0,
      lodPlanLod0Chunks: 0,
      lodPlanLod1Chunks: 0,
      lodPlanLod2PlusChunks: 0,
      lodPlanTransitionEdges: 0,
      lodPlanTransitionFaces: 0,
      lodPlanTransitionFaceBaseCells: 0,
      lodPlanTransitionCells: 0,
      lodPlanSkirtedChunks: 0,
      lodPlanCoveredBaseCells: 0,
      lodPlanMaxLod: 0,
      lodTransitionMeshCells: 0,
      lodTransitionMeshEmittedCells: 0,
      lodTransitionMeshTriangles: 0,
      lodTransitionMeshMissingSampleCells: 0,
      lodTransitionMeshDegenerateCells: 0,
      lodTransitionMeshNative: false,
    };
  lastRegionDiff: RegionDiffSummary | null = null;
  meshTimes: number[] = [];
  private debugEditMarkersDirty = true;
  private runtimeTransitionMeshSignature = '';
  private pendingNativeTransitionMeshSignature = '';
  private runtimeNativeTransitionMeshSignature = '';

  constructor(renderer: Renderer, overlay: HTMLElement) {
    this.renderer = renderer;
    this.overlay = overlay;
    this.workerCount = Math.min(6, Math.max(1, (navigator.hardwareConcurrency || 6) - 2));
  }

  private canUseSharedGenerateQueues(): boolean {
    return this.renderer.capabilities.crossOriginIsolated
      && this.renderer.capabilities.sharedArrayBufferAvailable
      && typeof SharedArrayBuffer !== 'undefined';
  }

  async init(): Promise<void> {
    const ready: Array<Promise<void>> = [];
    const useSharedQueues = this.canUseSharedGenerateQueues();
    for (let i = 0; i < this.workerCount; i++) {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: `voxel-worker-${i}` }) as ChunkWorker;
      worker.onmessage = (ev) => this.onWorkerMessage(worker, ev.data);
      worker.onerror = (ev) => this.showError(`Worker error: ${ev.message}`);
      this.workers.push(worker);
      ready.push(new Promise<void>((resolve) => {
        const listener = (ev: MessageEvent<WorkerOutboundMessage>) => {
          if (ev.data?.type === 'ready') {
            worker.removeEventListener('message', listener as EventListener);
            this.idle.push(worker);
            resolve();
          }
        };
        worker.addEventListener('message', listener as EventListener);
      }));
      if (useSharedQueues) {
        const buffer = new SharedArrayBuffer(SHARED_GENERATE_QUEUE_INTS * Int32Array.BYTES_PER_ELEMENT);
        worker.sharedGenerateQueue = { buffer, ints: new Int32Array(buffer), sequence: 0 };
        worker.postMessage({ type: 'initSharedQueue', queue: buffer });
        const remeshBuffer = new SharedArrayBuffer(SHARED_REMESH_DENSITY_SAMPLES * Int16Array.BYTES_PER_ELEMENT);
        worker.sharedRemeshPage = { buffer: remeshBuffer, densitySamples: new Int16Array(remeshBuffer) };
        worker.postMessage({ type: 'initSharedRemeshPage', densitySamples: remeshBuffer });
        const resultBuffer = new SharedArrayBuffer(SHARED_RESULT_ARENA_BYTES);
        worker.sharedResultArena = {
          buffer: resultBuffer,
          bytes: new Uint8Array(resultBuffer),
          slots: Array.from({ length: SHARED_RESULT_SLOT_COUNT }, (_, index) => ({
            index,
            generation: 0,
            state: 'free',
          })),
        };
        worker.postMessage({ type: 'initSharedResultArena', arena: resultBuffer, slotCount: SHARED_RESULT_SLOT_COUNT });
      }
      worker.postMessage({ type: 'init' });
    }
    await Promise.all(ready);
    this.lastStats.sharedQueuePages = this.workers.filter(worker => worker.sharedGenerateQueue).length;
    this.lastStats.sharedQueueBytes = this.lastStats.sharedQueuePages * SHARED_GENERATE_QUEUE_INTS * Int32Array.BYTES_PER_ELEMENT;
    this.lastStats.sharedRemeshPages = this.workers.filter(worker => worker.sharedRemeshPage).length;
    this.lastStats.sharedRemeshBytes = this.lastStats.sharedRemeshPages * SHARED_REMESH_DENSITY_SAMPLES * Int16Array.BYTES_PER_ELEMENT;
    this.lastStats.sharedResultPages = this.workers.filter(worker => worker.sharedResultArena).length;
    this.lastStats.sharedResultBytes = this.lastStats.sharedResultPages * SHARED_RESULT_ARENA_BYTES;
    this.lastStats.sharedResultSlotCapacity = this.lastStats.sharedResultPages * SHARED_RESULT_SLOT_COUNT;
    if (this.lastStats.sharedQueuePages > 0) this.renderer.capabilities.workerBufferMode = 'shared-queue';
    this.syncEditLog();
  }

  showError(message: string): void {
    console.error(message);
    this.overlay.textContent = message;
    this.overlay.classList.add('error');
  }

  syncEditLog(): void {
    const edits = this.editLog.map(edit => ({ ...edit }));
    for (const worker of this.workers) {
      worker.postMessage({ type: 'syncEdits', version: this.editVersion, edits });
    }
    this.lastStats.editCount = this.editLog.length;
    this.lastStats.redoEditCount = this.undoneEdits.length;
    this.lastStats.editBranchCount = this.editBranches.length;
    this.lastStats.editBranchEditCount = editBranchOperationCount(this.editBranches);
  }

  private markDebugEditMarkersDirty(): void {
    this.debugEditMarkersDirty = true;
  }

  refreshCacheStats(): void {
    const stats = this.cache.stats();
    this.lastStats.cacheEntries = stats.entries;
    this.lastStats.cacheMB = stats.bytes / (1024 * 1024);
    this.lastStats.cacheHits = stats.hits;
    this.lastStats.cacheMisses = stats.misses;
    this.lastStats.pooledArrays = stats.pooledArrays;
    this.lastStats.pooledMB = stats.pooledBytes / (1024 * 1024);
    this.lastStats.poolHits = stats.poolHits;
    this.lastStats.poolMisses = stats.poolMisses;
    this.lastStats.lodPlanTargetChunks = this.lastLodPlanSummary.targetChunks;
    this.lastStats.lodPlanLod0Chunks = this.lastLodPlanSummary.lod0Chunks;
    this.lastStats.lodPlanLod1Chunks = this.lastLodPlanSummary.lod1Chunks;
    this.lastStats.lodPlanLod2PlusChunks = this.lastLodPlanSummary.lod2PlusChunks;
    this.lastStats.lodPlanTransitionEdges = this.lastLodPlanSummary.transitionEdges;
    this.lastStats.lodPlanTransitionFaces = this.lastLodPlanSummary.transitionFaces;
    this.lastStats.lodPlanTransitionFaceBaseCells = this.lastLodPlanSummary.transitionFaceBaseCells;
    this.lastStats.lodPlanTransitionCells = this.lastLodPlanSummary.transitionCells;
    this.lastStats.lodPlanSkirtedChunks = this.lastLodPlanSummary.skirtedChunks;
    this.lastStats.lodPlanCoveredBaseCells = this.lastLodPlanSummary.coveredBaseCells;
    this.lastStats.lodPlanMaxLod = this.lastLodPlanSummary.maxLod;
  }

  private clearRuntimeLodTransitionMesh(): void {
    if (this.runtimeTransitionMeshSignature) {
      this.renderer.removeChunk(LOD_TRANSITION_MESH_KEY);
      this.runtimeTransitionMeshSignature = '';
    }
    this.pendingNativeTransitionMeshSignature = '';
    this.runtimeNativeTransitionMeshSignature = '';
    this.lastStats.lodTransitionMeshCells = 0;
    this.lastStats.lodTransitionMeshEmittedCells = 0;
    this.lastStats.lodTransitionMeshTriangles = 0;
    this.lastStats.lodTransitionMeshMissingSampleCells = 0;
    this.lastStats.lodTransitionMeshDegenerateCells = 0;
    this.lastStats.lodTransitionMeshNative = false;
  }

  private requestNativeRuntimeLodTransitionMesh(signature: string, cases: readonly TerrainLodTransitionCellCase[]): void {
    if (this.pendingNativeTransitionMeshSignature === signature || this.runtimeNativeTransitionMeshSignature === signature) return;
    const worker = this.idle.pop();
    if (!worker) return;
    const payload = buildNativeLodTransitionMeshPayload(cases);
    if (!payload) {
      this.idle.push(worker);
      return;
    }
    worker.currentLodTransitionMeshSignature = signature;
    this.pendingNativeTransitionMeshSignature = signature;
    worker.postMessage({
      type: 'generateLodTransitionMesh',
      signature,
      version: this.version,
      cellCount: payload.cellCount,
      missingSampleCells: payload.missingSampleCells,
      sides: payload.sides,
      combinedCases: payload.combinedCases,
      samples: payload.samples,
    }, [payload.sides.buffer, payload.combinedCases.buffer, payload.samples.buffer] as Transferable[]);
  }

  private updateRuntimeLodTransitionMesh(required: readonly ChunkRequest[]): void {
    if (!this.terrainLodEnabled || !this.streamingEnabled || !this.renderer.settings.nearTerrainEnabled) {
      this.clearRuntimeLodTransitionMesh();
      return;
    }
    if (this.lastLodPlanSummary.transitionCells <= 0) {
      this.clearRuntimeLodTransitionMesh();
      return;
    }

    const requests: TerrainLodRequest[] = required.map(item => ({
      key: item.key,
      cx: item.cx,
      cy: item.cy,
      cz: item.cz,
      lod: item.lod,
      priority: item.priority,
      lodSeamMask: item.lodSeamMask ?? 0,
    }));
    const sampledKeys = new Map<string, boolean>();
    const densityByKey = new Map<string, Int16Array | null>();
    const densityForKey = (key: string): Int16Array | null => {
      if (densityByKey.has(key)) return densityByKey.get(key) ?? null;
      const cached = this.cache.peek(key);
      const density = cached?.densitySamples?.length === DENSITY_GRID_N * DENSITY_GRID_N * DENSITY_GRID_N
        ? cached.densitySamples
        : null;
      densityByKey.set(key, density);
      return density;
    };
    const provider = (point: TerrainLodTransitionSamplePoint): number | null => {
      const density = densityForKey(point.chunkKey);
      sampledKeys.set(point.chunkKey, density !== null);
      if (!density) return null;
      const gx = clampInt(point.gx, 0, DENSITY_GRID_N - 1);
      const gy = clampInt(point.gy, 0, DENSITY_GRID_N - 1);
      const gz = clampInt(point.gz, 0, DENSITY_GRID_N - 1);
      return density[gx + DENSITY_GRID_N * (gy + DENSITY_GRID_N * gz)] / DENSITY_SCALE;
    };

    const cases = buildTerrainLodTransitionCases(requests, provider);
    const sampledSignature = [...sampledKeys.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, available]) => `${key}:${available ? 1 : 0}`)
      .join('|');
    const signature = `${this.version}:${this.editVersion}:${this.lastLodPlanSummary.transitionCells}:${sampledSignature}`;
    if (signature === this.runtimeTransitionMeshSignature) {
      this.requestNativeRuntimeLodTransitionMesh(signature, cases);
      return;
    }

    const mesh = buildTerrainLodTransitionMesh(cases);
    this.runtimeTransitionMeshSignature = signature;
    this.runtimeNativeTransitionMeshSignature = '';
    this.lastStats.lodTransitionMeshCells = mesh.cellCount;
    this.lastStats.lodTransitionMeshEmittedCells = mesh.emittedCells;
    this.lastStats.lodTransitionMeshTriangles = mesh.indices.length / 3;
    this.lastStats.lodTransitionMeshMissingSampleCells = mesh.missingSampleCells;
    this.lastStats.lodTransitionMeshDegenerateCells = mesh.degenerateCells;
    this.lastStats.lodTransitionMeshNative = false;

    const packed = buildPackedRuntimeLodTransitionMesh(mesh);
    if (!packed) {
      this.renderer.removeChunk(LOD_TRANSITION_MESH_KEY);
      return;
    }
    this.renderer.createChunkMesh(
      LOD_TRANSITION_MESH_KEY,
      packed.vertices,
      packed.indices,
      packed.frame,
      packed.bounds,
      {
        lod: 0,
        lodSeamMask: 0,
        lodTransitionMesh: true,
        lodTransitionMeshCells: mesh.cellCount,
        lodTransitionMeshEmittedCells: mesh.emittedCells,
        lodTransitionMeshMissingSampleCells: mesh.missingSampleCells,
        lodTransitionMeshDegenerateCells: mesh.degenerateCells,
      },
    );
    this.requestNativeRuntimeLodTransitionMesh(signature, cases);
  }

  refreshWorkerScratchStats(): void {
    let scratchBytes = 0;
    let scratchReuses = 0;
    let transferBytes = 0;
    let transferAllocations = 0;
    for (const worker of this.workers) {
      const stats = worker.scratchStats;
      if (!stats) continue;
      scratchBytes += stats.scratchBytes;
      scratchReuses += stats.scratchReuses;
      transferBytes += stats.transferBytes;
      transferAllocations += stats.transferAllocations;
    }
    this.lastStats.workerScratchMB = scratchBytes / (1024 * 1024);
    this.lastStats.workerScratchReuses = scratchReuses;
    this.lastStats.workerTransferMB = transferBytes / (1024 * 1024);
    this.lastStats.workerTransferAllocations = transferAllocations;
  }

  requestWorldgenTile(tileX: number, tileZ: number): boolean {
    const worker = this.idle.pop();
    if (!worker) return false;
    const key = `${tileX},${tileZ}`;
    worker.currentWorldgenTileKey = key;
    worker.postMessage({ type: 'generateWorldgenTile', key, tileX, tileZ });
    return true;
  }

  requestErosionTile(tileX: number, tileZ: number): boolean {
    const worker = this.idle.pop();
    if (!worker) return false;
    const key = `${tileX},${tileZ}`;
    worker.currentErosionTileKey = key;
    worker.postMessage({ type: 'generateErosionTile', key, tileX, tileZ });
    return true;
  }

  requestMaterialTile(tileX: number, tileZ: number): boolean {
    const worker = this.idle.pop();
    if (!worker) return false;
    const key = `${tileX},${tileZ}`;
    worker.currentMaterialTileKey = key;
    worker.postMessage({ type: 'generateMaterialTile', key, tileX, tileZ });
    return true;
  }

  requestCaveGraphTile(tileX: number, tileZ: number): boolean {
    const worker = this.idle.pop();
    if (!worker) return false;
    const key = `${tileX},${tileZ}`;
    worker.currentCaveGraphTileKey = key;
    worker.postMessage({ type: 'generateCaveGraphTile', key, tileX, tileZ });
    return true;
  }

  persistenceSnapshot(): Omit<RegionSnapshot, 'savedAt'> {
    return {
      editLog: cloneEditLog(this.editLog),
      undoneEdits: cloneEditLog(this.undoneEdits),
      editBranches: this.editBranches.map(branch => ({
        ...branch,
        edits: cloneEditLog(branch.edits),
      })),
      editVersion: this.editVersion,
      nextEditId: this.nextEditId,
      nextEditBranchId: this.nextEditBranchId,
      chunks: this.cache.entriesSnapshot(),
    };
  }

  private markRegionCompression(compression?: PayloadCompressionStats): void {
    if (!compression) return;
    this.lastStats.regionCompressionRawMB = compression.rawBytes / (1024 * 1024);
    this.lastStats.regionCompressionEncodedMB = compression.encodedBytes / (1024 * 1024);
    this.lastStats.regionCompressionRatio = compression.ratio;
  }

  markRegionSaved(chunkCount: number, compression?: PayloadCompressionStats): void {
    this.lastStats.savedRegionChunks = chunkCount;
    this.markRegionCompression(compression);
    this.lastRegionDiff = null;
  }

  markRegionExported(chunkCount: number, compression?: PayloadCompressionStats): void {
    this.lastStats.exportedRegionChunks = chunkCount;
    this.markRegionCompression(compression);
  }

  markRegionImported(chunkCount: number, compression?: PayloadCompressionStats): void {
    this.lastStats.importedRegionChunks = chunkCount;
    this.markRegionCompression(compression);
  }

  diffRegionSnapshot(snapshot: RegionSnapshot | null, slotName: string): RegionDiffSummary {
    const diff = createRegionDiff(this.persistenceSnapshot(), snapshot, slotName);
    this.lastRegionDiff = diff;
    if (snapshot) this.markRegionCompression(snapshot.compression);
    return diff;
  }

  loadRegionSnapshot(snapshot: RegionSnapshot): void {
    this.editLog = cloneEditLog(snapshot.editLog);
    this.undoneEdits = cloneEditLog(snapshot.undoneEdits ?? []);
    this.editBranches = (snapshot.editBranches ?? []).slice(0, MAX_EDIT_BRANCHES).map(branch => ({
      ...branch,
      edits: cloneEditLog(branch.edits),
    }));
    this.editVersion = snapshot.editVersion;
    const branchEdits = this.editBranches.flatMap(branch => branch.edits);
    const maxEditId = Math.max(0, ...this.editLog.map(edit => edit.id), ...this.undoneEdits.map(edit => edit.id), ...branchEdits.map(edit => edit.id));
    this.nextEditId = Math.max(snapshot.nextEditId, maxEditId + 1, 1);
    const maxBranchId = Math.max(0, ...this.editBranches.map(branch => branch.id));
    this.nextEditBranchId = Math.max(snapshot.nextEditBranchId ?? 1, maxBranchId + 1, 1);
    this.version++;
    this.queue.length = 0;
    this.cache.restore(snapshot.chunks);
    for (const key of [...this.states.keys()]) this.renderer.removeChunk(key);
    this.states.clear();
    this.syncEditLog();
    this.markDebugEditMarkersDirty();
    this.refreshCacheStats();
    this.lastStats.loadedRegionChunks = snapshot.chunks.length;
    this.markRegionCompression(snapshot.compression);
    this.lastRegionDiff = null;
  }

  mergeRegionSnapshot(snapshot: RegionSnapshot): RegionMergeResult {
    const sameEditHistory = editLogsEquivalent(this.editLog, snapshot.editLog)
      && editLogsEquivalent(this.undoneEdits, snapshot.undoneEdits);
    this.version++;
    this.queue.length = 0;
    for (const key of [...this.states.keys()]) this.renderer.removeChunk(key);
    this.states.clear();

    if (sameEditHistory) {
      for (const chunk of snapshot.chunks) {
        this.cache.put(
          chunk.key,
          chunk.cx,
          chunk.cy,
          chunk.cz,
          chunk.lod,
          chunk.vertices,
          chunk.indices,
          chunk.densitySamples,
          chunk.vegetation,
          chunk.frame,
          chunk.bounds,
          chunk.stats,
        );
      }
      this.mergeEditBranches(snapshot.editBranches);
      this.refreshCacheStats();
      this.markRegionCompression(snapshot.compression);
      this.lastRegionDiff = null;
      return {
        mode: 'chunks',
        consumedPayloads: true,
        importedChunks: snapshot.chunks.length,
        importedEdits: 0,
      };
    }

    const existing = new Set(this.editLog.map(editSignature));
    let addedEdits = 0;
    for (const imported of snapshot.editLog) {
      const signature = editSignature(imported);
      if (existing.has(signature)) continue;
      const edit = { ...imported, id: this.nextEditId++ };
      this.editLog.push(edit);
      existing.add(signature);
      addedEdits++;
    }
    this.undoneEdits = [];
    this.mergeEditBranches(snapshot.editBranches);
    this.cache.clear();
    this.editVersion++;
    this.syncEditLog();
    this.markDebugEditMarkersDirty();
    this.refreshCacheStats();
    this.markRegionCompression(snapshot.compression);
    this.lastRegionDiff = null;
    return {
      mode: 'edits',
      consumedPayloads: false,
      importedChunks: snapshot.chunks.length,
      importedEdits: addedEdits,
    };
  }

  private rebuildFromEditLog(): void {
    this.editVersion++;
    this.version++;
    this.queue.length = 0;
    this.cache.clear();
    this.syncEditLog();
    this.markDebugEditMarkersDirty();
    for (const key of [...this.states.keys()]) this.renderer.removeChunk(key);
    this.states.clear();
    this.refreshCacheStats();
  }

  private pushEditBranch(baseEditCount: number, edits: EditOperation[], createdAt = Date.now()): EditHistoryBranch | null {
    if (edits.length === 0) return null;
    const clampedBaseCount = clampInt(baseEditCount, 0, this.editLog.length);
    const branch: EditHistoryBranch = {
      id: this.nextEditBranchId++,
      createdAt,
      baseEditId: clampedBaseCount > 0 ? this.editLog[clampedBaseCount - 1]?.id ?? 0 : 0,
      baseEditCount: clampedBaseCount,
      edits: cloneEditLog(edits),
    };
    const signature = editBranchSignature(branch);
    this.editBranches = [
      branch,
      ...this.editBranches.filter(existing => editBranchSignature(existing) !== signature),
    ].slice(0, MAX_EDIT_BRANCHES);
    this.lastStats.editBranchCount = this.editBranches.length;
    this.lastStats.editBranchEditCount = editBranchOperationCount(this.editBranches);
    return branch;
  }

  private archiveRedoBranch(): void {
    if (this.undoneEdits.length === 0) return;
    this.pushEditBranch(this.editLog.length, [...this.undoneEdits].reverse());
  }

  private archiveActiveTailBranch(baseEditCount: number): void {
    const clampedBaseCount = clampInt(baseEditCount, 0, this.editLog.length);
    this.pushEditBranch(clampedBaseCount, this.editLog.slice(clampedBaseCount));
  }

  private editBranchBaseMatches(branch: EditHistoryBranch): boolean {
    if (branch.baseEditCount > this.editLog.length) return false;
    const base = this.editLog.slice(0, branch.baseEditCount);
    if (branch.baseEditId !== (base.length > 0 ? base[base.length - 1].id : 0)) return false;
    return true;
  }

  private mergeEditBranches(branches: EditHistoryBranch[] | undefined): number {
    if (!branches?.length) return 0;
    let added = 0;
    const existing = new Set(this.editBranches.map(editBranchSignature));
    for (const incoming of branches) {
      const branch: EditHistoryBranch = {
        ...incoming,
        id: this.nextEditBranchId++,
        edits: cloneEditLog(incoming.edits),
      };
      const signature = editBranchSignature(branch);
      if (existing.has(signature) || branch.edits.length === 0) continue;
      existing.add(signature);
      this.editBranches.unshift(branch);
      added++;
    }
    this.editBranches = this.editBranches.slice(0, MAX_EDIT_BRANCHES);
    this.lastStats.editBranchCount = this.editBranches.length;
    this.lastStats.editBranchEditCount = editBranchOperationCount(this.editBranches);
    return added;
  }

  switchEditBranch(): void {
    const index = this.editBranches.findIndex(branch => this.editBranchBaseMatches(branch));
    if (index < 0) {
      console.warn('No compatible edit branch is available for the current active edit prefix.');
      return;
    }
    const [branch] = this.editBranches.splice(index, 1);
    this.archiveActiveTailBranch(branch.baseEditCount);
    const base = this.editLog.slice(0, branch.baseEditCount);
    this.editLog = [...cloneEditLog(base), ...cloneEditLog(branch.edits)];
    this.undoneEdits = [];
    const branchMaxEditId = Math.max(0, ...branch.edits.map(edit => edit.id));
    this.nextEditId = Math.max(this.nextEditId, branchMaxEditId + 1);
    this.rebuildFromEditLog();
  }

  clearEditBranches(): void {
    if (this.editBranches.length === 0) return;
    this.editBranches.length = 0;
    this.lastStats.editBranchCount = 0;
    this.lastStats.editBranchEditCount = 0;
  }

  clearRegionPersistenceStats(): void {
    this.lastStats.savedRegionChunks = 0;
    this.lastStats.loadedRegionChunks = 0;
    this.lastStats.exportedRegionChunks = 0;
    this.lastStats.importedRegionChunks = 0;
    this.lastStats.regionCompressionRawMB = 0;
    this.lastStats.regionCompressionEncodedMB = 0;
    this.lastStats.regionCompressionRatio = 1;
    this.lastRegionDiff = null;
  }

  chunkIntersectsSphere(key: string, position: Vec3, radius: number): boolean {
    const [cx, cy, cz, lod = 0] = parseKey(key);
    const chunkWorldSize = CHUNK_WORLD_SIZE * (1 << Math.max(0, lod | 0));
    const min = vec3(cx * CHUNK_WORLD_SIZE, cy * CHUNK_WORLD_SIZE, cz * CHUNK_WORLD_SIZE);
    const max = vec3(min[0] + chunkWorldSize, min[1] + chunkWorldSize, min[2] + chunkWorldSize);
    const qx = Math.max(min[0], Math.min(position[0], max[0]));
    const qy = Math.max(min[1], Math.min(position[1], max[1]));
    const qz = Math.max(min[2], Math.min(position[2], max[2]));
    return Math.hypot(position[0] - qx, position[1] - qy, position[2] - qz) < radius;
  }

  streamRadiusForCamera(camera: FlyCamera): number {
    const altitudeBoost = Math.max(
      0,
      Math.floor((Math.max(0, camera.position[1]) - ALTITUDE_BOOST_START) / ALTITUDE_BOOST_CHUNK_STEP),
    );
    return clampInt(this.baseStreamRadius + altitudeBoost, MIN_STREAM_RADIUS, MAX_STREAM_RADIUS);
  }

  private updateStreamingCameraMotion(camera: FlyCamera): boolean {
    const previous = this.lastStreamingCameraPosition;
    const now = performance.now();
    if (
      Number.isFinite(previous.x)
      && Number.isFinite(previous.y)
      && Number.isFinite(previous.z)
      && Math.hypot(
        camera.position[0] - previous.x,
        camera.position[1] - previous.y,
        camera.position[2] - previous.z,
      ) > STREAMING_CAMERA_MOVE_EPSILON
    ) {
      this.lastStreamingCameraMoveTime = now;
    }
    this.lastStreamingCameraPosition = {
      x: camera.position[0],
      y: camera.position[1],
      z: camera.position[2],
    };
    return now - this.lastStreamingCameraMoveTime < STREAMING_CAMERA_MOVING_SECONDS * 1000;
  }

  private viewFocusStreamAnchor(camera: FlyCamera, radius: number): { cx: number; cz: number; radius: number } | null {
    if (camera.position[1] < VIEW_FOCUS_STREAM_MIN_ALTITUDE) return null;
    const forward = camera.forward();
    if (forward[1] >= -0.05) return null;
    const distanceToTargetY = (camera.position[1] - VIEW_FOCUS_STREAM_TARGET_Y) / Math.max(-forward[1], 0.001);
    if (!Number.isFinite(distanceToTargetY) || distanceToTargetY <= 0) return null;
    const minDistance = CHUNK_WORLD_SIZE * Math.max(3, radius * 0.45);
    const maxDistance = CHUNK_WORLD_SIZE * Math.min(32, Math.max(radius * 4.0, 8));
    const lookahead = Math.max(minDistance, Math.min(distanceToTargetY, maxDistance));
    const focusX = camera.position[0] + forward[0] * lookahead;
    const focusZ = camera.position[2] + forward[2] * lookahead;
    const cx = chunkCoord(focusX);
    const cz = chunkCoord(focusZ);
    const cameraCx = chunkCoord(camera.position[0]);
    const cameraCz = chunkCoord(camera.position[2]);
    const chunkDistance = Math.max(Math.abs(cx - cameraCx), Math.abs(cz - cameraCz));
    if (chunkDistance < Math.max(3, Math.floor(radius * 0.55))) return null;
    return {
      cx,
      cz,
      radius: clampInt(Math.min(radius, 5), MIN_STREAM_RADIUS, MAX_STREAM_RADIUS),
    };
  }

  setStreamRadius(radius: number): void {
    this.baseStreamRadius = clampInt(radius, MIN_STREAM_RADIUS, MAX_STREAM_RADIUS);
    try {
      localStorage.setItem('stormCanyon.streamRadius', String(this.baseStreamRadius));
    } catch {
      // localStorage can be disabled in strict browser profiles.
    }
  }

  setStreamingEnabled(enabled: boolean): void {
    this.streamingEnabled = Boolean(enabled);
    if (!this.streamingEnabled) {
      this.queue.length = 0;
      this.clearRuntimeLodTransitionMesh();
    }
  }

  setTerrainLodEnabled(enabled: boolean): void {
    const next = Boolean(enabled);
    if (this.terrainLodEnabled === next) return;
    this.terrainLodEnabled = next;
    this.version++;
    this.queue.length = 0;
    for (const key of [...this.states.keys()]) this.renderer.removeChunk(key);
    this.clearRuntimeLodTransitionMesh();
    this.states.clear();
  }

  adjustStreamRadius(delta: number): void {
    this.setStreamRadius(this.baseStreamRadius + delta);
  }

  requiredKeysForCamera(camera: FlyCamera): ChunkRequest[] {
    const cx0 = chunkCoord(camera.position[0]);
    const cz0 = chunkCoord(camera.position[2]);
    const radius = this.streamRadiusForCamera(camera);
    this.effectiveStreamRadius = radius;
    const focus = this.viewFocusStreamAnchor(camera, radius);
    const focusSignature = focus ? `${focus.cx},${focus.cz},${focus.radius}` : 'none';
    const signature = `${cx0},${cz0},${radius},${this.terrainLodEnabled ? 1 : 0},${focusSignature}`;
    if (signature === this.requiredPlanSignature) {
      this.currentTargetChunks = this.requiredPlan.length;
      return this.requiredPlan;
    }

    const primaryKeys = planTerrainLodRequests({
      cameraChunkX: cx0,
      cameraChunkZ: cz0,
      radius,
      verticalChunks: VERTICAL_CHUNKS,
      lodEnabled: this.terrainLodEnabled,
      minStreamRadius: MIN_STREAM_RADIUS,
    });
    const byKey = new Map<string, typeof primaryKeys[number]>();
    for (const item of primaryKeys) byKey.set(item.key, item);

    if (focus) {
      const focusKeys = planTerrainLodRequests({
        cameraChunkX: focus.cx,
        cameraChunkZ: focus.cz,
        radius: focus.radius,
        verticalChunks: VERTICAL_CHUNKS,
        lodEnabled: this.terrainLodEnabled,
        minStreamRadius: MIN_STREAM_RADIUS,
      });
      for (const item of focusKeys) {
        const existing = byKey.get(item.key);
        if (!existing || item.priority < existing.priority) byKey.set(item.key, item);
      }
    }

    const keys = [...byKey.values()].sort((a, b) => a.priority - b.priority);
    this.lastLodPlanSummary = summarizeTerrainLodPlan(keys);
    this.currentTargetChunks = keys.length;
    this.requiredPlanSignature = signature;
    this.requiredPlan = keys;
    this.requiredPlanKeys = new Set(keys.map(item => item.key));
    return keys;
  }

  update(camera: FlyCamera): void {
    const cameraMoving = this.updateStreamingCameraMotion(camera);
    const maxAdoptions = cameraMoving
      ? MAX_MOVING_CHUNK_RESULT_ADOPTIONS_PER_FRAME
      : MAX_CHUNK_RESULT_ADOPTIONS_PER_FRAME;
    const adoptionBudgetMs = cameraMoving
      ? MAX_MOVING_CHUNK_RESULT_ADOPTION_MS_PER_FRAME
      : MAX_CHUNK_RESULT_ADOPTION_MS_PER_FRAME;
    let adoptedThisFrame = this.processPendingChunkResults(maxAdoptions, adoptionBudgetMs);
    if (!this.streamingEnabled) {
      this.effectiveStreamRadius = this.streamRadiusForCamera(camera);
      this.currentTargetChunks = 0;
      return;
    }

    const required = this.requiredKeysForCamera(camera);
    const requiredKeys = this.requiredPlanKeys;
    let enqueuedThisFrame = 0;
    for (const item of required) {
      const state = this.states.get(item.key);
      if (state === 'loaded') {
        const currentMask = this.renderer.getChunkLodSeamMask(item.key);
        const nextMask = item.lodSeamMask ?? 0;
        if (currentMask !== nextMask) {
          const cached = this.cache.peek(item.key);
          if (cached) {
            const stats = { ...cached.stats, lodSeamMask: nextMask };
            this.renderer.createChunkMesh(item.key, cached.vertices, cached.indices, cached.frame, cached.bounds, stats);
            if (cached.vegetation.length > 0) this.renderer.createVegetationPatch(item.key, cached.vegetation);
          }
        }
      }
      if (!state && this.queue.length < MAX_QUEUE && enqueuedThisFrame < MAX_NEW_CHUNK_REQUESTS_PER_FRAME) {
        const canAdoptCachedChunk = adoptedThisFrame < maxAdoptions;
        const cachedCandidate = this.cache.peek(item.key);
        if (cachedCandidate) {
          if (!canAdoptCachedChunk) continue;
          const cached = this.cache.get(item.key) ?? cachedCandidate;
          const stats = { ...cached.stats, lodSeamMask: item.lodSeamMask ?? 0 };
          this.renderer.createChunkMesh(item.key, cached.vertices, cached.indices, cached.frame, cached.bounds, stats);
          if (cached.vegetation.length > 0) this.renderer.createVegetationPatch(item.key, cached.vegetation);
          this.states.set(item.key, 'loaded');
          adoptedThisFrame++;
          continue;
        }
        this.queue.push({ ...item, version: this.version, editVersion: this.editVersion });
        this.states.set(item.key, 'queued');
        enqueuedThisFrame++;
      }
    }

    // Evict chunks that are outside the streaming hysteresis ring.
    const radius = this.effectiveStreamRadius || this.streamRadiusForCamera(camera);
    const ccx = chunkCoord(camera.position[0]);
    const ccz = chunkCoord(camera.position[2]);
    const minCy = VERTICAL_CHUNKS[0];
    const maxCy = VERTICAL_CHUNKS[VERTICAL_CHUNKS.length - 1];
    for (const [key, state] of [...this.states.entries()]) {
      const [cx, cy, cz, lod = 0] = parseKey(key);
      const span = lodSpan(lod);
      const far = !requiredKeys.has(key) && (
        chunkRangeDistance(cx, cz, lod, ccx, ccz) > radius + EVICT_HYSTERESIS_CHUNKS
          || cy + span - 1 < minCy
          || cy > maxCy
      );
      if (far && state !== 'pending') {
        this.renderer.removeChunk(key);
        this.states.delete(key);
        const qIndex = this.queue.findIndex(q => q.key === key);
        if (qIndex >= 0) this.queue.splice(qIndex, 1);
      }
    }

    this.updateRuntimeLodTransitionMesh(required);
    this.queue.sort((a, b) => a.priority - b.priority);
    this.refreshCacheStats();
    this.dispatch();
  }

  dispatch(): void {
    if (!this.streamingEnabled) {
      this.pumpBackgroundTileQueues();
      return;
    }
    while (this.idle.length && this.queue.length) {
      const worker = this.idle.pop();
      const job = this.queue.shift();
      if (!worker || !job) return;
      if (job.mode === 'remeshDensity') {
        this.states.set(job.key, 'pending');
        worker.currentJobs = [job];
        worker.pendingJobsRemaining = 1;
        if (!job.densitySamples || !job.editsToApply) {
          this.showError(`Missing cached density payload for ${job.key}`);
          worker.currentJobs = [];
          worker.pendingJobsRemaining = 0;
          this.idle.push(worker);
          return;
        }
        if (worker.sharedRemeshPage && job.densitySamples.length <= worker.sharedRemeshPage.densitySamples.length) {
          this.dispatchSharedRemesh(worker, job);
        } else {
          this.dispatchFallbackRemesh(worker, job, job.densitySamples, job.editsToApply);
        }
      } else if (worker.sharedGenerateQueue) {
        const jobs = [job];
        while (
          jobs.length < SHARED_GENERATE_BATCH_SIZE
          && this.queue.length > 0
          && this.queue[0]?.mode !== 'remeshDensity'
        ) {
          const nextJob = this.queue.shift();
          if (!nextJob) break;
          jobs.push(nextJob);
        }
        for (const batchJob of jobs) this.states.set(batchJob.key, 'pending');
        worker.currentJobs = jobs;
        worker.pendingJobsRemaining = jobs.length;
        this.dispatchSharedGenerate(worker, jobs);
      } else {
        this.states.set(job.key, 'pending');
        worker.currentJobs = [job];
        worker.pendingJobsRemaining = 1;
        worker.postMessage({ type: 'generate', ...job });
      }
    }
    if (this.queue.length === 0) this.pumpBackgroundTileQueues();
  }

  private pumpBackgroundTileQueues(): number {
    if (!this.idle.length) return 0;
    const worldgenDispatched = worldgenTileCache.pumpWorkerQueue(this.idle.length);
    const erosionDispatched = erosionTileCache.pumpWorkerQueue(this.idle.length);
    const materialDispatched = materialTileCache.pumpWorkerQueue(this.idle.length);
    const caveGraphDispatched = caveGraphTileCache.pumpWorkerQueue(this.idle.length);
    return worldgenDispatched + erosionDispatched + materialDispatched + caveGraphDispatched;
  }

  private allocateSharedResultSlot(worker: ChunkWorker, key: string): SharedResultSlot | null {
    const arena = worker.sharedResultArena;
    if (!arena) return null;
    const slot = arena.slots.find(candidate => candidate.state === 'free');
    if (!slot) {
      this.lastStats.sharedResultSlotExhaustions++;
      return null;
    }
    slot.state = 'pending';
    slot.key = key;
    slot.generation++;
    this.lastStats.sharedResultSlotOccupied++;
    return slot;
  }

  private releaseSharedResultSlot(worker: ChunkWorker, slotIndex: number | undefined, generation: number | undefined): void {
    if (!Number.isInteger(slotIndex) || !Number.isInteger(generation)) return;
    const slot = worker.sharedResultArena?.slots[slotIndex as number];
    if (!slot || slot.generation !== generation || slot.state === 'free') return;
    slot.state = 'free';
    slot.key = undefined;
    this.lastStats.sharedResultSlotOccupied = Math.max(0, this.lastStats.sharedResultSlotOccupied - 1);
    this.lastStats.sharedResultSlotReleases++;
  }

  private releasePendingSharedResultSlots(worker: ChunkWorker): void {
    const arena = worker.sharedResultArena;
    if (!arena) return;
    for (const slot of arena.slots) {
      if (slot.state !== 'pending') continue;
      slot.state = 'free';
      slot.key = undefined;
      this.lastStats.sharedResultSlotOccupied = Math.max(0, this.lastStats.sharedResultSlotOccupied - 1);
      this.lastStats.sharedResultSlotReleases++;
    }
  }

  private dispatchSharedGenerate(worker: ChunkWorker, jobs: ChunkJob[]): void {
    const queue = worker.sharedGenerateQueue;
    if (!queue) {
      worker.postMessage({ type: 'generate', ...jobs[0] });
      return;
    }
    const count = Math.min(jobs.length, SHARED_GENERATE_BATCH_SIZE);
    const resultSlots = jobs.slice(0, count).map(job => this.allocateSharedResultSlot(worker, job.key));
    queue.sequence++;
    Atomics.store(queue.ints, SHARED_GENERATE_STATUS, 0);
    Atomics.store(queue.ints, SHARED_GENERATE_COUNT, count);
    Atomics.store(queue.ints, SHARED_GENERATE_SEQUENCE, queue.sequence);
    for (let index = 0; index < count; index++) {
      this.writeSharedGenerateJob(queue.ints, index, jobs[index], resultSlots[index]);
    }
    Atomics.store(queue.ints, SHARED_GENERATE_STATUS, 1);
    this.lastStats.sharedQueueDispatches += count;
    this.lastStats.sharedQueueBatches++;
    this.lastStats.sharedQueueBatchMax = Math.max(this.lastStats.sharedQueueBatchMax, count);
    worker.postMessage({ type: 'generateShared' });
  }

  private writeSharedGenerateJob(ints: Int32Array, index: number, job: ChunkJob, resultSlot: SharedResultSlot | null): void {
    const offset = SHARED_GENERATE_JOB_BASE + index * SHARED_GENERATE_JOB_INTS;
    Atomics.store(ints, offset + SHARED_GENERATE_CX, job.cx);
    Atomics.store(ints, offset + SHARED_GENERATE_CY, job.cy);
    Atomics.store(ints, offset + SHARED_GENERATE_CZ, job.cz);
    Atomics.store(ints, offset + SHARED_GENERATE_LOD, job.lod ?? 0);
    Atomics.store(ints, offset + SHARED_GENERATE_PRIORITY_MILLIS, Math.round(job.priority * 1000));
    Atomics.store(ints, offset + SHARED_GENERATE_VERSION, job.version);
    Atomics.store(ints, offset + SHARED_GENERATE_EDIT_VERSION, job.editVersion);
    Atomics.store(ints, offset + SHARED_GENERATE_LOD_SEAM_MASK, job.lodSeamMask ?? 0);
    Atomics.store(ints, offset + SHARED_GENERATE_RESULT_SLOT, resultSlot?.index ?? -1);
    Atomics.store(ints, offset + SHARED_GENERATE_RESULT_GENERATION, resultSlot?.generation ?? 0);
  }

  private dispatchFallbackRemesh(
    worker: ChunkWorker,
    job: ChunkJob,
    densitySamples: Int16Array | undefined,
    editsToApply: EditOperation[] | undefined,
  ): void {
    if (densitySamples) {
      this.lastStats.remeshFallbackDispatches++;
      this.lastStats.remeshFallbackBytes += densitySamples.byteLength;
    }
    worker.postMessage(
      { type: 'remeshDensity', ...job, densitySamples, editsToApply: editsToApply ?? [] },
      densitySamples ? [densitySamples.buffer] as Transferable[] : [],
    );
  }

  private dispatchSharedRemesh(worker: ChunkWorker, job: ChunkJob): void {
    const page = worker.sharedRemeshPage;
    if (!page || !job.densitySamples || !job.editsToApply) {
      this.dispatchFallbackRemesh(worker, job, job.densitySamples, job.editsToApply);
      return;
    }
    page.densitySamples.set(job.densitySamples);
    this.lastStats.sharedRemeshDispatches++;
    worker.postMessage({
      type: 'remeshDensityShared',
      key: job.key,
      cx: job.cx,
      cy: job.cy,
      cz: job.cz,
      lod: job.lod ?? 0,
      priority: job.priority,
      version: job.version,
      editVersion: job.editVersion,
      mode: 'remeshDensity',
      editsToApply: job.editsToApply,
      densitySampleCount: job.densitySamples.length,
    });
  }

  onWorkerMessage(worker: ChunkWorker, msg: WorkerOutboundMessage): void {
    if (msg.type === 'ready' || msg.type === 'editAck') return;
    if (msg.type === 'error') {
      this.showError(`${msg.message}\n${msg.stack ?? ''}`);
      if (worker.currentWorldgenTileKey) {
        worldgenTileCache.markWorkerTileFailed(worker.currentWorldgenTileKey);
        worker.currentWorldgenTileKey = undefined;
      }
      if (worker.currentErosionTileKey) {
        erosionTileCache.markWorkerTileFailed(worker.currentErosionTileKey);
        worker.currentErosionTileKey = undefined;
      }
      if (worker.currentMaterialTileKey) {
        materialTileCache.markWorkerTileFailed(worker.currentMaterialTileKey);
        worker.currentMaterialTileKey = undefined;
      }
      if (worker.currentCaveGraphTileKey) {
        caveGraphTileCache.markWorkerTileFailed(worker.currentCaveGraphTileKey);
        worker.currentCaveGraphTileKey = undefined;
      }
      if (worker.currentLodTransitionMeshSignature) {
        if (this.pendingNativeTransitionMeshSignature === worker.currentLodTransitionMeshSignature) {
          this.pendingNativeTransitionMeshSignature = '';
        }
        worker.currentLodTransitionMeshSignature = undefined;
      }
      for (const job of worker.currentJobs ?? []) {
        if (this.states.get(job.key) === 'pending') this.states.delete(job.key);
      }
      this.releasePendingSharedResultSlots(worker);
      worker.currentJobs = [];
      worker.pendingJobsRemaining = 0;
      this.idle.push(worker);
      this.dispatch();
      return;
    }
    if (msg.type === 'worldgenTile') {
      this.completeWorldgenTileJob(worker, msg);
      return;
    }
    if (msg.type === 'erosionTile') {
      this.completeErosionTileJob(worker, msg);
      return;
    }
    if (msg.type === 'materialTile') {
      this.completeMaterialTileJob(worker, msg);
      return;
    }
    if (msg.type === 'caveGraphTile') {
      this.completeCaveGraphTileJob(worker, msg);
      return;
    }
    if (msg.type === 'lodTransitionMesh') {
      this.completeLodTransitionMeshJob(worker, msg);
      return;
    }
    if (msg.type !== 'chunk') return;

    this.pendingChunkResults.push({ worker, msg });
  }

  private processPendingChunkResults(maxAdoptions: number, maxMs: number): number {
    let adopted = 0;
    const started = performance.now();
    while (this.pendingChunkResults.length > 0) {
      if (adopted >= maxAdoptions) break;
      if (adopted > 0 && performance.now() - started >= maxMs) break;
      const result = this.pendingChunkResults.shift();
      if (!result) break;
      this.completeChunkResult(result.worker, result.msg);
      adopted++;
    }
    return adopted;
  }

  private sharedResultSlotToken(msg: ChunkMessage): { slotIndex: number; generation: number } | null {
    const slotIndex = msg.stats?.sharedResultSlotIndex;
    const generation = msg.stats?.sharedResultGeneration;
    if (!Number.isInteger(slotIndex) || !Number.isInteger(generation)) return null;
    return { slotIndex: slotIndex as number, generation: generation as number };
  }

  private borrowedCachePayloadForChunkMessage(worker: ChunkWorker, msg: ChunkMessage): ChunkCachePayload | null {
    if (msg.stats?.sharedResultArena !== true) return null;
    const token = this.sharedResultSlotToken(msg);
    if (!token) return null;
    const slot = worker.sharedResultArena?.slots[token.slotIndex];
    if (!slot || slot.generation !== token.generation || slot.state !== 'pending' || slot.key !== msg.key) return null;
    const borrowedBytes = msg.vertices.byteLength + msg.indices.byteLength + msg.densitySamples.byteLength + msg.vegetation.byteLength;
    let released = false;
    const onRelease = (): void => {
      if (released) return;
      released = true;
      this.releaseSharedResultSlot(worker, token.slotIndex, token.generation);
    };
    slot.state = 'cached';
    return {
      vertices: msg.vertices,
      indices: msg.indices,
      densitySamples: msg.densitySamples,
      vegetation: msg.vegetation,
      copiedBytes: 0,
      borrowedBytes,
      ownsArrays: false,
      onRelease,
    };
  }

  private completeChunkResult(worker: ChunkWorker, msg: ChunkMessage): void {
    if (msg.version !== this.version) {
      this.states.delete(msg.key);
      this.lastStats.discarded++;
      const token = this.sharedResultSlotToken(msg);
      if (token) this.releaseSharedResultSlot(worker, token.slotIndex, token.generation);
      this.completeWorkerJob(worker, msg.key);
      return;
    }

    const sharedResult = msg.stats?.sharedResultArena === true;
    if (sharedResult) this.lastStats.sharedResultChunks++;

    const uploadBytes = (msg.vertices?.byteLength || 0) + (msg.indices?.byteLength || 0) + (msg.vegetation?.byteLength || 0);
    if (msg.stats?.workerScratch) {
      worker.scratchStats = msg.stats.workerScratch;
      this.refreshWorkerScratchStats();
    }
    this.lastStats.uploadMB = uploadBytes / (1024 * 1024);
    this.lastStats.densityKB = (msg.densitySamples?.byteLength || 0) / 1024;
    this.lastStats.generated++;
    if (msg.stats?.remeshed) this.lastStats.remeshed++;
    this.lastStats.overflow += msg.stats?.overflow ? 1 : 0;
    this.meshTimes.push(msg.stats?.ms ?? 0);
    if (this.meshTimes.length > 80) this.meshTimes.shift();
    this.lastStats.avgMeshMs = this.meshTimes.reduce((a, b) => a + b, 0) / this.meshTimes.length;

    this.renderer.createChunkMesh(msg.key, msg.vertices, msg.indices, msg.frame, msg.bounds, msg.stats);
    if (msg.vegetation && msg.vegetation.length > 0) this.renderer.createVegetationPatch(msg.key, msg.vegetation);
    const borrowedCachePayload = this.borrowedCachePayloadForChunkMessage(worker, msg);
    const cachePayload = borrowedCachePayload ?? cachePayloadForChunkMessage(msg);
    if (cachePayload.copiedBytes > 0) this.lastStats.sharedResultCacheCopyBytes += cachePayload.copiedBytes;
    const cached = this.cache.put(
      msg.key,
      msg.cx,
      msg.cy,
      msg.cz,
      msg.lod,
      cachePayload.vertices,
      cachePayload.indices,
      cachePayload.densitySamples,
      cachePayload.vegetation,
      msg.frame,
      msg.bounds,
      msg.stats,
      {
        ownsArrays: cachePayload.ownsArrays,
        onRelease: cachePayload.onRelease,
      },
    );
    if (cached && cachePayload.borrowedBytes > 0) {
      this.lastStats.sharedResultCacheBorrowedChunks++;
      this.lastStats.sharedResultCacheBorrowedBytes += cachePayload.borrowedBytes;
    }
    if (!cached && borrowedCachePayload) {
      const copiedPayload = cachePayloadForChunkMessage(msg);
      this.lastStats.sharedResultCacheCopyBytes += copiedPayload.copiedBytes;
      this.cache.put(
        msg.key,
        msg.cx,
        msg.cy,
        msg.cz,
        msg.lod,
        copiedPayload.vertices,
        copiedPayload.indices,
        copiedPayload.densitySamples,
        copiedPayload.vegetation,
        msg.frame,
        msg.bounds,
        msg.stats,
      );
    }
    if (!borrowedCachePayload) {
      const token = this.sharedResultSlotToken(msg);
      if (token) this.releaseSharedResultSlot(worker, token.slotIndex, token.generation);
    }
    this.refreshCacheStats();
    this.states.set(msg.key, 'loaded');
    this.completeWorkerJob(worker, msg.key);
  }

  private completeLodTransitionMeshJob(worker: ChunkWorker, msg: LodTransitionMeshMessage): void {
    if (this.pendingNativeTransitionMeshSignature === msg.signature) {
      this.pendingNativeTransitionMeshSignature = '';
    }
    worker.currentLodTransitionMeshSignature = undefined;
    if (msg.version !== this.version || msg.signature !== this.runtimeTransitionMeshSignature) {
      this.idle.push(worker);
      this.dispatch();
      return;
    }
    if (msg.stats?.workerScratch) {
      worker.scratchStats = msg.stats.workerScratch;
      this.refreshWorkerScratchStats();
    }
    this.runtimeNativeTransitionMeshSignature = msg.signature;
    if (msg.vertices.length > 0 && msg.indices.length >= 3) {
      this.renderer.createChunkMesh(LOD_TRANSITION_MESH_KEY, msg.vertices, msg.indices, msg.frame, msg.bounds, msg.stats);
      this.lastStats.lodTransitionMeshCells = msg.stats.lodTransitionMeshCells ?? this.lastStats.lodTransitionMeshCells;
      this.lastStats.lodTransitionMeshEmittedCells = msg.stats.lodTransitionMeshEmittedCells ?? this.lastStats.lodTransitionMeshEmittedCells;
      this.lastStats.lodTransitionMeshTriangles = msg.indices.length / 3;
      this.lastStats.lodTransitionMeshMissingSampleCells = msg.stats.lodTransitionMeshMissingSampleCells ?? this.lastStats.lodTransitionMeshMissingSampleCells;
      this.lastStats.lodTransitionMeshDegenerateCells = msg.stats.lodTransitionMeshDegenerateCells ?? this.lastStats.lodTransitionMeshDegenerateCells;
      this.lastStats.lodTransitionMeshNative = true;
      this.lastStats.overflow += msg.stats?.overflow ? 1 : 0;
      this.meshTimes.push(msg.stats?.ms ?? 0);
      if (this.meshTimes.length > 80) this.meshTimes.shift();
      this.lastStats.avgMeshMs = this.meshTimes.reduce((a, b) => a + b, 0) / this.meshTimes.length;
    }
    this.idle.push(worker);
    this.dispatch();
  }

  private completeWorldgenTileJob(worker: ChunkWorker, msg: WorldgenTileMessage): void {
    const originX = msg.tileX * msg.tileSize;
    const originZ = msg.tileZ * msg.tileSize;
    const tile: SerializedWorldgenTile = {
      key: msg.key,
      tileX: msg.tileX,
      tileZ: msg.tileZ,
      originX,
      originZ,
      fields: Array.from(msg.fields),
      biomeIds: Array.from(msg.biomeIds),
      waterIds: Array.from(msg.waterIds),
      riverNetworkIds: Array.from(msg.riverNetworkIds),
    };
    worldgenTileCache.adoptWorkerTile(tile);
    worker.currentWorldgenTileKey = undefined;
    this.idle.push(worker);
    this.dispatch();
  }

  private completeErosionTileJob(worker: ChunkWorker, msg: ErosionTileMessage): void {
    const originX = msg.tileX * msg.tileSize;
    const originZ = msg.tileZ * msg.tileSize;
    const tile: SerializedErosionTile = {
      key: msg.key,
      tileX: msg.tileX,
      tileZ: msg.tileZ,
      originX,
      originZ,
      fields: Array.from(msg.fields),
    };
    if (!erosionTileCache.adoptWorkerTile(tile, msg.fields.byteLength)) {
      erosionTileCache.markWorkerTileFailed(msg.key);
    }
    worker.currentErosionTileKey = undefined;
    this.idle.push(worker);
    this.dispatch();
  }

  private completeMaterialTileJob(worker: ChunkWorker, msg: MaterialTileMessage): void {
    const tile: SerializedMaterialTile | null = serializedMaterialTileFromNativeBuffer({
      key: msg.key,
      tileX: msg.tileX,
      tileZ: msg.tileZ,
      tileSize: msg.tileSize,
      schemaVersion: msg.schemaVersion,
      generatorVersion: msg.generatorVersion,
      resolution: msg.resolution,
      fieldCount: msg.fieldCount,
      fields: msg.fields,
      dominantMaterialIds: msg.dominantMaterialIds,
    });
    if (tile) {
      materialTileCache.adoptWorkerTile(tile, msg.fields.byteLength + msg.dominantMaterialIds.byteLength);
    } else {
      materialTileCache.markWorkerTileFailed(msg.key);
    }
    worker.currentMaterialTileKey = undefined;
    this.idle.push(worker);
    this.dispatch();
  }

  private completeCaveGraphTileJob(worker: ChunkWorker, msg: CaveGraphTileMessage): void {
    const tile = serializedCaveGraphTileFromNativeBuffer({
      key: msg.key,
      tileX: msg.tileX,
      tileZ: msg.tileZ,
      tileSize: msg.tileSize,
      schemaVersion: msg.schemaVersion,
      generatorVersion: msg.generatorVersion,
      passageFieldCount: msg.passageFieldCount,
      chamberFieldCount: msg.chamberFieldCount,
      passageCount: msg.passageCount,
      chamberCount: msg.chamberCount,
      passages: msg.passages,
      chambers: msg.chambers,
    });
    if (tile) {
      caveGraphTileCache.adoptWorkerTile(tile, msg.passages.byteLength + msg.chambers.byteLength);
    } else {
      caveGraphTileCache.markWorkerTileFailed(msg.key);
    }
    worker.currentCaveGraphTileKey = undefined;
    this.idle.push(worker);
    this.dispatch();
  }

  private completeWorkerJob(worker: ChunkWorker, key: string): void {
    if (worker.currentJobs) worker.currentJobs = worker.currentJobs.filter(job => job.key !== key);
    const remaining = Math.max(0, (worker.pendingJobsRemaining ?? 1) - 1);
    worker.pendingJobsRemaining = remaining;
    if (remaining > 0) return;
    worker.currentJobs = [];
    this.idle.push(worker);
    this.dispatch();
  }

  applyBrush(position: Vec3, options: BrushOptions): void {
    if (this.editLog.length >= MAX_EDIT_OPERATIONS) {
      console.warn(`Edit log is full at ${MAX_EDIT_OPERATIONS} operations. Clear edits before adding more.`);
      return;
    }
    const direction = normalizeBrushDirection(options.direction);
    const shape = options.shape;
    const edit: EditOperation = {
      id: this.nextEditId++,
      type: options.type,
      x: position[0],
      y: position[1],
      z: position[2],
      radius: options.radius,
      shape,
    };
    if (options.type === 'paintMaterial') {
      edit.material = clampInt(options.material, PAINT_MATERIAL_GRASS, PAINT_MATERIAL_MUD);
    }
    if (options.type === 'subtractSphere' || options.type === 'addSphere') {
      edit.falloff = clampNumber(options.falloff, 0, 8, DEFAULT_ENGINE_SETTINGS.brushFalloff);
    }
    if (options.type === 'smoothDensity' || options.type === 'flattenDensity') {
      edit.strength = clampNumber(options.strength, 0.05, 1, DEFAULT_ENGINE_SETTINGS.brushStrength);
    }
    if (shape === 'capsule') {
      edit.dx = direction[0];
      edit.dy = direction[1];
      edit.dz = direction[2];
      edit.length = options.length;
    }
    this.archiveRedoBranch();
    this.editLog.push(edit);
    this.undoneEdits.length = 0;
    this.markDebugEditMarkersDirty();
    this.editVersion++;
    this.version++;
    this.queue.length = 0;
    this.syncEditLog();

    // Dirty all intersecting chunks and let the streamer rebuild them.
    const dirtyRadius = editInfluenceRadius(edit) + 4;
    for (const key of [...this.states.keys()]) {
      if (this.chunkIntersectsSphere(key, position, dirtyRadius)) {
        const cached = this.cache.get(key);
        this.renderer.removeChunk(key);
        if (cached?.densitySamples?.length) {
          const [cx, cy, cz, lod] = parseKey(key);
          this.queue.push({
            key,
            cx,
            cy,
            cz,
            lod,
            lodSeamMask: cached.stats?.lodSeamMask ?? 0,
            priority: 0,
            version: this.version,
            editVersion: this.editVersion,
            mode: 'remeshDensity',
            densitySamples: new Int16Array(cached.densitySamples),
            editsToApply: [edit],
          });
          this.states.set(key, 'queued');
        } else {
          this.states.delete(key);
        }
      } else if (this.states.get(key) === 'pending') {
        // Pending chunks are stale after a global edit.
        this.states.delete(key);
      }
    }
    this.cache.invalidateSphere(position[0], position[1], position[2], dirtyRadius);
    this.refreshCacheStats();
  }

  clearEdits(): void {
    this.editLog.length = 0;
    this.undoneEdits.length = 0;
    this.editBranches.length = 0;
    this.rebuildFromEditLog();
  }

  undoEdit(): void {
    const edit = this.editLog.pop();
    if (!edit) return;
    this.undoneEdits.push(edit);
    this.rebuildFromEditLog();
  }

  redoEdit(): void {
    const edit = this.undoneEdits.pop();
    if (!edit) return;
    this.editLog.push(edit);
    this.rebuildFromEditLog();
  }

  reloadChunks(): void {
    this.version++;
    this.queue.length = 0;
    this.cache.clear();
    this.refreshCacheStats();
    for (const key of [...this.states.keys()]) this.renderer.removeChunk(key);
    this.clearRuntimeLodTransitionMesh();
    this.states.clear();
  }

  debugEditMarkerInstances(force = false): Float32Array | null {
    if (!force && !this.debugEditMarkersDirty) return null;
    this.debugEditMarkersDirty = false;
    const values: number[] = [];
    const recentEdits = this.editLog.slice(-32);
    for (const edit of recentEdits) {
      values.push(edit.x, edit.y, edit.z, -Math.max(editInfluenceRadius(edit), 2));
    }
    return new Float32Array(values);
  }

  densitySliceForCamera(camera: FlyCamera, settings: EngineSettings): DensitySliceSnapshot | null {
    const axis = densityAxisFromSettings(settings);
    const cx = chunkCoord(camera.position[0]);
    const cz = chunkCoord(camera.position[2]);
    const preferredCy = clampInt(chunkCoord(camera.position[1]), VERTICAL_CHUNKS[0], VERTICAL_CHUNKS[VERTICAL_CHUNKS.length - 1]);
    const cyCandidates = [preferredCy, ...VERTICAL_CHUNKS.filter(cy => cy !== preferredCy)];
    for (const cy of cyCandidates) {
      const key = keyOf(cx, cy, cz);
      const cached = this.cache.peek(key);
      if (!cached?.densitySamples?.length) continue;
      const cameraLocal = axis === 'x'
        ? camera.position[0] - cx * CHUNK_WORLD_SIZE
        : axis === 'y'
          ? camera.position[1] - cy * CHUNK_WORLD_SIZE
          : camera.position[2] - cz * CHUNK_WORLD_SIZE;
      const sliceIndex = settings.densitySliceFollowCamera
        ? clampInt(Math.round(cameraLocal / CHUNK_WORLD_SIZE * (DENSITY_GRID_N - 1)), 0, DENSITY_GRID_N - 1)
        : clampInt(settings.densitySliceIndex, 0, DENSITY_GRID_N - 1);
      const values = new Int16Array(DENSITY_GRID_N * DENSITY_GRID_N);
      let min = Infinity;
      let max = -Infinity;
      for (let row = 0; row < DENSITY_GRID_N; row++) {
        for (let col = 0; col < DENSITY_GRID_N; col++) {
          let sx = col;
          let sy = sliceIndex;
          let sz = row;
          if (axis === 'x') {
            sx = sliceIndex;
            sy = col;
          } else if (axis === 'z') {
            sy = row;
            sz = sliceIndex;
          }
          const raw = cached.densitySamples[sx + DENSITY_GRID_N * (sy + DENSITY_GRID_N * sz)];
          values[col + DENSITY_GRID_N * row] = raw;
          min = Math.min(min, raw);
          max = Math.max(max, raw);
        }
      }
      return { key, cx, cy, cz, axis, sliceIndex, size: DENSITY_GRID_N, scale: DENSITY_SCALE, min, max, values };
    }
    return null;
  }

  counts(): StreamerCounts {
    let queued = 0, pending = 0, loaded = 0;
    for (const state of this.states.values()) {
      if (state === 'queued') queued++;
      else if (state === 'pending') pending++;
      else if (state === 'loaded') loaded++;
    }
    return { queued, pending, loaded, workers: this.workerCount, idle: this.idle.length };
  }
}

function setupInput(canvas: HTMLCanvasElement, camera: FlyCamera, streamer: ChunkStreamer, options: InputOptions = {}): (dt: number) => void {
  const keys = new Set<string>();
  const automatedKeys = new Set<string>();
  const hasKey = (code: string): boolean => keys.has(code) || automatedKeys.has(code);
  const setStreamRadius = options.setStreamRadius ?? ((radius) => streamer.setStreamRadius(radius));
  const getBrushOptions = options.getBrushOptions ?? (() => ({
    radius: 9,
    distance: 34,
    type: 'subtractSphere' as EditOperation['type'],
    shape: 'sphere' as BrushShape,
    direction: camera.forward(),
    length: 18,
    material: PAINT_MATERIAL_ROCK,
    strength: DEFAULT_ENGINE_SETTINGS.brushStrength,
    falloff: DEFAULT_ENGINE_SETTINGS.brushFalloff,
  }));
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof Element && e.target.closest('#settings-panel')) return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !e.shiftKey) {
      streamer.undoEdit();
      e.preventDefault();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey))) {
      streamer.redoEdit();
      e.preventDefault();
      return;
    }
    keys.add(e.code);
    if (e.code === 'BracketRight' || e.code === 'Equal') {
      setStreamRadius(streamer.baseStreamRadius + 1);
      e.preventDefault();
    }
    if (e.code === 'BracketLeft' || e.code === 'Minus') {
      setStreamRadius(streamer.baseStreamRadius - 1);
      e.preventDefault();
    }
    if (e.code === 'Digit0') {
      setStreamRadius(MAX_STREAM_RADIUS);
      e.preventDefault();
    }
    if (e.code === 'Digit9') {
      setStreamRadius(FALLBACK_STREAM_RADIUS);
      e.preventDefault();
    }
    if (e.code === 'KeyE') {
      const brush = getBrushOptions();
      const target = add(camera.position, scale(camera.forward(), brush.distance));
      streamer.applyBrush(target, brush);
    }
    if (e.code === 'KeyR') streamer.clearEdits();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));

  const movementTest = readMovementTestConfigFromUrl();
  if (movementTest) {
    window.setTimeout(() => {
      for (const code of movementTest.keyCodes) automatedKeys.add(code);
      console.info(`Movement test started: ${movementTest.keyCodes.join('+')} for ${movementTest.durationMs.toFixed(0)} ms`);
      window.setTimeout(() => {
        for (const code of movementTest.keyCodes) automatedKeys.delete(code);
        console.info('Movement test stopped');
      }, movementTest.durationMs);
    }, movementTest.delayMs);
  }

  canvas.addEventListener('click', () => canvas.requestPointerLock());
  window.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas) return;
    camera.yaw -= e.movementX * 0.0022;
    camera.pitch = Math.max(-1.45, Math.min(1.45, camera.pitch - e.movementY * 0.0022));
  });

  return function updateCamera(dt: number): void {
    const forward = camera.forward();
    const right = camera.right();
    let move = vec3(0, 0, 0);
    if (hasKey('KeyW')) move = add(move, forward);
    if (hasKey('KeyS')) move = add(move, scale(forward, -1));
    if (hasKey('KeyD')) move = add(move, right);
    if (hasKey('KeyA')) move = add(move, scale(right, -1));
    if (hasKey('Space')) move = add(move, vec3(0, 1, 0));
    if (hasKey('ControlLeft') || hasKey('ControlRight')) move = add(move, vec3(0, -1, 0));
    const len = Math.hypot(move[0], move[1], move[2]);
    if (len > 0.0001) {
      move = normalize(move);
      let speed = camera.speed;
      if (hasKey('ShiftLeft') || hasKey('ShiftRight')) speed *= camera.fastMultiplier;
      if (hasKey('AltLeft') || hasKey('AltRight')) speed *= camera.slowMultiplier;
      camera.position = add(camera.position, scale(move, speed * dt));
    }
  };
}

function formatRegionDiff(diff: RegionDiffSummary | null): string {
  if (!diff) return '';
  const comparedAt = new Date(diff.comparedAt).toLocaleTimeString();
  const sampleText = formatRegionDiffSamples(diff);
  if (diff.status === 'missing') {
    return `Region diff ${diff.slotName} @ ${comparedAt}: no saved slot | Active ${diff.activeChunks} chunks, ${diff.activeEdits} edits, ${diff.activeEditBranches} branches${sampleText}`;
  }
  return `Region diff ${diff.slotName} @ ${comparedAt}: chunks ${diff.activeChunks}/${diff.savedChunks} active/saved, common ${diff.commonChunks}, changed ${diff.changedCommonChunks}, active +${diff.activeOnlyChunks}, saved +${diff.savedOnlyChunks} | Edits ${diff.activeEdits}/${diff.savedEdits}, same/changed/common ${diff.matchingCommonEditIds}/${diff.changedCommonEditIds}/${diff.commonEditIds}, active +${diff.activeOnlyEditIds}, saved +${diff.savedOnlyEditIds}, redo ${diff.activeRedoEdits}/${diff.savedRedoEdits}, branches ${diff.activeEditBranches}/${diff.savedEditBranches} same ${diff.matchingEditBranches}, active +${diff.activeOnlyEditBranches}, saved +${diff.savedOnlyEditBranches} (${diff.activeBranchEdits}/${diff.savedBranchEdits} edits)${sampleText}`;
}

function formatRegionEditDiffSample(sample: RegionEditDiffSample): string {
  return `#${sample.id} ${sample.label} [${sample.detail}]`;
}

function formatRegionBranchDiffSample(sample: RegionEditBranchDiffSample): string {
  const base = sample.baseEditId > 0 ? `base #${sample.baseEditId}` : 'base start';
  return `branch ${sample.id} ${base}, ${sample.editCount} edits`;
}

function formatRegionDiffSamples(diff: RegionDiffSummary): string {
  const parts: string[] = [];
  if (diff.changedEditSamples.length > 0) {
    parts.push(`changed edits: ${diff.changedEditSamples.map(sample => `#${sample.id} saved ${sample.saved.label} -> active ${sample.active.label}`).join('; ')}`);
  }
  if (diff.activeOnlyEditSamples.length > 0) {
    parts.push(`active-only edits: ${diff.activeOnlyEditSamples.map(formatRegionEditDiffSample).join('; ')}`);
  }
  if (diff.savedOnlyEditSamples.length > 0) {
    parts.push(`saved-only edits: ${diff.savedOnlyEditSamples.map(formatRegionEditDiffSample).join('; ')}`);
  }
  if (diff.activeOnlyBranchSamples.length > 0) {
    parts.push(`active-only branches: ${diff.activeOnlyBranchSamples.map(formatRegionBranchDiffSample).join('; ')}`);
  }
  if (diff.savedOnlyBranchSamples.length > 0) {
    parts.push(`saved-only branches: ${diff.savedOnlyBranchSamples.map(formatRegionBranchDiffSample).join('; ')}`);
  }
  return parts.length > 0 ? ` | ${parts.join(' | ')}` : '';
}

function regionDiffPanelItem(
  state: RegionDiffPanelItem['state'],
  label: string,
  detail: string,
): RegionDiffPanelItem {
  return { state, label, detail };
}

function createRegionDiffPanelState(diff: RegionDiffSummary | null): RegionDiffPanelState {
  if (!diff) {
    return {
      status: 'empty',
      summary: 'No region diff captured',
      detail: 'Use Diff Save or a saved-region row Diff action to compare the active world against a saved slot.',
      items: [],
    };
  }

  const comparedAt = new Date(diff.comparedAt).toLocaleTimeString();
  const items: RegionDiffPanelItem[] = [];
  for (const sample of diff.changedEditSamples.slice(0, 4)) {
    items.push(regionDiffPanelItem(
      'changed',
      `Changed edit #${sample.id}`,
      `${sample.saved.label} -> ${sample.active.label} | saved ${sample.saved.detail} | active ${sample.active.detail}`,
    ));
  }
  for (const sample of diff.activeOnlyEditSamples.slice(0, 3)) {
    items.push(regionDiffPanelItem('active', `Active-only #${sample.id}`, `${sample.label} | ${sample.detail}`));
  }
  for (const sample of diff.savedOnlyEditSamples.slice(0, 3)) {
    items.push(regionDiffPanelItem('saved', `Saved-only #${sample.id}`, `${sample.label} | ${sample.detail}`));
  }
  for (const sample of diff.activeOnlyBranchSamples.slice(0, 2)) {
    items.push(regionDiffPanelItem('branch-active', `Active branch ${sample.id}`, `${sample.label} | ${sample.detail}`));
  }
  for (const sample of diff.savedOnlyBranchSamples.slice(0, 2)) {
    items.push(regionDiffPanelItem('branch-saved', `Saved branch ${sample.id}`, `${sample.label} | ${sample.detail}`));
  }

  if (diff.status === 'missing') {
    return {
      status: 'missing',
      summary: `${diff.slotName}: no saved slot`,
      detail: `Compared ${comparedAt} | active ${diff.activeChunks} chunks, ${diff.activeEdits} edits, ${diff.activeEditBranches} branches`,
      items,
    };
  }

  return {
    status: 'compared',
    summary: `${diff.slotName}: ${diff.changedCommonChunks} changed chunks, active +${diff.activeOnlyChunks}, saved +${diff.savedOnlyChunks}`,
    detail: `Compared ${comparedAt} | chunks ${diff.activeChunks}/${diff.savedChunks} active/saved, common ${diff.commonChunks}, matching ${diff.matchingCommonChunks} | edits ${diff.activeEdits}/${diff.savedEdits}, same/changed/common ${diff.matchingCommonEditIds}/${diff.changedCommonEditIds}/${diff.commonEditIds}, active +${diff.activeOnlyEditIds}, saved +${diff.savedOnlyEditIds} | branches ${diff.activeEditBranches}/${diff.savedEditBranches}, active +${diff.activeOnlyEditBranches}, saved +${diff.savedOnlyEditBranches}`,
    items,
  };
}

function formatDensityDiff(diff: DensitySliceDiffSummary | null): string {
  if (!diff) return '';
  const comparedAt = new Date(diff.comparedAt).toLocaleTimeString();
  if (diff.status === 'missing-current') return `Density diff @ ${comparedAt}: no current cached slice`;
  if (diff.status === 'missing-capture') return `Density diff @ ${comparedAt}: no captured slice`;
  if (diff.status === 'incompatible') return `Density diff @ ${comparedAt}: incompatible ${diff.currentKey} vs ${diff.captureKey}`;
  const changedPercent = diff.cells > 0 ? (diff.changedCells / diff.cells) * 100 : 0;
  return `Density diff @ ${comparedAt}: ${diff.currentKey} vs ${diff.captureKey}, ${diff.changedCells}/${diff.cells} cells changed (${changedPercent.toFixed(1)}%), mean ${diff.meanAbsMeters.toFixed(2)}m, max ${diff.maxAbsMeters.toFixed(2)}m`;
}

function formatRegionImportPreview(preview: RegionImportPreview | null): string {
  if (!preview) return '';
  const diff = preview.diff;
  const sizeMB = preview.fileSize / (1024 * 1024);
  if (diff.status === 'missing') {
    return `Import preview ${preview.fileName}: ${diff.savedChunks} chunks, ${diff.savedEdits} edits, ${diff.savedEditBranches} branches, ${sizeMB.toFixed(2)} MB`;
  }
  return `Import preview ${preview.fileName}: file ${diff.savedChunks} chunks/${diff.savedEdits} edits/${diff.savedEditBranches} branches vs active ${diff.activeChunks}/${diff.activeEdits}/${diff.activeEditBranches} | common chunks ${diff.commonChunks}, changed chunks ${diff.changedCommonChunks}, active +${diff.activeOnlyChunks}, file +${diff.savedOnlyChunks} | edits same/changed/common ${diff.matchingCommonEditIds}/${diff.changedCommonEditIds}/${diff.commonEditIds}, active +${diff.activeOnlyEditIds}, file +${diff.savedOnlyEditIds}`;
}

function regionSlotInfoFor(infos: RegionSlotInfo[], key: string): RegionSlotInfo | undefined {
  return infos.find(info => info.key === key);
}

function managedRegionSlotInfos(infos: RegionSlotInfo[]): RegionSlotInfo[] {
  const managedKeys = new Set<string>(REGION_SLOTS.map(slot => slot.key));
  return infos.filter(info => managedKeys.has(info.key));
}

function regionSlotIndexByKey(key: string): number {
  return REGION_SLOTS.findIndex(slot => slot.key === key);
}

function formatRegionBrowserBytes(bytes: number): string {
  if (bytes <= 0) return '0.00 MB';
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatRegionBrowserKB(bytes: number): string {
  if (bytes <= 0) return '0.0 KB';
  if (bytes >= 1024 * 1024) return formatRegionBrowserBytes(bytes);
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatRegionCodecCounts(info: RegionSlotInfo): string {
  if (info.compressionPayloads <= 0) return 'codecs n/a';
  return `codecs raw/lz/dv ${info.compressionRawPayloads}/${info.compressionLzssPayloads}/${info.compressionDeltaPayloads}`;
}

function formatRegionPayloadInspection(inspection: RegionPayloadInspection): string {
  const smaller = Math.max(0, (1 - inspection.compression.ratio) * 100);
  return `${inspection.name}: ${inspection.chunks.length} chunks | ${formatRegionBrowserBytes(inspection.compression.encodedBytes)} / ${formatRegionBrowserBytes(inspection.compression.rawBytes)} | ${smaller.toFixed(0)}% smaller`;
}

function serializeRegionPayloadInspection(inspection: RegionPayloadInspection | null) {
  if (!inspection) return null;
  return {
    key: inspection.key,
    name: inspection.name,
    savedAt: inspection.savedAt,
    chunkCount: inspection.chunkCount,
    editCount: inspection.editCount,
    compression: inspection.compression,
    largestChunks: inspection.largestChunks,
    chunks: inspection.chunks,
    chunkCountInspected: inspection.chunks.length,
  };
}

function regionPayloadEndpoint(inspection: RegionPayloadInspection): RegionPayloadComparisonEndpoint {
  return {
    key: inspection.key,
    name: inspection.name,
    savedAt: inspection.savedAt,
    chunkCount: inspection.chunkCount,
    editCount: inspection.editCount,
    rawBytes: inspection.compression.rawBytes,
    encodedBytes: inspection.compression.encodedBytes,
    savedBytes: inspection.compression.savedBytes,
  };
}

function regionPayloadCodecs(chunk: RegionChunkPayloadInfo | null): string {
  if (!chunk) return 'missing';
  return `${chunk.vertices.codec}/${chunk.indices.codec}/${chunk.density.codec}/${chunk.vegetation.codec}`;
}

function regionPayloadSignature(chunk: RegionChunkPayloadInfo): string {
  return [
    chunk.rawBytes,
    chunk.encodedBytes,
    regionPayloadCodecs(chunk),
    chunk.vertices.rawBytes,
    chunk.vertices.encodedBytes,
    chunk.indices.rawBytes,
    chunk.indices.encodedBytes,
    chunk.density.rawBytes,
    chunk.density.encodedBytes,
    chunk.vegetation.rawBytes,
    chunk.vegetation.encodedBytes,
  ].join(':');
}

function regionPayloadChunkDelta(
  key: string,
  baselineChunk: RegionChunkPayloadInfo | null,
  comparedChunk: RegionChunkPayloadInfo | null,
): RegionPayloadChunkDelta {
  const baselineRawBytes = baselineChunk?.rawBytes ?? 0;
  const comparedRawBytes = comparedChunk?.rawBytes ?? 0;
  const baselineEncodedBytes = baselineChunk?.encodedBytes ?? 0;
  const comparedEncodedBytes = comparedChunk?.encodedBytes ?? 0;
  const baselineCodecs = regionPayloadCodecs(baselineChunk);
  const comparedCodecs = regionPayloadCodecs(comparedChunk);
  return {
    key,
    state: baselineChunk && comparedChunk ? 'common' : baselineChunk ? 'baseline-only' : 'compared-only',
    baselineRawBytes,
    comparedRawBytes,
    rawByteDelta: comparedRawBytes - baselineRawBytes,
    baselineEncodedBytes,
    comparedEncodedBytes,
    encodedByteDelta: comparedEncodedBytes - baselineEncodedBytes,
    baselineCodecs,
    comparedCodecs,
    codecChanged: Boolean(baselineChunk && comparedChunk && baselineCodecs !== comparedCodecs),
  };
}

function compareRegionPayloadInspections(
  baseline: RegionPayloadInspection,
  compared: RegionPayloadInspection,
): RegionPayloadComparison {
  const baselineChunks = new Map(baseline.chunks.map(chunk => [chunk.key, chunk]));
  const comparedChunks = new Map(compared.chunks.map(chunk => [chunk.key, chunk]));
  const deltas: RegionPayloadChunkDelta[] = [];
  let commonChunks = 0;
  let matchingCommonChunks = 0;
  let changedCommonChunks = 0;
  let baselineOnlyChunks = 0;
  let comparedOnlyChunks = 0;
  let smallerChunks = 0;
  let largerChunks = 0;
  let codecChangedChunks = 0;

  for (const baselineChunk of baselineChunks.values()) {
    const comparedChunk = comparedChunks.get(baselineChunk.key) ?? null;
    const delta = regionPayloadChunkDelta(baselineChunk.key, baselineChunk, comparedChunk);
    deltas.push(delta);
    if (!comparedChunk) {
      baselineOnlyChunks++;
      continue;
    }
    commonChunks++;
    if (regionPayloadSignature(baselineChunk) === regionPayloadSignature(comparedChunk)) matchingCommonChunks++;
    else changedCommonChunks++;
    if (delta.encodedByteDelta < 0) smallerChunks++;
    else if (delta.encodedByteDelta > 0) largerChunks++;
    if (delta.codecChanged) codecChangedChunks++;
  }

  for (const comparedChunk of comparedChunks.values()) {
    if (baselineChunks.has(comparedChunk.key)) continue;
    comparedOnlyChunks++;
    deltas.push(regionPayloadChunkDelta(comparedChunk.key, null, comparedChunk));
  }

  return {
    comparedAt: Date.now(),
    baseline: regionPayloadEndpoint(baseline),
    compared: regionPayloadEndpoint(compared),
    commonChunks,
    matchingCommonChunks,
    changedCommonChunks,
    baselineOnlyChunks,
    comparedOnlyChunks,
    smallerChunks,
    largerChunks,
    codecChangedChunks,
    rawByteDelta: compared.compression.rawBytes - baseline.compression.rawBytes,
    encodedByteDelta: compared.compression.encodedBytes - baseline.compression.encodedBytes,
    savedByteDelta: compared.compression.savedBytes - baseline.compression.savedBytes,
    largestDeltas: deltas
      .sort((a, b) => {
        const encodedDelta = Math.abs(b.encodedByteDelta) - Math.abs(a.encodedByteDelta);
        if (encodedDelta !== 0) return encodedDelta;
        return Math.abs(b.rawByteDelta) - Math.abs(a.rawByteDelta);
      })
      .slice(0, 8),
  };
}

function formatSignedRegionBytes(bytes: number): string {
  const prefix = bytes > 0 ? '+' : bytes < 0 ? '-' : '';
  return `${prefix}${formatRegionBrowserKB(Math.abs(bytes))}`;
}

function formatRegionPayloadComparison(comparison: RegionPayloadComparison): string {
  const encodedDelta = formatSignedRegionBytes(comparison.encodedByteDelta);
  const rawDelta = formatSignedRegionBytes(comparison.rawByteDelta);
  return `${comparison.baseline.name} -> ${comparison.compared.name}: common ${comparison.commonChunks}, changed ${comparison.changedCommonChunks}, base +${comparison.baselineOnlyChunks}, compare +${comparison.comparedOnlyChunks} | encoded ${encodedDelta}, raw ${rawDelta}`;
}

function serializeRegionPayloadComparison(comparison: RegionPayloadComparison | null) {
  if (!comparison) return null;
  return {
    comparedAt: comparison.comparedAt,
    baseline: comparison.baseline,
    compared: comparison.compared,
    commonChunks: comparison.commonChunks,
    matchingCommonChunks: comparison.matchingCommonChunks,
    changedCommonChunks: comparison.changedCommonChunks,
    baselineOnlyChunks: comparison.baselineOnlyChunks,
    comparedOnlyChunks: comparison.comparedOnlyChunks,
    smallerChunks: comparison.smallerChunks,
    largerChunks: comparison.largerChunks,
    codecChangedChunks: comparison.codecChangedChunks,
    rawByteDelta: comparison.rawByteDelta,
    encodedByteDelta: comparison.encodedByteDelta,
    savedByteDelta: comparison.savedByteDelta,
    largestDeltas: comparison.largestDeltas,
  };
}

function formatRegionPayloadHashAudit(audit: RegionPayloadHashAudit): string {
  const status = audit.failedPayloads === 0 ? 'ok' : `${audit.failedPayloads} failed`;
  return `${audit.name}: decoded ${audit.payloads} payloads / ${formatRegionBrowserBytes(audit.decodedBytes)} from ${formatRegionBrowserBytes(audit.encodedBytes)} encoded | ${status}`;
}

function serializeRegionPayloadHashAudit(audit: RegionPayloadHashAudit | null) {
  if (!audit) return null;
  return {
    key: audit.key,
    name: audit.name,
    savedAt: audit.savedAt,
    chunkCount: audit.chunkCount,
    editCount: audit.editCount,
    auditedAt: audit.auditedAt,
    payloads: audit.payloads,
    failedPayloads: audit.failedPayloads,
    encodedBytes: audit.encodedBytes,
    decodedBytes: audit.decodedBytes,
    failedChunks: audit.failedChunks,
    largestDecodedChunks: audit.largestDecodedChunks,
    chunks: audit.chunks,
  };
}

function filterRegionPayloadChunks(inspection: RegionPayloadInspection, filter: string) {
  const query = filter.trim().toLowerCase();
  const chunks = [...inspection.chunks].sort((a, b) => b.encodedBytes - a.encodedBytes);
  if (!query) return chunks;
  return chunks.filter(chunk => [
    chunk.key,
    chunk.vertices.codec,
    chunk.indices.codec,
    chunk.density.codec,
    chunk.vegetation.codec,
  ].some(value => value.toLowerCase().includes(query)));
}

function regionRetentionPolicy(id: unknown): RegionRetentionPolicy | null {
  return REGION_RETENTION_POLICIES.find(policy => policy.id === id) ?? null;
}

function normalizeRegionRetentionPolicyId(id: unknown): RegionRetentionPolicyId {
  return id === 'compact' || id === 'standard' || id === 'archive' || id === 'custom' ? id : 'custom';
}

function normalizeRegionBrowserState(state: Partial<RegionBrowserState> = {}): RegionBrowserState {
  const policyId = normalizeRegionRetentionPolicyId(state.retentionPolicyId);
  const policy = regionRetentionPolicy(policyId);
  const fallbackPolicy = regionRetentionPolicy('standard');
  return {
    filter: String(state.filter ?? ''),
    savedOnly: Boolean(state.savedOnly),
    retentionPolicyId: policyId,
    retentionMaxSlots: policy?.maxSlots ?? clampInt(Number(state.retentionMaxSlots ?? fallbackPolicy?.maxSlots ?? REGION_SLOTS.length), 1, REGION_SLOTS.length),
    retentionMaxMB: policy?.maxMB ?? Math.max(1, Math.min(2048, Math.round(Number(state.retentionMaxMB ?? fallbackPolicy?.maxMB ?? 256) || 256))),
    payloadFilter: String(state.payloadFilter ?? ''),
  };
}

function loadRegionBrowserState(): RegionBrowserState {
  try {
    const raw = localStorage.getItem(REGION_BROWSER_STATE_STORAGE_KEY);
    return normalizeRegionBrowserState(raw ? JSON.parse(raw) : {});
  } catch {
    return normalizeRegionBrowserState();
  }
}

function saveRegionBrowserState(state: RegionBrowserState): void {
  try {
    localStorage.setItem(REGION_BROWSER_STATE_STORAGE_KEY, JSON.stringify(normalizeRegionBrowserState(state)));
  } catch {
    // Browser state persistence is best effort; the UI still works in memory.
  }
}

function normalizeRegionMaintenanceEvent(raw: unknown): RegionMaintenanceEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const event = raw as Partial<RegionMaintenanceEvent>;
  const at = Number(event.at);
  if (!Number.isFinite(at) || at <= 0) return null;
  const action = String(event.action ?? '').trim().slice(0, 32);
  const summary = String(event.summary ?? '').trim().slice(0, 180);
  if (!action || !summary) return null;
  return {
    id: Number.isFinite(Number(event.id)) ? Number(event.id) : at,
    at,
    action,
    summary,
  };
}

function loadRegionMaintenanceHistory(): RegionMaintenanceEvent[] {
  try {
    const raw = localStorage.getItem(REGION_MAINTENANCE_HISTORY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.map(normalizeRegionMaintenanceEvent).filter((event): event is RegionMaintenanceEvent => Boolean(event)).sort((a, b) => b.at - a.at).slice(0, MAX_REGION_MAINTENANCE_EVENTS)
      : [];
  } catch {
    return [];
  }
}

function saveRegionMaintenanceHistory(history: RegionMaintenanceEvent[]): void {
  try {
    localStorage.setItem(REGION_MAINTENANCE_HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, MAX_REGION_MAINTENANCE_EVENTS)));
  } catch {
    // Best effort only; region maintenance still works without this local ledger.
  }
}

function addRegionMaintenanceEvent(history: RegionMaintenanceEvent[], action: string, summary: string): RegionMaintenanceEvent[] {
  const event = normalizeRegionMaintenanceEvent({ id: Date.now(), at: Date.now(), action, summary });
  if (!event) return history;
  return [event, ...history].slice(0, MAX_REGION_MAINTENANCE_EVENTS);
}

function regionInfoEncodedBytes(info: RegionSlotInfo): number {
  return info.compressionEncodedBytes || info.compressionRawBytes || 0;
}

function regionRetentionPolicyLabel(state: RegionBrowserState): string {
  if (state.retentionPolicyId === 'custom') return 'Custom';
  return regionRetentionPolicy(state.retentionPolicyId)?.label ?? 'Custom';
}

function buildRegionRetentionPlan(infos: RegionSlotInfo[], state: RegionBrowserState, activeKey: string): RegionRetentionPlan {
  const policy = normalizeRegionBrowserState(state);
  let remaining = managedRegionSlotInfos(infos).sort((a, b) => a.savedAt - b.savedAt);
  const pruned: RegionSlotInfo[] = [];
  let encodedBytes = remaining.reduce((total, info) => total + regionInfoEncodedBytes(info), 0);
  const maxEncodedBytes = policy.retentionMaxMB * 1024 * 1024;
  const beforeSlots = remaining.length;
  const beforeEncodedBytes = encodedBytes;
  while (remaining.length > policy.retentionMaxSlots || encodedBytes > maxEncodedBytes) {
    const candidates = remaining.length > 1 ? remaining.filter(info => info.key !== activeKey) : remaining;
    const target = candidates[0] ?? remaining[0];
    if (!target) break;
    pruned.push(target);
    remaining = remaining.filter(info => info.key !== target.key);
    encodedBytes -= regionInfoEncodedBytes(target);
  }
  return {
    policyId: policy.retentionPolicyId,
    policyLabel: regionRetentionPolicyLabel(policy),
    maxSlots: policy.retentionMaxSlots,
    maxEncodedBytes,
    beforeSlots,
    beforeEncodedBytes,
    afterSlots: remaining.length,
    afterEncodedBytes: encodedBytes,
    pruned,
  };
}

function formatRetentionSlotNames(infos: RegionSlotInfo[], names: string[]): string {
  return infos.map(info => {
    const index = regionSlotIndexByKey(info.key);
    const name = index >= 0 ? sanitizeRegionSlotName(names[index] ?? info.name, index) : info.name;
    return `${name} (${info.chunkCount} chunks, ${formatRegionBrowserBytes(regionInfoEncodedBytes(info))})`;
  }).join(', ');
}

function formatRegionRetentionPlan(plan: RegionRetentionPlan, names: string[], detailed = false): string {
  const limit = `${plan.maxSlots} slots / ${formatRegionBrowserBytes(plan.maxEncodedBytes)}`;
  if (plan.beforeSlots === 0) return `${plan.policyLabel}: no saved managed regions.`;
  if (plan.pruned.length === 0) {
    return `${plan.policyLabel}: keep ${plan.beforeSlots} saved slots, ${formatRegionBrowserBytes(plan.beforeEncodedBytes)} used under ${limit}.`;
  }
  const reclaimedBytes = plan.beforeEncodedBytes - plan.afterEncodedBytes;
  const prunedNames = formatRetentionSlotNames(plan.pruned, names);
  const summary = `${plan.policyLabel}: prune ${plan.pruned.length}, keep ${plan.afterSlots}, reclaim ${formatRegionBrowserBytes(reclaimedBytes)}.`;
  return detailed ? `${summary}\nLimit: ${limit}\nPrunes: ${prunedNames}` : summary;
}

function serializeRetentionPlan(plan: RegionRetentionPlan, names: string[]) {
  return {
    policyId: plan.policyId,
    policyLabel: plan.policyLabel,
    maxSlots: plan.maxSlots,
    maxEncodedBytes: plan.maxEncodedBytes,
    beforeSlots: plan.beforeSlots,
    beforeEncodedBytes: plan.beforeEncodedBytes,
    afterSlots: plan.afterSlots,
    afterEncodedBytes: plan.afterEncodedBytes,
    summary: formatRegionRetentionPlan(plan, names),
    pruned: plan.pruned.map(info => {
      const index = regionSlotIndexByKey(info.key);
      return {
        key: info.key,
        name: index >= 0 ? sanitizeRegionSlotName(names[index] ?? info.name, index) : info.name,
        savedAt: info.savedAt,
        chunkCount: info.chunkCount,
        editCount: info.editCount,
        encodedBytes: regionInfoEncodedBytes(info),
        rawBytes: info.compressionRawBytes,
        payloads: info.compressionPayloads,
        rawPayloads: info.compressionRawPayloads,
        lzssPayloads: info.compressionLzssPayloads,
        deltaVarintPayloads: info.compressionDeltaPayloads,
      };
    }),
  };
}

function addCompressionSummary(target: PayloadCompressionStats, source: PayloadCompressionStats | undefined): PayloadCompressionStats {
  if (!source) return target;
  target.payloads += source.payloads;
  target.rawBytes += source.rawBytes;
  target.encodedBytes += source.encodedBytes;
  target.savedBytes = Math.max(0, target.rawBytes - target.encodedBytes);
  target.ratio = target.rawBytes > 0 ? target.encodedBytes / target.rawBytes : 1;
  target.rawPayloads += source.rawPayloads;
  target.lzssPayloads += source.lzssPayloads;
  target.deltaVarintPayloads += source.deltaVarintPayloads;
  return target;
}

function regionSlotOptionLabel(index: number, names: string[], infos: RegionSlotInfo[]): string {
  const slot = REGION_SLOTS[index];
  const name = sanitizeRegionSlotName(names[index] ?? slot.name, index);
  const info = regionSlotInfoFor(infos, slot.key);
  return info ? `${name} (${info.chunkCount} chunks)` : `${name} (empty)`;
}

function renderRegionBrowser(
  root: HTMLElement,
  settings: EngineSettings,
  names: string[],
  infos: RegionSlotInfo[],
  browserState: RegionBrowserState,
  maintenanceHistory: RegionMaintenanceEvent[],
  payloadInspection: RegionPayloadInspection | null,
  payloadComparison: RegionPayloadComparison | null,
  payloadHashAudit: RegionPayloadHashAudit | null,
  onStateChange: (state: RegionBrowserState) => void,
  onSelect: (index: number) => void,
  onAction: (action: RegionBrowserAction, index: number) => void,
): void {
  const normalizedState = normalizeRegionBrowserState(browserState);
  const managedInfos = managedRegionSlotInfos(infos);
  const hideIdleBrowser = managedInfos.length === 0
    && maintenanceHistory.length === 0
    && !payloadInspection
    && !payloadComparison
    && !payloadHashAudit
    && normalizedState.filter.trim().length === 0
    && !normalizedState.savedOnly;
  root.textContent = '';
  root.className = 'region-browser';
  root.onpointerdown = event => event.stopPropagation();
  root.onclick = event => event.stopPropagation();
  root.hidden = hideIdleBrowser;
  if (hideIdleBrowser) return;
  let currentPayloadFilter = normalizedState.payloadFilter;

  const header = document.createElement('div');
  header.className = 'region-browser-header';
  header.textContent = 'Region Browser';
  root.append(header);

  const totalChunks = managedInfos.reduce((total, info) => total + info.chunkCount, 0);
  const totalRawBytes = managedInfos.reduce((total, info) => total + info.compressionRawBytes, 0);
  const totalEncodedBytes = managedInfos.reduce((total, info) => total + info.compressionEncodedBytes, 0);
  const retentionPlan = buildRegionRetentionPlan(infos, normalizedState, regionSlotFromSettings(settings, names).key);
  const oldestInfo = managedInfos.reduce<RegionSlotInfo | null>(
    (oldest, info) => !oldest || info.savedAt < oldest.savedAt ? info : oldest,
    null,
  );
  const summary = document.createElement('div');
  summary.className = 'region-browser-summary';
  summary.textContent = managedInfos.length > 0
    ? `${managedInfos.length}/${REGION_SLOTS.length} saved | ${totalChunks} chunks | ${formatRegionBrowserBytes(totalEncodedBytes)} / ${formatRegionBrowserBytes(totalRawBytes)} | oldest ${new Date(oldestInfo?.savedAt ?? Date.now()).toLocaleTimeString()}`
    : 'No saved managed regions';
  root.append(summary);

  const controls = document.createElement('div');
  controls.className = 'region-browser-controls';

  const filter = document.createElement('input');
  filter.type = 'search';
  filter.placeholder = 'Filter slots';
  filter.value = normalizedState.filter;
  filter.className = 'region-browser-filter';
  controls.append(filter);

  const savedOnlyLabel = document.createElement('label');
  savedOnlyLabel.className = 'region-browser-saved-only';
  const savedOnly = document.createElement('input');
  savedOnly.type = 'checkbox';
  savedOnly.checked = normalizedState.savedOnly;
  savedOnlyLabel.append(savedOnly, document.createTextNode('Saved only'));
  controls.append(savedOnlyLabel);

  const retention = document.createElement('div');
  retention.className = 'region-browser-retention';
  const policyLabel = document.createElement('label');
  policyLabel.textContent = 'Policy';
  const policySelect = document.createElement('select');
  for (const optionDef of [
    { id: 'custom', label: 'Custom' },
    ...REGION_RETENTION_POLICIES.map(policy => ({ id: policy.id, label: policy.label })),
  ] as Array<{ id: RegionRetentionPolicyId; label: string }>) {
    const option = document.createElement('option');
    option.value = optionDef.id;
    option.textContent = optionDef.label;
    policySelect.append(option);
  }
  policySelect.value = normalizedState.retentionPolicyId;
  policyLabel.append(policySelect);
  const maxSlotsLabel = document.createElement('label');
  maxSlotsLabel.textContent = 'Keep slots';
  const maxSlots = document.createElement('input');
  maxSlots.type = 'number';
  maxSlots.min = '1';
  maxSlots.max = String(REGION_SLOTS.length);
  maxSlots.step = '1';
  maxSlots.value = String(normalizedState.retentionMaxSlots);
  maxSlotsLabel.append(maxSlots);
  const maxMBLabel = document.createElement('label');
  maxMBLabel.textContent = 'Max MB';
  const maxMB = document.createElement('input');
  maxMB.type = 'number';
  maxMB.min = '1';
  maxMB.max = '2048';
  maxMB.step = '1';
  maxMB.value = String(normalizedState.retentionMaxMB);
  maxMBLabel.append(maxMB);
  const retentionReport = document.createElement('div');
  retentionReport.className = 'region-retention-report';
  retentionReport.textContent = formatRegionRetentionPlan(retentionPlan, names);
  retention.append(policyLabel, maxSlotsLabel, maxMBLabel, retentionReport);
  controls.append(retention);

  const maintenance = document.createElement('div');
  maintenance.className = 'region-browser-maintenance';
  for (const [action, label] of [
    ['refresh', 'Refresh'],
    ['dryRunRetention', 'Dry Run'],
    ['applyRetention', 'Apply Policy'],
    ['pruneOldest', 'Prune Oldest'],
    ['exportMaintenanceReport', 'Export Report'],
    ['exportBundle', 'Export All'],
    ['importBundle', 'Import All'],
  ] as Array<[RegionBrowserAction, string]>) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if ((action === 'exportBundle' || action === 'pruneOldest' || action === 'dryRunRetention' || action === 'applyRetention') && managedInfos.length === 0) button.disabled = true;
    button.addEventListener('click', () => onAction(action, -1));
    maintenance.append(button);
  }
  controls.append(maintenance);
  root.append(controls);

  const historyPanel = document.createElement('div');
  historyPanel.className = 'region-maintenance-history';
  const historyTitle = document.createElement('div');
  historyTitle.className = 'region-maintenance-title';
  historyTitle.textContent = 'Maintenance History';
  historyPanel.append(historyTitle);
  const historyItems = maintenanceHistory.slice(0, 4);
  if (historyItems.length === 0) {
    const emptyHistory = document.createElement('div');
    emptyHistory.className = 'region-maintenance-empty';
    emptyHistory.textContent = 'No maintenance actions yet';
    historyPanel.append(emptyHistory);
  } else {
    for (const event of historyItems) {
      const item = document.createElement('div');
      item.className = 'region-maintenance-item';
      const time = new Date(event.at).toLocaleTimeString();
      item.textContent = `${time} | ${event.action}: ${event.summary}`;
      historyPanel.append(item);
    }
  }
  root.append(historyPanel);

  const payloadPanel = document.createElement('div');
  payloadPanel.className = 'region-payload-inspection';
  const payloadTitle = document.createElement('div');
  payloadTitle.className = 'region-payload-title';
  payloadTitle.textContent = 'Payload Browser';
  payloadPanel.append(payloadTitle);
  if (!payloadInspection) {
    const emptyPayload = document.createElement('div');
    emptyPayload.className = 'region-payload-empty';
    emptyPayload.textContent = 'Inspect a saved slot to browse payload sizes';
    payloadPanel.append(emptyPayload);
  } else {
    const payloadSummary = document.createElement('div');
    payloadSummary.className = 'region-payload-summary';
    payloadSummary.textContent = formatRegionPayloadInspection(payloadInspection);
    payloadPanel.append(payloadSummary);
    if (payloadComparison && payloadComparison.baseline.key === payloadInspection.key) {
      const comparison = document.createElement('div');
      comparison.className = 'region-payload-comparison';
      const comparisonTitle = document.createElement('div');
      comparisonTitle.className = 'region-payload-comparison-title';
      comparisonTitle.textContent = 'Comparison';
      const comparisonSummary = document.createElement('div');
      comparisonSummary.className = 'region-payload-comparison-summary';
      comparisonSummary.textContent = formatRegionPayloadComparison(payloadComparison);
      comparison.append(comparisonTitle, comparisonSummary);
      for (const delta of payloadComparison.largestDeltas.slice(0, 6)) {
        const item = document.createElement('div');
        item.className = 'region-payload-comparison-item';
        const codecText = delta.codecChanged ? ` | codecs ${delta.baselineCodecs} -> ${delta.comparedCodecs}` : '';
        item.textContent = `${delta.key} | ${delta.state} | encoded ${formatRegionBrowserKB(delta.baselineEncodedBytes)} -> ${formatRegionBrowserKB(delta.comparedEncodedBytes)} (${formatSignedRegionBytes(delta.encodedByteDelta)})${codecText}`;
        comparison.append(item);
      }
      payloadPanel.append(comparison);
    }
    if (payloadHashAudit && payloadHashAudit.key === payloadInspection.key) {
      const audit = document.createElement('div');
      audit.className = payloadHashAudit.failedPayloads === 0 ? 'region-payload-audit' : 'region-payload-audit region-payload-audit-failed';
      const auditTitle = document.createElement('div');
      auditTitle.className = 'region-payload-audit-title';
      auditTitle.textContent = 'Decode/Hash Audit';
      const auditSummary = document.createElement('div');
      auditSummary.className = 'region-payload-audit-summary';
      auditSummary.textContent = formatRegionPayloadHashAudit(payloadHashAudit);
      audit.append(auditTitle, auditSummary);
      const auditItems = payloadHashAudit.failedChunks.length > 0 ? payloadHashAudit.failedChunks : payloadHashAudit.largestDecodedChunks.slice(0, 5);
      for (const chunk of auditItems.slice(0, 5)) {
        const item = document.createElement('div');
        item.className = 'region-payload-audit-item';
        const status = chunk.failures.length > 0 ? `failed ${chunk.failures.join('; ')}` : `hashes v/i/d/veg ${chunk.vertices.decodedHash}/${chunk.indices.decodedHash}/${chunk.density.decodedHash}/${chunk.vegetation.decodedHash}`;
        item.textContent = `${chunk.key} | ${formatRegionBrowserKB(chunk.decodedBytes)} decoded / ${formatRegionBrowserKB(chunk.encodedBytes)} encoded | ${status}`;
        audit.append(item);
      }
      payloadPanel.append(audit);
    }
    const payloadFilter = document.createElement('input');
    payloadFilter.type = 'search';
    payloadFilter.placeholder = 'Filter chunks or codecs';
    payloadFilter.value = normalizedState.payloadFilter;
    payloadFilter.className = 'region-payload-filter';
    payloadPanel.append(payloadFilter);
    const payloadList = document.createElement('div');
    payloadList.className = 'region-payload-list';
    const renderPayloadList = () => {
      payloadList.textContent = '';
      const chunks = filterRegionPayloadChunks(payloadInspection, payloadFilter.value);
      const visibleChunks = chunks.slice(0, 8);
      if (visibleChunks.length === 0) {
        const emptyPayload = document.createElement('div');
        emptyPayload.className = 'region-payload-empty';
        emptyPayload.textContent = 'No matching payload chunks';
        payloadList.append(emptyPayload);
        return;
      }
      for (const chunk of visibleChunks) {
        const item = document.createElement('div');
        item.className = 'region-payload-item';
        item.textContent = `${chunk.key} | ${formatRegionBrowserKB(chunk.encodedBytes)} / ${formatRegionBrowserKB(chunk.rawBytes)} | v/i/d/veg ${chunk.vertices.codec}/${chunk.indices.codec}/${chunk.density.codec}/${chunk.vegetation.codec}`;
        payloadList.append(item);
      }
    };
    payloadFilter.addEventListener('input', () => {
      onStateChange(normalizeRegionBrowserState({
        ...normalizedState,
        filter: filter.value,
        savedOnly: savedOnly.checked,
        retentionPolicyId: policySelect.value as RegionRetentionPolicyId,
        retentionMaxSlots: Number(maxSlots.value),
        retentionMaxMB: Number(maxMB.value),
        payloadFilter: payloadFilter.value,
      }));
      currentPayloadFilter = payloadFilter.value;
      renderPayloadList();
    });
    renderPayloadList();
    payloadPanel.append(payloadList);
  }
  root.append(payloadPanel);

  const list = document.createElement('div');
  list.className = 'region-slot-list';
  const rows: HTMLElement[] = [];
  for (let index = 0; index < REGION_SLOTS.length; index++) {
    const slot = REGION_SLOTS[index];
    const info = regionSlotInfoFor(infos, slot.key);
    const slotName = sanitizeRegionSlotName(names[index] ?? slot.name, index);
    const selected = clampInt(settings.regionSlot, 0, REGION_SLOTS.length - 1) === index;
    const row = document.createElement('div');
    row.className = selected ? 'region-slot-row region-slot-row-selected' : 'region-slot-row';
    row.dataset.saved = info ? '1' : '0';
    row.dataset.search = `${slotName} ${slot.key} ${info ? `${info.chunkCount} chunks ${info.editCount} edits saved` : 'empty'}`.toLowerCase();
    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'region-slot-select';
    select.addEventListener('click', () => onSelect(index));

    const title = document.createElement('span');
    title.className = 'region-slot-title';
    title.textContent = slotName;
    const meta = document.createElement('span');
    meta.className = 'region-slot-meta';
    if (info) {
      const smaller = Math.max(0, (1 - info.compressionRatio) * 100);
      meta.textContent = `${info.chunkCount} chunks | ${info.editCount} edits | ${formatRegionBrowserBytes(info.compressionEncodedBytes)} / ${formatRegionBrowserBytes(info.compressionRawBytes)} | ${smaller.toFixed(0)}% smaller | ${formatRegionCodecCounts(info)}`;
    } else {
      meta.textContent = 'Empty slot';
    }
    const saved = document.createElement('span');
    saved.className = 'region-slot-saved';
    saved.textContent = info?.savedAt ? `Saved ${new Date(info.savedAt).toLocaleTimeString()}` : 'No save';

    select.append(title, meta, saved);
    const actions = document.createElement('div');
    actions.className = 'region-slot-actions';
    for (const [action, label] of [
      ['load', 'Load'],
      ['diff', 'Diff'],
      ['inspect', 'Inspect'],
      ['comparePayload', 'Compare'],
      ['verifyPayload', 'Verify'],
      ['export', 'Export'],
      ['clear', 'Clear'],
    ] as Array<[RegionBrowserAction, string]>) {
      const actionButton = document.createElement('button');
      actionButton.type = 'button';
      actionButton.textContent = label;
      if (!info && action !== 'diff') actionButton.disabled = true;
      if (action === 'comparePayload' && (!info || !payloadInspection || payloadInspection.key === slot.key)) actionButton.disabled = true;
      if (action === 'verifyPayload' && (!info || !payloadInspection || payloadInspection.key !== slot.key)) actionButton.disabled = true;
      actionButton.addEventListener('click', () => onAction(action, index));
      actions.append(actionButton);
    }
    row.append(select, actions);
    list.append(row);
    rows.push(row);
  }
  const empty = document.createElement('div');
  empty.className = 'region-browser-empty';
  empty.textContent = 'No matching regions';
  list.append(empty);
  root.append(list);

  const applyFilters = () => {
    const query = filter.value.trim().toLowerCase();
    const savedOnlyChecked = savedOnly.checked;
    let visible = 0;
    for (const row of rows) {
      const matchesQuery = query.length === 0 || (row.dataset.search ?? '').includes(query);
      const matchesSaved = !savedOnlyChecked || row.dataset.saved === '1';
      const show = matchesQuery && matchesSaved;
      row.hidden = !show;
      if (show) visible++;
    }
    empty.hidden = visible > 0;
  };
  const updateRetentionReport = (state: RegionBrowserState): void => {
    retentionReport.textContent = formatRegionRetentionPlan(
      buildRegionRetentionPlan(infos, state, regionSlotFromSettings(settings, names).key),
      names,
    );
  };
  filter.addEventListener('input', () => {
    const next = normalizeRegionBrowserState({ filter: filter.value, savedOnly: savedOnly.checked, retentionPolicyId: policySelect.value as RegionRetentionPolicyId, retentionMaxSlots: Number(maxSlots.value), retentionMaxMB: Number(maxMB.value), payloadFilter: currentPayloadFilter });
    onStateChange(next);
    updateRetentionReport(next);
    applyFilters();
  });
  savedOnly.addEventListener('change', () => {
    const next = normalizeRegionBrowserState({ filter: filter.value, savedOnly: savedOnly.checked, retentionPolicyId: policySelect.value as RegionRetentionPolicyId, retentionMaxSlots: Number(maxSlots.value), retentionMaxMB: Number(maxMB.value), payloadFilter: currentPayloadFilter });
    onStateChange(next);
    updateRetentionReport(next);
    applyFilters();
  });
  policySelect.addEventListener('change', () => {
    const next = normalizeRegionBrowserState({ filter: filter.value, savedOnly: savedOnly.checked, retentionPolicyId: policySelect.value as RegionRetentionPolicyId, retentionMaxSlots: Number(maxSlots.value), retentionMaxMB: Number(maxMB.value), payloadFilter: currentPayloadFilter });
    maxSlots.value = String(next.retentionMaxSlots);
    maxMB.value = String(next.retentionMaxMB);
    onStateChange(next);
    updateRetentionReport(next);
  });
  maxSlots.addEventListener('change', () => {
    const next = normalizeRegionBrowserState({ filter: filter.value, savedOnly: savedOnly.checked, retentionPolicyId: 'custom', retentionMaxSlots: Number(maxSlots.value), retentionMaxMB: Number(maxMB.value), payloadFilter: currentPayloadFilter });
    policySelect.value = next.retentionPolicyId;
    maxSlots.value = String(next.retentionMaxSlots);
    onStateChange(next);
    updateRetentionReport(next);
  });
  maxMB.addEventListener('change', () => {
    const next = normalizeRegionBrowserState({ filter: filter.value, savedOnly: savedOnly.checked, retentionPolicyId: 'custom', retentionMaxSlots: Number(maxSlots.value), retentionMaxMB: Number(maxMB.value), payloadFilter: currentPayloadFilter });
    policySelect.value = next.retentionPolicyId;
    maxMB.value = String(next.retentionMaxMB);
    onStateChange(next);
    updateRetentionReport(next);
  });
  applyFilters();
}

function updateOverlay(
  el: HTMLElement,
  fps: number,
  renderer: Renderer,
  streamer: ChunkStreamer,
  camera: FlyCamera,
  profile: RuntimeProfile,
  game: GameSnapshot,
  settings: EngineSettings,
  selectedRegionInfo?: RegionSlotInfo,
  densityDiff?: DensitySliceDiffSummary | null,
  selectedRegionName?: string,
  regionImportPreview?: RegionImportPreview | null,
  autoQuality?: AutoQualityState,
  browserWorkerBenchmarkCaptures: BrowserWorkerBenchmarkCapture[] = [],
  browserWorkerBenchmarkRunning = false,
): void {
  const counts = streamer.counts();
  const rstats = renderer.stats;
  const caps = renderer.capabilities;
  const regionSlot = regionSlotFromSettings(settings);
  const regionName = selectedRegionName ?? selectedRegionInfo?.name ?? regionSlot.name;
  const workerMode = caps.workerBufferMode === 'shared-queue'
    ? `shared job/remesh/result pages + ${streamer.lastStats.sharedResultChunks} zero-copy renderer results`
    : caps.workerBufferMode === 'shared-ready'
      ? 'transferable, SAB ready'
      : 'transferable fallback';
  const deviceLost = caps.deviceLostReason ? ` | Device lost: ${caps.deviceLostReason}` : '';
  const slotStatus = selectedRegionInfo
    ? `${selectedRegionInfo.chunkCount} chunks, ${selectedRegionInfo.editCount} edits, saved ${new Date(selectedRegionInfo.savedAt).toLocaleTimeString()}`
    : 'empty';
  const compressionStatus = streamer.lastStats.regionCompressionRawMB > 0
    ? `${streamer.lastStats.regionCompressionEncodedMB.toFixed(2)}/${streamer.lastStats.regionCompressionRawMB.toFixed(2)} MB (${Math.max(0, (1 - streamer.lastStats.regionCompressionRatio) * 100).toFixed(0)}% smaller)`
    : 'n/a';
  const regionDiffLine = formatRegionDiff(streamer.lastRegionDiff);
  const densityDiffLine = formatDensityDiff(densityDiff ?? null);
  const importPreviewLine = formatRegionImportPreview(regionImportPreview ?? null);
  const sharedGenerateLine = streamer.lastStats.sharedQueueBatches > 0
    ? `${streamer.lastStats.sharedQueueDispatches}/${streamer.lastStats.sharedQueueBatches} gen jobs/batches, max ${streamer.lastStats.sharedQueueBatchMax}`
    : `${streamer.lastStats.sharedQueueDispatches} gen jobs`;
  const autoQualityLine = autoQuality
    ? `Quality: ${settings.qualityPreset === QUALITY_PRESET_AUTO ? `Auto ${autoQualityLevelName(autoQuality.level)} (${autoQuality.pressure})` : 'Manual'} | ${autoQuality.reason} | captures ${autoQuality.captures.length}`
    : '';
  const benchmarkLine = formatBrowserWorkerBenchmark(browserWorkerBenchmarkCaptures, browserWorkerBenchmarkRunning);
  const brushShape = brushShapeFromMode(settings.brushShape);
  const brushMaterial = settings.brushMode === BRUSH_MODE_PAINT ? ` ${paintMaterialLabel(settings.paintMaterial)}` : '';
  const brushStrength = settings.brushMode === BRUSH_MODE_SMOOTH || settings.brushMode === BRUSH_MODE_FLATTEN ? ` s${settings.brushStrength.toFixed(2)}` : '';
  const brushFalloff = settings.brushMode === BRUSH_MODE_CARVE || settings.brushMode === BRUSH_MODE_BUILD ? ` f${settings.brushFalloff.toFixed(2)}m` : '';
  const worldgen = worldgenSnapshot(camera, settings);
  const nextSurvey = game.collected >= game.total
    ? 'complete'
    : `| Next: ${game.nextSiteName ?? 'Survey'} ${game.nextBiome ?? 'Unknown'} / ${game.nextMaterial ?? 'Unknown'} ${game.nextDistance.toFixed(0)}m`;
  const nextContract = game.completedContracts >= game.totalContracts
    ? 'complete'
    : `| Next: ${game.nextContractName ?? 'Field Contract'} ${game.nextContractDistance.toFixed(0)}m | ${game.nextContractAction ?? 'Use terrain edit tools at the marker'}`;
  const nextCheckpoint = game.visitedCheckpoints >= game.totalCheckpoints
    ? 'complete'
    : `| Next: ${game.nextCheckpointName ?? 'Route Flag'} ${game.nextCheckpointDistance.toFixed(0)}m`;
  const nextHazard = game.clearedHazards >= game.totalHazards
    ? 'clear'
    : `| Next: ${game.nextHazardName ?? 'Hazard'} ${game.nextHazardDistance.toFixed(0)}m | ${game.nextHazardAction ?? 'Use terrain edit tools at the marker'}`;
  const activeHazard = game.activeHazardName
    ? ` | Hazard: ${game.activeHazardName} (${game.activeHazardRisk ?? 'risk'})`
    : '';
  el.innerHTML = `
    <b>Storm Canyon Voxel Prototype</b><br/>
    FPS: ${fps.toFixed(0)} | Frame: ${profile.avgFrameMs.toFixed(1)} ms avg | Draws: ${rstats.drawCalls} | SDF tris: ${(rstats.terrainTriangles / 1000).toFixed(0)}k | Clusters: ${rstats.terrainClusters}/${rstats.culledTerrainClusters} GPU visible/culled | Terrain arena: ${rstats.terrainClusterDrawCalls} indirect slots, ${rstats.terrainClusterDrawsSkipped} compacted-away clusters | Far tris: ${((rstats.farTerrainTriangles ?? 0) / 1000).toFixed(0)}k<br/>
    Render radius: ${streamer.baseStreamRadius}/${MAX_STREAM_RADIUS} base / ${streamer.effectiveStreamRadius} effective (${(streamer.effectiveStreamRadius * CHUNK_WORLD_SIZE).toFixed(0)}m) | LOD rings: ${streamer.terrainLodEnabled ? 'on' : 'off'} | Far vista: 4.6km clipmap | Target chunks: ${streamer.currentTargetChunks} | GPU terrain cull/Hi-Z: ${rstats.hiZOcclusionCulledBatches}/${rstats.hiZOcclusionTestedBatches} occluded/visible clusters<br/>
    LOD plan: ${streamer.lastStats.lodPlanTargetChunks} targets (0/1/2+: ${streamer.lastStats.lodPlanLod0Chunks}/${streamer.lastStats.lodPlanLod1Chunks}/${streamer.lastStats.lodPlanLod2PlusChunks}) | covered cells ${streamer.lastStats.lodPlanCoveredBaseCells} | transition faces ${streamer.lastStats.lodPlanTransitionFaces}/${streamer.lastStats.lodPlanTransitionEdges} on ${streamer.lastStats.lodPlanSkirtedChunks} chunks, ${streamer.lastStats.lodPlanTransitionCells} cells (${streamer.lastStats.lodPlanTransitionFaceBaseCells} face cells) | runtime mesh ${streamer.lastStats.lodTransitionMeshNative ? 'native' : 'TS'} ${streamer.lastStats.lodTransitionMeshEmittedCells}/${streamer.lastStats.lodTransitionMeshCells} cells, ${streamer.lastStats.lodTransitionMeshTriangles} tris, missing ${streamer.lastStats.lodTransitionMeshMissingSampleCells} | max LOD ${streamer.lastStats.lodPlanMaxLod}<br/>
    Survey beacons: ${game.collected}/${game.total} | Biomes: ${game.collectedBiomes.length}/${game.totalBiomes} ${nextSurvey} | Field contracts: ${game.completedContracts}/${game.totalContracts} ${nextContract}<br/>
    Route flags: ${game.visitedCheckpoints}/${game.totalCheckpoints} ${nextCheckpoint} | Hazards: ${game.clearedHazards}/${game.totalHazards} ${nextHazard}${activeHazard}<br/>
    Expedition: ${game.rank} | Score: ${game.score} | Inv samples/kits/flags: ${game.inventorySamples}/${game.inventoryFieldKits}/${game.inventoryRouteFlags} | Travel: ${(game.traversalMeters / 1000).toFixed(2)}km | Active markers: ${rstats.gameMarkers} | Edit markers: ${rstats.debugMarkers}<br/>
    Chunks loaded/queued/pending: ${counts.loaded}/${counts.queued}/${counts.pending} | Visible/culled: ${rstats.visibleTerrainChunks}/${rstats.culledTerrainChunks} | Workers: ${counts.workers} (${counts.idle} idle)<br/>
    Meshes: ${profile.meshCount} (LOD 0/1/2+: ${profile.terrainLod0Chunks}/${profile.terrainLod1Chunks}/${profile.terrainLod2PlusChunks}, seams ${profile.terrainLodTransitionEdges} edges, transition mesh ${profile.terrainLodTransitionMeshChunks}/${profile.terrainLodTransitionMeshTriangles} tris) | Vegetation patches visible/culled/total: ${rstats.visibleVegetationPatches}/${rstats.culledVegetationPatches}/${profile.vegetationPatchCount} | Veg instances/draws: ${rstats.vegetationInstances}/${rstats.vegetationDrawCalls} batched, LOD culled ${rstats.vegetationLodCulledInstances} | Avg WASM mesh: ${streamer.lastStats.avgMeshMs.toFixed(1)} ms<br/>
    Upload: ${streamer.lastStats.uploadMB.toFixed(2)} MB last / ${profile.avgUploadMB.toFixed(2)} MB avg | GPU buffers est: ${profile.estimatedGpuMB.toFixed(1)} MB (${profile.chunkMeshMB.toFixed(1)} terrain, ${profile.farTerrainMB.toFixed(1)} far, ${profile.vegetationMB.toFixed(1)} veg, ${profile.waterMB.toFixed(2)} water, ${profile.depthPyramidMB.toFixed(2)} hi-z/${profile.depthPyramidMips} mips, ${profile.uploadRingMB.toFixed(1)} staging)<br/>
    Renderer upload ring: ${profile.uploadRingPages} pages | last ${profile.uploadRingLastFlushMB.toFixed(2)} MB | pending ${profile.uploadRingPendingMB.toFixed(2)} MB | fallback ${profile.uploadRingFallbackUploads}/${profile.uploadRingFallbackMB.toFixed(2)} MB<br/>
    Generated/remeshed: ${streamer.lastStats.generated}/${streamer.lastStats.remeshed} | Stale discarded: ${streamer.lastStats.discarded} | Mesh overflow events: ${streamer.lastStats.overflow} | Brush: ${brushModeLabel(settings.brushMode)}${brushMaterial} ${brushShapeLabel(brushShape)} r${settings.editRadius.toFixed(1)}m${brushFalloff}${brushStrength} @ ${settings.brushDistance.toFixed(0)}m${brushShape === 'capsule' ? ` l${settings.brushLength.toFixed(1)}m` : ''} | Edits: ${streamer.lastStats.editCount}/${MAX_EDIT_OPERATIONS} | Redo: ${streamer.lastStats.redoEditCount} | Branches: ${streamer.lastStats.editBranchCount}/${streamer.lastStats.editBranchEditCount} edits | Density payload: ${streamer.lastStats.densityKB.toFixed(1)} KB/chunk<br/>
    Worldgen probes: ${formatWorldgenProbe(worldgen.brush)} | ${formatWorldgenProbe(worldgen.camera)}<br/>
    Worldgen tiles: ${formatWorldgenTileStats(worldgen.tileStats)}<br/>
    Erosion tiles: ${formatErosionTileStats(worldgen.erosionTileStats)}<br/>
    Material fields: ${formatMaterialTileStats(worldgen.materialTileStats)}<br/>
    Cave graph: ${formatCaveGraphStats(worldgen.caveGraphStats)}<br/>
    Chunk cache: ${streamer.lastStats.cacheEntries} entries / ${streamer.lastStats.cacheMB.toFixed(1)} MB | Hits/misses: ${streamer.lastStats.cacheHits}/${streamer.lastStats.cacheMisses} | Array pool: ${streamer.lastStats.pooledArrays} / ${streamer.lastStats.pooledMB.toFixed(1)} MB, reuse ${streamer.lastStats.poolHits}/${streamer.lastStats.poolMisses}<br/>
    Worker scratch: ${streamer.lastStats.workerScratchMB.toFixed(3)} MB arenas, reuse ${streamer.lastStats.workerScratchReuses} | Transfer alloc: ${streamer.lastStats.workerTransferMB.toFixed(1)} MB / ${streamer.lastStats.workerTransferAllocations} | Shared pages: ${streamer.lastStats.sharedQueuePages} job / ${streamer.lastStats.sharedRemeshPages} remesh / ${streamer.lastStats.sharedResultPages} result, ${sharedGenerateLine}; remesh/results ${streamer.lastStats.sharedRemeshDispatches}/${streamer.lastStats.sharedResultChunks}, cache borrowed ${streamer.lastStats.sharedResultCacheBorrowedChunks}/${(streamer.lastStats.sharedResultCacheBorrowedBytes / (1024 * 1024)).toFixed(1)} MB, copies ${(streamer.lastStats.sharedResultCacheCopyBytes / (1024 * 1024)).toFixed(1)} MB<br/>
    Result slots: ${streamer.lastStats.sharedResultSlotOccupied}/${streamer.lastStats.sharedResultSlotCapacity} occupied (${streamer.lastStats.sharedResultSlotExhaustions} exh, ${streamer.lastStats.sharedResultSlotReleases} rel) | Remesh fallback: ${streamer.lastStats.remeshFallbackDispatches} dispatches / ${(streamer.lastStats.remeshFallbackBytes / (1024 * 1024)).toFixed(1)} MB copied<br/>
    Region ${regionName} save/load/export/import: ${streamer.lastStats.savedRegionChunks}/${streamer.lastStats.loadedRegionChunks}/${streamer.lastStats.exportedRegionChunks}/${streamer.lastStats.importedRegionChunks} chunks | Slot: ${slotStatus}<br/>
    Region compression: ${compressionStatus}<br/>
    ${regionDiffLine ? `${regionDiffLine}<br/>` : ''}
    ${importPreviewLine ? `${importPreviewLine}<br/>` : ''}
    ${densityDiffLine ? `${densityDiffLine}<br/>` : ''}
    Runtime: WebGPU ${caps.webgpu ? 'on' : 'off'} | COI/SAB: ${caps.crossOriginIsolated ? 'yes' : 'no'}/${caps.sharedArrayBufferAvailable ? 'yes' : 'no'} | Workers: ${workerMode} | Max buffer: ${caps.maxBufferSizeMB.toFixed(0)} MB | Timestamp query: ${caps.timestampQuery ? 'yes' : 'no'} | Multi-draw indirect: ${caps.multiDrawIndirect ? 'on' : 'off'}${deviceLost}<br/>
    ${autoQualityLine ? `${autoQualityLine}<br/>` : ''}
    ${benchmarkLine}<br/>
    Camera: ${camera.position[0].toFixed(1)}, ${camera.position[1].toFixed(1)}, ${camera.position[2].toFixed(1)}<br/>
    <span>Click to capture mouse. WASD + Space/Ctrl fly. Shift fast. [ / ] or - / = changes radius. 0=max 20, 9=default, or open with ?radius=20. E applies the selected brush. Ctrl+Z/Y undo or redo. R resets edits.</span>
  `;
}

function densityColor(raw: number, scaleValue: number): [number, number, number] {
  const meters = raw / Math.max(scaleValue, 1);
  const nearSurface = Math.max(0, 1 - Math.min(Math.abs(meters) / 8, 1));
  const base = meters < 0 ? [34, 104, 210] : [178, 116, 40];
  return [
    Math.round(base[0] * (1 - nearSurface) + 248 * nearSurface),
    Math.round(base[1] * (1 - nearSurface) + 248 * nearSurface),
    Math.round(base[2] * (1 - nearSurface) + 248 * nearSurface),
  ];
}

function drawDensityCanvas(canvas: HTMLCanvasElement, slice: DensitySliceSnapshot): void {
  const size = slice.size;
  if (canvas.width !== size || canvas.height !== size) {
    canvas.width = size;
    canvas.height = size;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < slice.values.length; i++) {
    const [r, g, b] = densityColor(slice.values[i], slice.scale);
    const dst = i * 4;
    image.data[dst] = r;
    image.data[dst + 1] = g;
    image.data[dst + 2] = b;
    image.data[dst + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

function drawDensityDiffCanvas(canvas: HTMLCanvasElement, current: DensitySliceSnapshot | null, capture: DensitySliceCapture | null): void {
  const size = current?.size ?? capture?.size ?? DENSITY_GRID_N;
  if (canvas.width !== size || canvas.height !== size) {
    canvas.width = size;
    canvas.height = size;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const image = ctx.createImageData(size, size);
  if (!current || !capture || current.axis !== capture.axis || current.values.length !== capture.values.length) {
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = 16;
      image.data[i + 1] = 24;
      image.data[i + 2] = 28;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return;
  }
  for (let i = 0; i < current.values.length; i++) {
    const delta = (current.values[i] / current.scale) - (capture.values[i] / capture.scale);
    const amount = Math.min(Math.abs(delta) / 4, 1);
    const dst = i * 4;
    if (delta >= 0) {
      image.data[dst] = Math.round(38 + 210 * amount);
      image.data[dst + 1] = Math.round(44 + 44 * (1 - amount));
      image.data[dst + 2] = Math.round(62 + 32 * (1 - amount));
    } else {
      image.data[dst] = Math.round(42 + 34 * (1 - amount));
      image.data[dst + 1] = Math.round(94 + 62 * amount);
      image.data[dst + 2] = Math.round(142 + 100 * amount);
    }
    image.data[dst + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

function densitySliceMeta(slice: DensitySliceSnapshot): string {
  return `${slice.axis.toUpperCase()} ${slice.sliceIndex}/${slice.size - 1} | SDF ${(slice.min / slice.scale).toFixed(1)} to ${(slice.max / slice.scale).toFixed(1)}m`;
}

function renderDensityPanel(
  panel: HTMLElement,
  slice: DensitySliceSnapshot | null,
  enabled: boolean,
  captureLibrary: DensityCaptureLibrary,
  densityDiff: DensitySliceDiffSummary | null,
): void {
  const set = selectedDensitySet(captureLibrary);
  const capture = selectedDensityCapture(captureLibrary);
  panel.hidden = !enabled;
  if (!enabled) return;
  let title = panel.querySelector<HTMLElement>('[data-density-title]');
  let meta = panel.querySelector<HTMLElement>('[data-density-meta]');
  let canvas = panel.querySelector<HTMLCanvasElement>('[data-density-canvas]');
  let captureTitle = panel.querySelector<HTMLElement>('[data-density-capture-title]');
  let captureMeta = panel.querySelector<HTMLElement>('[data-density-capture-meta]');
  let captureCanvas = panel.querySelector<HTMLCanvasElement>('[data-density-capture-canvas]');
  let diffTitle = panel.querySelector<HTMLElement>('[data-density-diff-title]');
  let diffCanvas = panel.querySelector<HTMLCanvasElement>('[data-density-diff-canvas]');
  let diffMeta = panel.querySelector<HTMLElement>('[data-density-diff-meta]');
  if (!title || !meta || !canvas || !captureTitle || !captureMeta || !captureCanvas || !diffTitle || !diffCanvas || !diffMeta) {
    panel.textContent = '';
    title = document.createElement('div');
    title.dataset.densityTitle = 'true';
    title.className = 'density-title';
    meta = document.createElement('div');
    meta.dataset.densityMeta = 'true';
    meta.className = 'density-meta';
    canvas = document.createElement('canvas');
    canvas.dataset.densityCanvas = 'true';
    canvas.className = 'density-canvas';
    captureTitle = document.createElement('div');
    captureTitle.dataset.densityCaptureTitle = 'true';
    captureTitle.className = 'density-title density-capture-title';
    captureMeta = document.createElement('div');
    captureMeta.dataset.densityCaptureMeta = 'true';
    captureMeta.className = 'density-meta';
    captureCanvas = document.createElement('canvas');
    captureCanvas.dataset.densityCaptureCanvas = 'true';
    captureCanvas.className = 'density-canvas density-capture-canvas';
    diffTitle = document.createElement('div');
    diffTitle.dataset.densityDiffTitle = 'true';
    diffTitle.className = 'density-title density-diff-title';
    diffCanvas = document.createElement('canvas');
    diffCanvas.dataset.densityDiffCanvas = 'true';
    diffCanvas.className = 'density-canvas density-diff-canvas';
    diffMeta = document.createElement('div');
    diffMeta.dataset.densityDiffMeta = 'true';
    diffMeta.className = 'density-meta';
    panel.append(title, canvas, meta, captureTitle, captureCanvas, captureMeta, diffTitle, diffCanvas, diffMeta);
  }
  if (!slice) {
    title.textContent = `Density Slice · ${set.name}`;
    meta.textContent = 'Waiting for cached density near camera';
    canvas.width = 1;
    canvas.height = 1;
  } else {
    drawDensityCanvas(canvas, slice);
    title.textContent = `Density Slice ${slice.key}`;
    meta.textContent = `${set.name} (${captureLibrary.selectedSetIndex + 1}/${captureLibrary.sets.length}) | ${densitySliceMeta(slice)}`;
  }
  if (!capture) {
    captureTitle.hidden = true;
    captureCanvas.hidden = true;
    captureMeta.hidden = true;
    diffTitle.hidden = true;
    diffCanvas.hidden = true;
    diffMeta.hidden = true;
  } else {
    captureTitle.hidden = false;
    captureCanvas.hidden = false;
    captureMeta.hidden = false;
    diffTitle.hidden = false;
    diffCanvas.hidden = false;
    diffMeta.hidden = false;
    drawDensityCanvas(captureCanvas, capture);
    captureTitle.textContent = `Captured ${set.selectedIndex + 1}/${set.captures.length} ${capture.key}`;
    const diffText = formatDensityDiff(densityDiff);
    captureMeta.textContent = `${densitySliceMeta(capture)} | ${new Date(capture.capturedAt).toLocaleTimeString()}${diffText ? ` | ${diffText}` : ''}`;
    drawDensityDiffCanvas(diffCanvas, slice, capture);
    diffTitle.textContent = 'Slice Difference';
    diffMeta.textContent = diffText || 'Run Diff Slice to quantify current vs captured SDF deltas';
  }
}

function regionFileName(savedAt: number): string {
  const stamp = new Date(savedAt).toISOString().replace(/[:.]/g, '-');
  return `storm-canyon-region-${stamp}.scvr`;
}

function regionBundleFileName(savedAt: number): string {
  const stamp = new Date(savedAt).toISOString().replace(/[:.]/g, '-');
  return `storm-canyon-regions-${stamp}.scvb`;
}

function regionMaintenanceReportFileName(savedAt: number): string {
  return `storm-canyon-region-maintenance-${new Date(savedAt).toISOString().replace(/[:.]/g, '-')}.json`;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function canvasPngDataUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Canvas screenshot capture returned no image data.'));
          return;
        }
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error('Failed to encode canvas screenshot.'));
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(blob);
      }, 'image/png');
    } catch (error) {
      reject(error);
    }
  });
}

function diagnosticFileName(capturedAt: number): string {
  return `storm-canyon-diagnostic-${new Date(capturedAt).toISOString().replace(/[:.]/g, '-')}.json`;
}

function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clampInt(Math.ceil(sorted.length * q) - 1, 0, sorted.length - 1);
  return sorted[index];
}

function serializeAutoQualityState(state: AutoQualityState): Omit<AutoQualityState, 'captures'> & { captureCount: number; levelName: string } {
  return {
    enabled: state.enabled,
    level: state.level,
    levelName: autoQualityLevelName(state.level),
    pressure: state.pressure,
    reason: state.reason,
    startedAt: state.startedAt,
    lastAdjustmentAt: state.lastAdjustmentAt,
    adjustments: state.adjustments,
    slowFrames: state.slowFrames,
    fastFrames: state.fastFrames,
    captureCount: state.captures.length,
  };
}

function createQualityRuntimeCapture(
  label: string,
  settings: EngineSettings,
  camera: FlyCamera,
  autoQuality: AutoQualityState,
  profiler: RuntimeProfiler,
  renderer: Renderer,
  streamer: ChunkStreamer,
  browserWorkerBenchmarkCaptures: BrowserWorkerBenchmarkCapture[] = [],
): QualityRuntimeCapture {
  const profile = profiler.last;
  const rstats = renderer.stats;
  return {
    capturedAt: Date.now(),
    label,
    settings: { ...settings },
    autoQuality: serializeAutoQualityState(autoQuality),
    browserWorkerBenchmark: browserWorkerBenchmarkCaptures[0] ?? null,
    worldgen: worldgenSnapshot(camera, settings),
    frame: {
      samples: profiler.frameMsSamples.length,
      lastMs: profile.frameMs,
      avgMs: profile.avgFrameMs,
      p95Ms: percentile(profiler.frameMsSamples, 0.95),
      targetMs: AUTO_QUALITY_TARGET_FRAME_MS,
    },
    renderer: {
      ...profile,
      drawCalls: rstats.drawCalls,
      terrainTriangles: rstats.terrainTriangles,
      visibleTerrainChunks: rstats.visibleTerrainChunks,
      culledTerrainChunks: rstats.culledTerrainChunks,
      visibleTerrainClusters: rstats.terrainClusters,
      culledTerrainClusters: rstats.culledTerrainClusters,
      terrainClusterDrawCalls: rstats.terrainClusterDrawCalls,
      terrainClusterDrawsSkipped: rstats.terrainClusterDrawsSkipped,
      hiZOcclusionTestedClusters: rstats.hiZOcclusionTestedClusters,
      hiZOcclusionCulledClusters: rstats.hiZOcclusionCulledClusters,
      hiZOcclusionTestedBatches: rstats.hiZOcclusionTestedBatches,
      hiZOcclusionCulledBatches: rstats.hiZOcclusionCulledBatches,
      vegetationLodCulledInstances: rstats.vegetationLodCulledInstances,
      vegetationDrawCalls: rstats.vegetationDrawCalls,
      visibleVegetationPatches: rstats.visibleVegetationPatches,
      culledVegetationPatches: rstats.culledVegetationPatches,
    },
    streamer: {
      ...streamer.lastStats,
      ...streamer.counts(),
    },
    capabilities: { ...renderer.capabilities },
  };
}

interface AutomationConfig {
  enabled: boolean;
  label: string;
  actions: string[];
  targets: Set<'console' | 'backend' | 'window'>;
  waitFrames: number;
  intervalFrames: number;
  maxRuns: number;
  includeScreenshot: boolean;
  endpoint: string;
}

interface AutomationEnvelope {
  type: 'storm-canyon-automation-report';
  version: 1;
  id: string;
  label: string;
  action: string;
  sequence: number;
  frame: number;
  capturedAt: number;
  location: string;
  payload: unknown;
}

function automationListParam(params: URLSearchParams, ...names: string[]): string[] {
  const values: string[] = [];
  for (const name of names) {
    for (const value of params.getAll(name)) {
      values.push(...value.split(/[;,]/g).map(item => item.trim()).filter(Boolean));
    }
  }
  return values;
}

function readAutomationConfig(): AutomationConfig {
  const params = new URLSearchParams(window.location.search);
  const explicit = parseBooleanLike(params.get('automation') ?? params.get('auto'));
  const actions = automationListParam(params, 'automation.actions', 'automationActions', 'auto.actions', 'autoActions', 'auto.action', 'autoAction');
  const autoValue = params.get('auto');
  if (autoValue && explicit === null) {
    actions.push(...autoValue.split(/[;,]/g).map(item => item.trim()).filter(item => item && !['1', 'true', 'yes', 'on'].includes(item.toLowerCase())));
  }
  const targets = new Set<'console' | 'backend' | 'window'>();
  const targetValues = automationListParam(params, 'automation.target', 'automationTarget', 'auto.target', 'autoTarget', 'reportTarget');
  for (const target of targetValues) {
    const normalized = target.toLowerCase();
    if (normalized === 'console') targets.add('console');
    if (normalized === 'backend' || normalized === 'server') targets.add('backend');
    if (normalized === 'window' || normalized === 'global') targets.add('window');
  }
  if (targets.size === 0) targets.add('console');
  const backendOverride = parseBooleanLike(params.get('automation.backend') ?? params.get('autoBackend'));
  const windowOverride = parseBooleanLike(params.get('automation.window') ?? params.get('autoWindow'));
  if (backendOverride === true) targets.add('backend');
  if (parseBooleanLike(params.get('automation.console') ?? params.get('autoConsole')) === false) targets.delete('console');
  if (windowOverride === true) targets.add('window');
  const intervalFrames = clampInt(
    parseNumberLike(params.get('automation.everyFrames') ?? params.get('autoEveryFrames') ?? params.get('autoEvery')) ?? 0,
    0,
    36000,
  );
  const maxRunsOverride = parseNumberLike(params.get('automation.runs') ?? params.get('autoRuns') ?? params.get('autoReports'));
  return {
    enabled: explicit === false ? false : explicit === true || actions.length > 0 || targetValues.length > 0 || backendOverride === true || windowOverride === true,
    label: params.get('automation.label') ?? params.get('autoLabel') ?? 'url-automation',
    actions: actions.length > 0 ? actions : ['state'],
    targets,
    waitFrames: clampInt(parseNumberLike(params.get('automation.waitFrames') ?? params.get('autoWaitFrames') ?? params.get('autoWait')) ?? 90, 0, 36000),
    intervalFrames,
    maxRuns: clampInt(maxRunsOverride ?? (intervalFrames > 0 ? 1000000 : 1), 1, 1000000),
    includeScreenshot: parseBooleanLike(params.get('automation.screenshot') ?? params.get('autoScreenshot')) === true,
    endpoint: params.get('automation.endpoint') ?? params.get('autoEndpoint') ?? '/__storm/automation-report',
  };
}

async function main() {
  const canvas = document.querySelector<HTMLCanvasElement>('#gfx');
  const overlay = document.querySelector<HTMLElement>('#overlay');
  const densityPanel = document.querySelector<HTMLElement>('#density-panel');
  const regionBrowser = document.querySelector<HTMLElement>('#region-browser');
  const settingsRoot = document.querySelector<HTMLElement>('#settings-panel');
  if (!canvas || !overlay || !densityPanel || !regionBrowser || !settingsRoot) throw new Error('Required app root elements were not found.');
  let settings = loadEngineSettings();
  const camera = new FlyCamera();
  const renderer = new Renderer(canvas);
  await renderer.init();
  const streamer = new ChunkStreamer(renderer, overlay);
  await streamer.init();
  worldgenTileCache.setPersistenceProvider(new WorldgenTileIndexedDbStore());
  erosionTileCache.setPersistenceProvider(new ErosionTileIndexedDbStore());
  materialTileCache.setPersistenceProvider(new MaterialTileIndexedDbStore());
  caveGraphTileCache.setPersistenceProvider(new CaveGraphTileIndexedDbStore());
  worldgenTileCache.setWorkerProvider((tileX, tileZ) => streamer.requestWorldgenTile(tileX, tileZ));
  erosionTileCache.setWorkerProvider((tileX, tileZ) => streamer.requestErosionTile(tileX, tileZ));
  materialTileCache.setWorkerProvider((tileX, tileZ) => streamer.requestMaterialTile(tileX, tileZ));
  caveGraphTileCache.setWorkerProvider((tileX, tileZ) => streamer.requestCaveGraphTile(tileX, tileZ));
  const regionStore = new RegionStore();
  if (settings.qualityPreset === QUALITY_PRESET_AUTO) {
    settings = sanitizeEngineSettings(applyQualityPreset(settings, renderer.capabilities));
    settings = applyUrlSettingOverrides(settings);
  }
  applyEngineSettings(settings, camera, renderer, streamer);
  applyUrlCameraOverrides(camera);
  const game = new StormCanyonGame();
  const emptyGameMarkers = new Float32Array(0);
  const initialMarkers = settings.gameMarkersEnabled ? game.consumeMarkerInstances(true) : null;
  if (initialMarkers) renderer.setGameMarkers(initialMarkers);
  const profiler = new RuntimeProfiler();
  let autoQualityState: AutoQualityState = {
    enabled: settings.qualityPreset === QUALITY_PRESET_AUTO,
    level: autoQualityLevelFromPreset(recommendedQualityPreset(renderer.capabilities)),
    pressure: settings.qualityPreset === QUALITY_PRESET_AUTO ? 'warming' : 'manual',
    reason: settings.qualityPreset === QUALITY_PRESET_AUTO ? 'Auto quality warmup' : 'Manual quality preset',
    startedAt: performance.now(),
    lastAdjustmentAt: 0,
    adjustments: 0,
    slowFrames: 0,
    fastFrames: 0,
    captures: [],
  };
  let densityCaptureLibrary = loadDensityCaptureLibrary();
  let densitySliceDiff: DensitySliceDiffSummary | null = null;
  let regionSlotNames = loadRegionSlotNames();
  let regionBrowserState: RegionBrowserState = loadRegionBrowserState();
  let regionMaintenanceHistory: RegionMaintenanceEvent[] = loadRegionMaintenanceHistory();
  let regionPayloadInspection: RegionPayloadInspection | null = null;
  let regionPayloadComparison: RegionPayloadComparison | null = null;
  let regionPayloadHashAudit: RegionPayloadHashAudit | null = null;
  let brushPresets = loadBrushPresets();
  let browserWorkerBenchmarkCaptures = loadBrowserWorkerBenchmarkCaptures();
  let browserWorkerBenchmarkRunning = false;
  let pendingRegionImport: RegionImportPreview | null = null;
  let regionSlotInfos: RegionSlotInfo[] = [];
  let settingsPanel: SettingsPanel | null = null;
  const automation = readAutomationConfig();
  let automationFrame = 0;
  let automationRuns = 0;
  let automationRunning = false;
  let handleRegionBrowserAction = (action: RegionBrowserAction, index: number): void => {
    void action;
    settingsPanel?.setValue('regionSlot', index);
  };

  const updateEditHistoryPanel = (): void => {
    settingsPanel?.setEditHistory({
      editCount: streamer.editLog.length,
      redoCount: streamer.undoneEdits.length,
      branchCount: streamer.editBranches.length,
      maxEdits: MAX_EDIT_OPERATIONS,
      items: editHistoryPanelItems(streamer, 10),
    });
  };
  const updateBrushPresetPanel = (): void => {
    settingsPanel?.setBrushPresets(createBrushPresetPanelState(brushPresets, settings));
  };

  const updateRegionBrowser = (): void => {
    settingsPanel?.setSelectOptions('regionSlot', REGION_SLOTS.map((_, index) => ({
      label: regionSlotOptionLabel(index, regionSlotNames, regionSlotInfos),
      value: index,
    })));
    renderRegionBrowser(
      regionBrowser,
      settings,
      regionSlotNames,
      regionSlotInfos,
      regionBrowserState,
      regionMaintenanceHistory,
      regionPayloadInspection,
      regionPayloadComparison,
      regionPayloadHashAudit,
      (state) => {
        regionBrowserState = normalizeRegionBrowserState(state);
        saveRegionBrowserState(regionBrowserState);
      },
      (index) => settingsPanel?.setValue('regionSlot', index),
      (action, index) => handleRegionBrowserAction(action, index),
    );
    if (!settings.regionBrowserPanelVisible) regionBrowser.hidden = true;
  };

  const refreshRegionSlots = async () => {
    regionSlotInfos = await regionStore.list();
    let namesChanged = false;
    for (const info of regionSlotInfos) {
      const index = REGION_SLOTS.findIndex(slot => slot.key === info.key);
      if (index >= 0 && info.name && regionSlotNames[index] !== info.name) {
        regionSlotNames[index] = sanitizeRegionSlotName(info.name, index);
        namesChanged = true;
      }
    }
    if (namesChanged) saveRegionSlotNames(regionSlotNames);
    const savedKeys = new Set(regionSlotInfos.map(info => info.key));
    if (regionPayloadInspection && !savedKeys.has(regionPayloadInspection.key)) {
      regionPayloadInspection = null;
      regionPayloadComparison = null;
      regionPayloadHashAudit = null;
    }
    if (regionPayloadComparison && (!savedKeys.has(regionPayloadComparison.baseline.key) || !savedKeys.has(regionPayloadComparison.compared.key))) regionPayloadComparison = null;
    if (regionPayloadHashAudit && !savedKeys.has(regionPayloadHashAudit.key)) regionPayloadHashAudit = null;
    updateRegionBrowser();
  };
  const recordRegionMaintenance = (action: string, summary: string): void => {
    regionMaintenanceHistory = addRegionMaintenanceEvent(regionMaintenanceHistory, action, summary);
    saveRegionMaintenanceHistory(regionMaintenanceHistory);
  };
  void refreshRegionSlots().catch(error => console.warn('Could not refresh region slot metadata.', error));
  const currentRegionSlot = () => regionSlotFromSettings(settings, regionSlotNames);
  const clearPendingRegionImport = (releasePayloads = true) => {
    if (releasePayloads && pendingRegionImport) releaseRegionSnapshotPayloads(pendingRegionImport.snapshot);
    pendingRegionImport = null;
  };
  const activeRegionSnapshot = (): Omit<RegionSnapshot, 'savedAt'> => ({
    ...streamer.persistenceSnapshot(),
    gameProgress: game.progress(),
  });
  const invalidateRegionPayloadStateForKeys = (...keys: string[]): void => {
    const changedKeys = new Set(keys);
    if (regionPayloadInspection && changedKeys.has(regionPayloadInspection.key)) {
      regionPayloadInspection = null;
      regionPayloadComparison = null;
      regionPayloadHashAudit = null;
      return;
    }
    if (
      regionPayloadComparison
      && (changedKeys.has(regionPayloadComparison.baseline.key) || changedKeys.has(regionPayloadComparison.compared.key))
    ) {
      regionPayloadComparison = null;
    }
    if (regionPayloadHashAudit && changedKeys.has(regionPayloadHashAudit.key)) regionPayloadHashAudit = null;
  };
  const refreshGameMarkers = (force = false): void => {
    if (!settings.gameMarkersEnabled) {
      renderer.setGameMarkers(emptyGameMarkers);
      return;
    }
    const markers = game.consumeMarkerInstances(force);
    if (markers) renderer.setGameMarkers(markers);
  };
  const loadRegionSnapshotWithGame = (snapshot: RegionSnapshot): void => {
    streamer.loadRegionSnapshot(snapshot);
    if (snapshot.gameProgress) game.restoreProgress(snapshot.gameProgress);
    refreshGameMarkers();
  };

  const setSettings = (nextSettings: Partial<EngineSettings>, changedKey: keyof EngineSettings | 'all' = 'all'): void => {
    settings = sanitizeEngineSettings(nextSettings);
    if (changedKey === 'qualityPreset') {
      settings = sanitizeEngineSettings(applyQualityPreset(settings, renderer.capabilities));
      autoQualityState = {
        ...autoQualityState,
        enabled: settings.qualityPreset === QUALITY_PRESET_AUTO,
        level: autoQualityLevelFromPreset(settings.qualityPreset === QUALITY_PRESET_AUTO ? recommendedQualityPreset(renderer.capabilities) : settings.qualityPreset),
        pressure: settings.qualityPreset === QUALITY_PRESET_AUTO ? 'warming' : 'manual',
        reason: settings.qualityPreset === QUALITY_PRESET_AUTO ? 'Auto quality warmup' : 'Manual quality preset',
        startedAt: performance.now(),
        slowFrames: 0,
        fastFrames: 0,
      };
      settingsPanel?.setSettings(settings);
    }
    applyEngineSettings(settings, camera, renderer, streamer);
    saveEngineSettings(settings);
    if (changedKey === 'gameMarkersEnabled' || changedKey === 'all') refreshGameMarkers(true);
    if (changedKey === 'all') settingsPanel?.setSettings(settings);
    if (changedKey === 'regionSlot' || changedKey === 'regionBrowserPanelVisible' || changedKey === 'all') updateRegionBrowser();
    applyPanelVisibility(settings, overlay, settingsRoot, densityPanel, regionBrowser);
    updateBrushPresetPanel();
  };
  const currentBrushOptions = (): BrushOptions => ({
    radius: settings.editRadius,
    distance: settings.brushDistance,
    type: brushTypeFromMode(settings.brushMode),
    shape: brushShapeFromMode(settings.brushShape),
    direction: camera.forward(),
    length: settings.brushLength,
    falloff: settings.brushFalloff,
    material: settings.paintMaterial,
    strength: settings.brushStrength,
  });
  const recordQualityCapture = (label: string): QualityRuntimeCapture => {
    const capture = createQualityRuntimeCapture(label, settings, camera, autoQualityState, profiler, renderer, streamer, browserWorkerBenchmarkCaptures);
    autoQualityState.captures = [capture, ...autoQualityState.captures].slice(0, MAX_QUALITY_CAPTURES);
    return capture;
  };
  const updateAutoQuality = (profile: RuntimeProfile, now: number): void => {
    if (settings.qualityPreset !== QUALITY_PRESET_AUTO) {
      autoQualityState.enabled = false;
      autoQualityState.pressure = 'manual';
      autoQualityState.reason = 'Manual quality preset';
      autoQualityState.slowFrames = 0;
      autoQualityState.fastFrames = 0;
      return;
    }

    autoQualityState.enabled = true;
    if (now - autoQualityState.startedAt < AUTO_QUALITY_WARMUP_MS || profiler.frameMsSamples.length < 60) {
      autoQualityState.pressure = 'warming';
      autoQualityState.reason = 'Collecting frame-time samples';
      return;
    }

    const counts = streamer.counts();
    const settled = counts.pending === 0 && counts.queued === 0;
    const slow = profile.avgFrameMs > AUTO_QUALITY_SLOW_FRAME_MS || percentile(profiler.frameMsSamples, 0.95) > AUTO_QUALITY_SLOW_FRAME_MS * 1.35;
    const fast = settled && profile.avgFrameMs < AUTO_QUALITY_FAST_FRAME_MS && profile.estimatedGpuMB < 768;
    autoQualityState.slowFrames = slow ? autoQualityState.slowFrames + 1 : Math.max(0, autoQualityState.slowFrames - 2);
    autoQualityState.fastFrames = fast ? autoQualityState.fastFrames + 1 : Math.max(0, autoQualityState.fastFrames - 4);

    const cooledDown = now - autoQualityState.lastAdjustmentAt >= AUTO_QUALITY_COOLDOWN_MS;
    if (slow && autoQualityState.slowFrames >= AUTO_QUALITY_SLOW_FRAMES && cooledDown && autoQualityState.level > 0) {
      autoQualityState.level--;
      autoQualityState.lastAdjustmentAt = now;
      autoQualityState.adjustments++;
      autoQualityState.slowFrames = 0;
      autoQualityState.fastFrames = 0;
      autoQualityState.pressure = 'constrained';
      autoQualityState.reason = `Reduced to ${autoQualityLevelName(autoQualityState.level)} after ${profile.avgFrameMs.toFixed(1)} ms avg frames`;
      setSettings(autoQualitySettingsForLevel(settings, autoQualityState.level), 'all');
      recordQualityCapture('auto-quality-downshift');
      return;
    }

    if (fast && autoQualityState.fastFrames >= AUTO_QUALITY_FAST_FRAMES && cooledDown && autoQualityState.level < 3) {
      autoQualityState.level++;
      autoQualityState.lastAdjustmentAt = now;
      autoQualityState.adjustments++;
      autoQualityState.slowFrames = 0;
      autoQualityState.fastFrames = 0;
      autoQualityState.pressure = 'headroom';
      autoQualityState.reason = `Raised to ${autoQualityLevelName(autoQualityState.level)} after ${profile.avgFrameMs.toFixed(1)} ms avg frames`;
      setSettings(autoQualitySettingsForLevel(settings, autoQualityState.level), 'all');
      recordQualityCapture('auto-quality-upshift');
      return;
    }

    autoQualityState.pressure = slow ? 'constrained' : fast ? 'headroom' : 'steady';
    autoQualityState.reason = `${autoQualityLevelName(autoQualityState.level)} tier, ${profile.avgFrameMs.toFixed(1)} ms avg / ${percentile(profiler.frameMsSamples, 0.95).toFixed(1)} ms p95`;
  };
  const carveAtCrosshair = () => {
    const brush = currentBrushOptions();
    const target = add(camera.position, scale(camera.forward(), brush.distance));
    streamer.applyBrush(target, brush);
  };
  const pickPaintMaterialAtCrosshair = (): void => {
    const target = add(camera.position, scale(camera.forward(), settings.brushDistance));
    const height = terrainHeight(target[0], target[2]);
    const normal = terrainNormal(target[0], target[2]);
    const material = clampInt(terrainMaterial(target[0], height, target[2], normal[1]), PAINT_MATERIAL_GRASS, PAINT_MATERIAL_MUD);
    setSettings({ ...settings, brushMode: BRUSH_MODE_PAINT, paintMaterial: material }, 'all');
  };
  const applyPaintMaterialSwatch = (material: number): void => {
    setSettings({
      ...settings,
      brushMode: BRUSH_MODE_PAINT,
      paintMaterial: clampInt(material, PAINT_MATERIAL_GRASS, PAINT_MATERIAL_MUD),
    }, 'all');
  };
  const saveCurrentBrushPreset = (): void => {
    const presetSettings = brushPresetSettingsFrom(settings);
    const fallbackName = brushPresetLabel(presetSettings);
    const nextName = window.prompt('Brush preset name', fallbackName);
    if (nextName === null) return;
    const name = sanitizeBrushPresetName(nextName, fallbackName);
    if (!name) return;
    const existingIndex = brushPresets.findIndex(preset => preset.name.toLowerCase() === name.toLowerCase());
    const now = Date.now();
    const preset: BrushPreset = {
      id: existingIndex >= 0 ? brushPresets[existingIndex].id : newBrushPresetId(),
      name,
      settings: presetSettings,
      createdAt: existingIndex >= 0 ? brushPresets[existingIndex].createdAt : now,
      updatedAt: now,
    };
    brushPresets = existingIndex >= 0
      ? [preset, ...brushPresets.filter((_, index) => index !== existingIndex)]
      : [preset, ...brushPresets].slice(0, MAX_BRUSH_PRESETS);
    saveBrushPresets(brushPresets);
    updateBrushPresetPanel();
  };
  const clearBrushPresets = (): void => {
    if (brushPresets.length === 0) return;
    if (!window.confirm(`Clear ${brushPresets.length} saved brush preset${brushPresets.length === 1 ? '' : 's'}?`)) return;
    brushPresets = [];
    saveBrushPresets(brushPresets);
    updateBrushPresetPanel();
  };
  const applyBrushPreset = (id: string): void => {
    const preset = brushPresets.find(item => item.id === id);
    if (!preset) return;
    setSettings({ ...settings, ...preset.settings }, 'all');
  };
  const deleteBrushPreset = (id: string): void => {
    const preset = brushPresets.find(item => item.id === id);
    if (!preset) return;
    if (!window.confirm(`Delete brush preset "${preset.name}"?`)) return;
    brushPresets = brushPresets.filter(item => item.id !== id);
    saveBrushPresets(brushPresets);
    updateBrushPresetPanel();
  };
  const applyDetailBrushPreset = (): void => {
    setSettings({
      ...settings,
      brushMode: BRUSH_MODE_CARVE,
      brushShape: BRUSH_SHAPE_SPHERE,
      editRadius: 4,
      brushLength: 10,
      brushFalloff: 0.5,
      brushStrength: 0.35,
    }, 'all');
  };
  const applyPathBrushPreset = (): void => {
    setSettings({
      ...settings,
      brushMode: BRUSH_MODE_FLATTEN,
      brushShape: BRUSH_SHAPE_CAPSULE,
      editRadius: 7,
      brushLength: 38,
      brushFalloff: 1.5,
      brushStrength: 0.65,
    }, 'all');
  };
  const applyTerraceBrushPreset = (): void => {
    setSettings({
      ...settings,
      brushMode: BRUSH_MODE_FLATTEN,
      brushShape: BRUSH_SHAPE_CAPSULE,
      editRadius: 5.5,
      brushLength: 22,
      brushFalloff: 1,
      brushStrength: 0.85,
    }, 'all');
  };
  const applyTunnelBrushPreset = (): void => {
    setSettings({
      ...settings,
      brushMode: BRUSH_MODE_CARVE,
      brushShape: BRUSH_SHAPE_CAPSULE,
      editRadius: 4.5,
      brushLength: 30,
      brushFalloff: 1.25,
      brushStrength: 0.55,
    }, 'all');
  };
  const applyHardEdgePreset = (): void => {
    setSettings({ ...settings, brushFalloff: 0 }, 'all');
  };
  const applySoftEdgePreset = (): void => {
    setSettings({ ...settings, brushFalloff: clampNumber(settings.editRadius * 0.25, 0.5, 8, 1) }, 'all');
  };
  const saveRegion = async () => {
    const slot = currentRegionSlot();
    const snapshot = await regionStore.save(activeRegionSnapshot(), slot.key, slot.name);
    invalidateRegionPayloadStateForKeys(slot.key);
    streamer.markRegionSaved(snapshot.chunks.length, snapshot.compression);
    recordRegionMaintenance('Save', `${slot.name}: ${snapshot.chunks.length} chunks, ${formatRegionBrowserBytes(snapshot.compression?.encodedBytes ?? 0)}`);
    await refreshRegionSlots();
  };
  const loadRegion = async () => {
    const slot = currentRegionSlot();
    const snapshot = await regionStore.load(slot.key);
    if (snapshot) {
      loadRegionSnapshotWithGame(snapshot);
      recordRegionMaintenance('Load', `${slot.name}: ${snapshot.chunks.length} chunks`);
    }
    await refreshRegionSlots();
  };
  const diffSavedRegion = async () => {
    const slot = currentRegionSlot();
    const snapshot = await regionStore.load(slot.key);
    try {
      streamer.diffRegionSnapshot(snapshot, slot.name);
    } finally {
      if (snapshot) releaseRegionSnapshotPayloads(snapshot);
    }
    await refreshRegionSlots();
  };
  const clearSavedRegion = async () => {
    const slot = currentRegionSlot();
    await regionStore.clear(slot.key);
    streamer.clearRegionPersistenceStats();
    recordRegionMaintenance('Clear', slot.name);
    await refreshRegionSlots();
  };
  const renameRegion = async () => {
    const slot = currentRegionSlot();
    const nextName = window.prompt('Region slot name', slot.name);
    if (nextName === null) return;
    const name = sanitizeRegionSlotName(nextName, slot.index);
    regionSlotNames = regionSlotNames.map((existing, index) => index === slot.index ? name : existing);
    saveRegionSlotNames(regionSlotNames);
    await regionStore.rename(slot.key, name);
    recordRegionMaintenance('Rename', `${slot.name} -> ${name}`);
    await refreshRegionSlots();
  };
  const duplicateRegion = async () => {
    const source = currentRegionSlot();
    const snapshot = await regionStore.load(source.key);
    if (!snapshot) {
      streamer.showError(`${source.name} has no saved region to duplicate.`);
      return;
    }
    try {
      const fallbackTarget = source.index === 0 ? 2 : 1;
      const answer = window.prompt('Duplicate selected save to slot number 1-4', String(fallbackTarget));
      if (answer === null) return;
      const parsedTarget = Number.parseInt(answer, 10);
      if (!Number.isInteger(parsedTarget) || parsedTarget < 1 || parsedTarget > REGION_SLOTS.length) {
        streamer.showError('Target slot must be a number from 1 to 4.');
        return;
      }
      const targetIndex = parsedTarget - 1;
      if (targetIndex === source.index) {
        streamer.showError('Choose a different target slot for duplication.');
        return;
      }
      const target = regionSlotFromSettings({ ...settings, regionSlot: targetIndex }, regionSlotNames);
      const existing = regionSlotInfoFor(regionSlotInfos, target.key);
      if (existing && !window.confirm(`${target.name} already has a saved region. Overwrite it?`)) return;
      const savedSnapshot = await regionStore.save(snapshot, target.key, target.name);
      invalidateRegionPayloadStateForKeys(target.key);
      streamer.markRegionSaved(savedSnapshot.chunks.length, savedSnapshot.compression);
      recordRegionMaintenance('Duplicate', `${source.name} -> ${target.name}: ${savedSnapshot.chunks.length} chunks`);
      await refreshRegionSlots();
    } finally {
      releaseRegionSnapshotPayloads(snapshot);
    }
  };
  const collectSavedRegionEntries = async () => {
    const entries: Array<{ key: string; name: string; snapshot: RegionSnapshot }> = [];
    for (let index = 0; index < REGION_SLOTS.length; index++) {
      const slot = regionSlotFromSettings({ ...settings, regionSlot: index }, regionSlotNames);
      const snapshot = await regionStore.load(slot.key);
      if (snapshot) entries.push({ key: slot.key, name: slot.name, snapshot });
    }
    return entries;
  };
  const exportRegionBundle = async () => {
    const entries = await collectSavedRegionEntries();
    if (entries.length === 0) {
      streamer.showError('No saved region slots are available to export.');
      return;
    }
    try {
      const encoded = await encodeRegionBundle(entries);
      downloadBlob(encoded.blob, regionBundleFileName(Date.now()));
      streamer.markRegionExported(entries.reduce((total, entry) => total + entry.snapshot.chunks.length, 0), encoded.compression);
      recordRegionMaintenance('Export Bundle', `${entries.length} slots, ${formatRegionBrowserBytes(encoded.compression.encodedBytes)}`);
    } finally {
      for (const entry of entries) releaseRegionSnapshotPayloads(entry.snapshot);
    }
  };
  const pruneOldestRegion = async () => {
    const infos = managedRegionSlotInfos(await regionStore.list());
    if (infos.length === 0) {
      streamer.showError('No saved managed region slots are available to prune.');
      await refreshRegionSlots();
      return;
    }
    const current = currentRegionSlot();
    const candidates = infos.filter(info => info.key !== current.key);
    const target = (candidates.length > 0 ? candidates : infos).sort((a, b) => a.savedAt - b.savedAt)[0];
    const targetIndex = regionSlotIndexByKey(target.key);
    const targetName = targetIndex >= 0 ? sanitizeRegionSlotName(regionSlotNames[targetIndex] ?? target.name, targetIndex) : target.name;
    const encoded = formatRegionBrowserBytes(target.compressionEncodedBytes);
    if (!window.confirm(`Prune oldest saved region ${targetName} (${target.chunkCount} chunks, ${encoded})?`)) return;
    await regionStore.clear(target.key);
    if (target.key === current.key) streamer.clearRegionPersistenceStats();
    recordRegionMaintenance('Prune', `${targetName}: ${target.chunkCount} chunks, ${encoded}`);
    await refreshRegionSlots();
  };
  const applyRegionRetention = async () => {
    const policy = normalizeRegionBrowserState(regionBrowserState);
    const current = currentRegionSlot();
    const infos = await regionStore.list();
    const plan = buildRegionRetentionPlan(infos, policy, current.key);
    if (plan.pruned.length === 0) {
      window.alert(formatRegionRetentionPlan(plan, regionSlotNames, true));
      await refreshRegionSlots();
      return;
    }
    const names = formatRetentionSlotNames(plan.pruned, regionSlotNames);
    if (!window.confirm(`Apply ${plan.policyLabel} retention (${policy.retentionMaxSlots} slots / ${policy.retentionMaxMB} MB) and prune ${names}?`)) return;
    for (const info of plan.pruned) await regionStore.clear(info.key);
    if (plan.pruned.some(info => info.key === current.key)) streamer.clearRegionPersistenceStats();
    recordRegionMaintenance('Apply Retention', formatRegionRetentionPlan(plan, regionSlotNames));
    await refreshRegionSlots();
  };
  const dryRunRegionRetention = async () => {
    const plan = buildRegionRetentionPlan(await regionStore.list(), regionBrowserState, currentRegionSlot().key);
    const report = formatRegionRetentionPlan(plan, regionSlotNames, true);
    window.alert(report);
    recordRegionMaintenance('Preview Retention', report.replace(/\s+/g, ' '));
    await refreshRegionSlots();
  };
  const exportRegionMaintenanceReport = async () => {
    const generatedAt = Date.now();
    const infos = await regionStore.list();
    const policy = normalizeRegionBrowserState(regionBrowserState);
    const activeSlot = currentRegionSlot();
    const plan = buildRegionRetentionPlan(infos, policy, activeSlot.key);
    const body = {
      app: 'storm-canyon-voxel',
      type: 'region-maintenance-report',
      version: 1,
      generatedAt,
      activeSlot,
      retentionPolicy: {
        id: policy.retentionPolicyId,
        label: regionRetentionPolicyLabel(policy),
        maxSlots: policy.retentionMaxSlots,
        maxMB: policy.retentionMaxMB,
      },
      retentionPlan: serializeRetentionPlan(plan, regionSlotNames),
      payloadInspection: serializeRegionPayloadInspection(regionPayloadInspection),
      payloadComparison: serializeRegionPayloadComparison(regionPayloadComparison),
      payloadHashAudit: serializeRegionPayloadHashAudit(regionPayloadHashAudit),
      slots: managedRegionSlotInfos(infos).map(info => {
        const index = regionSlotIndexByKey(info.key);
        return {
          key: info.key,
          name: index >= 0 ? sanitizeRegionSlotName(regionSlotNames[index] ?? info.name, index) : info.name,
          savedAt: info.savedAt,
          chunkCount: info.chunkCount,
          editCount: info.editCount,
          compressionRatio: info.compressionRatio,
          rawBytes: info.compressionRawBytes,
          encodedBytes: regionInfoEncodedBytes(info),
          payloads: info.compressionPayloads,
          rawPayloads: info.compressionRawPayloads,
          lzssPayloads: info.compressionLzssPayloads,
          deltaVarintPayloads: info.compressionDeltaPayloads,
        };
      }),
      maintenanceHistory: regionMaintenanceHistory,
    };
    downloadBlob(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }), regionMaintenanceReportFileName(generatedAt));
    recordRegionMaintenance('Export Report', `${body.slots.length} slots, ${regionMaintenanceHistory.length} history events`);
    await refreshRegionSlots();
  };
  const captureDensitySlice = () => {
    const slice = streamer.densitySliceForCamera(camera, settings);
    if (!slice) {
      streamer.showError('No cached density slice is available near the camera.');
      return;
    }
    densityCaptureLibrary = addDensityCapture(densityCaptureLibrary, slice);
    densitySliceDiff = null;
  };
  const diffDensitySlice = () => {
    const slice = streamer.densitySliceForCamera(camera, settings);
    densitySliceDiff = compareDensitySlices(slice, selectedDensityCapture(densityCaptureLibrary));
  };
  const newDensitySet = () => {
    const nextName = window.prompt('Density set name', `Set ${densityCaptureLibrary.sets.length + 1}`);
    if (nextName === null) return;
    densityCaptureLibrary = addDensityCaptureSet(densityCaptureLibrary, nextName);
    densitySliceDiff = null;
  };
  const renameDensitySet = () => {
    const set = selectedDensitySet(densityCaptureLibrary);
    const nextName = window.prompt('Density set name', set.name);
    if (nextName === null) return;
    densityCaptureLibrary = renameDensityCaptureSet(densityCaptureLibrary, nextName);
    densitySliceDiff = null;
  };
  const exportDensityCaptures = () => {
    if (densityCaptureCount(densityCaptureLibrary) === 0) {
      streamer.showError('No density slice captures are available to export.');
      return;
    }
    const savedAt = Date.now();
    const body = {
      app: 'storm-canyon-voxel',
      type: 'density-slice-captures',
      version: 2,
      savedAt,
      ...serializeDensityLibrary(densityCaptureLibrary),
    };
    const blob = new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' });
    const stamp = new Date(savedAt).toISOString().replace(/[:.]/g, '-');
    downloadBlob(blob, `storm-canyon-density-slices-${stamp}.json`);
  };
  const exportRegion = () => {
    const slot = currentRegionSlot();
    const snapshot = { ...activeRegionSnapshot(), savedAt: Date.now() };
    const { blob, compression } = encodeRegionSnapshotWithStats(snapshot);
    downloadBlob(blob, regionFileName(snapshot.savedAt));
    streamer.markRegionExported(snapshot.chunks.length, compression);
    recordRegionMaintenance('Export', `${slot.name}: ${snapshot.chunks.length} chunks, ${formatRegionBrowserBytes(compression.encodedBytes)}`);
  };
  const exportSavedRegionSlot = async (index: number) => {
    const slot = regionSlotFromSettings({ ...settings, regionSlot: index }, regionSlotNames);
    const snapshot = await regionStore.load(slot.key);
    if (!snapshot) {
      streamer.showError(`${slot.name} has no saved region to export.`);
      return;
    }
    try {
      const { blob, compression } = encodeRegionSnapshotWithStats(snapshot);
      downloadBlob(blob, regionFileName(snapshot.savedAt));
      streamer.markRegionExported(snapshot.chunks.length, compression);
      recordRegionMaintenance('Export', `${slot.name}: ${snapshot.chunks.length} chunks, ${formatRegionBrowserBytes(compression.encodedBytes)}`);
    } finally {
      releaseRegionSnapshotPayloads(snapshot);
    }
  };
  const diffSavedRegionSlot = async (index: number) => {
    const slot = regionSlotFromSettings({ ...settings, regionSlot: index }, regionSlotNames);
    const snapshot = await regionStore.load(slot.key);
    try {
      streamer.diffRegionSnapshot(snapshot, slot.name);
    } finally {
      if (snapshot) releaseRegionSnapshotPayloads(snapshot);
    }
    await refreshRegionSlots();
  };
  const inspectSavedRegionSlot = async (index: number) => {
    const slot = regionSlotFromSettings({ ...settings, regionSlot: index }, regionSlotNames);
    const inspection = await regionStore.inspect(slot.key);
    if (!inspection) {
      streamer.showError(`${slot.name} has no saved payloads to inspect.`);
      return;
    }
    regionPayloadInspection = { ...inspection, name: slot.name };
    regionPayloadComparison = null;
    regionPayloadHashAudit = null;
    recordRegionMaintenance('Inspect', formatRegionPayloadInspection(regionPayloadInspection));
    await refreshRegionSlots();
  };
  const compareSavedRegionPayloadSlot = async (index: number) => {
    if (!regionPayloadInspection) {
      streamer.showError('Inspect a saved region first to choose a payload comparison baseline.');
      return;
    }
    const slot = regionSlotFromSettings({ ...settings, regionSlot: index }, regionSlotNames);
    if (slot.key === regionPayloadInspection.key) {
      streamer.showError('Choose a different saved slot to compare against the inspected payload baseline.');
      return;
    }
    const inspection = await regionStore.inspect(slot.key);
    if (!inspection) {
      streamer.showError(`${slot.name} has no saved payloads to compare.`);
      return;
    }
    regionPayloadComparison = compareRegionPayloadInspections(regionPayloadInspection, { ...inspection, name: slot.name });
    recordRegionMaintenance('Compare Payload', formatRegionPayloadComparison(regionPayloadComparison));
    await refreshRegionSlots();
  };
  const verifySavedRegionPayloadSlot = async (index: number) => {
    if (!regionPayloadInspection) {
      streamer.showError('Inspect a saved region first to choose a payload verification target.');
      return;
    }
    const slot = regionSlotFromSettings({ ...settings, regionSlot: index }, regionSlotNames);
    if (slot.key !== regionPayloadInspection.key) {
      streamer.showError('Verify the currently inspected saved payload baseline.');
      return;
    }
    const audit = await regionStore.verifyPayloadHashes(slot.key);
    if (!audit) {
      streamer.showError(`${slot.name} has no saved payloads to verify.`);
      return;
    }
    regionPayloadHashAudit = { ...audit, name: slot.name };
    recordRegionMaintenance('Verify Payload', formatRegionPayloadHashAudit(regionPayloadHashAudit));
    await refreshRegionSlots();
  };
  const loadRegionSlot = async (index: number) => {
    settingsPanel?.setValue('regionSlot', index);
    await loadRegion();
  };
  const clearSavedRegionSlot = async (index: number) => {
    const slot = regionSlotFromSettings({ ...settings, regionSlot: index }, regionSlotNames);
    if (!window.confirm(`Clear saved region ${slot.name}?`)) return;
    await regionStore.clear(slot.key);
    if (settings.regionSlot === index) streamer.clearRegionPersistenceStats();
    recordRegionMaintenance('Clear', slot.name);
    await refreshRegionSlots();
  };
  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = '.scvr,application/vnd.storm-canyon.region,application/octet-stream';
  importInput.hidden = true;
  document.body.append(importInput);

  const importRegionFile = async (file: File) => {
    clearPendingRegionImport();
    const snapshot = await decodeRegionSnapshot(file);
    loadRegionSnapshotWithGame(snapshot);
    streamer.markRegionImported(snapshot.chunks.length, snapshot.compression);
    try {
      const slot = currentRegionSlot();
      const savedSnapshot = await regionStore.save(activeRegionSnapshot(), slot.key, slot.name);
      invalidateRegionPayloadStateForKeys(slot.key);
      streamer.markRegionSaved(savedSnapshot.chunks.length, savedSnapshot.compression);
      recordRegionMaintenance('Import', `${slot.name}: ${savedSnapshot.chunks.length} chunks`);
      await refreshRegionSlots();
    } catch (error) {
      console.warn('Imported region loaded but could not be written to IndexedDB.', error);
    }
  };
  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;
    void importRegionFile(file).catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
  });
  const importRegion = () => importInput.click();

  const importBundleInput = document.createElement('input');
  importBundleInput.type = 'file';
  importBundleInput.accept = `.scvb,${REGION_BUNDLE_MIME_TYPE},application/octet-stream`;
  importBundleInput.hidden = true;
  document.body.append(importBundleInput);

  const importRegionBundleFile = async (file: File) => {
    const entries = await decodeRegionBundle(file);
    const managedKeys = new Set<string>(REGION_SLOTS.map(slot => slot.key));
    const compression = createPayloadCompressionStats();
    let importedSlots = 0;
    let importedChunks = 0;
    for (const entry of entries) {
      try {
        if (!managedKeys.has(entry.key)) continue;
        const index = REGION_SLOTS.findIndex(slot => slot.key === entry.key);
        const name = sanitizeRegionSlotName(entry.name, index);
        regionSlotNames = regionSlotNames.map((existing, slotIndex) => slotIndex === index ? name : existing);
        const savedSnapshot = await regionStore.save(entry.snapshot, entry.key, name);
        invalidateRegionPayloadStateForKeys(entry.key);
        importedSlots++;
        importedChunks += savedSnapshot.chunks.length;
        addCompressionSummary(compression, savedSnapshot.compression);
      } finally {
        releaseRegionSnapshotPayloads(entry.snapshot);
      }
    }
    if (importedSlots === 0) throw new Error('No managed region slots were found in the selected bundle.');
    saveRegionSlotNames(regionSlotNames);
    streamer.markRegionImported(importedChunks, compression);
    recordRegionMaintenance('Import Bundle', `${importedSlots} slots, ${importedChunks} chunks`);
    await refreshRegionSlots();
  };
  importBundleInput.addEventListener('change', () => {
    const file = importBundleInput.files?.[0];
    importBundleInput.value = '';
    if (!file) return;
    void importRegionBundleFile(file).catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
  });
  const importRegionBundle = () => importBundleInput.click();

  const regionPreviewInput = document.createElement('input');
  regionPreviewInput.type = 'file';
  regionPreviewInput.accept = '.scvr,application/vnd.storm-canyon.region,application/octet-stream';
  regionPreviewInput.hidden = true;
  document.body.append(regionPreviewInput);

  const previewRegionImportFile = async (file: File) => {
    const snapshot = await decodeRegionSnapshot(file);
    clearPendingRegionImport();
    const diff = createRegionDiff(activeRegionSnapshot(), snapshot, file.name);
    pendingRegionImport = {
      fileName: file.name,
      fileSize: file.size,
      decodedAt: Date.now(),
      snapshot,
      diff,
    };
    streamer.markRegionImported(0, snapshot.compression);
    recordRegionMaintenance('Preview Import', `${file.name}: ${snapshot.chunks.length} chunks`);
  };
  regionPreviewInput.addEventListener('change', () => {
    const file = regionPreviewInput.files?.[0];
    regionPreviewInput.value = '';
    if (!file) return;
    void previewRegionImportFile(file).catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
  });
  const previewRegionImport = () => regionPreviewInput.click();

  const applyRegionImportPreview = async () => {
    if (!pendingRegionImport) {
      streamer.showError('No region import preview is available to apply.');
      return;
    }
    const preview = pendingRegionImport;
    pendingRegionImport = null;
    loadRegionSnapshotWithGame(preview.snapshot);
    streamer.markRegionImported(preview.snapshot.chunks.length, preview.snapshot.compression);
    const slot = currentRegionSlot();
    const savedSnapshot = await regionStore.save(activeRegionSnapshot(), slot.key, slot.name);
    invalidateRegionPayloadStateForKeys(slot.key);
    streamer.markRegionSaved(savedSnapshot.chunks.length, savedSnapshot.compression);
    recordRegionMaintenance('Apply Import', `${slot.name}: ${savedSnapshot.chunks.length} chunks`);
    await refreshRegionSlots();
  };

  const mergeRegionImportPreview = async () => {
    if (!pendingRegionImport) {
      streamer.showError('No region import preview is available to merge.');
      return;
    }
    const preview = pendingRegionImport;
    pendingRegionImport = null;
    const result = streamer.mergeRegionSnapshot(preview.snapshot);
    game.mergeProgress(preview.snapshot.gameProgress);
    refreshGameMarkers();
    streamer.markRegionImported(result.importedChunks, preview.snapshot.compression);
    if (!result.consumedPayloads) releaseRegionSnapshotPayloads(preview.snapshot);
    const slot = currentRegionSlot();
    const savedSnapshot = await regionStore.save(activeRegionSnapshot(), slot.key, slot.name);
    invalidateRegionPayloadStateForKeys(slot.key);
    streamer.markRegionSaved(savedSnapshot.chunks.length, savedSnapshot.compression);
    recordRegionMaintenance('Merge Import', `${slot.name}: ${result.importedChunks} imported chunks, ${result.importedEdits} edits`);
    await refreshRegionSlots();
  };

  const densityImportInput = document.createElement('input');
  densityImportInput.type = 'file';
  densityImportInput.accept = '.json,application/json';
  densityImportInput.hidden = true;
  document.body.append(densityImportInput);

  const importDensityCapturesFile = async (file: File) => {
    const imported = restoreImportedDensityLibrary(JSON.parse(await file.text()));
    if (!imported || densityCaptureCount(imported) === 0) throw new Error('No density slice captures were found in the selected file.');
    densityCaptureLibrary = mergeDensityCaptureLibrary(densityCaptureLibrary, imported);
    densitySliceDiff = null;
  };
  densityImportInput.addEventListener('change', () => {
    const file = densityImportInput.files?.[0];
    densityImportInput.value = '';
    if (!file) return;
    void importDensityCapturesFile(file).catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
  });
  const importDensityCaptures = () => densityImportInput.click();

  const browserWorkerBenchmarkImportInput = document.createElement('input');
  browserWorkerBenchmarkImportInput.type = 'file';
  browserWorkerBenchmarkImportInput.accept = '.json,application/json';
  browserWorkerBenchmarkImportInput.hidden = true;
  document.body.append(browserWorkerBenchmarkImportInput);

  const exportBrowserWorkerBenchmarkHistory = () => {
    if (browserWorkerBenchmarkCaptures.length === 0) {
      streamer.showError('No browser worker benchmark captures are available to export.');
      return;
    }
    const exportedAt = Date.now();
    const body = {
      app: 'storm-canyon-voxel',
      type: 'browser-worker-benchmark-history',
      version: 1,
      exportedAt,
      captures: browserWorkerBenchmarkCaptures,
    };
    downloadBlob(
      new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }),
      browserWorkerBenchmarkHistoryFileName(exportedAt),
    );
    recordRegionMaintenance('Export Bench', `${browserWorkerBenchmarkCaptures.length} captures`);
    updateRegionBrowser();
  };

  const importBrowserWorkerBenchmarkHistoryFile = async (file: File) => {
    const imported = normalizeImportedBrowserWorkerBenchmarkCaptures(JSON.parse(await file.text()));
    if (imported.length === 0) throw new Error('No browser worker benchmark captures were found in the selected file.');
    browserWorkerBenchmarkCaptures = mergeBrowserWorkerBenchmarkCaptures(browserWorkerBenchmarkCaptures, imported);
    saveBrowserWorkerBenchmarkCaptures(browserWorkerBenchmarkCaptures);
    recordRegionMaintenance('Import Bench', `${imported.length} imported, ${browserWorkerBenchmarkCaptures.length} retained`);
    updateRegionBrowser();
    recordQualityCapture('browser-worker-benchmark-import');
  };
  browserWorkerBenchmarkImportInput.addEventListener('change', () => {
    const file = browserWorkerBenchmarkImportInput.files?.[0];
    browserWorkerBenchmarkImportInput.value = '';
    if (!file) return;
    void importBrowserWorkerBenchmarkHistoryFile(file).catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
  });
  const importBrowserWorkerBenchmarkHistory = () => browserWorkerBenchmarkImportInput.click();

  const clearBrowserWorkerBenchmarkHistory = () => {
    browserWorkerBenchmarkCaptures = [];
    saveBrowserWorkerBenchmarkCaptures(browserWorkerBenchmarkCaptures);
    recordRegionMaintenance('Clear Bench', 'Browser worker benchmark history cleared');
    updateRegionBrowser();
  };

  const captureBrowserWorkerBenchmark = async () => {
    if (browserWorkerBenchmarkRunning) return;
    browserWorkerBenchmarkRunning = true;
    try {
      const result = await runBrowserWorkerBenchmark();
      const previous = browserWorkerBenchmarkCaptures[0];
      const capture: BrowserWorkerBenchmarkCapture = {
        capturedAt: Date.now(),
        benchmarkId: result.benchmarkId,
        settings: { ...settings },
        autoQuality: serializeAutoQualityState(autoQualityState),
        capabilities: { ...renderer.capabilities },
        result,
        trend: computeBenchmarkTrend(result, previous),
      };
      browserWorkerBenchmarkCaptures = mergeBrowserWorkerBenchmarkCaptures(browserWorkerBenchmarkCaptures, [capture]);
      saveBrowserWorkerBenchmarkCaptures(browserWorkerBenchmarkCaptures);
      recordRegionMaintenance(
        'Worker Bench',
        `gen ${result.avgGenerateMs.toFixed(1)} ms, cached ${result.avgCachedRemeshMs.toFixed(1)} ms, edit ${result.avgEditRemeshMs.toFixed(1)} ms`,
      );
      updateRegionBrowser();
      recordQualityCapture('browser-worker-benchmark');
    } finally {
      browserWorkerBenchmarkRunning = false;
    }
  };

  const createDiagnosticCapture = async (includeScreenshot = true) => {
    const capturedAt = Date.now();
    const currentSlice = streamer.densitySliceForCamera(camera, settings);
    const selectedCapture = selectedDensityCapture(densityCaptureLibrary);
    densitySliceDiff = compareDensitySlices(currentSlice, selectedCapture);
    const slot = currentRegionSlot();
    const regionInfo = regionSlotInfos.find(info => info.key === slot.key) ?? null;
    const screenshotDataUrl = includeScreenshot ? await canvasPngDataUrl(canvas) : null;
    const worldgen = worldgenSnapshot(camera, settings);
    return {
      type: 'storm-canyon-diagnostic-capture',
      version: 2,
      capturedAt,
      screenshot: screenshotDataUrl ? {
        mimeType: 'image/png',
        width: canvas.width,
        height: canvas.height,
        dataUrl: screenshotDataUrl,
      } : null,
      camera: {
        position: [...camera.position],
        yaw: camera.yaw,
        pitch: camera.pitch,
        fovDegrees: camera.fovDegrees,
      },
      settings: { ...settings },
      runtime: {
        capabilities: { ...renderer.capabilities },
        rendererStats: { ...renderer.stats },
        rendererMemory: renderer.memoryStats(),
        profile: { ...profiler.last },
        streamerCounts: streamer.counts(),
        streamerStats: { ...streamer.lastStats },
        autoQuality: serializeAutoQualityState(autoQualityState),
        qualityCaptures: autoQualityState.captures,
        browserWorkerBenchmarks: browserWorkerBenchmarkCaptures,
        regionDiff: streamer.lastRegionDiff ? { ...streamer.lastRegionDiff } : null,
      },
      region: {
        activeSlot: { key: slot.key, name: slot.name },
        selectedSlotInfo: regionInfo,
        pendingImport: pendingRegionImport ? {
          fileName: pendingRegionImport.fileName,
          fileSize: pendingRegionImport.fileSize,
          decodedAt: pendingRegionImport.decodedAt,
          diff: pendingRegionImport.diff,
        } : null,
      },
      density: {
        currentSlice: serializeDensitySliceSnapshot(currentSlice),
        selectedCapture: selectedCapture ? serializeDensityCapture(selectedCapture) : null,
        selectedSet: {
          name: selectedDensitySet(densityCaptureLibrary).name,
          index: densityCaptureLibrary.selectedSetIndex,
          count: selectedDensitySet(densityCaptureLibrary).captures.length,
        },
        diff: densitySliceDiff,
      },
      worldgen,
      game: game.snapshot(camera),
      gameProgress: game.progress(),
      overlayText: overlay.innerText,
    };
  };
  const exportDiagnosticCapture = async () => {
    const body = await createDiagnosticCapture(true);
    const blob = new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' });
    downloadBlob(blob, diagnosticFileName(body.capturedAt));
  };
  const createQualityCaptureBody = (label = 'manual-export') => {
    const capture = recordQualityCapture(label);
    return {
      type: 'storm-canyon-quality-capture',
      version: 2,
      exportedAt: Date.now(),
      capture,
      recentCaptures: autoQualityState.captures,
      browserWorkerBenchmarks: browserWorkerBenchmarkCaptures,
    };
  };
  const exportQualityCapture = () => {
    const body = createQualityCaptureBody('manual-export');
    downloadBlob(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }), qualityCaptureFileName(body.capture.capturedAt));
  };
  const createWorldgenTileCapture = () => {
    const tiles = worldgenTileCache.exportTilesAround(camera.position[0], camera.position[2], 1);
    const caveGraph = caveGraphTileCache.exportTilesAround(camera.position[0], camera.position[2], 1);
    const erosionTiles = erosionTileCache.exportTilesAround(camera.position[0], camera.position[2], 1);
    const materialTiles = materialTileCache.exportTilesAround(camera.position[0], camera.position[2], 1);
    return {
      ...tiles,
      erosionTiles,
      materialTiles,
      caveGraph,
      settings: { ...settings },
      camera: {
        position: [...camera.position],
        yaw: camera.yaw,
        pitch: camera.pitch,
      },
      probes: worldgenSnapshot(camera, settings),
    };
  };
  const exportWorldgenTiles = () => {
    const body = createWorldgenTileCapture();
    downloadBlob(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }), worldgenTileFileName(body.capturedAt));
  };

  const createAutomationStateCapture = () => {
    const slot = currentRegionSlot();
    const regionInfo = regionSlotInfos.find(info => info.key === slot.key) ?? null;
    const selectedCapture = selectedDensityCapture(densityCaptureLibrary);
    return {
      type: 'storm-canyon-runtime-state',
      version: 1,
      capturedAt: Date.now(),
      frame: automationFrame,
      camera: {
        position: [...camera.position],
        yaw: camera.yaw,
        pitch: camera.pitch,
        fovDegrees: camera.fovDegrees,
      },
      settings: { ...settings },
      panels: {
        overlay: settings.overlayPanelVisible && !overlay.hidden,
        settings: settings.settingsPanelVisible && !settingsRoot.hidden,
        density: settings.densityPanelVisible && !densityPanel.hidden,
        regionBrowser: settings.regionBrowserPanelVisible && !regionBrowser.hidden,
      },
      runtime: {
        capabilities: { ...renderer.capabilities },
        rendererStats: { ...renderer.stats },
        rendererMemory: renderer.memoryStats(),
        profile: { ...profiler.last },
        streamerCounts: streamer.counts(),
        streamerStats: { ...streamer.lastStats },
        autoQuality: serializeAutoQualityState(autoQualityState),
        browserWorkerBenchmarks: browserWorkerBenchmarkCaptures,
        regionDiff: streamer.lastRegionDiff ? { ...streamer.lastRegionDiff } : null,
      },
      region: {
        activeSlot: { key: slot.key, name: slot.name },
        selectedSlotInfo: regionInfo,
        slotCount: regionSlotInfos.length,
        pendingImport: pendingRegionImport ? {
          fileName: pendingRegionImport.fileName,
          fileSize: pendingRegionImport.fileSize,
          decodedAt: pendingRegionImport.decodedAt,
          diff: pendingRegionImport.diff,
        } : null,
      },
      density: {
        selectedCapture: selectedCapture ? serializeDensityCapture(selectedCapture) : null,
        selectedSet: {
          name: selectedDensitySet(densityCaptureLibrary).name,
          index: densityCaptureLibrary.selectedSetIndex,
          count: selectedDensitySet(densityCaptureLibrary).captures.length,
        },
        diff: densitySliceDiff,
      },
      worldgen: worldgenSnapshot(camera, settings),
      game: game.snapshot(camera),
      gameProgress: game.progress(),
      overlayText: overlay.innerText,
    };
  };

  const emitAutomationReport = async (action: string, payload: unknown): Promise<AutomationEnvelope> => {
    const envelope: AutomationEnvelope = {
      type: 'storm-canyon-automation-report',
      version: 1,
      id: `automation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      label: automation.label,
      action,
      sequence: automationRuns + 1,
      frame: automationFrame,
      capturedAt: Date.now(),
      location: window.location.href,
      payload,
    };
    const automationWindow = window as unknown as {
      __stormCanyonAutomationLatest?: AutomationEnvelope;
      __stormCanyonAutomationReports?: AutomationEnvelope[];
    };
    automationWindow.__stormCanyonAutomationLatest = envelope;
    if (automation.targets.has('window')) {
      automationWindow.__stormCanyonAutomationReports = [
        ...(automationWindow.__stormCanyonAutomationReports ?? []),
        envelope,
      ].slice(-50);
    }
    if (automation.targets.has('console')) {
      console.log(`STORM_CANYON_AUTOMATION ${JSON.stringify(envelope)}`);
    }
    if (automation.targets.has('backend')) {
      try {
        const body = JSON.stringify(envelope);
        const response = await fetch(automation.endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          keepalive: body.length < 64000,
        });
        if (!response.ok) console.warn(`Automation report POST failed with HTTP ${response.status}.`);
      } catch (error) {
        console.warn('Automation report POST failed.', error);
      }
    }
    return envelope;
  };

  const emitAutomationStateAfterAction = async (action: string, result: unknown = null): Promise<void> => {
    await emitAutomationReport(action, {
      type: 'storm-canyon-automation-action-result',
      version: 1,
      action,
      result,
      state: createAutomationStateCapture(),
    });
  };

  const runAutomationAction = async (action: string): Promise<void> => {
    const normalized = action.trim().toLowerCase().replace(/[-_\s]/g, '');
    try {
      if (normalized === 'state' || normalized === 'report' || normalized === 'runtime') {
        await emitAutomationReport(action, createAutomationStateCapture());
      } else if (normalized === 'diagnostic' || normalized === 'diagnosticcapture') {
        await emitAutomationReport(action, await createDiagnosticCapture(automation.includeScreenshot));
      } else if (normalized === 'quality' || normalized === 'qualitycapture') {
        await emitAutomationReport(action, createQualityCaptureBody(`automation-${automation.label}`));
      } else if (normalized === 'worldgen' || normalized === 'worldgentiles' || normalized === 'worldgentilecapture') {
        await emitAutomationReport(action, createWorldgenTileCapture());
      } else if (normalized === 'benchmark' || normalized === 'workerbenchmark' || normalized === 'runworkerbenchmark') {
        await captureBrowserWorkerBenchmark();
        await emitAutomationStateAfterAction(action, { completed: true });
      } else if (normalized === 'reload' || normalized === 'reloadchunks') {
        streamer.reloadChunks();
        await emitAutomationStateAfterAction(action, { completed: true });
      } else if (normalized === 'carve') {
        carveAtCrosshair();
        await emitAutomationStateAfterAction(action, { completed: true });
      } else if (normalized === 'capturedensity' || normalized === 'capturedensityslice' || normalized === 'density') {
        captureDensitySlice();
        await emitAutomationStateAfterAction(action, { completed: true });
      } else if (normalized === 'diffdensity' || normalized === 'diffdensityslice' || normalized === 'densitydiff') {
        diffDensitySlice();
        await emitAutomationStateAfterAction(action, { completed: true });
      } else if (normalized === 'saveregion') {
        await saveRegion();
        await emitAutomationStateAfterAction(action, { completed: true });
      } else if (normalized === 'loadregion') {
        await loadRegion();
        await emitAutomationStateAfterAction(action, { completed: true });
      } else if (normalized === 'diffregion') {
        await diffSavedRegion();
        await emitAutomationStateAfterAction(action, { completed: true });
      } else if (normalized === 'resetgame' || normalized === 'resetgameprogress') {
        game.resetProgress();
        refreshGameMarkers();
        await emitAutomationStateAfterAction(action, { completed: true });
      } else {
        await emitAutomationReport(action, {
          type: 'storm-canyon-automation-error',
          version: 1,
          action,
          message: `Unknown automation action: ${action}`,
          supportedActions: [
            'state',
            'diagnostic',
            'quality',
            'worldgen',
            'benchmark',
            'reloadChunks',
            'carve',
            'captureDensity',
            'diffDensity',
            'saveRegion',
            'loadRegion',
            'diffRegion',
            'resetGame',
          ],
        });
      }
    } catch (error) {
      await emitAutomationReport(action, {
        type: 'storm-canyon-automation-error',
        version: 1,
        action,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  };

  const pumpAutomation = (): void => {
    if (!automation.enabled || automationRunning || automationRuns >= automation.maxRuns) return;
    if (automationFrame < automation.waitFrames) return;
    if (automationRuns > 0 && automation.intervalFrames <= 0) return;
    if (automationRuns > 0 && (automationFrame - automation.waitFrames) % automation.intervalFrames !== 0) return;
    automationRunning = true;
    const actions = [...automation.actions];
    void (async () => {
      for (const action of actions) await runAutomationAction(action);
    })().finally(() => {
      automationRuns++;
      automationRunning = false;
    });
  };

  handleRegionBrowserAction = (action, index) => {
    if (action === 'load') void loadRegionSlot(index).catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
    else if (action === 'diff') void diffSavedRegionSlot(index).catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
    else if (action === 'inspect') void inspectSavedRegionSlot(index).catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
    else if (action === 'comparePayload') void compareSavedRegionPayloadSlot(index).catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
    else if (action === 'verifyPayload') void verifySavedRegionPayloadSlot(index).catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
    else if (action === 'export') void exportSavedRegionSlot(index).catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
    else if (action === 'clear') void clearSavedRegionSlot(index).catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
    else if (action === 'refresh') void refreshRegionSlots().catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
    else if (action === 'exportBundle') void exportRegionBundle().catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
    else if (action === 'importBundle') importRegionBundle();
    else if (action === 'exportMaintenanceReport') void exportRegionMaintenanceReport().catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
    else if (action === 'pruneOldest') void pruneOldestRegion().catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
    else if (action === 'dryRunRetention') void dryRunRegionRetention().catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
    else if (action === 'applyRetention') void applyRegionRetention().catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
  };

  const dispatchSettingsAction = (action: string): boolean => {
    if (action === 'carve') carveAtCrosshair();
    else if (action === 'undoEdit') streamer.undoEdit();
    else if (action === 'redoEdit') streamer.redoEdit();
    else if (action === 'switchEditBranch') streamer.switchEditBranch();
    else if (action === 'clearEdits') streamer.clearEdits();
    else if (action === 'clearEditBranches') streamer.clearEditBranches();
    else if (action === 'reloadChunks') streamer.reloadChunks();
    else if (action === 'pickPaintMaterial') pickPaintMaterialAtCrosshair();
    else if (action === 'paintMaterialGrass') applyPaintMaterialSwatch(PAINT_MATERIAL_GRASS);
    else if (action === 'paintMaterialRock') applyPaintMaterialSwatch(PAINT_MATERIAL_ROCK);
    else if (action === 'paintMaterialSnow') applyPaintMaterialSwatch(PAINT_MATERIAL_SNOW);
    else if (action === 'paintMaterialMud') applyPaintMaterialSwatch(PAINT_MATERIAL_MUD);
    else if (action === 'brushPresetDetail') applyDetailBrushPreset();
    else if (action === 'brushPresetPath') applyPathBrushPreset();
    else if (action === 'brushPresetTerrace') applyTerraceBrushPreset();
    else if (action === 'brushPresetTunnel') applyTunnelBrushPreset();
    else if (action === 'saveBrushPreset') saveCurrentBrushPreset();
    else if (action === 'clearBrushPresets') clearBrushPresets();
    else if (action === 'falloffPresetHard') applyHardEdgePreset();
    else if (action === 'falloffPresetSoft') applySoftEdgePreset();
    else if (action === 'saveRegion') void saveRegion().catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
    else if (action === 'loadRegion') void loadRegion().catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
    else if (action === 'diffRegion') void diffSavedRegion().catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
    else if (action === 'renameRegion') void renameRegion().catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
    else if (action === 'duplicateRegion') void duplicateRegion().catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
    else if (action === 'pruneOldestRegion') void pruneOldestRegion().catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
    else if (action === 'dryRunRegionRetention') void dryRunRegionRetention().catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
    else if (action === 'applyRegionRetention') void applyRegionRetention().catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
    else if (action === 'exportRegionMaintenanceReport') void exportRegionMaintenanceReport().catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
    else if (action === 'exportRegionBundle') void exportRegionBundle().catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
    else if (action === 'importRegionBundle') importRegionBundle();
    else if (action === 'previewRegionImport') previewRegionImport();
    else if (action === 'applyRegionImportPreview') void applyRegionImportPreview().catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
    else if (action === 'mergeRegionImportPreview') void mergeRegionImportPreview().catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
    else if (action === 'resetGameProgress') {
      game.resetProgress();
      refreshGameMarkers();
    }
    else if (action === 'exportRegion') exportRegion();
    else if (action === 'importRegion') importRegion();
    else if (action === 'clearSavedRegion') void clearSavedRegion().catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
    else if (action === 'captureDensitySlice') captureDensitySlice();
    else if (action === 'previousDensityCapture') {
      densityCaptureLibrary = selectDensityCapture(densityCaptureLibrary, -1);
      densitySliceDiff = null;
    } else if (action === 'nextDensityCapture') {
      densityCaptureLibrary = selectDensityCapture(densityCaptureLibrary, 1);
      densitySliceDiff = null;
    } else if (action === 'previousDensitySet') {
      densityCaptureLibrary = selectDensityCaptureSet(densityCaptureLibrary, -1);
      densitySliceDiff = null;
    } else if (action === 'nextDensitySet') {
      densityCaptureLibrary = selectDensityCaptureSet(densityCaptureLibrary, 1);
      densitySliceDiff = null;
    } else if (action === 'newDensitySet') newDensitySet();
    else if (action === 'renameDensitySet') renameDensitySet();
    else if (action === 'importDensityCaptures') importDensityCaptures();
    else if (action === 'diffDensitySlice') diffDensitySlice();
    else if (action === 'runWorkerBenchmark') void captureBrowserWorkerBenchmark().catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
    else if (action === 'exportWorkerBenchmarks') exportBrowserWorkerBenchmarkHistory();
    else if (action === 'importWorkerBenchmarks') importBrowserWorkerBenchmarkHistory();
    else if (action === 'clearWorkerBenchmarks') clearBrowserWorkerBenchmarkHistory();
    else if (action === 'exportDiagnosticCapture') void exportDiagnosticCapture().catch(error => streamer.showError(error instanceof Error ? error.message : String(error)));
    else if (action === 'exportQualityCapture') exportQualityCapture();
    else if (action === 'exportWorldgenTiles') exportWorldgenTiles();
    else if (action === 'exportDensityCaptures') exportDensityCaptures();
    else if (action === 'clearDensityCaptures') {
      densityCaptureLibrary = clearDensityCaptures();
      densitySliceDiff = null;
    }
    else if (action === 'resetSettings') setSettings({ ...DEFAULT_ENGINE_SETTINGS, streamRadius: FALLBACK_STREAM_RADIUS }, 'all');
    else return false;
    return true;
  };

  settingsPanel = createSettingsPanel({
    root: settingsRoot,
    initialSettings: settings,
    onChange: (nextSettings, changedKey) => setSettings(nextSettings, changedKey),
    onAction: dispatchSettingsAction,
    onBrushPresetAction: (action, id) => {
      if (action === 'apply') applyBrushPreset(id);
      else if (action === 'delete') deleteBrushPreset(id);
    },
  });
  updateRegionBrowser();
  updateBrushPresetPanel();
  updateEditHistoryPanel();
  applyPanelVisibility(settings, overlay, settingsRoot, densityPanel, regionBrowser);

  const updateCamera = setupInput(canvas, camera, streamer, {
    getBrushOptions: currentBrushOptions,
    setStreamRadius: (radius) => settingsPanel?.setValue('streamRadius', radius),
  });

  const engineConsole = new EngineConsole(document.body);
  registerEngineConsoleCommands(engineConsole, {
    getSettings: () => settings,
    setSettings: (next, key) => setSettings(next, key),
    defaultSettings: DEFAULT_ENGINE_SETTINGS,
    parseSettingValue: parseSettingValueForUrl,
    dispatchAction: dispatchSettingsAction,
    camera,
    streamer: {
      counts: () => streamer.counts(),
      get baseStreamRadius() { return streamer.baseStreamRadius; },
      get effectiveStreamRadius() { return streamer.effectiveStreamRadius; },
      get terrainLodEnabled() { return streamer.terrainLodEnabled; },
      applyBrush: (target, brush) => streamer.applyBrush(vec3(target[0], target[1], target[2]), brush as Parameters<typeof streamer.applyBrush>[1]),
      reloadChunks: () => streamer.reloadChunks(),
      clearEdits: () => streamer.clearEdits(),
      undoEdit: () => streamer.undoEdit(),
      redoEdit: () => streamer.redoEdit(),
      showError: (message) => streamer.showError(message),
      get lastStats() { return streamer.lastStats as unknown as Record<string, unknown>; },
    },
    renderer: {
      get capabilities() { return renderer.capabilities as unknown as Record<string, unknown>; },
      get stats() { return renderer.stats as unknown as Record<string, unknown>; },
    },
    profiler: {
      get last() { return profiler.last; },
      get frameMsSamples() { return profiler.frameMsSamples; },
    },
    game: {
      progress: () => game.progress() as unknown as Record<string, unknown>,
      resetProgress: () => { game.resetProgress(); refreshGameMarkers(); },
    },
    worldgenProbe: (x, z) => {
      const probeCamera = { ...camera, position: vec3(x, camera.position[1], z) };
      const snapshot = worldgenSnapshot(probeCamera as unknown as FlyCamera, settings);
      return snapshot.camera as unknown as Record<string, number | string>;
    },
    reload: () => window.location.reload(),
    editLogSnapshot: () => ({
      active: streamer.editLog as unknown as unknown[],
      redo: streamer.undoneEdits as unknown as unknown[],
      branches: streamer.editBranches as unknown as unknown[],
      activeVersion: streamer.editVersion,
      nextEditId: streamer.nextEditId,
    }),
    brushPresetList: () => brushPresets.map(preset => ({ id: preset.id, label: preset.name })),
    applyBrushPreset: (id) => {
      if (!brushPresets.some(preset => preset.id === id)) return false;
      applyBrushPreset(id);
      return true;
    },
    deleteBrushPreset: (id) => {
      if (!brushPresets.some(preset => preset.id === id)) return false;
      deleteBrushPreset(id);
      return true;
    },
    regionSlotList: () => REGION_SLOTS.map((slot, index) => {
      const name = regionSlotFromSettings({ ...settings, regionSlot: index }).name;
      return { index, key: slot.key, name };
    }),
    tileCacheStats: (name) => {
      if (name === 'chunk') {
        const s = streamer.lastStats;
        return {
          cacheEntries: s.cacheEntries,
          cacheMB: s.cacheMB,
          cacheHits: s.cacheHits,
          cacheMisses: s.cacheMisses,
          pooledArrays: s.pooledArrays,
          pooledMB: s.pooledMB,
          poolHits: s.poolHits,
          poolMisses: s.poolMisses,
        };
      }
      if (name === 'worldgen') return worldgenTileCache.stats() as unknown as Record<string, unknown>;
      if (name === 'erosion') return erosionTileCache.stats() as unknown as Record<string, unknown>;
      if (name === 'material') return materialTileCache.stats() as unknown as Record<string, unknown>;
      if (name === 'cave') return caveGraphTileCache.stats() as unknown as Record<string, unknown>;
      return null;
    },
    poolStats: () => ({
      pooledArrays: streamer.lastStats.pooledArrays,
      pooledMB: streamer.lastStats.pooledMB,
      poolHits: streamer.lastStats.poolHits,
      poolMisses: streamer.lastStats.poolMisses,
      workerScratchMB: streamer.lastStats.workerScratchMB,
      workerScratchReuses: streamer.lastStats.workerScratchReuses,
      workerTransferMB: streamer.lastStats.workerTransferMB,
      workerTransferAllocations: streamer.lastStats.workerTransferAllocations,
      sharedResultSlotCapacity: streamer.lastStats.sharedResultSlotCapacity,
      sharedResultSlotOccupied: streamer.lastStats.sharedResultSlotOccupied,
      sharedResultSlotExhaustions: streamer.lastStats.sharedResultSlotExhaustions,
      sharedResultSlotReleases: streamer.lastStats.sharedResultSlotReleases,
      remeshFallbackDispatches: streamer.lastStats.remeshFallbackDispatches,
      remeshFallbackBytes: streamer.lastStats.remeshFallbackBytes,
    }),
    autoQualityState: () => serializeAutoQualityState(autoQualityState) as unknown as Record<string, unknown>,
    benchmarkHistory: () => browserWorkerBenchmarkCaptures as unknown as unknown[],
    canvas: () => canvas,
  });
  (window as unknown as { __stormCanyonConsole?: EngineConsole }).__stormCanyonConsole = engineConsole;

  const frameProbeEnabled = readBooleanUrlOverride('test.frameProbe', 'frameProbe') === true;
  const frameProbe: FrameProbeState | null = frameProbeEnabled
    ? { samples: [], maxBySection: {} }
    : null;
  if (frameProbe) {
    (window as unknown as { __stormCanyonFrameProbe?: FrameProbeState }).__stormCanyonFrameProbe = frameProbe;
  }

  let last = performance.now();
  let fps = 60;
  let lastDiagnosticUiUpdate = Number.NEGATIVE_INFINITY;
  let lastDiagnosticCameraMoveTime = performance.now();
  let lastDiagnosticCameraPosition = {
    x: camera.position[0],
    y: camera.position[1],
    z: camera.position[2],
  };
  function frame(now: number): void {
    const frameProbeSections: Record<string, number> | null = frameProbe ? {} : null;
    const frameProbeStart = frameProbe ? performance.now() : 0;
    let frameProbeMark = frameProbeStart;
    const markFrameProbe = (name: string): void => {
      if (!frameProbe || !frameProbeSections) return;
      const next = performance.now();
      frameProbeSections[name] = next - frameProbeMark;
      frameProbe.maxBySection[name] = Math.max(frameProbe.maxBySection[name] ?? 0, frameProbeSections[name]);
      frameProbeMark = next;
    };
    automationFrame++;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    fps = fps * 0.92 + (1 / Math.max(dt, 0.0001)) * 0.08;
    updateCamera(dt);
    if (Math.hypot(
      camera.position[0] - lastDiagnosticCameraPosition.x,
      camera.position[1] - lastDiagnosticCameraPosition.y,
      camera.position[2] - lastDiagnosticCameraPosition.z,
    ) > DIAGNOSTIC_CAMERA_MOVE_EPSILON) {
      lastDiagnosticCameraMoveTime = now;
    }
    lastDiagnosticCameraPosition = {
      x: camera.position[0],
      y: camera.position[1],
      z: camera.position[2],
    };
    const diagnosticCameraMoving = now - lastDiagnosticCameraMoveTime < DIAGNOSTIC_CAMERA_MOVING_SECONDS * 1000;
    markFrameProbe('camera');
    worldgenTileCache.ensureTilesAround(camera.position[0], camera.position[2], 1);
    erosionTileCache.ensureTilesAround(camera.position[0], camera.position[2], 1);
    caveGraphTileCache.ensureTilesAround(camera.position[0], camera.position[2], 1);
    materialTileCache.ensureTilesAround(camera.position[0], camera.position[2], 1);
    markFrameProbe('tilePrefetch');
    game.update(camera, streamer.editLog);
    if (settings.gameMarkersEnabled) {
      const markerInstances = game.consumeMarkerInstances();
      if (markerInstances) renderer.setGameMarkers(markerInstances);
    }
    markFrameProbe('game');
    const brushOptions = currentBrushOptions();
    const brushPreviewMarkers = settings.brushPreviewEnabled
      ? brushPreviewMarkerInstances(camera, brushOptions)
      : null;
    const dirtyMarkers = settings.debugView === DEBUG_VIEW_DIRTY_REGIONS
      ? streamer.debugEditMarkerInstances(true)
      : null;
    renderer.setDebugMarkers(combineMarkerInstances(brushPreviewMarkers, dirtyMarkers));
    markFrameProbe('markers');
    streamer.update(camera);
    markFrameProbe('streamer');
    const aspect = canvas.width / Math.max(1, canvas.height);
    const viewProj = camera.viewProjection(aspect);
    renderer.render(camera, viewProj, now / 1000);
    markFrameProbe('render');
    const profile = profiler.sample(dt, renderer, streamer);
    updateAutoQuality(profile, now);
    markFrameProbe('quality');
    if (!diagnosticCameraMoving && now - lastDiagnosticUiUpdate >= DIAGNOSTIC_UI_UPDATE_INTERVAL_MS) {
      lastDiagnosticUiUpdate = now;
      settingsPanel?.setBrushInspector(createBrushInspectorState(camera, settings, brushOptions));
      settingsPanel?.setRegionDiff(createRegionDiffPanelState(streamer.lastRegionDiff));
      updateEditHistoryPanel();
      renderDensityPanel(
        densityPanel,
        settings.debugView === DEBUG_VIEW_DENSITY_SLICE ? streamer.densitySliceForCamera(camera, settings) : null,
        settings.densityPanelVisible && settings.debugView === DEBUG_VIEW_DENSITY_SLICE,
        densityCaptureLibrary,
        densitySliceDiff,
      );
      updateOverlay(
        overlay,
        fps,
        renderer,
        streamer,
        camera,
        profile,
        game.snapshot(camera),
        settings,
        regionSlotInfos.find(info => info.key === currentRegionSlot().key),
        densitySliceDiff,
        currentRegionSlot().name,
        pendingRegionImport,
        autoQualityState,
        browserWorkerBenchmarkCaptures,
        browserWorkerBenchmarkRunning,
      );
    }
    markFrameProbe('diagnostics');
    applyPanelVisibility(settings, overlay, settingsRoot, densityPanel, regionBrowser);
    pumpAutomation();
    markFrameProbe('automation');
    if (frameProbe && frameProbeSections) {
      const total = performance.now() - frameProbeStart;
      frameProbe.maxBySection.total = Math.max(frameProbe.maxBySection.total ?? 0, total);
      if (total >= 24 || frameProbe.samples.length < 12) {
        frameProbe.samples.push({
          t: Math.round(performance.now()),
          total,
          sections: { ...frameProbeSections },
        });
        if (frameProbe.samples.length > 240) frameProbe.samples.splice(0, frameProbe.samples.length - 240);
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch((error) => {
  console.error(error);
  const overlay = document.querySelector<HTMLElement>('#overlay');
  if (overlay) {
    overlay.classList.add('error');
    overlay.textContent = error instanceof Error ? error.message : String(error);
  }
});
