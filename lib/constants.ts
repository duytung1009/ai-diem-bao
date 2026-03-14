import type { LLMConfig } from './types';

export const STORAGE_KEYS = {
  SETTINGS: 'llm-settings',
  CACHE_PREFIX: 'cache:',
} as const;

export const DEFAULT_LLM_CONFIG: LLMConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  temperature: 0.3,
};
