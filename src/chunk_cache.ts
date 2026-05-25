import type { ChunkMeshStats, SphereBounds, TerrainPackFrame } from './engine_contracts';
import { sharedTypedArrayPool, type TypedArrayPool } from './typed_array_pool.ts';

export interface CachedChunkMesh {
  key?: string;
  cx?: number;
  cy?: number;
  cz?: number;
  lod?: number;
  vertices: Uint8Array;
  indices: Uint32Array;
  densitySamples: Int16Array;
  vegetation: Float32Array;
  frame: TerrainPackFrame;
  bounds: SphereBounds;
  stats: ChunkMeshStats;
}

export interface ChunkCacheStats {
  entries: number;
  bytes: number;
  hits: number;
  misses: number;
  pooledArrays: number;
  pooledBytes: number;
  poolHits: number;
  poolMisses: number;
}

export interface ChunkCachePutOptions {
  ownsArrays?: boolean;
  onRelease?: () => void;
}

export interface PersistedChunkMesh extends CachedChunkMesh {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  lod: number;
}

interface EncodedChunkMesh {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  lod: number;
  vertices: Uint8Array;
  indices: Uint32Array;
  densitySamples: Int16Array;
  vegetation: Float32Array;
  frame: TerrainPackFrame;
  bounds: SphereBounds;
  stats: ChunkMeshStats;
  bytes: number;
  lastUsed: number;
  ownsArrays: boolean;
  onRelease?: () => void;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function byteLengthOf(entry: Omit<EncodedChunkMesh, 'bytes' | 'lastUsed'>): number {
  return entry.vertices.byteLength
    + entry.indices.byteLength
    + entry.densitySamples.byteLength
    + entry.vegetation.byteLength;
}

export class CompressedChunkCache {
  private entries = new Map<string, EncodedChunkMesh>();
  private bytes = 0;
  private clock = 0;
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly chunkWorldSize: number,
    private readonly maxBytes = 96 * 1024 * 1024,
    private readonly pool: TypedArrayPool = sharedTypedArrayPool,
  ) {}

  get(key: string): CachedChunkMesh | null {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    entry.lastUsed = ++this.clock;
    this.hits++;
    return this.decode(entry);
  }

  peek(key: string): CachedChunkMesh | null {
    const entry = this.entries.get(key);
    return entry ? this.decode(entry) : null;
  }

  put(
    key: string,
    cx: number,
    cy: number,
    cz: number,
    lod: number,
    vertices: Uint8Array,
    indices: Uint32Array,
    densitySamples: Int16Array,
    vegetation: Float32Array,
    frame: TerrainPackFrame,
    bounds: SphereBounds,
    stats: ChunkMeshStats,
    options: ChunkCachePutOptions = {},
  ): boolean {
    if (!vertices.length || !indices.length) {
      options.onRelease?.();
      return false;
    }
    const next: Omit<EncodedChunkMesh, 'bytes' | 'lastUsed'> = {
      key,
      cx,
      cy,
      cz,
      lod,
      vertices,
      indices,
      densitySamples,
      vegetation,
      frame,
      bounds,
      stats,
      ownsArrays: options.ownsArrays !== false,
      onRelease: options.onRelease,
    };
    const entry: EncodedChunkMesh = { ...next, bytes: byteLengthOf(next), lastUsed: ++this.clock };
    this.delete(key);
    if (entry.bytes > this.maxBytes) {
      this.releaseEntry(entry);
      return false;
    }
    this.entries.set(key, entry);
    this.bytes += entry.bytes;
    this.evict();
    return this.entries.get(key) === entry;
  }

  invalidateSphere(x: number, y: number, z: number, radius: number): void {
    for (const entry of [...this.entries.values()]) {
      if (this.intersectsSphere(entry, x, y, z, radius)) this.delete(entry.key);
    }
  }

  clear(): void {
    for (const entry of this.entries.values()) this.releaseEntry(entry);
    this.entries.clear();
    this.bytes = 0;
  }

  stats(): ChunkCacheStats {
    const poolStats = this.pool.stats();
    return {
      entries: this.entries.size,
      bytes: this.bytes,
      hits: this.hits,
      misses: this.misses,
      pooledArrays: poolStats.arrays,
      pooledBytes: poolStats.bytes,
      poolHits: poolStats.hits,
      poolMisses: poolStats.misses,
    };
  }

  private decode(entry: EncodedChunkMesh): CachedChunkMesh {
    return {
      key: entry.key,
      cx: entry.cx,
      cy: entry.cy,
      cz: entry.cz,
      lod: entry.lod,
      vertices: entry.vertices,
      indices: entry.indices,
      densitySamples: entry.densitySamples,
      vegetation: entry.vegetation,
      frame: entry.frame,
      bounds: entry.bounds,
      stats: entry.stats,
    };
  }

  entriesSnapshot(): PersistedChunkMesh[] {
    return [...this.entries.values()].map(entry => ({
      key: entry.key,
      cx: entry.cx,
      cy: entry.cy,
      cz: entry.cz,
      lod: entry.lod,
      vertices: entry.vertices,
      indices: entry.indices,
      densitySamples: entry.densitySamples,
      vegetation: entry.vegetation,
      frame: entry.frame,
      bounds: entry.bounds,
      stats: entry.stats,
    }));
  }

  restore(entries: PersistedChunkMesh[]): void {
    this.clear();
    for (const entry of entries) {
      this.put(
        entry.key,
        entry.cx,
        entry.cy,
        entry.cz,
        entry.lod,
        entry.vertices,
        entry.indices,
        entry.densitySamples,
        entry.vegetation,
        entry.frame,
        entry.bounds,
        entry.stats,
      );
    }
  }

  private delete(key: string): void {
    const existing = this.entries.get(key);
    if (!existing) return;
    this.bytes -= existing.bytes;
    this.entries.delete(key);
    this.releaseEntry(existing);
  }

  private releaseEntry(entry: EncodedChunkMesh): void {
    if (entry.ownsArrays) {
      this.pool.release(entry.vertices);
      this.pool.release(entry.indices);
      this.pool.release(entry.densitySamples);
      this.pool.release(entry.vegetation);
    }
    entry.onRelease?.();
  }

  private evict(): void {
    while (this.bytes > this.maxBytes && this.entries.size > 0) {
      let oldest: EncodedChunkMesh | null = null;
      for (const entry of this.entries.values()) {
        if (!oldest || entry.lastUsed < oldest.lastUsed) oldest = entry;
      }
      if (!oldest) return;
      this.delete(oldest.key);
    }
  }

  private intersectsSphere(entry: EncodedChunkMesh, x: number, y: number, z: number, radius: number): boolean {
    const scale = Math.max(entry.frame?.scale ?? this.chunkWorldSize, this.chunkWorldSize);
    const minX = entry.frame?.origin?.[0] ?? entry.cx * this.chunkWorldSize;
    const minY = entry.frame?.origin?.[1] ?? entry.cy * this.chunkWorldSize;
    const minZ = entry.frame?.origin?.[2] ?? entry.cz * this.chunkWorldSize;
    const maxX = minX + scale;
    const maxY = minY + scale;
    const maxZ = minZ + scale;
    const qx = clamp(x, minX, maxX);
    const qy = clamp(y, minY, maxY);
    const qz = clamp(z, minZ, maxZ);
    return Math.hypot(x - qx, y - qy, z - qz) <= radius;
  }
}
