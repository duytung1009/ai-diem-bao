export type XenForoVersion = 'xf1' | 'xf2' | 'unknown';

export interface ScrapedPost {
  author: string;
  content: string;
  timestamp: string;
  postNumber: number;
}

export interface TopicData {
  url: string;
  title: string;
  version: XenForoVersion;
  posts: ScrapedPost[];
  totalPages: number;
  currentPage: number;
}

export interface SummaryResult {
  main?: string;
  opinions?: string;
  research?: string;
}

export interface LLMConfig {
  provider: 'openai' | 'claude' | 'custom';
  model: string;
  apiKey: string;
  baseUrl: string;
  temperature: number;
}

export type MessageType =
  | 'DETECT_XF'
  | 'SCRAPE_TOPIC'
  | 'SCRAPE_ALL_PAGES'
  | 'SCRAPE_PROGRESS'
  | 'CANCEL_SCRAPE'
  | 'SUMMARIZE'
  | 'SUMMARIZE_INCREMENTAL'
  | 'GET_SETTINGS'
  | 'SAVE_SETTINGS'
  | 'TEST_CONNECTION'
  | 'GET_CACHED_TOPIC'
  | 'SAVE_CACHED_TOPIC'
  | 'DELETE_CACHED_TOPIC'
  | 'GET_CACHE_SIZE';

export interface Message<T = unknown> {
  type: MessageType;
  payload?: T;
}

export interface DetectResult {
  version: XenForoVersion;
  title: string;
  postCount: number;
  pageCount: number;
}

export interface PageProgress {
  currentPage: number;
  totalPages: number;
  postsScraped: number;
}

export type CacheFreshness = 'fresh' | 'stale' | 'outdated';

export interface CachedTopic {
  url: string;
  title: string;
  version: XenForoVersion;
  posts: ScrapedPost[];
  summary: string;
  llmConfig: { provider: string; model: string };
  cachedAt: number;
  lastPostNumber: number;
  totalPosts: number;
}
