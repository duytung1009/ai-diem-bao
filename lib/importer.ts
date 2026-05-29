import type { CacheExport, ExportedSegment, ExportedTopic } from './exporter';
import type { CachedTopic, NotebookEntry, ScrapedPost, TopicSegment } from './types';

export type ImportConflictMode = 'skip' | 'overwrite';

export interface ImportResult {
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePost(input: unknown): ScrapedPost | null {
  if (!isRecord(input)) return null;

  const author = typeof input.author === 'string' ? input.author : '';
  const content = typeof input.content === 'string' ? input.content : '';
  const timestamp = typeof input.timestamp === 'string' ? input.timestamp : '';
  const postNumber = Number(input.postNumber ?? 0);

  if (!Number.isFinite(postNumber) || postNumber <= 0) return null;

  const post: ScrapedPost = {
    author,
    content,
    timestamp,
    postNumber,
  };

  const page = Number(input.page);
  if (Number.isFinite(page) && page > 0) {
    post.page = page;
  }

  if (isRecord(input.userMeta)) {
    post.userMeta = {
      messageCount: typeof input.userMeta.messageCount === 'number' ? input.userMeta.messageCount : undefined,
      reactionScore: typeof input.userMeta.reactionScore === 'number' ? input.userMeta.reactionScore : undefined,
      joinDate: typeof input.userMeta.joinDate === 'string' ? input.userMeta.joinDate : undefined,
      userTitle: typeof input.userMeta.userTitle === 'string' ? input.userMeta.userTitle : undefined,
    };
  }

  return post;
}

function normalizePosts(input: unknown): ScrapedPost[] {
  if (!Array.isArray(input)) return [];
  return input.map(normalizePost).filter((post): post is ScrapedPost => Boolean(post));
}

function mapExportedSegment(segment: ExportedSegment): TopicSegment {
  return {
    startPage: Number.isFinite(segment.startPage) ? segment.startPage : 1,
    endPage: Number.isFinite(segment.endPage) ? segment.endPage : (Number.isFinite(segment.startPage) ? segment.startPage : 1),
    posts: normalizePosts(segment.posts),
    complete: typeof segment.complete === 'boolean' ? segment.complete : true,
    summary: segment.summary ?? '',
    summaryJson: segment.summaryJson,
    postCount: Number.isFinite(segment.postCount) ? segment.postCount : 0,
    summarizedAt: Number.isFinite(segment.summarizedAt) ? segment.summarizedAt : Date.now(),
  };
}

function normalizeTopic(input: unknown, index: number): ExportedTopic {
  if (!isRecord(input)) {
    throw new Error(`Topic #${index + 1}: du lieu khong hop le`);
  }

  const url = asNonEmptyString(input.url);
  const title = asNonEmptyString(input.title);
  if (!url || !title) {
    throw new Error(`Topic #${index + 1}: thieu url hoặc title`);
  }

  const segments = Array.isArray(input.segments) ? input.segments.filter(isRecord).map((s) => ({
    startPage: Number(s.startPage ?? 1),
    endPage: Number(s.endPage ?? s.startPage ?? 1),
    complete: typeof s.complete === 'boolean' ? s.complete : undefined,
    posts: normalizePosts(s.posts),
    summary: typeof s.summary === 'string' ? s.summary : '',
    summaryJson: s.summaryJson as ExportedSegment['summaryJson'],
    postCount: Number(s.postCount ?? 0),
    summarizedAt: Number(s.summarizedAt ?? Date.now()),
  })) : undefined;

  return {
    url,
    title,
    topicType: input.topicType === 'news' ? 'news' : input.topicType === 'discussion' ? 'discussion' : undefined,
    version: input.version === 'xf1' || input.version === 'xf2' || input.version === 'unknown' ? input.version : 'unknown',
    posts: normalizePosts(input.posts),
    lastPostNumber: Number(input.lastPostNumber ?? 0),
    cachedAt: Number(input.cachedAt ?? Date.now()),
    llmConfig: isRecord(input.llmConfig)
      ? {
          provider: typeof input.llmConfig.provider === 'string' ? input.llmConfig.provider : 'unknown',
          model: typeof input.llmConfig.model === 'string' ? input.llmConfig.model : 'unknown',
        }
      : { provider: 'unknown', model: 'unknown' },
    totalPosts: Number(input.totalPosts ?? 0),
    forumPostCount: typeof input.forumPostCount === 'number' ? input.forumPostCount : undefined,
    summarizedPostCount: typeof input.summarizedPostCount === 'number' ? input.summarizedPostCount : undefined,
    totalPages: Number(input.totalPages ?? 1),
    bookmarked: typeof input.bookmarked === 'boolean' ? input.bookmarked : undefined,
    summary: typeof input.summary === 'string' ? input.summary : '',
    opinions: typeof input.opinions === 'string' ? input.opinions : undefined,
    overallSummary: typeof input.overallSummary === 'string' ? input.overallSummary : undefined,
    summaryJson: input.summaryJson as ExportedTopic['summaryJson'],
    segments,
    knowledgeEntries: Array.isArray(input.knowledgeEntries) ? (input.knowledgeEntries as ExportedTopic['knowledgeEntries']) : undefined,
    knowledgeChunks: Array.isArray(input.knowledgeChunks) ? (input.knowledgeChunks as ExportedTopic['knowledgeChunks']) : undefined,
    lastKnowledgePostNumber: typeof input.lastKnowledgePostNumber === 'number' ? input.lastKnowledgePostNumber : undefined,
    excludedKnowledgePostNumbers: Array.isArray(input.excludedKnowledgePostNumbers)
      ? input.excludedKnowledgePostNumbers.filter((n): n is number => typeof n === 'number')
      : undefined,
    threadAnalysis: isRecord(input.threadAnalysis) ? (input.threadAnalysis as unknown as ExportedTopic['threadAnalysis']) : undefined,
    researchHistory: Array.isArray(input.researchHistory) ? (input.researchHistory as ExportedTopic['researchHistory']) : undefined,
  };
}

function normalizeNotebookEntry(input: unknown, index: number): NotebookEntry | null {
  if (!isRecord(input)) return null;
  const id = asNonEmptyString(input.id);
  const title = asNonEmptyString(input.title);
  const content = typeof input.content === 'string' ? input.content : '';
  const sourceTopicUrl = asNonEmptyString(input.sourceTopicUrl);
  const sourceTopicTitle = typeof input.sourceTopicTitle === 'string' ? input.sourceTopicTitle : '';
  if (!id || !title || !sourceTopicUrl) {
    console.warn(`NotebookEntry #${index + 1}: missing id, title or sourceTopicUrl -- skipping`);
    return null;
  }
  return {
    id,
    title,
    content,
    tags: Array.isArray(input.tags) ? input.tags.filter((t): t is string => typeof t === 'string') : [],
    category: typeof input.category === 'string' ? input.category : undefined,
    source: isRecord(input.source) ? {
      author: typeof input.source.author === 'string' ? input.source.author : '',
      postNumber: typeof input.source.postNumber === 'number' ? input.source.postNumber : 0,
      timestamp: typeof input.source.timestamp === 'string' ? input.source.timestamp : undefined,
    } : { author: '', postNumber: 0 },
    extractedAt: typeof input.extractedAt === 'number' ? input.extractedAt : Date.now(),
    saved: typeof input.saved === 'boolean' ? input.saved : true,
    sourceTopicUrl,
    sourceTopicTitle,
    savedAt: typeof input.savedAt === 'number' ? input.savedAt : Date.now(),
    orphaned: typeof input.orphaned === 'number' ? input.orphaned : undefined,
    orphanedAt: typeof input.orphanedAt === 'number' ? input.orphanedAt : undefined,
  };
}

export function validateCacheExport(raw: unknown): CacheExport {
  if (!isRecord(raw)) {
    throw new Error('File import khong dung dinh dang JSON object');
  }

  // Notebook-only export: topics co the la [] hoac khong co
  const isNotebook = raw.scope === 'notebook';

  if (!isNotebook && !Array.isArray(raw.topics)) {
    throw new Error('File import thieu truong topics[] hop le');
  }

  const version = typeof raw.version === 'string' ? raw.version : '';
  if (!version) {
    throw new Error('File import thieu truong version');
  }

  const topics = Array.isArray(raw.topics) ? raw.topics.map((topic, index) => normalizeTopic(topic, index)) : [];

  const notebookEntries = Array.isArray(raw.notebookEntries)
    ? raw.notebookEntries.map((e, i) => normalizeNotebookEntry(e, i)).filter((e): e is NotebookEntry => e !== null)
    : undefined;

  return {
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : new Date().toISOString(),
    version,
    scope: (raw.scope as CacheExport['scope']) ?? undefined,
    topicCount: typeof raw.topicCount === 'number' ? raw.topicCount : topics.length,
    topics,
    notebookEntries,
  };
}

export function mapExportedTopic(topic: ExportedTopic): CachedTopic {
  return {
    url: topic.url,
    title: topic.title,
    version: topic.version ?? 'unknown',
    posts: normalizePosts(topic.posts),
    summary: topic.summary ?? '',
    opinions: topic.opinions,
    researchHistory: topic.researchHistory,
    llmConfig: topic.llmConfig,
    cachedAt: topic.cachedAt ?? Date.now(),
    lastPostNumber: Number.isFinite(topic.lastPostNumber) ? topic.lastPostNumber : 0,
    totalPosts: topic.totalPosts ?? 0,
    forumPostCount: topic.forumPostCount,
    summarizedPostCount: topic.summarizedPostCount,
    totalPages: topic.totalPages ?? 1,
    topicType: topic.topicType,
    segments: topic.segments?.map(mapExportedSegment),
    overallSummary: topic.overallSummary,
    summaryJson: topic.summaryJson,
    bookmarked: topic.bookmarked,
    knowledgeEntries: topic.knowledgeEntries,
    knowledgeChunks: topic.knowledgeChunks,
    lastKnowledgePostNumber: topic.lastKnowledgePostNumber,
    excludedKnowledgePostNumbers: topic.excludedKnowledgePostNumbers,
    threadAnalysis: topic.threadAnalysis,
  };
}
