import type { NotebookEntry } from './types';
import { getDB } from './cache-db';

const NOTEBOOK_STORE_NAME = 'notebookEntries';

export interface NotebookStats {
  totalEntries: number;
  topicCount: number;
  orphanCount: number;
  categories: string[];
}

function store(mode: IDBTransactionMode = 'readonly') {
  return getDB().then(db => {
    const tx = db.transaction(NOTEBOOK_STORE_NAME, mode);
    return { tx, store: tx.objectStore(NOTEBOOK_STORE_NAME) };
  });
}

export async function notebookGet(id: string): Promise<NotebookEntry | null> {
  const { store: s } = await store();
  return new Promise((resolve, reject) => {
    const req = s.get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function notebookGetAll(): Promise<NotebookEntry[]> {
  const { store: s } = await store();
  return new Promise((resolve, reject) => {
    const req = s.getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function notebookGetByTopic(topicUrl: string): Promise<NotebookEntry[]> {
  const { store: s } = await store();
  return new Promise((resolve, reject) => {
    const req = s.index('by-topicUrl').getAll(topicUrl);
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function notebookGetByTag(tag: string): Promise<NotebookEntry[]> {
  const { store: s } = await store();
  return new Promise((resolve, reject) => {
    const req = s.index('by-tags').getAll(IDBKeyRange.only(tag));
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function notebookGetByCategory(category: string): Promise<NotebookEntry[]> {
  const { store: s } = await store();
  return new Promise((resolve, reject) => {
    const req = s.index('by-category').getAll(category);
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function notebookGetOrphans(): Promise<NotebookEntry[]> {
  const { store: s } = await store();
  return new Promise((resolve, reject) => {
    const req = s.index('by-orphaned').getAll(1);
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function notebookPut(entry: NotebookEntry): Promise<void> {
  const { tx } = await store('readwrite');
  return new Promise((resolve, reject) => {
    tx.objectStore(NOTEBOOK_STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function notebookDelete(id: string): Promise<void> {
  const { tx } = await store('readwrite');
  return new Promise((resolve, reject) => {
    tx.objectStore(NOTEBOOK_STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function notebookOrphanByTopic(topicUrl: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(NOTEBOOK_STORE_NAME, 'readwrite');
    const index = tx.objectStore(NOTEBOOK_STORE_NAME).index('by-topicUrl');
    const req = index.openCursor(topicUrl);
    const now = Date.now();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      const entry = cursor.value;
      entry.orphaned = 1;
      entry.orphanedAt = now;
      cursor.update(entry);
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function notebookDeleteByTopic(topicUrl: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(NOTEBOOK_STORE_NAME, 'readwrite');
    const index = tx.objectStore(NOTEBOOK_STORE_NAME).index('by-topicUrl');
    const req = index.openCursor(topicUrl);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function notebookGetStats(): Promise<NotebookStats> {
  const all = await notebookGetAll();
  const topicSet = new Set<string>();
  let orphanCount = 0;
  const catSet = new Set<string>();
  for (const e of all) {
    if (e.sourceTopicUrl) topicSet.add(e.sourceTopicUrl);
    if (e.orphaned) orphanCount++;
    if (e.category) catSet.add(e.category);
  }
  return {
    totalEntries: all.length,
    topicCount: topicSet.size,
    orphanCount,
    categories: [...catSet].sort((a, b) => a.localeCompare(b, 'vi')),
  };
}
