import { dbGet, dbPut, dbDelete, dbGetAll } from './cache-db';
import type { CachedTopic } from './types';

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.pathname = u.pathname.replace(/\/page-\d+\/?$/, '');
    if (!u.pathname.endsWith('/')) u.pathname += '/';
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

export async function getCachedTopic(url: string): Promise<CachedTopic | null> {
  return dbGet(normalizeUrl(url));
}

export async function saveCachedTopic(topic: CachedTopic): Promise<void> {
  await dbPut(topic);
}

export async function deleteCachedTopic(url: string): Promise<void> {
  await dbDelete(normalizeUrl(url));
}

export async function getAllCachedTopics(): Promise<CachedTopic[]> {
  return dbGetAll();
}

export async function getCacheSize(): Promise<number> {
  const all = await dbGetAll();
  let size = 0;
  for (const topic of all) {
    size += JSON.stringify(topic).length * 2; // rough byte estimate (UTF-16)
  }
  return size;
}
