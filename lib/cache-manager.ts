import { STORAGE_KEYS } from './constants';
import type { CachedTopic } from './types';

function cacheKey(url: string): string {
  return `${STORAGE_KEYS.CACHE_PREFIX}${normalizeUrl(url)}`;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.pathname = u.pathname.replace(/\/page-\d+$/, '');
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

export async function getCachedTopic(url: string): Promise<CachedTopic | null> {
  const key = cacheKey(url);
  const result = await browser.storage.local.get(key);
  return (result[key] as CachedTopic) || null;
}

export async function saveCachedTopic(topic: CachedTopic): Promise<void> {
  const key = cacheKey(topic.url);

  // Check storage quota before saving
  const usage = await getCacheSize();
  const MAX_CACHE_BYTES = 8 * 1024 * 1024; // 8MB soft limit (of 10MB total)
  if (usage > MAX_CACHE_BYTES) {
    await evictOldest();
  }

  await browser.storage.local.set({ [key]: topic });
}

export async function deleteCachedTopic(url: string): Promise<void> {
  const key = cacheKey(url);
  await browser.storage.local.remove(key);
}

export async function getAllCachedTopics(): Promise<CachedTopic[]> {
  const all = await browser.storage.local.get(null);
  const topics: CachedTopic[] = [];
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(STORAGE_KEYS.CACHE_PREFIX) && value && typeof value === 'object' && 'summary' in value) {
      topics.push(value as CachedTopic);
    }
  }
  return topics;
}

export async function getCacheSize(): Promise<number> {
  const all = await browser.storage.local.get(null);
  let size = 0;
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(STORAGE_KEYS.CACHE_PREFIX)) {
      size += JSON.stringify(value).length * 2; // rough byte estimate (UTF-16)
    }
  }
  return size;
}

async function evictOldest(): Promise<void> {
  const topics = await getAllCachedTopics();
  if (topics.length === 0) return;

  // Sort by cachedAt ascending (oldest first)
  topics.sort((a, b) => a.cachedAt - b.cachedAt);

  // Remove the oldest
  await deleteCachedTopic(topics[0].url);
}
