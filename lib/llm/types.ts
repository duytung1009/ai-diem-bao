import type { ScrapedPost } from '../types';
import type { SchemaName } from './json-schemas';

export interface LLMOptions {
  jsonMode?: boolean;
  schemaName?: SchemaName;
}

export interface LLMProvider {
  summarize(posts: ScrapedPost[], systemPrompt: string, signal?: AbortSignal, options?: LLMOptions): Promise<LLMResponse>;
  testConnection(): Promise<boolean>;
}

export interface LLMResponse {
  content: string;
  tokensUsed?: {
    prompt: number;
    completion: number;
  };
}
