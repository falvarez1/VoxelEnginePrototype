import type { EditHistoryBranch, EditOperation, GameProgress } from './engine_contracts';
import type { PersistedChunkMesh } from './chunk_cache.ts';
import {
  decodeBytePayload,
  decodeDensitySamples,
  addPayloadCompression,
  encodeBytePayload,
  encodeDensitySamples,
  createPayloadCompressionStats,
  type BytePayloadCodec,
  type DensityCodec,
  type PayloadCompressionStats,
} from './chunk_codec.ts';
import { sharedTypedArrayPool } from './typed_array_pool.ts';

const DB_NAME = 'storm-canyon-region-store';
const DB_VERSION = 2;
const LEGACY_CHUNKS_STORE = 'chunks';
const REGION_CHUNKS_STORE = 'regionChunks';
const META_STORE = 'meta';
const REGION_KEY = 'default';

export interface RegionSnapshot {
  editLog: EditOperation[];
  undoneEdits: EditOperation[];
  editBranches: EditHistoryBranch[];
  editVersion: number;
  nextEditId: number;
  nextEditBranchId: number;
  gameProgress?: GameProgress;
  chunks: PersistedChunkMesh[];
  savedAt: number;
  compression?: PayloadCompressionStats;
}

interface RegionMeta {
  key: string;
  name?: string;
  editLog: EditOperation[];
  undoneEdits?: EditOperation[];
  editBranches?: EditHistoryBranch[];
  editVersion: number;
  nextEditId: number;
  nextEditBranchId?: number;
  gameProgress?: GameProgress;
  savedAt: number;
  chunkCount?: number;
  compression?: PayloadCompressionStats;
}

interface RegionChunkRecord extends Omit<PersistedChunkMesh, 'vertices' | 'indices' | 'densitySamples' | 'vegetation'> {
  storageKey: string;
  regionKey: string;
  chunkKey: string;
  vertices?: Uint8Array;
  verticesPayload?: Uint8Array;
  verticesCodec?: BytePayloadCodec;
  verticesRawBytes?: number;
  indices?: Uint32Array;
  indicesPayload?: Uint8Array;
  indicesCodec?: BytePayloadCodec;
  indicesRawBytes?: number;
  densitySamples?: Int16Array;
  densityPayload?: Uint8Array;
  densityCodec?: DensityCodec;
  densitySampleCount?: number;
  densityRawBytes?: number;
  vegetation?: Float32Array;
  vegetationPayload?: Uint8Array;
  vegetationCodec?: BytePayloadCodec;
  vegetationRawBytes?: number;
}

export interface RegionSlotInfo {
  key: string;
  name: string;
  savedAt: number;
  chunkCount: number;
  editCount: number;
  compressionRatio: number;
  compressionRawBytes: number;
  compressionEncodedBytes: number;
  compressionPayloads: number;
  compressionRawPayloads: number;
  compressionLzssPayloads: number;
  compressionDeltaPayloads: number;
}

export interface RegionPayloadMetric {
  codec: string;
  rawBytes: number;
  encodedBytes: number;
  savedBytes: number;
  ratio: number;
}

export interface RegionChunkPayloadInfo {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  lod: number;
  rawBytes: number;
  encodedBytes: number;
  savedBytes: number;
  vertices: RegionPayloadMetric;
  indices: RegionPayloadMetric;
  density: RegionPayloadMetric;
  vegetation: RegionPayloadMetric;
}

export interface RegionPayloadInspection {
  key: string;
  name: string;
  savedAt: number;
  chunkCount: number;
  editCount: number;
  compression: PayloadCompressionStats;
  chunks: RegionChunkPayloadInfo[];
  largestChunks: RegionChunkPayloadInfo[];
}

export interface RegionPayloadHashMetric extends RegionPayloadMetric {
  encodedHash: string;
  decodedHash: string;
  decodedBytes: number;
  elementCount: number;
  valid: boolean;
  error?: string;
}

