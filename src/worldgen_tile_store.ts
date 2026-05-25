import {
  WORLDGEN_TILE_FIELD_NAMES,
  WORLDGEN_TILE_GENERATOR_VERSION,
  WORLDGEN_TILE_RESOLUTION,
  WORLDGEN_TILE_SCHEMA_VERSION,
  WORLDGEN_TILE_SIZE,
  type SerializedWorldgenTile,
  type WorldgenTilePersistenceLoadResult,
  type WorldgenTilePersistenceProvider,
  type WorldgenTilePersistenceSaveResult,
} from './worldgen_tiles.ts';

const DB_NAME = 'storm-canyon-worldgen-tile-store';
const DB_VERSION = 1;
const TILE_STORE = 'tiles';
export const WORLDGEN_TILE_STORE_MAX_RECORDS = 512;

interface WorldgenTileRecord {
  key: string;
  tileX: number;
  tileZ: number;
  originX: number;
  originZ: number;
  schemaVersion: number;
  generatorVersion: number;
  tileSize: number;
  resolution: number;
  fieldCount: number;
  fieldNames: readonly string[];
  savedAt: number;
  source: 'native';
  fields: Float32Array;
  biomeIds: Uint8Array;
  waterIds: Uint8Array;
  riverNetworkIds: Uint16Array;
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

function indexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

async function openWorldgenTileDb(): Promise<IDBDatabase | null> {
  if (!indexedDbAvailable()) return null;
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(TILE_STORE)) {
      const tiles = db.createObjectStore(TILE_STORE, { keyPath: 'key' });
      tiles.createIndex('savedAt', 'savedAt', { unique: false });
    }
  };
  return requestToPromise(request);
}

function validRecord(record: WorldgenTileRecord | undefined, key: string, tileX: number, tileZ: number): record is WorldgenTileRecord {
  if (!record) return false;
  const expectedSamples = WORLDGEN_TILE_RESOLUTION * WORLDGEN_TILE_RESOLUTION;
  const expectedFields = expectedSamples * WORLDGEN_TILE_FIELD_NAMES.length;
  return record.key === key
    && record.tileX === tileX
    && record.tileZ === tileZ
    && record.schemaVersion === WORLDGEN_TILE_SCHEMA_VERSION
    && record.generatorVersion === WORLDGEN_TILE_GENERATOR_VERSION
    && record.tileSize === WORLDGEN_TILE_SIZE
    && record.resolution === WORLDGEN_TILE_RESOLUTION
    && record.fieldCount === WORLDGEN_TILE_FIELD_NAMES.length
    && record.fields?.length === expectedFields
    && record.biomeIds?.length === expectedSamples
    && record.waterIds?.length === expectedSamples
    && record.riverNetworkIds?.length === expectedSamples;
}

function toRecord(tile: SerializedWorldgenTile): WorldgenTileRecord {
  return {
    key: tile.key,
    tileX: tile.tileX,
    tileZ: tile.tileZ,
    originX: tile.originX,
    originZ: tile.originZ,
    schemaVersion: WORLDGEN_TILE_SCHEMA_VERSION,
    generatorVersion: WORLDGEN_TILE_GENERATOR_VERSION,
    tileSize: WORLDGEN_TILE_SIZE,
    resolution: WORLDGEN_TILE_RESOLUTION,
    fieldCount: WORLDGEN_TILE_FIELD_NAMES.length,
    fieldNames: WORLDGEN_TILE_FIELD_NAMES,
    savedAt: Date.now(),
    source: 'native',
    fields: Float32Array.from(tile.fields),
    biomeIds: Uint8Array.from(tile.biomeIds),
    waterIds: Uint8Array.from(tile.waterIds),
    riverNetworkIds: Uint16Array.from(tile.riverNetworkIds),
  };
}

function toTile(record: WorldgenTileRecord): SerializedWorldgenTile {
  return {
    key: record.key,
    tileX: record.tileX,
    tileZ: record.tileZ,
    originX: record.originX,
    originZ: record.originZ,
    fields: Array.from(record.fields),
    biomeIds: Array.from(record.biomeIds),
    waterIds: Array.from(record.waterIds),
    riverNetworkIds: Array.from(record.riverNetworkIds),
  };
}

export class WorldgenTileIndexedDbStore implements WorldgenTilePersistenceProvider {
  async loadTile(key: string, tileX: number, tileZ: number): Promise<WorldgenTilePersistenceLoadResult> {
    const db = await openWorldgenTileDb();
    if (!db) return { tile: null };
    try {
      const transaction = db.transaction(TILE_STORE, 'readonly');
      const record = await requestToPromise<WorldgenTileRecord | undefined>(transaction.objectStore(TILE_STORE).get(key));
      await transactionDone(transaction);
      if (!record) return { tile: null };
      if (validRecord(record, key, tileX, tileZ)) return { tile: toTile(record) };
    } finally {
      db.close();
    }
    await this.deleteTile(key);
    return { tile: null, invalidated: true };
  }

  async saveTile(tile: SerializedWorldgenTile): Promise<WorldgenTilePersistenceSaveResult> {
    const db = await openWorldgenTileDb();
    if (!db) return {};
    try {
      const transaction = db.transaction(TILE_STORE, 'readwrite');
      transaction.objectStore(TILE_STORE).put(toRecord(tile));
      await transactionDone(transaction);
      return await this.pruneOldTiles(db);
    } finally {
      db.close();
    }
  }

  async deleteTile(key: string): Promise<void> {
    const db = await openWorldgenTileDb();
    if (!db) return;
    try {
      const transaction = db.transaction(TILE_STORE, 'readwrite');
      transaction.objectStore(TILE_STORE).delete(key);
      await transactionDone(transaction);
    } finally {
      db.close();
    }
  }

  private async pruneOldTiles(db: IDBDatabase): Promise<WorldgenTilePersistenceSaveResult> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TILE_STORE, 'readwrite');
      const store = transaction.objectStore(TILE_STORE);
      let total = 0;
      let pruned = 0;
      transaction.oncomplete = () => resolve({ pruned, records: Math.max(0, total - pruned) });
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
      const count = store.count();
      count.onerror = () => reject(count.error ?? new Error('Failed to count worldgen tile records'));
      count.onsuccess = () => {
        total = count.result;
        const excess = Math.max(0, total - WORLDGEN_TILE_STORE_MAX_RECORDS);
        if (excess <= 0) return;
        const cursorRequest = store.index('savedAt').openKeyCursor();
        cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error('Failed to prune worldgen tile records'));
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor || pruned >= excess) return;
          store.delete(cursor.primaryKey);
          pruned++;
          cursor.continue();
        };
      };
    });
  }
}
