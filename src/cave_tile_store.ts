import {
  CAVE_GRAPH_TILE_GENERATOR_VERSION,
  CAVE_GRAPH_TILE_SCHEMA_VERSION,
  CAVE_GRAPH_TILE_SIZE,
  type CaveGraphTilePersistenceLoadResult,
  type CaveGraphTilePersistenceProvider,
  type CaveGraphTilePersistenceSaveResult,
  type SerializedCaveGraphTile,
} from './cave_tiles.ts';

const DB_NAME = 'storm-canyon-cave-graph-tile-store';
const DB_VERSION = 1;
const TILE_STORE = 'tiles';
export const CAVE_GRAPH_TILE_STORE_MAX_RECORDS = 512;

interface CaveGraphTileRecord extends SerializedCaveGraphTile {
  schemaVersion: number;
  generatorVersion: number;
  tileSize: number;
  savedAt: number;
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

async function openCaveGraphTileDb(): Promise<IDBDatabase | null> {
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

function cloneTile(tile: SerializedCaveGraphTile): SerializedCaveGraphTile {
  return {
    key: tile.key,
    tileX: tile.tileX,
    tileZ: tile.tileZ,
    originX: tile.originX,
    originZ: tile.originZ,
    passages: tile.passages.map(passage => ({
      ...passage,
      start: [passage.start[0], passage.start[1], passage.start[2]],
      end: [passage.end[0], passage.end[1], passage.end[2]],
      center: [passage.center[0], passage.center[1], passage.center[2]],
    })),
    chambers: tile.chambers.map(chamber => ({
      ...chamber,
      center: [chamber.center[0], chamber.center[1], chamber.center[2]],
    })),
  };
}

function validRecord(record: CaveGraphTileRecord | undefined, key: string, tileX: number, tileZ: number): record is CaveGraphTileRecord {
  if (!record) return false;
  return record.key === key
    && record.tileX === tileX
    && record.tileZ === tileZ
    && record.originX === tileX * CAVE_GRAPH_TILE_SIZE
    && record.originZ === tileZ * CAVE_GRAPH_TILE_SIZE
    && record.schemaVersion === CAVE_GRAPH_TILE_SCHEMA_VERSION
    && record.generatorVersion === CAVE_GRAPH_TILE_GENERATOR_VERSION
    && record.tileSize === CAVE_GRAPH_TILE_SIZE
    && Array.isArray(record.passages)
    && Array.isArray(record.chambers);
}

function toRecord(tile: SerializedCaveGraphTile): CaveGraphTileRecord {
  return {
    ...cloneTile(tile),
    schemaVersion: CAVE_GRAPH_TILE_SCHEMA_VERSION,
    generatorVersion: CAVE_GRAPH_TILE_GENERATOR_VERSION,
    tileSize: CAVE_GRAPH_TILE_SIZE,
    savedAt: Date.now(),
  };
}

export class CaveGraphTileIndexedDbStore implements CaveGraphTilePersistenceProvider {
  async loadTile(key: string, tileX: number, tileZ: number): Promise<CaveGraphTilePersistenceLoadResult> {
    const db = await openCaveGraphTileDb();
    if (!db) return { tile: null };
    try {
      const transaction = db.transaction(TILE_STORE, 'readonly');
      const record = await requestToPromise<CaveGraphTileRecord | undefined>(transaction.objectStore(TILE_STORE).get(key));
      await transactionDone(transaction);
      if (!record) return { tile: null };
      if (validRecord(record, key, tileX, tileZ)) return { tile: cloneTile(record) };
    } finally {
      db.close();
    }
    await this.deleteTile(key);
    return { tile: null, invalidated: true };
  }

  async saveTile(tile: SerializedCaveGraphTile): Promise<CaveGraphTilePersistenceSaveResult> {
    const db = await openCaveGraphTileDb();
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
    const db = await openCaveGraphTileDb();
    if (!db) return;
    try {
      const transaction = db.transaction(TILE_STORE, 'readwrite');
      transaction.objectStore(TILE_STORE).delete(key);
      await transactionDone(transaction);
    } finally {
      db.close();
    }
  }

  private async pruneOldTiles(db: IDBDatabase): Promise<CaveGraphTilePersistenceSaveResult> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TILE_STORE, 'readwrite');
      const store = transaction.objectStore(TILE_STORE);
      let total = 0;
      let pruned = 0;
      transaction.oncomplete = () => resolve({ pruned, records: Math.max(0, total - pruned) });
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
      const count = store.count();
      count.onerror = () => reject(count.error ?? new Error('Failed to count cave graph tile records'));
      count.onsuccess = () => {
        total = count.result;
        const excess = Math.max(0, total - CAVE_GRAPH_TILE_STORE_MAX_RECORDS);
        if (excess <= 0) return;
        const cursorRequest = store.index('savedAt').openKeyCursor();
        cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error('Failed to prune cave graph tile records'));
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
