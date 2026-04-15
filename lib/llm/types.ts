import type { ScrapedPost } from '../types';

export interface LLMProvider {
  summarize(posts: ScrapedPost[], systemPrompt: string, signal?: AbortSignal): Promise<LLMResponse>;
  testConnection(): Promise<boolean>;
}

export interface LLMResponse {
  content: string;
  tokensUsed?: {
    prompt: number;
    completion: number;
  };
}
