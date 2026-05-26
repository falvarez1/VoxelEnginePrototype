import type { PersistedChunkMesh } from './chunk_cache.ts';
import {
  decodeBytePayload,
  decodeDensitySamples,
  addEncodedBytePayload,
  addEncodedDensityPayload,
  encodeBytePayload,
  encodeDensitySamples,
  createPayloadCompressionStats,
  type BytePayloadCodec,
  type DensityCodec,
  type PayloadCompressionStats,
} from './chunk_codec.ts';
import type { ChunkMeshStats, EditHistoryBranch, EditOperation, GameProgress, SphereBounds, TerrainPackFrame } from './engine_contracts.ts';
import type { RegionSnapshot } from './region_store.ts';
import { sharedTypedArrayPool } from './typed_array_pool.ts';

const MAGIC = 'SCVR1';
const BUNDLE_MAGIC = 'SCVB1';
const FORMAT_VERSION = 3;
const BUNDLE_FORMAT_VERSION = 1;
const HEADER_LENGTH_BYTES = 4;
const REGION_MIME_TYPE = 'application/vnd.storm-canyon.region';
export const REGION_BUNDLE_MIME_TYPE = 'application/vnd.storm-canyon.region-bundle';
const APP_ID = 'storm-canyon-voxel';
const CHUNK_WORLD_SIZE = 32;
const DENSITY_GRID_SIZE = 33;
const DENSITY_SAMPLE_COUNT = DENSITY_GRID_SIZE * DENSITY_GRID_SIZE * DENSITY_GRID_SIZE;
const DENSITY_SCALE = 256;
const TERRAIN_VERTEX_STRIDE = 16;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface RegionChunkHeader {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  lod: number;
  frame: TerrainPackFrame;
  bounds: SphereBounds;
  stats: ChunkMeshStats;
  verticesBytes: number;
  verticesCodec?: BytePayloadCodec;
  verticesRawBytes?: number;
  indicesBytes: number;
  indicesCodec?: BytePayloadCodec;
  indicesRawBytes?: number;
  densityBytes: number;
  densityCodec?: DensityCodec;
  densitySampleCount?: number;
  densityRawBytes?: number;
  vegetationBytes: number;
  vegetationCodec?: BytePayloadCodec;
  vegetationRawBytes?: number;
}

interface RegionFileHeader {
  app: string;
  version: number;
  compatibility: {
    chunkWorldSize: number;
    densityGridSize: number;
    densityScale: number;
    terrainVertexStride: number;
  };
  savedAt: number;
  editLog: EditOperation[];
  undoneEdits: EditOperation[];
  editBranches?: EditHistoryBranch[];
  editVersion: number;
  nextEditId: number;
  nextEditBranchId?: number;
  gameProgress?: GameProgress;
  chunks: RegionChunkHeader[];
}

export interface EncodedRegionSnapshot {
  blob: Blob;
  compression: PayloadCompressionStats;
}

interface RegionBundleHeaderEntry {
  key: string;
  name: string;
  bytes: number;
  savedAt: number;
  chunkCount: number;
  editCount: number;
  compression?: PayloadCompressionStats;
}

interface RegionBundleHeader {
  app: string;
  type: 'region-bundle';
  version: number;
  savedAt: number;
  entries: RegionBundleHeaderEntry[];
}

export interface RegionBundleSourceEntry {
  key: string;
  name: string;
  snapshot: RegionSnapshot;
}

export interface RegionBundleEntry extends RegionBundleSourceEntry {}

export interface EncodedRegionBundle {
  blob: Blob;
  entries: RegionBundleHeaderEntry[];
  compression: PayloadCompressionStats;
}

