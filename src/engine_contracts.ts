export type ChunkState = 'queued' | 'pending' | 'loaded';

export interface ChunkKeyParts {
  cx: number;
  cy: number;
  cz: number;
  lod: number;
}

export interface ChunkJob extends ChunkKeyParts {
  key: string;
  priority: number;
  version: number;
  editVersion: number;
  lodSeamMask?: number;
  mode?: 'generate' | 'remeshDensity';
  densitySamples?: Int16Array;
  editsToApply?: EditOperation[];
}

export interface ChunkMeshStats {
  vertexCount?: number;
  indexCount?: number;
  densityCount?: number;
  densityScale?: number;
  lod?: number;
  lodSeamMask?: number;
  lodSeamSkirtTriangles?: number;
  lodTransitionMesh?: boolean;
  lodTransitionMeshCells?: number;
  lodTransitionMeshEmittedCells?: number;
  lodTransitionMeshMissingSampleCells?: number;
  lodTransitionMeshDegenerateCells?: number;
  cellSize?: number;
  chunkWorldSize?: number;
  remeshed?: boolean;
  overflow?: boolean | number;
  ms?: number;
  workerScratch?: WorkerScratchStats;
  sharedResultArena?: boolean;
  sharedResultBytes?: number;
}

export interface WorkerScratchStats {
  scratchBytes: number;
  scratchReuses: number;
  transferBytes: number;
  transferAllocations: number;
}

export interface SphereBounds {
  center: [number, number, number];
  radius: number;
}

export interface TerrainPackFrame {
  origin: [number, number, number];
  scale: number;
}

export interface ChunkMessage extends ChunkKeyParts {
  type: 'chunk';
  key: string;
  version: number;
  vertices: Uint8Array;
  indices: Uint32Array;
  densitySamples: Int16Array;
  vegetation: Float32Array;
  frame: TerrainPackFrame;
  bounds: SphereBounds;
  stats: ChunkMeshStats;
}

export interface LodTransitionMeshMessage {
  type: 'lodTransitionMesh';
  signature: string;
  version: number;
  vertices: Uint8Array;
  indices: Uint32Array;
  frame: TerrainPackFrame;
  bounds: SphereBounds;
  stats: ChunkMeshStats;
}

export interface WorldgenTileMessage {
  type: 'worldgenTile';
  key: string;
  tileX: number;
  tileZ: number;
  tileSize: number;
  resolution: number;
  fieldCount: number;
  fields: Float32Array;
  biomeIds: Uint8Array;
  waterIds: Uint8Array;
  riverNetworkIds: Uint16Array;
  ms: number;
}

export interface CaveGraphTileMessage {
  type: 'caveGraphTile';
  key: string;
  tileX: number;
  tileZ: number;
  tileSize: number;
  schemaVersion: number;
  generatorVersion: number;
  passageFieldCount: number;
  chamberFieldCount: number;
  passageCount: number;
  chamberCount: number;
  passages: Float32Array;
  chambers: Float32Array;
  ms: number;
}

export interface ErosionTileMessage {
  type: 'erosionTile';
  key: string;
  tileX: number;
  tileZ: number;
  tileSize: number;
  schemaVersion: number;
  generatorVersion: number;
  resolution: number;
  fieldCount: number;
  fields: Float32Array;
  ms: number;
}

export interface MaterialTileMessage {
  type: 'materialTile';
  key: string;
  tileX: number;
  tileZ: number;
  tileSize: number;
  schemaVersion: number;
  generatorVersion: number;
  resolution: number;
  fieldCount: number;
  fields: Float32Array;
  dominantMaterialIds: Uint8Array;
  ms: number;
}

export interface BrowserWorkerBenchmarkSceneResult {
  scene: string;
  chunks: number;
  vertices: number;
  triangles: number;
  editedSamples: number;
  builtSamples: number;
  boxSamples: number;
  capsuleSamples: number;
  smoothSamples: number;
  flattenSamples: number;
  avgGenerateMs: number;
  avgCachedRemeshMs: number;
  avgEditRemeshMs: number;
  avgBuildRemeshMs: number;
  avgBoxRemeshMs: number;
  avgCapsuleRemeshMs: number;
  avgSmoothRemeshMs: number;
  avgFlattenRemeshMs: number;
}

