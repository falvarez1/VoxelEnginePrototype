import {
  EROSION_TILE_FIELD_NAMES,
  EROSION_TILE_GENERATOR_VERSION,
  EROSION_TILE_RESOLUTION,
  EROSION_TILE_SCHEMA_VERSION,
  EROSION_TILE_SIZE,
  type ErosionTilePersistenceLoadResult,
  type ErosionTilePersistenceProvider,
  type ErosionTilePersistenceSaveResult,
  type SerializedErosionTile,
} from './erosion_tiles.ts';

const DB_NAME = 'storm-canyon-erosion-tile-store';
const DB_VERSION = 1;
const TILE_STORE = 'tiles';
export const EROSION_TILE_STORE_MAX_RECORDS = 512;

interface ErosionTileRecord {
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

async function openErosionTileDb(): Promise<IDBDatabase | null> {
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

function validRecord(record: ErosionTileRecord | undefined, key: string, tileX: number, tileZ: number): record is ErosionTileRecord {
  if (!record) return false;
  const expectedFields = EROSION_TILE_RESOLUTION * EROSION_TILE_RESOLUTION * EROSION_TILE_FIELD_NAMES.length;
  return record.key === key
    && record.tileX === tileX
    && record.tileZ === tileZ
    && record.originX === tileX * EROSION_TILE_SIZE
    && record.originZ === tileZ * EROSION_TILE_SIZE
    && record.schemaVersion === EROSION_TILE_SCHEMA_VERSION
    && record.generatorVersion === EROSION_TILE_GENERATOR_VERSION
    && record.tileSize === EROSION_TILE_SIZE
    && record.resolution === EROSION_TILE_RESOLUTION
    && record.fieldCount === EROSION_TILE_FIELD_NAMES.length
    && record.fields?.length === expectedFields;
}

function toRecord(tile: SerializedErosionTile): ErosionTileRecord {
  return {
    key: tile.key,
    tileX: tile.tileX,
    tileZ: tile.tileZ,
    originX: tile.originX,
    originZ: tile.originZ,
    schemaVersion: EROSION_TILE_SCHEMA_VERSION,
    generatorVersion: EROSION_TILE_GENERATOR_VERSION,
    tileSize: EROSION_TILE_SIZE,
    resolution: EROSION_TILE_RESOLUTION,
    fieldCount: EROSION_TILE_FIELD_NAMES.length,
    fieldNames: EROSION_TILE_FIELD_NAMES,
    savedAt: Date.now(),
    source: 'native',
    fields: Float32Array.from(tile.fields),
  };
}

function toTile(record: ErosionTileRecord): SerializedErosionTile {
  return {
    key: record.key,
    tileX: record.tileX,
    tileZ: record.tileZ,
    originX: record.originX,
    originZ: record.originZ,
    fields: Array.from(record.fields),
  };
}

export class ErosionTileIndexedDbStore implements ErosionTilePersistenceProvider {
  async loadTile(key: string, tileX: number, tileZ: number): Promise<ErosionTilePersistenceLoadResult> {
    const db = await openErosionTileDb();
    if (!db) return { tile: null };
    let records = 0;
    try {
      const transaction = db.transaction(TILE_STORE, 'readonly');
      const store = transaction.objectStore(TILE_STORE);
      const recordPromise = requestToPromise<ErosionTileRecord | undefined>(store.get(key));
      const recordsPromise = requestToPromise<number>(store.count());
      const [record, recordCount] = await Promise.all([recordPromise, recordsPromise]);
      records = recordCount;
      await transactionDone(transaction);
      if (!record) return { tile: null, records };
      if (validRecord(record, key, tileX, tileZ)) return { tile: toTile(record), records };
    } finally {
      db.close();
    }
    await this.deleteTile(key);
    return { tile: null, invalidated: true, records: Math.max(0, records - 1) };
  }

  async saveTile(tile: SerializedErosionTile): Promise<ErosionTilePersistenceSaveResult> {
    const db = await openErosionTileDb();
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
    const db = await openErosionTileDb();
    if (!db) return;
    try {
      const transaction = db.transaction(TILE_STORE, 'readwrite');
      transaction.objectStore(TILE_STORE).delete(key);
      await transactionDone(transaction);
    } finally {
      db.close();
    }
  }

  private async pruneOldTiles(db: IDBDatabase): Promise<ErosionTilePersistenceSaveResult> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TILE_STORE, 'readwrite');
      const store = transaction.objectStore(TILE_STORE);
      let total = 0;
      let pruned = 0;
      transaction.oncomplete = () => resolve({ pruned, records: Math.max(0, total - pruned) });
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
      const count = store.count();
      count.onerror = () => reject(count.error ?? new Error('Failed to count erosion tile records'));
      count.onsuccess = () => {
        total = count.result;
        const excess = Math.max(0, total - EROSION_TILE_STORE_MAX_RECORDS);
        if (excess <= 0) return;
        const cursorRequest = store.index('savedAt').openKeyCursor();
        cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error('Failed to prune erosion tile records'));
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