function bytesOf(view: ArrayBufferView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

function blobBufferOf(view: ArrayBufferView): ArrayBuffer {
  return bytesOf(view).slice().buffer as ArrayBuffer;
}

function finiteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function integerNumber(value: unknown, fallback = 0): number {
  const n = Math.trunc(finiteNumber(value, fallback));
  return Number.isFinite(n) ? n : fallback;
}

function vector3(value: unknown, fallback: [number, number, number] = [0, 0, 0]): [number, number, number] {
  if (!Array.isArray(value) || value.length < 3) return fallback;
  return [finiteNumber(value[0], fallback[0]), finiteNumber(value[1], fallback[1]), finiteNumber(value[2], fallback[2])];
}

function normalizeFrame(value: unknown): TerrainPackFrame {
  const raw = value as Partial<TerrainPackFrame> | null | undefined;
  return {
    origin: vector3(raw?.origin),
    scale: finiteNumber(raw?.scale, 1),
  };
}

function normalizeBounds(value: unknown): SphereBounds {
  const raw = value as Partial<SphereBounds> | null | undefined;
  return {
    center: vector3(raw?.center),
    radius: finiteNumber(raw?.radius, 0),
  };
}

function normalizeStats(value: unknown): ChunkMeshStats {
  const raw = (value ?? {}) as ChunkMeshStats;
  return { ...raw };
}

function normalizeEdit(value: unknown): EditOperation | null {
  const raw = value as Partial<EditOperation> | null | undefined;
  if (!raw || (raw.type !== 'subtractSphere' && raw.type !== 'addSphere' && raw.type !== 'paintMaterial' && raw.type !== 'smoothDensity' && raw.type !== 'flattenDensity')) return null;
  const shape = raw.shape === 'box' || raw.shape === 'capsule' ? raw.shape : 'sphere';
  const edit: EditOperation = {
    id: integerNumber(raw.id, 0),
    type: raw.type,
    x: finiteNumber(raw.x),
    y: finiteNumber(raw.y),
    z: finiteNumber(raw.z),
    radius: finiteNumber(raw.radius),
    shape,
  };
  if (shape === 'capsule') {
    edit.dx = finiteNumber(raw.dx, 0);
    edit.dy = finiteNumber(raw.dy, 0);
    edit.dz = finiteNumber(raw.dz, 1);
    edit.length = finiteNumber(raw.length, 0);
  }
  if (edit.type === 'subtractSphere' || edit.type === 'addSphere') {
    edit.falloff = Math.max(0, Math.min(8, finiteNumber(raw.falloff, 0)));
  }
  if (edit.type === 'paintMaterial') {
    edit.material = Math.max(0, Math.min(255, integerNumber(raw.material, 0)));
  }
  if (edit.type === 'smoothDensity' || edit.type === 'flattenDensity') {
    edit.strength = Math.max(0.05, Math.min(1, finiteNumber(raw.strength, 0.55)));
  }
  return {
    ...edit,
  };
}

function normalizeEditHistoryBranch(value: unknown): EditHistoryBranch | null {
  const raw = value as Partial<EditHistoryBranch> | null | undefined;
  if (!raw || !Array.isArray(raw.edits)) return null;
  const edits = raw.edits.map(normalizeEdit).filter((edit): edit is EditOperation => edit !== null);
  if (edits.length === 0) return null;
  return {
    id: Math.max(1, integerNumber(raw.id, 1)),
    createdAt: finiteNumber(raw.createdAt, Date.now()),
    baseEditId: Math.max(0, integerNumber(raw.baseEditId, 0)),
    baseEditCount: Math.max(0, integerNumber(raw.baseEditCount, 0)),
    edits,
  };
}

function normalizeProgressIds(value: unknown): number[] {
  return Array.isArray(value)
    ? [...new Set(value
      .map(id => Math.trunc(finiteNumber(id, -1)))
      .filter(id => Number.isInteger(id) && id >= 0))]
    : [];
}

function normalizeGameProgress(value: unknown): GameProgress | undefined {
  const raw = value as Partial<GameProgress> | null | undefined;
  if (!raw || !Array.isArray(raw.collectedBeaconIds)) return undefined;
  const base = {
    collectedBeaconIds: normalizeProgressIds(raw.collectedBeaconIds),
    completedContractIds: normalizeProgressIds(raw.completedContractIds),
    updatedAt: finiteNumber(raw.updatedAt, Date.now()),
  };
  const progressVersion = integerNumber(raw.version, 1);
  const hasTraversalMeters = typeof raw.traversalMeters === 'number' && Number.isFinite(raw.traversalMeters);
  const hasVisitedArray = Array.isArray(raw.visitedCheckpointIds) && raw.visitedCheckpointIds.length > 0;
  const hasClearedArray = Array.isArray(raw.clearedHazardIds) && raw.clearedHazardIds.length > 0;
  const isV2 = progressVersion >= 2 || hasVisitedArray || hasClearedArray || hasTraversalMeters;
  if (!isV2) {
    return {
      version: 1,
      ...base,
    };
  }
  return {
    version: 2,
    ...base,
    visitedCheckpointIds: normalizeProgressIds(raw.visitedCheckpointIds),
    clearedHazardIds: normalizeProgressIds(raw.clearedHazardIds),
    traversalMeters: Math.max(0, Math.min(1000000, finiteNumber(raw.traversalMeters, 0))),
  };
}

function typedUint32(bytes: Uint8Array, label: string): Uint32Array {
  if (bytes.byteLength % Uint32Array.BYTES_PER_ELEMENT !== 0) throw new Error(`${label} byte length is not uint32 aligned.`);
  return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / Uint32Array.BYTES_PER_ELEMENT);
}