export interface BrowserWorkerBenchmarkSummary {
  benchmarkId: string;
  capturedAt: number;
  elapsedMs: number;
  chunks: number;
  avgGenerateMs: number;
  avgCachedRemeshMs: number;
  avgEditRemeshMs: number;
  avgBuildRemeshMs: number;
  avgBoxRemeshMs: number;
  avgCapsuleRemeshMs: number;
  avgSmoothRemeshMs: number;
  avgFlattenRemeshMs: number;
  scenes: BrowserWorkerBenchmarkSceneResult[];
}

export type BrushShape = 'sphere' | 'box' | 'capsule';

export interface EditOperation {
  id: number;
  type: 'subtractSphere' | 'addSphere' | 'paintMaterial' | 'smoothDensity' | 'flattenDensity';
  x: number;
  y: number;
  z: number;
  radius: number;
  shape?: BrushShape;
  dx?: number;
  dy?: number;
  dz?: number;
  length?: number;
  falloff?: number;
  material?: number;
  strength?: number;
}

export interface EditHistoryBranch {
  id: number;
  createdAt: number;
  baseEditId: number;
  baseEditCount: number;
  edits: EditOperation[];
}

export type WorkerInboundMessage =
  | { type: 'init' }
  | { type: 'initSharedQueue'; queue: SharedArrayBuffer }
  | { type: 'initSharedRemeshPage'; densitySamples: SharedArrayBuffer }
  | { type: 'initSharedResultArena'; arena: SharedArrayBuffer }
  | { type: 'generateShared' }
  | ({ type: 'generate' } & ChunkJob)
  | ({ type: 'remeshDensity' } & ChunkJob & { densitySamples: Int16Array; editsToApply: EditOperation[] })
  | ({ type: 'remeshDensityShared' } & ChunkJob & { editsToApply: EditOperation[]; densitySampleCount: number })
  | {
      type: 'generateLodTransitionMesh';
      signature: string;
      version: number;
      cellCount: number;
      missingSampleCells: number;
      sides: Uint8Array;
      combinedCases: Uint32Array;
      samples: Float32Array;
    }
  | { type: 'generateWorldgenTile'; key: string; tileX: number; tileZ: number }
  | { type: 'generateErosionTile'; key: string; tileX: number; tileZ: number }
  | { type: 'generateMaterialTile'; key: string; tileX: number; tileZ: number }
  | { type: 'generateCaveGraphTile'; key: string; tileX: number; tileZ: number }
  | { type: 'syncEdits'; version: number; edits: EditOperation[] }
  | { type: 'runBenchmark'; benchmarkId: string };

export type WorkerOutboundMessage =
  | { type: 'ready' }
  | { type: 'editAck'; version: number }
  | { type: 'benchmarkResult'; benchmarkId: string; result: BrowserWorkerBenchmarkSummary }
  | { type: 'error'; message: string; stack?: string }
  | LodTransitionMeshMessage
  | WorldgenTileMessage
  | ErosionTileMessage
  | MaterialTileMessage
  | CaveGraphTileMessage
  | ChunkMessage;

export interface EngineSettings {
  streamRadius: number;
  streamingEnabled: boolean;
  terrainLodEnabled: boolean;
  nearTerrainEnabled: boolean;
  farTerrainEnabled: boolean;
  waterEnabled: boolean;
  vegetationEnabled: boolean;
  gameMarkersEnabled: boolean;
  overlayPanelVisible: boolean;
  settingsPanelVisible: boolean;
  densityPanelVisible: boolean;
  regionBrowserPanelVisible: boolean;
  qualityPreset: number;
  fogDensity: number;
  materialDetail: number;
  exposure: number;
  atmosphereStrength: number;
  skyEnabled: boolean;
  cinematicLighting: boolean;
  debugView: number;
  waterOpacity: number;
  animationSpeed: number;
  cameraSpeed: number;
  fastMultiplier: number;
  fov: number;
  editRadius: number;
  brushDistance: number;
  brushMode: number;
  brushShape: number;
  brushLength: number;
  brushFalloff: number;
  brushPreviewEnabled: boolean;
  paintMaterial: number;
  brushStrength: number;
  regionSlot: number;
  densitySliceAxis: number;
  densitySliceIndex: number;
  densitySliceFollowCamera: boolean;
  sunAzimuth: number;
  sunElevation: number;
}

