import type { LLMConfig } from '../types';
import type { LLMProvider } from './types';
import { OpenAIAdapter } from './openai-adapter';

export function createProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case 'openai':
    case 'custom':
      return new OpenAIAdapter(config);
    case 'claude':
      // Claude adapter will be added in Phase 3
      throw new Error('Claude adapter not yet implemented');
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
