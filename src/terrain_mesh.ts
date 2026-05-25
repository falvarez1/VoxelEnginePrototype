import type { SphereBounds, TerrainPackFrame } from './engine_contracts';

export const FLOAT_TERRAIN_VERTEX_FLOATS = 8;
export const PACKED_TERRAIN_VERTEX_STRIDE = 16;
export const TERRAIN_CLUSTER_INDEX_COUNT = 384;

export interface TerrainMaterialMasks {
  biome: number;
  wetness: number;
  snow: number;
}

export type TerrainMaskProvider = (
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  material: number,
  ao: number,
) => TerrainMaterialMasks;

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
}

function packUnorm8(value: number): number {
  return Math.round(clamp(value, 0, 1) * 255);
}

export function boundsFromFloatTerrainVertices(vertices: Float32Array): SphereBounds {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i += FLOAT_TERRAIN_VERTEX_FLOATS) {
    const x = vertices[i];
    const y = vertices[i + 1];
    const z = vertices[i + 2];
    minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
  }
  const center: [number, number, number] = [(minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5];
  const radius = Math.hypot(maxX - center[0], maxY - center[1], maxZ - center[2]);
  return { center, radius };
}

export function packFrameFromFloatTerrainVertices(vertices: Float32Array): TerrainPackFrame {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i += FLOAT_TERRAIN_VERTEX_FLOATS) {
    const x = vertices[i];
    const y = vertices[i + 1];
    const z = vertices[i + 2];
    minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
  }
  const scale = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1);
  return { origin: [minX, minY, minZ], scale };
}

export function packFrameFromChunk(cx: number, cy: number, cz: number, chunkWorldSize: number, baseChunkWorldSize = chunkWorldSize): TerrainPackFrame {
  return {
    origin: [cx * baseChunkWorldSize, cy * baseChunkWorldSize, cz * baseChunkWorldSize],
    scale: chunkWorldSize,
  };
}

export function packFloatTerrainVertices(vertices: Float32Array, frame: TerrainPackFrame, masksForVertex?: TerrainMaskProvider): Uint8Array {
  const vertexCount = Math.floor(vertices.length / FLOAT_TERRAIN_VERTEX_FLOATS);
  const packed = new Uint8Array(vertexCount * PACKED_TERRAIN_VERTEX_STRIDE);
  const view = new DataView(packed.buffer);
  const invScale = 1 / Math.max(frame.scale, 0.0001);
  for (let i = 0; i < vertexCount; i++) {
    const src = i * FLOAT_TERRAIN_VERTEX_FLOATS;
    const dst = i * PACKED_TERRAIN_VERTEX_STRIDE;
    view.setUint16(dst, Math.round(clamp((vertices[src] - frame.origin[0]) * invScale, 0, 1) * 65535), true);
    view.setUint16(dst + 2, Math.round(clamp((vertices[src + 1] - frame.origin[1]) * invScale, 0, 1) * 65535), true);
    view.setUint16(dst + 4, Math.round(clamp((vertices[src + 2] - frame.origin[2]) * invScale, 0, 1) * 65535), true);
    view.setUint16(dst + 6, 0, true);
    const x = vertices[src];
    const y = vertices[src + 1];
    const z = vertices[src + 2];
    const nx = vertices[src + 3];
    const ny = vertices[src + 4];
    const nz = vertices[src + 5];
    const material = vertices[src + 6];
    const ao = vertices[src + 7];
    packed[dst + 8] = packUnorm8(nx * 0.5 + 0.5);
    packed[dst + 9] = packUnorm8(ny * 0.5 + 0.5);
    packed[dst + 10] = packUnorm8(nz * 0.5 + 0.5);
    packed[dst + 11] = packUnorm8(ao);
    packed[dst + 12] = Math.round(clamp(vertices[src + 6], 0, 255));
    if (masksForVertex) {
      const masks = masksForVertex(x, y, z, nx, ny, nz, material, ao);
      packed[dst + 13] = packUnorm8(masks.biome);
      packed[dst + 14] = packUnorm8(masks.wetness);
      packed[dst + 15] = packUnorm8(masks.snow);
    }
  }
  return packed;
}

function readPackedWorldPosition(vertices: Uint8Array, vertexIndex: number, frame: TerrainPackFrame, out: [number, number, number]): void {
  const offset = vertexIndex * PACKED_TERRAIN_VERTEX_STRIDE;
  const view = new DataView(vertices.buffer, vertices.byteOffset + offset, PACKED_TERRAIN_VERTEX_STRIDE);
  out[0] = frame.origin[0] + (view.getUint16(0, true) / 65535) * frame.scale;
  out[1] = frame.origin[1] + (view.getUint16(2, true) / 65535) * frame.scale;
  out[2] = frame.origin[2] + (view.getUint16(4, true) / 65535) * frame.scale;
}

export function buildTerrainClusterBounds(
  vertices: Uint8Array,
  indices: Uint32Array,
  frame: TerrainPackFrame,
  clusterIndexCount = TERRAIN_CLUSTER_INDEX_COUNT,
): Float32Array {
  const clusterCount = Math.ceil(indices.length / clusterIndexCount);
  const bounds = new Float32Array(clusterCount * 4);
  const p: [number, number, number] = [0, 0, 0];
  for (let cluster = 0; cluster < clusterCount; cluster++) {
    const start = cluster * clusterIndexCount;
    const end = Math.min(indices.length, start + clusterIndexCount);
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = start; i < end; i++) {
      readPackedWorldPosition(vertices, indices[i], frame, p);
      minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); minZ = Math.min(minZ, p[2]);
      maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); maxZ = Math.max(maxZ, p[2]);
    }
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    bounds[cluster * 4 + 0] = cx;
    bounds[cluster * 4 + 1] = cy;
    bounds[cluster * 4 + 2] = cz;
    bounds[cluster * 4 + 3] = Math.hypot(maxX - cx, maxY - cy, maxZ - cz);
  }
  return bounds;
}
