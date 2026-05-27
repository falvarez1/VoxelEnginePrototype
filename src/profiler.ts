import type { RendererMemoryStats, RuntimeProfile, StreamerStats } from './engine_contracts';

interface ProfiledRenderer {
  memoryStats(): RendererMemoryStats;
}

interface ProfiledStreamer {
  lastStats: Pick<StreamerStats, 'uploadMB'>;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pushSample(samples: number[], value: number, maxSamples = 120): void {
  samples.push(value);
  if (samples.length > maxSamples) samples.shift();
}

export class RuntimeProfiler {
  frameMsSamples: number[];
  uploadSamples: number[];
  last: RuntimeProfile;

  constructor() {
    this.frameMsSamples = [];
    this.uploadSamples = [];
    this.last = {
      frameMs: 0,
      avgFrameMs: 0,
      avgUploadMB: 0,
      estimatedGpuMB: 0,
      chunkMeshMB: 0,
      farTerrainMB: 0,
      vegetationMB: 0,
      waterMB: 0,
      depthPyramidMB: 0,
      depthPyramidMips: 0,
      uploadRingMB: 0,
      uploadRingPages: 0,
      uploadRingPendingMB: 0,
      uploadRingLastFlushMB: 0,
      uploadRingFallbackUploads: 0,
      uploadRingFallbackMB: 0,
      meshCount: 0,
      terrainLod0Chunks: 0,
      terrainLod1Chunks: 0,
      terrainLod2PlusChunks: 0,
      terrainLodTransitionEdges: 0,
      terrainLodTransitionMeshChunks: 0,
      terrainLodTransitionMeshTriangles: 0,
      terrainClusterCount: 0,
      vegetationPatchCount: 0,
    };
  }

  sample(dt: number, renderer: ProfiledRenderer, streamer: ProfiledStreamer): RuntimeProfile {
    const frameMs = dt * 1000;
    pushSample(this.frameMsSamples, frameMs);
    pushSample(this.uploadSamples, streamer.lastStats.uploadMB);

    const memory = renderer.memoryStats();
    this.last = {
      frameMs,
      avgFrameMs: average(this.frameMsSamples),
      avgUploadMB: average(this.uploadSamples),
      estimatedGpuMB: memory.totalMB,
      chunkMeshMB: memory.chunkMeshMB,
      farTerrainMB: memory.farTerrainMB,
      vegetationMB: memory.vegetationMB,
      waterMB: memory.waterMB,
      depthPyramidMB: memory.depthPyramidMB,
      depthPyramidMips: memory.depthPyramidMips,
      uploadRingMB: memory.uploadRingMB,
      uploadRingPages: memory.uploadRingPages,
      uploadRingPendingMB: memory.uploadRingPendingMB,
      uploadRingLastFlushMB: memory.uploadRingLastFlushMB,
      uploadRingFallbackUploads: memory.uploadRingFallbackUploads,
      uploadRingFallbackMB: memory.uploadRingFallbackMB,
      meshCount: memory.meshCount,
      terrainLod0Chunks: memory.terrainLod0Chunks,
      terrainLod1Chunks: memory.terrainLod1Chunks,
      terrainLod2PlusChunks: memory.terrainLod2PlusChunks,
      terrainLodTransitionEdges: memory.terrainLodTransitionEdges,
      terrainLodTransitionMeshChunks: memory.terrainLodTransitionMeshChunks,
      terrainLodTransitionMeshTriangles: memory.terrainLodTransitionMeshTriangles,
      terrainClusterCount: memory.terrainClusterCount,
      vegetationPatchCount: memory.vegetationPatchCount,
    };
    return this.last;
  }
}