export interface RegionChunkPayloadHashAudit {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  lod: number;
  encodedBytes: number;
  decodedBytes: number;
  vertices: RegionPayloadHashMetric;
  indices: RegionPayloadHashMetric;
  density: RegionPayloadHashMetric;
  vegetation: RegionPayloadHashMetric;
  failures: string[];
}

export interface RegionPayloadHashAudit {
  key: string;
  name: string;
  savedAt: number;
  chunkCount: number;
  editCount: number;
  auditedAt: number;
  payloads: number;
  failedPayloads: number;
  encodedBytes: number;
  decodedBytes: number;
  chunks: RegionChunkPayloadHashAudit[];
  failedChunks: RegionChunkPayloadHashAudit[];
  largestDecodedChunks: RegionChunkPayloadHashAudit[];
}

export function releaseRegionSnapshotPayloads(snapshot: Pick<RegionSnapshot, 'chunks'>): void {
  for (const chunk of snapshot.chunks) {
    sharedTypedArrayPool.release(chunk.vertices);
    sharedTypedArrayPool.release(chunk.indices);
    sharedTypedArrayPool.release(chunk.densitySamples);
    sharedTypedArrayPool.release(chunk.vegetation);
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

async function openRegionDb(): Promise<IDBDatabase> {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(LEGACY_CHUNKS_STORE)) db.createObjectStore(LEGACY_CHUNKS_STORE, { keyPath: 'key' });
    if (!db.objectStoreNames.contains(REGION_CHUNKS_STORE)) {
      const chunks = db.createObjectStore(REGION_CHUNKS_STORE, { keyPath: 'storageKey' });
      chunks.createIndex('regionKey', 'regionKey', { unique: false });
    }
    if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' });
  };
  return requestToPromise(request);
}

function chunkStorageKey(regionKey: string, chunkKey: string): string {
  return `${regionKey}::${chunkKey}`;
}

function chunkRecord(regionKey: string, chunk: PersistedChunkMesh): RegionChunkRecord {
  const vertices = encodeBytePayload(chunk.vertices);
  const indices = encodeBytePayload(chunk.indices);
  const density = encodeDensitySamples(chunk.densitySamples);
  const vegetation = encodeBytePayload(chunk.vegetation);
  const {
    vertices: _vertices,
    indices: _indices,
    densitySamples: _densitySamples,
    vegetation: _vegetation,
    ...chunkWithoutPayloads
  } = chunk;
  return {
    ...chunkWithoutPayloads,
    regionKey,
    chunkKey: chunk.key,
    storageKey: chunkStorageKey(regionKey, chunk.key),
    verticesPayload: vertices.bytes,
    verticesCodec: vertices.codec,
    verticesRawBytes: vertices.rawBytes,
    indicesPayload: indices.bytes,
    indicesCodec: indices.codec,
    indicesRawBytes: indices.rawBytes,
    densityPayload: density.bytes,
    densityCodec: density.codec,
    densitySampleCount: density.sampleCount,
    densityRawBytes: density.rawBytes,
    vegetationPayload: vegetation.bytes,
    vegetationCodec: vegetation.codec,
    vegetationRawBytes: vegetation.rawBytes,
  };
}

function recordCompression(record: RegionChunkRecord, stats = createPayloadCompressionStats()): PayloadCompressionStats {
  addPayloadCompression(
    stats,
    record.verticesCodec,
    record.verticesPayload?.byteLength ?? record.vertices?.byteLength ?? 0,
    record.verticesRawBytes ?? record.vertices?.byteLength ?? 0,
  );
  addPayloadCompression(
    stats,
    record.indicesCodec,
    record.indicesPayload?.byteLength ?? record.indices?.byteLength ?? 0,
    record.indicesRawBytes ?? record.indices?.byteLength ?? 0,
  );
  addPayloadCompression(
    stats,
    record.densityCodec,
    record.densityPayload?.byteLength ?? record.densitySamples?.byteLength ?? 0,
    record.densityRawBytes ?? record.densitySamples?.byteLength ?? 0,
  );
  addPayloadCompression(
    stats,
    record.vegetationCodec,
    record.vegetationPayload?.byteLength ?? record.vegetation?.byteLength ?? 0,
    record.vegetationRawBytes ?? record.vegetation?.byteLength ?? 0,
  );
  return stats;
}

