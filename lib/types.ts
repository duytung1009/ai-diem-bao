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
  | 'SUMMARIZE'
  | 'GET_SETTINGS'
  | 'SAVE_SETTINGS'
  | 'TEST_CONNECTION';

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
