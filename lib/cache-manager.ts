import { dbGet, dbPut, dbDelete, dbGetAll, dbGetAllKnowledge, dbUpsertKnowledge, dbDeleteKnowledge } from './cache-db';
import type { CachedTopic, GlobalKnowledgeEntry } from './types';

export function mergePartialTopic(
  partial: Partial<CachedTopic> & { url?: string },
  existing: CachedTopic | null,
  url: string,
  llmConfig: { provider: string; model: string },
): CachedTopic {
  return {
    url: normalizeUrl(url),
    title: partial.title ?? existing?.title ?? '',
    version: partial.version ?? existing?.version ?? 'unknown',
    posts: partial.posts ?? existing?.posts ?? [],
    summary: partial.summary ?? existing?.summary ?? '',
    opinions: partial.opinions ?? existing?.opinions,
    researchHistory: partial.researchHistory ?? existing?.researchHistory,
    llmConfig,
    cachedAt: Date.now(),
    lastPostNumber: partial.lastPostNumber ?? existing?.lastPostNumber ?? 0,
    forumPostCount: partial.forumPostCount ?? existing?.forumPostCount,
    totalPosts: Math.max(partial.totalPosts ?? 0, existing?.totalPosts ?? 0),
    summarizedPostCount: partial.summarizedPostCount ?? existing?.summarizedPostCount,
    totalPages: partial.totalPages ?? existing?.totalPages ?? 1,
    topicType: partial.topicType ?? existing?.topicType,
    segments: partial.segments ?? existing?.segments,
    overallSummary: partial.overallSummary ?? existing?.overallSummary,
    summaryJson: partial.summaryJson ?? existing?.summaryJson,
    bookmarked: partial.bookmarked ?? existing?.bookmarked,
    threadLocked: partial.threadLocked ?? existing?.threadLocked,
    threadDeleted: partial.threadDeleted ?? existing?.threadDeleted,
    knowledgeEntries: partial.knowledgeEntries ?? existing?.knowledgeEntries,
    knowledgeChunks: partial.knowledgeChunks !== undefined
      ? partial.knowledgeChunks
      : existing?.knowledgeChunks,
    lastKnowledgePostNumber: partial.lastKnowledgePostNumber !== undefined
      ? partial.lastKnowledgePostNumber
      : existing?.lastKnowledgePostNumber,
    excludedKnowledgePostNumbers: partial.excludedKnowledgePostNumbers !== undefined
      ? partial.excludedKnowledgePostNumbers
      : existing?.excludedKnowledgePostNumbers,
    threadAnalysis: partial.threadAnalysis !== undefined
      ? partial.threadAnalysis
      : existing?.threadAnalysis,
    userTrustScores: partial.userTrustScores !== undefined
      ? partial.userTrustScores
      : existing?.userTrustScores,
  };
}

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

export function isSameTopicUrl(url1: string | null, url2: string | null): boolean {
  if (!url1 || !url2) return false;
  try {
    return normalizeUrl(url1) === normalizeUrl(url2);
  } catch { return url1 === url2; }
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

export async function getAllKnowledge(): Promise<GlobalKnowledgeEntry[]> {
  return dbGetAllKnowledge();
}

export async function upsertKnowledgeEntry(entry: GlobalKnowledgeEntry): Promise<void> {
  await dbUpsertKnowledge(entry);
}

export async function deleteKnowledgeEntry(id: string): Promise<void> {
  await dbDeleteKnowledge(id);
}