function recordsCompression(records: RegionChunkRecord[]): PayloadCompressionStats {
  const stats = createPayloadCompressionStats();
  for (const record of records) recordCompression(record, stats);
  return stats;
}

function payloadMetric(codec: string | undefined, encodedBytes: number, rawBytes: number): RegionPayloadMetric {
  const safeRawBytes = Math.max(0, rawBytes);
  const safeEncodedBytes = Math.max(0, encodedBytes);
  return {
    codec: codec ?? 'raw',
    rawBytes: safeRawBytes,
    encodedBytes: safeEncodedBytes,
    savedBytes: Math.max(0, safeRawBytes - safeEncodedBytes),
    ratio: safeRawBytes > 0 ? safeEncodedBytes / safeRawBytes : 1,
  };
}

function chunkPayloadInfo(record: RegionChunkRecord): RegionChunkPayloadInfo {
  const vertices = payloadMetric(
    record.verticesCodec,
    record.verticesPayload?.byteLength ?? record.vertices?.byteLength ?? 0,
    record.verticesRawBytes ?? record.vertices?.byteLength ?? 0,
  );
  const indices = payloadMetric(
    record.indicesCodec,
    record.indicesPayload?.byteLength ?? record.indices?.byteLength ?? 0,
    record.indicesRawBytes ?? record.indices?.byteLength ?? 0,
  );
  const density = payloadMetric(
    record.densityCodec,
    record.densityPayload?.byteLength ?? record.densitySamples?.byteLength ?? 0,
    record.densityRawBytes ?? record.densitySamples?.byteLength ?? 0,
  );
  const vegetation = payloadMetric(
    record.vegetationCodec,
    record.vegetationPayload?.byteLength ?? record.vegetation?.byteLength ?? 0,
    record.vegetationRawBytes ?? record.vegetation?.byteLength ?? 0,
  );
  const rawBytes = vertices.rawBytes + indices.rawBytes + density.rawBytes + vegetation.rawBytes;
  const encodedBytes = vertices.encodedBytes + indices.encodedBytes + density.encodedBytes + vegetation.encodedBytes;
  return {
    key: record.chunkKey,
    cx: record.cx,
    cy: record.cy,
    cz: record.cz,
    lod: record.lod,
    rawBytes,
    encodedBytes,
    savedBytes: Math.max(0, rawBytes - encodedBytes),
    vertices,
    indices,
    density,
    vegetation,
  };
}

function legacyChunkPayloadInfo(chunk: PersistedChunkMesh): RegionChunkPayloadInfo {
  const record: RegionChunkRecord = {
    ...chunk,
    storageKey: chunkStorageKey(REGION_KEY, chunk.key),
    regionKey: REGION_KEY,
    chunkKey: chunk.key,
  };
  return chunkPayloadInfo(record);
}

function hashBytes(view: ArrayBufferView): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `0x${hash.toString(16).padStart(8, '0')}`;
}