export interface RendererSettings {
  nearTerrainEnabled: boolean;
  farTerrainEnabled: boolean;
  waterEnabled: boolean;
  vegetationEnabled: boolean;
  fogDensity: number;
  materialDetail: number;
  exposure: number;
  atmosphereStrength: number;
  skyEnabled: boolean;
  cinematicLighting: boolean;
  debugView: number;
  waterOpacity: number;
  animationSpeed: number;
  sunDirection: [number, number, number];
}

export interface RendererStats {
  drawCalls: number;
  terrainTriangles: number;
  farTerrainTriangles: number;
  terrainClusters: number;
  culledTerrainClusters: number;
  terrainClusterDrawCalls: number;
  terrainClusterDrawsSkipped: number;
  vegetationInstances: number;
  vegetationLodCulledInstances: number;
  vegetationDrawCalls: number;
  visibleVegetationPatches: number;
  culledVegetationPatches: number;
  gameMarkers: number;
  debugMarkers: number;
  visibleTerrainChunks: number;
  culledTerrainChunks: number;
  depthPyramidMips: number;
  hiZOcclusionTestedClusters: number;
  hiZOcclusionCulledClusters: number;
  hiZOcclusionTestedBatches: number;
  hiZOcclusionCulledBatches: number;
}

export interface DensitySliceSnapshot {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  axis: 'x' | 'y' | 'z';
  sliceIndex: number;
  size: number;
  scale: number;
  min: number;
  max: number;
  values: Int16Array;
}

export interface RendererMemoryStats {
  chunkMeshMB: number;
  vegetationMB: number;
  farTerrainMB: number;
  waterMB: number;
  depthPyramidMB: number;
  depthPyramidMips: number;
  uploadRingMB: number;
  uploadRingPages: number;
  uploadRingPendingMB: number;
  uploadRingLastFlushMB: number;
  uploadRingFallbackUploads: number;
  uploadRingFallbackMB: number;
  totalMB: number;
  meshCount: number;
  terrainLod0Chunks: number;
  terrainLod1Chunks: number;
  terrainLod2PlusChunks: number;
  terrainLodTransitionEdges: number;
  terrainLodSkirtTriangles: number;
  terrainLodTransitionMeshChunks: number;
  terrainLodTransitionMeshTriangles: number;
  terrainClusterCount: number;
  vegetationPatchCount: number;
}

export interface RuntimeCapabilities {
  webgpu: boolean;
  crossOriginIsolated: boolean;
  sharedArrayBufferAvailable: boolean;
  workerBufferMode: 'transferable' | 'shared-ready' | 'shared-queue';
  maxTextureDimension2D: number;
  maxBufferSizeMB: number;
  maxStorageBufferBindingSizeMB: number;
  timestampQuery: boolean;
  deviceLostReason?: string;
}

export interface StreamerStats {
  generated: number;
  remeshed: number;
  discarded: number;
  avgMeshMs: number;
  uploadMB: number;
  densityKB: number;
  overflow: number;
  editCount: number;
  redoEditCount: number;
  editBranchCount: number;
  editBranchEditCount: number;
  cacheEntries: number;
  cacheMB: number;
  cacheHits: number;
  cacheMisses: number;
  pooledArrays: number;
  pooledMB: number;
  poolHits: number;
  poolMisses: number;
  workerScratchMB: number;
  workerScratchReuses: number;
  workerTransferMB: number;
  workerTransferAllocations: number;
  sharedQueuePages: number;
  sharedQueueDispatches: number;
  sharedQueueBatches: number;
  sharedQueueBatchMax: number;
  sharedQueueBytes: number;
  sharedRemeshPages: number;
  sharedRemeshDispatches: number;
  sharedRemeshBytes: number;
  sharedResultPages: number;
  sharedResultChunks: number;
  sharedResultBytes: number;
  savedRegionChunks: number;
  loadedRegionChunks: number;
  exportedRegionChunks: number;
  importedRegionChunks: number;
  regionCompressionRawMB: number;
  regionCompressionEncodedMB: number;
  regionCompressionRatio: number;
  lodPlanTargetChunks: number;
  lodPlanLod0Chunks: number;
  lodPlanLod1Chunks: number;
  lodPlanLod2PlusChunks: number;
  lodPlanTransitionEdges: number;
  lodPlanTransitionFaces: number;
  lodPlanTransitionFaceBaseCells: number;
  lodPlanTransitionCells: number;
  lodPlanSkirtedChunks: number;
  lodPlanCoveredBaseCells: number;
  lodPlanMaxLod: number;
  lodTransitionMeshCells: number;
  lodTransitionMeshEmittedCells: number;
  lodTransitionMeshTriangles: number;
  lodTransitionMeshMissingSampleCells: number;
  lodTransitionMeshDegenerateCells: number;
  lodTransitionMeshNative: boolean;
}

