import type { LLMConfig } from '../types';
import type { LLMProvider } from './types';
import { OpenAIAdapter } from './openai-adapter';
import { ClaudeAdapter } from './claude-adapter';

export function createProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case 'openai':
    case 'custom':
      return new OpenAIAdapter(config);
    case 'claude':
      return new ClaudeAdapter(config);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
