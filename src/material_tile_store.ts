import {
  MATERIAL_TILE_FIELD_NAMES,
  MATERIAL_TILE_GENERATOR_VERSION,
  MATERIAL_TILE_RESOLUTION,
  MATERIAL_TILE_SCHEMA_VERSION,
  MATERIAL_TILE_SIZE,
  type MaterialTilePersistenceLoadResult,
  type MaterialTilePersistenceProvider,
  type MaterialTilePersistenceSaveResult,
  type SerializedMaterialTile,
} from './material_tiles.ts';

const DB_NAME = 'storm-canyon-material-tile-store';
const DB_VERSION = 1;
const TILE_STORE = 'tiles';
export const MATERIAL_TILE_STORE_MAX_RECORDS = 512;

interface MaterialTileRecord {
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
  dominantMaterialIds: Uint8Array;
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

async function openMaterialTileDb(): Promise<IDBDatabase | null> {
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

function validRecord(record: MaterialTileRecord | undefined, key: string, tileX: number, tileZ: number): record is MaterialTileRecord {
  if (!record) return false;
  const expectedSamples = MATERIAL_TILE_RESOLUTION * MATERIAL_TILE_RESOLUTION;
  const expectedFields = expectedSamples * MATERIAL_TILE_FIELD_NAMES.length;
  return record.key === key
    && record.tileX === tileX
    && record.tileZ === tileZ
    && record.originX === tileX * MATERIAL_TILE_SIZE
    && record.originZ === tileZ * MATERIAL_TILE_SIZE
    && record.schemaVersion === MATERIAL_TILE_SCHEMA_VERSION
    && record.generatorVersion === MATERIAL_TILE_GENERATOR_VERSION
    && record.tileSize === MATERIAL_TILE_SIZE
    && record.resolution === MATERIAL_TILE_RESOLUTION
    && record.fieldCount === MATERIAL_TILE_FIELD_NAMES.length
    && record.fields?.length === expectedFields
    && record.dominantMaterialIds?.length === expectedSamples;
}

function toRecord(tile: SerializedMaterialTile): MaterialTileRecord {
  return {
    key: tile.key,
    tileX: tile.tileX,
    tileZ: tile.tileZ,
    originX: tile.originX,
    originZ: tile.originZ,
    schemaVersion: MATERIAL_TILE_SCHEMA_VERSION,
    generatorVersion: MATERIAL_TILE_GENERATOR_VERSION,
    tileSize: MATERIAL_TILE_SIZE,
    resolution: MATERIAL_TILE_RESOLUTION,
    fieldCount: MATERIAL_TILE_FIELD_NAMES.length,
    fieldNames: MATERIAL_TILE_FIELD_NAMES,
    savedAt: Date.now(),
    source: 'native',
    fields: Float32Array.from(tile.fields),
    dominantMaterialIds: Uint8Array.from(tile.dominantMaterialIds),
  };
}

function toTile(record: MaterialTileRecord): SerializedMaterialTile {
  return {
    key: record.key,
    tileX: record.tileX,
    tileZ: record.tileZ,
    originX: record.originX,
    originZ: record.originZ,
    fields: Array.from(record.fields),
    dominantMaterialIds: Array.from(record.dominantMaterialIds),
  };
}

export class MaterialTileIndexedDbStore implements MaterialTilePersistenceProvider {
  async loadTile(key: string, tileX: number, tileZ: number): Promise<MaterialTilePersistenceLoadResult> {
    const db = await openMaterialTileDb();
    if (!db) return { tile: null };
    let records = 0;
    try {
      const transaction = db.transaction(TILE_STORE, 'readonly');
      const store = transaction.objectStore(TILE_STORE);
      const recordPromise = requestToPromise<MaterialTileRecord | undefined>(store.get(key));
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

  async saveTile(tile: SerializedMaterialTile): Promise<MaterialTilePersistenceSaveResult> {
    const db = await openMaterialTileDb();
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
    const db = await openMaterialTileDb();
    if (!db) return;
    try {
      const transaction = db.transaction(TILE_STORE, 'readwrite');
      transaction.objectStore(TILE_STORE).delete(key);
      await transactionDone(transaction);
    } finally {
      db.close();
    }
  }

  private async pruneOldTiles(db: IDBDatabase): Promise<MaterialTilePersistenceSaveResult> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TILE_STORE, 'readwrite');
      const store = transaction.objectStore(TILE_STORE);
      let total = 0;
      let pruned = 0;
      transaction.oncomplete = () => resolve({ pruned, records: Math.max(0, total - pruned) });
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
      const count = store.count();
      count.onerror = () => reject(count.error ?? new Error('Failed to count material tile records'));
      count.onsuccess = () => {
        total = count.result;
        const excess = Math.max(0, total - MATERIAL_TILE_STORE_MAX_RECORDS);
        if (excess <= 0) return;
        const cursorRequest = store.index('savedAt').openKeyCursor();
        cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error('Failed to prune material tile records'));
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