export interface RegionDiffSummary {
  slotName: string;
  status: 'compared' | 'missing';
  comparedAt: number;
  savedAt: number;
  activeChunks: number;
  savedChunks: number;
  commonChunks: number;
  matchingCommonChunks: number;
  changedCommonChunks: number;
  activeOnlyChunks: number;
  savedOnlyChunks: number;
  activeEdits: number;
  savedEdits: number;
  activeRedoEdits: number;
  savedRedoEdits: number;
  activeEditBranches: number;
  savedEditBranches: number;
  activeBranchEdits: number;
  savedBranchEdits: number;
  commonEditIds: number;
  matchingCommonEditIds: number;
  changedCommonEditIds: number;
  activeOnlyEditIds: number;
  savedOnlyEditIds: number;
  activeOnlyEditSamples: RegionEditDiffSample[];
  savedOnlyEditSamples: RegionEditDiffSample[];
  changedEditSamples: RegionChangedEditDiffSample[];
  matchingEditBranches: number;
  activeOnlyEditBranches: number;
  savedOnlyEditBranches: number;
  activeOnlyBranchSamples: RegionEditBranchDiffSample[];
  savedOnlyBranchSamples: RegionEditBranchDiffSample[];
  savedCompressionRatio: number;
}

export interface RegionEditDiffSample {
  id: number;
  index: number;
  state: 'active-only' | 'saved-only' | 'changed-active' | 'changed-saved';
  label: string;
  detail: string;
}

export interface RegionChangedEditDiffSample {
  id: number;
  active: RegionEditDiffSample;
  saved: RegionEditDiffSample;
}

export interface RegionEditBranchDiffSample {
  id: number;
  state: 'active-only' | 'saved-only';
  label: string;
  detail: string;
  baseEditId: number;
  baseEditCount: number;
  editCount: number;
}

export interface GameProgress {
  version: 1 | 2;
  collectedBeaconIds: number[];
  completedContractIds?: number[];
  visitedCheckpointIds?: number[];
  clearedHazardIds?: number[];
  traversalMeters?: number;
  updatedAt: number;
}

export interface StreamerCounts {
  queued: number;
  pending: number;
  loaded: number;
  workers: number;
  idle: number;
}

export interface RuntimeProfile {
  frameMs: number;
  avgFrameMs: number;
  avgUploadMB: number;
  estimatedGpuMB: number;
  chunkMeshMB: number;
  farTerrainMB: number;
  vegetationMB: number;
  waterMB: number;
  depthPyramidMB: number;
  depthPyramidMips: number;
  uploadRingMB: number;
  uploadRingPages: number;
  uploadRingPendingMB: number;
  uploadRingLastFlushMB: number;
  uploadRingFallbackUploads: number;
  uploadRingFallbackMB: number;
  meshCount: number;
  terrainLod0Chunks: number;
  terrainLod1Chunks: number;
  terrainLod2PlusChunks: number;
  terrainLodTransitionEdges: number;
  terrainLodSkirtTriangles: number;
  terrainLodTransitionMeshChunks: number;
  terrainLodTransitionMeshTriangles: number;
  terrainClusterCount: number;
  vegetationPatchCount: number;
}
