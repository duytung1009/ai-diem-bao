import type { CachedTopic } from './types';

const DB_NAME = 'loi-thot-ho-cache';
const DB_VERSION = 3;
const STORE_NAME = 'topics';
const NOTEBOOK_STORE_NAME = 'notebookEntries';

let db: IDBDatabase | null = null;
let openingPromise: Promise<IDBDatabase> | null = null;

export function getDB(): Promise<IDBDatabase> {
  if (db) return Promise.resolve(db);
  if (openingPromise) return openingPromise;
  openingPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const database = request.result;
      const oldVersion = event.oldVersion;
      if (oldVersion < 1) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'url' });
        store.createIndex('by-cachedAt', 'cachedAt', { unique: false });
      }
      if (oldVersion < 2) {
        const store = request.transaction!.objectStore(STORE_NAME);
        if (!store.indexNames.contains('by-bookmarked')) {
          store.createIndex('by-bookmarked', 'bookmarked', { unique: false });
        }
      }
      if (oldVersion < 3) {
        const store = database.createObjectStore(NOTEBOOK_STORE_NAME, { keyPath: 'id' });
        store.createIndex('by-topicUrl', 'sourceTopicUrl', { unique: false, multiEntry: false });
        store.createIndex('by-savedAt', 'savedAt', { unique: false, multiEntry: false });
        store.createIndex('by-category', 'category', { unique: false, multiEntry: false });
        store.createIndex('by-tags', 'tags', { unique: false, multiEntry: true });
        store.createIndex('by-orphaned', 'orphaned', { unique: false, multiEntry: false });
      }
    };
    request.onsuccess = () => {
      db = request.result;
      openingPromise = null;
      db.onclose = () => { db = null; };
      db.onversionchange = () => { db!.close(); db = null; };
      resolve(db);
    };
    request.onerror = () => {
      openingPromise = null;
      reject(request.error);
    };
  });
  return openingPromise;
}

export async function dbGet(url: string): Promise<CachedTopic | null> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(url);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function dbPut(topic: CachedTopic): Promise<void> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(topic);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbDelete(url: string): Promise<void> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(url);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbGetAll(): Promise<CachedTopic[]> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error);
  });
}

export async function dbClear(): Promise<void> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
