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
  maxTokens?: number;
  timeoutMs?: number;
}

export type MessageType =
  | 'DETECT_XF'
  | 'SCRAPE_TOPIC'
  | 'SCRAPE_ALL_PAGES'
  | 'SCRAPE_PROGRESS'
  | 'CANCEL_SCRAPE'
  | 'SUMMARIZE'
  | 'SUMMARIZE_INCREMENTAL'
  | 'ANALYZE_OPINIONS'
  | 'RESEARCH_QUERY'
  | 'GET_SETTINGS'
  | 'SAVE_SETTINGS'
  | 'TEST_CONNECTION'
  | 'GET_CUSTOM_PROMPTS'
  | 'SAVE_CUSTOM_PROMPTS'
  | 'GET_CACHED_TOPIC'
  | 'SAVE_CACHED_TOPIC'
  | 'DELETE_CACHED_TOPIC'
  | 'GET_CACHE_SIZE'
  | 'GET_ALL_CACHED_TOPICS'
  | 'DETECT_ACTIVE_TAB';

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
  opinions?: string;
  researchHistory?: ResearchEntry[];
  llmConfig: { provider: string; model: string };
  cachedAt: number;
  lastPostNumber: number;
  totalPosts: number;
}

export interface ResearchEntry {
  question: string;
  answer: string;
  askedAt: number;
}

export interface CustomPrompts {
  summary?: string;
  opinions?: string;
  research?: string;
}
