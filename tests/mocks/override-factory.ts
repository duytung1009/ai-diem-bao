import { vi } from 'vitest';
import type { LLMProvider } from '@/lib/llm/types';
import type { LLMConfig } from '@/lib/types';
import * as factoryModule from '@/lib/llm/factory';
import { MockLLMProvider } from './mock-provider';

const originalCreateProvider = factoryModule.createProvider;

let mockProvider: LLMProvider | null = null;

export function overrideCreateProvider(provider: LLMProvider): void {
  mockProvider = provider;
  vi.spyOn(factoryModule, 'createProvider').mockImplementation((_config: LLMConfig) => provider);
}

export function restoreCreateProvider(): void {
  mockProvider = null;
  vi.restoreAllMocks();
}

export function createMockProvider(): MockLLMProvider {
  const provider = new MockLLMProvider();
  overrideCreateProvider(provider);
  return provider;
}
