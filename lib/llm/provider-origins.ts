import type { LLMProvider } from '@/lib/types';
import { originFromUrl } from '@/lib/permissions';

export const PROVIDER_BASE_URLS: Record<LLMProvider, string> = {
  openai: 'https://api.openai.com/v1',
  claude: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com',

  openrouter: 'https://openrouter.ai/api/v1',
  custom: '',
  deepseek: 'https://api.deepseek.com/v1',
  grok: 'https://api.x.ai/v1',
};

export function getProviderOrigin(provider: LLMProvider, baseUrl: string): string | null {
  if (provider === 'custom') {
    return originFromUrl(baseUrl);
  }
  return originFromUrl(PROVIDER_BASE_URLS[provider]);
}