function typedFloat32(bytes: Uint8Array, label: string): Float32Array {
  if (bytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) throw new Error(`${label} byte length is not float32 aligned.`);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / Float32Array.BYTES_PER_ELEMENT);
}

function assertByteMultiple(length: number, stride: number, label: string): void {
  if (!Number.isSafeInteger(length) || length < 0) throw new Error(`${label} has an invalid byte length.`);
  if (length % stride !== 0) throw new Error(`${label} byte length ${length} is not aligned to ${stride} bytes.`);
}

function assertHeaderCompatibility(header: Partial<RegionFileHeader>): void {
  if (header.app && header.app !== APP_ID) throw new Error(`Unsupported region app: ${header.app}.`);
  const compat = header.compatibility;
  if (!compat) throw new Error('Region file is missing compatibility metadata.');
  if (compat.chunkWorldSize !== CHUNK_WORLD_SIZE) throw new Error(`Unsupported chunk size: ${compat.chunkWorldSize}.`);
  if (compat.densityGridSize !== DENSITY_GRID_SIZE) throw new Error(`Unsupported density grid size: ${compat.densityGridSize}.`);
  if (compat.densityScale !== DENSITY_SCALE) throw new Error(`Unsupported density scale: ${compat.densityScale}.`);
  if (compat.terrainVertexStride !== TERRAIN_VERTEX_STRIDE) throw new Error(`Unsupported terrain vertex stride: ${compat.terrainVertexStride}.`);
}

function takeBytes(source: Uint8Array, cursor: number, length: number, label: string): [Uint8Array, number] {
  if (!Number.isSafeInteger(length) || length < 0) throw new Error(`${label} has an invalid byte length.`);
  const end = cursor + length;
  if (end > source.byteLength) throw new Error(`${label} exceeds the region file payload.`);
  return [source.slice(cursor, end), end];
}

function chunkHeader(
  chunk: PersistedChunkMesh,
  encoded: {
    vertices: ReturnType<typeof encodeBytePayload>;
    indices: ReturnType<typeof encodeBytePayload>;
    density: ReturnType<typeof encodeDensitySamples>;
    vegetation: ReturnType<typeof encodeBytePayload>;
  },
): RegionChunkHeader {
  return {
    key: chunk.key,
    cx: chunk.cx,
    cy: chunk.cy,
    cz: chunk.cz,
    lod: chunk.lod,
    frame: chunk.frame,
    bounds: chunk.bounds,
    stats: chunk.stats,
    verticesBytes: encoded.vertices.bytes.byteLength,
    verticesCodec: encoded.vertices.codec,
    verticesRawBytes: encoded.vertices.rawBytes,
    indicesBytes: encoded.indices.bytes.byteLength,
    indicesCodec: encoded.indices.codec,
    indicesRawBytes: encoded.indices.rawBytes,
    densityBytes: encoded.density.bytes.byteLength,
    densityCodec: encoded.density.codec,
    densitySampleCount: encoded.density.sampleCount,
    densityRawBytes: encoded.density.rawBytes,
    vegetationBytes: encoded.vegetation.bytes.byteLength,
    vegetationCodec: encoded.vegetation.codec,
    vegetationRawBytes: encoded.vegetation.rawBytes,
  };
}

