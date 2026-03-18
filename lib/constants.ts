import type { LLMConfig } from './types';

export const STORAGE_KEYS = {
  SETTINGS: 'llm-settings',
  CACHE_PREFIX: 'cache:',
  CUSTOM_PROMPTS: 'custom-prompts',
} as const;

export const DEFAULT_LLM_CONFIG: LLMConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  temperature: 0.3,
  timeoutMs: 120000,
};
