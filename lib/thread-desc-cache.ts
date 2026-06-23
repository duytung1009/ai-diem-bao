import { getDB, THREAD_DESC_STORE_NAME } from './cache-db';
import { normalizeUrl } from './cache-manager';

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface ThreadDescEntry {
  url: string;
  description: string;
  generatedAt: number;
}

export async function getThreadDescription(url: string): Promise<string | null> {
  try {
    const database = await getDB();
    const key = normalizeUrl(url);
    const entry = await new Promise<ThreadDescEntry | null>((resolve, reject) => {
      const tx = database.transaction(THREAD_DESC_STORE_NAME, 'readonly');
      const req = tx.objectStore(THREAD_DESC_STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    if (!entry) return null;
    if (Date.now() - entry.generatedAt > TTL_MS) return null;
    return entry.description;
  } catch {
    return null;
  }
}

export async function saveThreadDescription(url: string, description: string): Promise<void> {
  const database = await getDB();
  const key = normalizeUrl(url);
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(THREAD_DESC_STORE_NAME, 'readwrite');
    tx.objectStore(THREAD_DESC_STORE_NAME).put({ url: key, description, generatedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