export function encodeRegionSnapshot(snapshot: RegionSnapshot): Blob {
  return encodeRegionSnapshotWithStats(snapshot).blob;
}

function addCompressionStats(target: PayloadCompressionStats, source: PayloadCompressionStats | undefined): PayloadCompressionStats {
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

export function encodeRegionSnapshotWithStats(snapshot: RegionSnapshot): EncodedRegionSnapshot {
  const encodedChunks = snapshot.chunks.map(chunk => ({
    chunk,
    vertices: encodeBytePayload(chunk.vertices),
    indices: encodeBytePayload(chunk.indices),
    density: encodeDensitySamples(chunk.densitySamples),
    vegetation: encodeBytePayload(chunk.vegetation),
  }));
  const compression = createPayloadCompressionStats();
  for (const encoded of encodedChunks) {
    addEncodedBytePayload(compression, encoded.vertices);
    addEncodedBytePayload(compression, encoded.indices);
    addEncodedDensityPayload(compression, encoded.density);
    addEncodedBytePayload(compression, encoded.vegetation);
  }
  const header = {
    app: APP_ID,
    version: FORMAT_VERSION,
    compatibility: {
      chunkWorldSize: CHUNK_WORLD_SIZE,
      densityGridSize: DENSITY_GRID_SIZE,
      densityScale: DENSITY_SCALE,
      terrainVertexStride: TERRAIN_VERTEX_STRIDE,
    },
    savedAt: snapshot.savedAt,
    editLog: snapshot.editLog,
    undoneEdits: snapshot.undoneEdits,
    editBranches: snapshot.editBranches ?? [],
    editVersion: snapshot.editVersion,
    nextEditId: snapshot.nextEditId,
    nextEditBranchId: snapshot.nextEditBranchId ?? 1,
    gameProgress: snapshot.gameProgress,
    chunks: encodedChunks.map(({ chunk, vertices, indices, density, vegetation }) => chunkHeader(chunk, { vertices, indices, density, vegetation })),
  } satisfies RegionFileHeader;

  const magic = encoder.encode(MAGIC);
  const headerBytes = encoder.encode(JSON.stringify(header));
  const prefix = new Uint8Array(magic.byteLength + HEADER_LENGTH_BYTES);
  prefix.set(magic, 0);
  new DataView(prefix.buffer).setUint32(magic.byteLength, headerBytes.byteLength, true);

  const parts: BlobPart[] = [prefix.buffer, headerBytes.buffer];
  for (const { vertices, indices, density, vegetation } of encodedChunks) {
    parts.push(
      blobBufferOf(vertices.bytes),
      blobBufferOf(indices.bytes),
      blobBufferOf(density.bytes),
      blobBufferOf(vegetation.bytes),
    );
  }
  return { blob: new Blob(parts, { type: REGION_MIME_TYPE }), compression };
}

export async function encodeRegionBundle(entries: RegionBundleSourceEntry[]): Promise<EncodedRegionBundle> {
  if (entries.length === 0) throw new Error('No region snapshots are available to bundle.');
  const savedAt = Date.now();
  const encodedEntries: Array<{ header: RegionBundleHeaderEntry; bytes: Uint8Array }> = [];
  const compression = createPayloadCompressionStats();
  for (const entry of entries) {
    const encoded = encodeRegionSnapshotWithStats(entry.snapshot);
    const bytes = new Uint8Array(await encoded.blob.arrayBuffer());
    addCompressionStats(compression, encoded.compression);
    encodedEntries.push({
      header: {
        key: entry.key,
        name: entry.name,
        bytes: bytes.byteLength,
        savedAt: entry.snapshot.savedAt,
        chunkCount: entry.snapshot.chunks.length,
        editCount: entry.snapshot.editLog.length,
        compression: encoded.compression,
      },
      bytes,
    });
  }

  const header = {
    app: APP_ID,
    type: 'region-bundle',
    version: BUNDLE_FORMAT_VERSION,
    savedAt,
    entries: encodedEntries.map(entry => entry.header),
  } satisfies RegionBundleHeader;
  const magic = encoder.encode(BUNDLE_MAGIC);
  const headerBytes = encoder.encode(JSON.stringify(header));
  const prefix = new Uint8Array(magic.byteLength + HEADER_LENGTH_BYTES);
  prefix.set(magic, 0);
  new DataView(prefix.buffer).setUint32(magic.byteLength, headerBytes.byteLength, true);

  const parts: BlobPart[] = [prefix.buffer, headerBytes.buffer];
  for (const entry of encodedEntries) parts.push(blobBufferOf(entry.bytes));
  return {
    blob: new Blob(parts, { type: REGION_BUNDLE_MIME_TYPE }),
    entries: header.entries,
    compression,
  };
}

export async function decodeRegionSnapshot(source: Blob | ArrayBuffer | Uint8Array): Promise<RegionSnapshot> {
  const sourceBytes = source instanceof Blob
    ? new Uint8Array(await source.arrayBuffer())
    : source instanceof Uint8Array
      ? source
      : new Uint8Array(source);
  const magic = encoder.encode(MAGIC);
  const prefixLength = magic.byteLength + HEADER_LENGTH_BYTES;
  if (sourceBytes.byteLength < prefixLength) throw new Error('Region file is too small.');

  for (let i = 0; i < magic.byteLength; i++) {
    if (sourceBytes[i] !== magic[i]) throw new Error('Unsupported region file format.');
  }

  const headerLength = new DataView(sourceBytes.buffer, sourceBytes.byteOffset + magic.byteLength, HEADER_LENGTH_BYTES)
    .getUint32(0, true);
  const headerStart = prefixLength;
  const headerEnd = headerStart + headerLength;
  if (headerEnd > sourceBytes.byteLength) throw new Error('Region file header exceeds file length.');

  const header = JSON.parse(decoder.decode(sourceBytes.subarray(headerStart, headerEnd))) as Partial<RegionFileHeader>;
  if (header.version !== 1 && header.version !== 2 && header.version !== FORMAT_VERSION) {
    throw new Error(`Unsupported region file version: ${header.version ?? 'unknown'}.`);
  }
  assertHeaderCompatibility(header);
  if (!Array.isArray(header.chunks)) throw new Error('Region file header is missing chunk descriptors.');

  let cursor = headerEnd;
  const chunks: PersistedChunkMesh[] = [];
  const compression = createPayloadCompressionStats();
  for (const rawChunk of header.chunks) {
    const desc = rawChunk as Partial<RegionChunkHeader>;
    const cx = integerNumber(desc.cx);
    const cy = integerNumber(desc.cy);
    const cz = integerNumber(desc.cz);
    const lod = integerNumber(desc.lod);
    const key = String(desc.key ?? `${cx},${cy},${cz},${lod}`);
    const verticesLength = integerNumber(desc.verticesBytes);
    const indicesLength = integerNumber(desc.indicesBytes);
    const densityLength = integerNumber(desc.densityBytes);
    const vegetationLength = integerNumber(desc.vegetationBytes);
    const verticesRawBytes = integerNumber(desc.verticesRawBytes, verticesLength);
    const indicesRawBytes = integerNumber(desc.indicesRawBytes, indicesLength);
    const vegetationRawBytes = integerNumber(desc.vegetationRawBytes, vegetationLength);
    assertByteMultiple(desc.verticesCodec ? verticesRawBytes : verticesLength, TERRAIN_VERTEX_STRIDE, `${key} vertices`);
    assertByteMultiple(desc.indicesCodec ? indicesRawBytes : indicesLength, Uint32Array.BYTES_PER_ELEMENT, `${key} indices`);
    assertByteMultiple(desc.vegetationCodec ? vegetationRawBytes : vegetationLength, Float32Array.BYTES_PER_ELEMENT, `${key} vegetation`);
    const densityCodec = desc.densityCodec;
    const densitySampleCount = integerNumber(desc.densitySampleCount, DENSITY_SAMPLE_COUNT);
    const densityRawBytes = integerNumber(desc.densityRawBytes, DENSITY_SAMPLE_COUNT * Int16Array.BYTES_PER_ELEMENT);
    if (!densityCodec) assertByteMultiple(densityLength, Int16Array.BYTES_PER_ELEMENT, `${key} density`);
    if (densitySampleCount !== DENSITY_SAMPLE_COUNT) {
      throw new Error(`${key} density payload has ${densitySampleCount} samples; expected ${DENSITY_SAMPLE_COUNT}.`);
    }
    if (densityRawBytes !== DENSITY_SAMPLE_COUNT * Int16Array.BYTES_PER_ELEMENT) {
      throw new Error(`${key} density payload has ${densityRawBytes} raw bytes; expected ${DENSITY_SAMPLE_COUNT * Int16Array.BYTES_PER_ELEMENT}.`);
    }
    if (!densityCodec && densityLength !== DENSITY_SAMPLE_COUNT * Int16Array.BYTES_PER_ELEMENT) {
      throw new Error(`${key} density payload has ${densityLength} bytes; expected ${DENSITY_SAMPLE_COUNT * Int16Array.BYTES_PER_ELEMENT}.`);
    }
    addPayloadCompressionSafe(compression, desc.verticesCodec, verticesLength, verticesRawBytes);
    addPayloadCompressionSafe(compression, desc.indicesCodec, indicesLength, indicesRawBytes);
    addPayloadCompressionSafe(compression, densityCodec, densityLength, densityRawBytes);
    addPayloadCompressionSafe(compression, desc.vegetationCodec, vegetationLength, vegetationRawBytes);

    let verticesBytes: Uint8Array;
    let indicesBytes: Uint8Array;
    let densityBytes: Uint8Array;
    let vegetationBytes: Uint8Array;
    [verticesBytes, cursor] = takeBytes(sourceBytes, cursor, verticesLength, `${key} vertices`);
    [indicesBytes, cursor] = takeBytes(sourceBytes, cursor, indicesLength, `${key} indices`);
    [densityBytes, cursor] = takeBytes(sourceBytes, cursor, densityLength, `${key} density`);
    [vegetationBytes, cursor] = takeBytes(sourceBytes, cursor, vegetationLength, `${key} vegetation`);

    chunks.push({
      key,
      cx,
      cy,
      cz,
      lod,
      vertices: decodeBytePayload(desc.verticesCodec, verticesBytes, verticesRawBytes, sharedTypedArrayPool),
      indices: typedUint32(decodeBytePayload(desc.indicesCodec, indicesBytes, indicesRawBytes, sharedTypedArrayPool), `${key} indices`),
      densitySamples: decodeDensitySamples(densityCodec, densityBytes, densitySampleCount, sharedTypedArrayPool),
      vegetation: typedFloat32(decodeBytePayload(desc.vegetationCodec, vegetationBytes, vegetationRawBytes, sharedTypedArrayPool), `${key} vegetation`),
      frame: normalizeFrame(desc.frame),
      bounds: normalizeBounds(desc.bounds),
      stats: normalizeStats(desc.stats),
    });
  }

  if (cursor !== sourceBytes.byteLength) throw new Error('Region file has unexpected trailing bytes.');

  return {
    editLog: Array.isArray(header.editLog) ? header.editLog.map(normalizeEdit).filter((edit): edit is EditOperation => edit !== null) : [],
    undoneEdits: Array.isArray(header.undoneEdits) ? header.undoneEdits.map(normalizeEdit).filter((edit): edit is EditOperation => edit !== null) : [],
    editBranches: Array.isArray(header.editBranches) ? header.editBranches.map(normalizeEditHistoryBranch).filter((branch): branch is EditHistoryBranch => branch !== null) : [],
    editVersion: integerNumber(header.editVersion),
    nextEditId: Math.max(1, integerNumber(header.nextEditId, 1)),
    nextEditBranchId: Math.max(1, integerNumber(header.nextEditBranchId, 1)),
    gameProgress: normalizeGameProgress(header.gameProgress),
    savedAt: finiteNumber(header.savedAt, Date.now()),
    chunks,
    compression,
  };
}

export async function decodeRegionBundle(source: Blob | ArrayBuffer | Uint8Array): Promise<RegionBundleEntry[]> {
  const sourceBytes = source instanceof Blob
    ? new Uint8Array(await source.arrayBuffer())
    : source instanceof Uint8Array
      ? source
      : new Uint8Array(source);
  const magic = encoder.encode(BUNDLE_MAGIC);
  const prefixLength = magic.byteLength + HEADER_LENGTH_BYTES;
  if (sourceBytes.byteLength < prefixLength) throw new Error('Region bundle is too small.');
  for (let i = 0; i < magic.byteLength; i++) {
    if (sourceBytes[i] !== magic[i]) throw new Error('Unsupported region bundle format.');
  }

  const headerLength = new DataView(sourceBytes.buffer, sourceBytes.byteOffset + magic.byteLength, HEADER_LENGTH_BYTES)
    .getUint32(0, true);
  const headerStart = prefixLength;
  const headerEnd = headerStart + headerLength;
  if (headerEnd > sourceBytes.byteLength) throw new Error('Region bundle header exceeds file length.');

  const header = JSON.parse(decoder.decode(sourceBytes.subarray(headerStart, headerEnd))) as Partial<RegionBundleHeader>;
  if (header.app !== APP_ID || header.type !== 'region-bundle') throw new Error('Unsupported region bundle metadata.');
  if (header.version !== BUNDLE_FORMAT_VERSION) throw new Error(`Unsupported region bundle version: ${header.version ?? 'unknown'}.`);
  if (!Array.isArray(header.entries)) throw new Error('Region bundle is missing entries.');

  let cursor = headerEnd;
  const entries: RegionBundleEntry[] = [];
  for (const rawEntry of header.entries) {
    const key = String(rawEntry.key ?? '').trim();
    const name = String(rawEntry.name ?? key).trim() || key;
    const length = integerNumber(rawEntry.bytes);
    if (!key) throw new Error('Region bundle entry is missing a slot key.');
    const [bytes, nextCursor] = takeBytes(sourceBytes, cursor, length, `${key} bundled region`);
    cursor = nextCursor;
    entries.push({
      key,
      name,
      snapshot: await decodeRegionSnapshot(bytes),
    });
  }
  if (cursor !== sourceBytes.byteLength) throw new Error('Region bundle has unexpected trailing bytes.');
  return entries;
}

function addPayloadCompressionSafe(
  stats: PayloadCompressionStats,
  codec: string | undefined,
  encodedBytes: number,
  rawBytes: number,
): void {
  stats.payloads++;
  stats.rawBytes += rawBytes;
  stats.encodedBytes += encodedBytes;
  stats.savedBytes = Math.max(0, stats.rawBytes - stats.encodedBytes);
  stats.ratio = stats.rawBytes > 0 ? stats.encodedBytes / stats.rawBytes : 1;
  if (codec === 'lzss-bytes-v1') stats.lzssPayloads++;
  else if (codec === 'delta-varint-i16-v1') stats.deltaVarintPayloads++;
  else stats.rawPayloads++;
}