function payloadHashMetric(
  label: string,
  codec: string | undefined,
  encoded: Uint8Array,
  rawBytes: number,
  decode: () => ArrayBufferView,
): RegionPayloadHashMetric {
  const base = payloadMetric(codec, encoded.byteLength, rawBytes);
  try {
    const decoded = decode();
    return {
      ...base,
      encodedHash: hashBytes(encoded),
      decodedHash: hashBytes(decoded),
      decodedBytes: decoded.byteLength,
      elementCount: 'length' in decoded ? Number(decoded.length) : decoded.byteLength,
      valid: true,
    };
  } catch (error) {
    return {
      ...base,
      encodedHash: hashBytes(encoded),
      decodedHash: '',
      decodedBytes: 0,
      elementCount: 0,
      valid: false,
      error: `${label}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function chunkPayloadHashAudit(record: RegionChunkRecord): RegionChunkPayloadHashAudit {
  const verticesBytes = record.verticesPayload ?? (record.vertices ? new Uint8Array(record.vertices.buffer, record.vertices.byteOffset, record.vertices.byteLength) : new Uint8Array());
  const indicesBytes = record.indicesPayload ?? (record.indices ? new Uint8Array(record.indices.buffer, record.indices.byteOffset, record.indices.byteLength) : new Uint8Array());
  const densityBytes = record.densityPayload ?? (record.densitySamples ? new Uint8Array(record.densitySamples.buffer, record.densitySamples.byteOffset, record.densitySamples.byteLength) : new Uint8Array());
  const vegetationBytes = record.vegetationPayload ?? (record.vegetation ? new Uint8Array(record.vegetation.buffer, record.vegetation.byteOffset, record.vegetation.byteLength) : new Uint8Array());
  const vertices = payloadHashMetric(
    'vertices',
    record.verticesCodec,
    verticesBytes,
    record.verticesRawBytes ?? record.vertices?.byteLength ?? verticesBytes.byteLength,
    () => record.verticesPayload ? decodeBytePayload(record.verticesCodec, record.verticesPayload, record.verticesRawBytes) : record.vertices ?? new Uint8Array(),
  );
  const indices = payloadHashMetric(
    'indices',
    record.indicesCodec,
    indicesBytes,
    record.indicesRawBytes ?? record.indices?.byteLength ?? indicesBytes.byteLength,
    () => record.indicesPayload ? typedUint32(decodeBytePayload(record.indicesCodec, record.indicesPayload, record.indicesRawBytes), `${record.chunkKey} indices`) : record.indices ?? new Uint32Array(),
  );
  const density = payloadHashMetric(
    'density',
    record.densityCodec,
    densityBytes,
    record.densityRawBytes ?? record.densitySamples?.byteLength ?? densityBytes.byteLength,
    () => record.densityPayload ? decodeDensitySamples(record.densityCodec, record.densityPayload, record.densitySampleCount) : record.densitySamples ?? new Int16Array(),
  );
  const vegetation = payloadHashMetric(
    'vegetation',
    record.vegetationCodec,
    vegetationBytes,
    record.vegetationRawBytes ?? record.vegetation?.byteLength ?? vegetationBytes.byteLength,
    () => record.vegetationPayload ? typedFloat32(decodeBytePayload(record.vegetationCodec, record.vegetationPayload, record.vegetationRawBytes), `${record.chunkKey} vegetation`) : record.vegetation ?? new Float32Array(),
  );
  const failures = [vertices, indices, density, vegetation]
    .filter(metric => !metric.valid)
    .map(metric => metric.error ?? 'Unknown payload decode failure');
  return {
    key: record.chunkKey,
    cx: record.cx,
    cy: record.cy,
    cz: record.cz,
    lod: record.lod,
    encodedBytes: vertices.encodedBytes + indices.encodedBytes + density.encodedBytes + vegetation.encodedBytes,
    decodedBytes: vertices.decodedBytes + indices.decodedBytes + density.decodedBytes + vegetation.decodedBytes,
    vertices,
    indices,
    density,
    vegetation,
    failures,
  };
}

function legacyChunkPayloadHashAudit(chunk: PersistedChunkMesh): RegionChunkPayloadHashAudit {
  return chunkPayloadHashAudit({
    ...chunk,
    storageKey: chunkStorageKey(REGION_KEY, chunk.key),
    regionKey: REGION_KEY,
    chunkKey: chunk.key,
  });
}

function payloadAuditSummary(
  meta: RegionMeta,
  chunks: RegionChunkPayloadHashAudit[],
): RegionPayloadHashAudit {
  const failedChunks = chunks.filter(chunk => chunk.failures.length > 0);
  const failedPayloads = chunks.reduce((total, chunk) => total
    + Number(!chunk.vertices.valid)
    + Number(!chunk.indices.valid)
    + Number(!chunk.density.valid)
    + Number(!chunk.vegetation.valid), 0);
  return {
    key: meta.key,
    name: meta.name ?? meta.key,
    savedAt: meta.savedAt ?? 0,
    chunkCount: meta.chunkCount ?? chunks.length,
    editCount: meta.editLog?.length ?? 0,
    auditedAt: Date.now(),
    payloads: chunks.length * 4,
    failedPayloads,
    encodedBytes: chunks.reduce((total, chunk) => total + chunk.encodedBytes, 0),
    decodedBytes: chunks.reduce((total, chunk) => total + chunk.decodedBytes, 0),
    chunks,
    failedChunks,
    largestDecodedChunks: [...chunks].sort((a, b) => b.decodedBytes - a.decodedBytes).slice(0, 8),
  };
}

function persistedChunk(record: RegionChunkRecord): PersistedChunkMesh {
  const {
    storageKey: _storageKey,
    regionKey: _regionKey,
    chunkKey: _chunkKey,
    verticesPayload,
    verticesCodec,
    verticesRawBytes,
    vertices,
    indicesPayload,
    indicesCodec,
    indicesRawBytes,
    indices,
    densityPayload,
    densityCodec,
    densitySampleCount,
    densityRawBytes: _densityRawBytes,
    densitySamples,
    vegetationPayload,
    vegetationCodec,
    vegetationRawBytes,
    vegetation,
    ...chunk
  } = record;
  return {
    ...chunk,
    vertices: verticesPayload ? decodeBytePayload(verticesCodec, verticesPayload, verticesRawBytes, sharedTypedArrayPool) : vertices ?? new Uint8Array(),
    indices: indicesPayload ? typedUint32(decodeBytePayload(indicesCodec, indicesPayload, indicesRawBytes, sharedTypedArrayPool), `${record.chunkKey} indices`) : indices ?? new Uint32Array(),
    densitySamples: densityPayload
      ? decodeDensitySamples(densityCodec, densityPayload, densitySampleCount, sharedTypedArrayPool)
      : densitySamples ?? new Int16Array(),
    vegetation: vegetationPayload ? typedFloat32(decodeBytePayload(vegetationCodec, vegetationPayload, vegetationRawBytes, sharedTypedArrayPool), `${record.chunkKey} vegetation`) : vegetation ?? new Float32Array(),
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

function deleteRegionChunks(store: IDBObjectStore, regionKey: string): Promise<void> {
  const index = store.index('regionKey');
  const request = index.openKeyCursor(IDBKeyRange.only(regionKey));
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error('Failed to scan region chunks'));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
  });
}

async function getRegionChunkRecords(db: IDBDatabase, regionKey: string): Promise<RegionChunkRecord[]> {
  const transaction = db.transaction(REGION_CHUNKS_STORE, 'readonly');
  const records = await requestToPromise<RegionChunkRecord[]>(
    transaction.objectStore(REGION_CHUNKS_STORE).index('regionKey').getAll(regionKey),
  );
  await transactionDone(transaction);
  return records;
}

async function clearRegionChunks(db: IDBDatabase, regionKey: string): Promise<void> {
  const transaction = db.transaction(REGION_CHUNKS_STORE, 'readwrite');
  await deleteRegionChunks(transaction.objectStore(REGION_CHUNKS_STORE), regionKey);
  await transactionDone(transaction);
}

export class RegionStore {
  async save(snapshot: Omit<RegionSnapshot, 'savedAt'>, regionKey = REGION_KEY, name = regionKey): Promise<RegionSnapshot> {
    const savedAt = Date.now();
    const db = await openRegionDb();
    try {
      await clearRegionChunks(db, regionKey);
      const records = snapshot.chunks.map(chunk => chunkRecord(regionKey, chunk));
      const compression = recordsCompression(records);
      const transaction = db.transaction([REGION_CHUNKS_STORE, META_STORE], 'readwrite');
      const chunks = transaction.objectStore(REGION_CHUNKS_STORE);
      const meta = transaction.objectStore(META_STORE);
      for (const record of records) chunks.put(record);
      meta.put({
        key: regionKey,
        name,
        editLog: snapshot.editLog,
        undoneEdits: snapshot.undoneEdits ?? [],
        editBranches: snapshot.editBranches ?? [],
        editVersion: snapshot.editVersion,
        nextEditId: snapshot.nextEditId,
        nextEditBranchId: snapshot.nextEditBranchId ?? 1,
        gameProgress: snapshot.gameProgress,
        savedAt,
        chunkCount: snapshot.chunks.length,
        compression,
      } satisfies RegionMeta);
      await transactionDone(transaction);
      return { ...snapshot, savedAt, compression };
    } finally {
      db.close();
    }
  }

  async load(regionKey = REGION_KEY): Promise<RegionSnapshot | null> {
    const db = await openRegionDb();
    try {
      const metaTransaction = db.transaction(META_STORE, 'readonly');
      const meta = await requestToPromise<RegionMeta | undefined>(metaTransaction.objectStore(META_STORE).get(regionKey));
      await transactionDone(metaTransaction);
      if (!meta) return null;

      let records = await getRegionChunkRecords(db, regionKey);
      let compression = recordsCompression(records);
      let chunks = records.map(persistedChunk);
      if (chunks.length === 0 && regionKey === REGION_KEY && db.objectStoreNames.contains(LEGACY_CHUNKS_STORE)) {
        const legacyTransaction = db.transaction(LEGACY_CHUNKS_STORE, 'readonly');
        chunks = await requestToPromise<PersistedChunkMesh[]>(legacyTransaction.objectStore(LEGACY_CHUNKS_STORE).getAll());
        await transactionDone(legacyTransaction);
        compression = meta.compression ?? createPayloadCompressionStats();
      }

      return {
        editLog: meta.editLog ?? [],
        undoneEdits: meta.undoneEdits ?? [],
        editBranches: meta.editBranches ?? [],
        editVersion: meta.editVersion ?? 0,
        nextEditId: meta.nextEditId ?? 1,
        nextEditBranchId: meta.nextEditBranchId ?? 1,
        gameProgress: meta.gameProgress,
        savedAt: meta.savedAt ?? 0,
        chunks,
        compression,
      };
    } finally {
      db.close();
    }
  }

  async list(): Promise<RegionSlotInfo[]> {
    const db = await openRegionDb();
    try {
      const transaction = db.transaction(META_STORE, 'readonly');
      const metas = await requestToPromise<RegionMeta[]>(transaction.objectStore(META_STORE).getAll());
      await transactionDone(transaction);
      return metas.map(meta => ({
        key: meta.key,
        name: meta.name ?? meta.key,
        savedAt: meta.savedAt ?? 0,
        chunkCount: meta.chunkCount ?? 0,
        editCount: meta.editLog?.length ?? 0,
        compressionRatio: meta.compression?.ratio ?? 1,
        compressionRawBytes: meta.compression?.rawBytes ?? 0,
        compressionEncodedBytes: meta.compression?.encodedBytes ?? 0,
        compressionPayloads: meta.compression?.payloads ?? 0,
        compressionRawPayloads: meta.compression?.rawPayloads ?? 0,
        compressionLzssPayloads: meta.compression?.lzssPayloads ?? 0,
        compressionDeltaPayloads: meta.compression?.deltaVarintPayloads ?? 0,
      })).sort((a, b) => a.name.localeCompare(b.name));
    } finally {
      db.close();
    }
  }

  async inspect(regionKey = REGION_KEY): Promise<RegionPayloadInspection | null> {
    const db = await openRegionDb();
    try {
      const metaTransaction = db.transaction(META_STORE, 'readonly');
      const meta = await requestToPromise<RegionMeta | undefined>(metaTransaction.objectStore(META_STORE).get(regionKey));
      await transactionDone(metaTransaction);
      if (!meta) return null;

      const records = await getRegionChunkRecords(db, regionKey);
      let compression = recordsCompression(records);
      let chunks = records.map(chunkPayloadInfo);
      if (chunks.length === 0 && regionKey === REGION_KEY && db.objectStoreNames.contains(LEGACY_CHUNKS_STORE)) {
        const legacyTransaction = db.transaction(LEGACY_CHUNKS_STORE, 'readonly');
        const legacyChunks = await requestToPromise<PersistedChunkMesh[]>(legacyTransaction.objectStore(LEGACY_CHUNKS_STORE).getAll());
        await transactionDone(legacyTransaction);
        chunks = legacyChunks.map(legacyChunkPayloadInfo);
        compression = meta.compression ?? createPayloadCompressionStats();
      }
      const largestChunks = [...chunks].sort((a, b) => b.encodedBytes - a.encodedBytes).slice(0, 6);
      return {
        key: meta.key,
        name: meta.name ?? meta.key,
        savedAt: meta.savedAt ?? 0,
        chunkCount: meta.chunkCount ?? chunks.length,
        editCount: meta.editLog?.length ?? 0,
        compression,
        chunks,
        largestChunks,
      };
    } finally {
      db.close();
    }
  }

  async verifyPayloadHashes(regionKey = REGION_KEY): Promise<RegionPayloadHashAudit | null> {
    const db = await openRegionDb();
    try {
      const metaTransaction = db.transaction(META_STORE, 'readonly');
      const meta = await requestToPromise<RegionMeta | undefined>(metaTransaction.objectStore(META_STORE).get(regionKey));
      await transactionDone(metaTransaction);
      if (!meta) return null;

      const records = await getRegionChunkRecords(db, regionKey);
      let chunks = records.map(chunkPayloadHashAudit);
      if (chunks.length === 0 && regionKey === REGION_KEY && db.objectStoreNames.contains(LEGACY_CHUNKS_STORE)) {
        const legacyTransaction = db.transaction(LEGACY_CHUNKS_STORE, 'readonly');
        const legacyChunks = await requestToPromise<PersistedChunkMesh[]>(legacyTransaction.objectStore(LEGACY_CHUNKS_STORE).getAll());
        await transactionDone(legacyTransaction);
        chunks = legacyChunks.map(legacyChunkPayloadHashAudit);
      }
      return payloadAuditSummary(meta, chunks);
    } finally {
      db.close();
    }
  }

  async clear(regionKey = REGION_KEY): Promise<void> {
    const db = await openRegionDb();
    try {
      await clearRegionChunks(db, regionKey);
      const transaction = db.transaction(META_STORE, 'readwrite');
      transaction.objectStore(META_STORE).delete(regionKey);
      await transactionDone(transaction);
    } finally {
      db.close();
    }
  }

  async rename(regionKey = REGION_KEY, name = regionKey): Promise<void> {
    const db = await openRegionDb();
    try {
      const transaction = db.transaction(META_STORE, 'readwrite');
      const store = transaction.objectStore(META_STORE);
      const meta = await requestToPromise<RegionMeta | undefined>(store.get(regionKey));
      if (meta) store.put({ ...meta, name });
      await transactionDone(transaction);
    } finally {
      db.close();
    }
  }
}
