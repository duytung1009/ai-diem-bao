import { describe, it, expect, vi, afterEach } from 'vitest';
import { reduceKnowledgeChunks } from '@/lib/llm/summarizer';
import * as factoryModule from '@/lib/llm/factory';
import type { LLMConfig, KnowledgeEntry } from '@/lib/types';
import { createMockProvider, restoreCreateProvider } from '../mocks/override-factory';

describe('reduceKnowledgeChunks', () => {
  afterEach(() => {
    restoreCreateProvider();
  });

  it('calculates safeMaxTokens based on cap * 700, and does not clamp to requestedMaxTokens if cap needs more budget', async () => {
    const mock = createMockProvider({
      responses: ['[{"title":"Saved Entry","content":"Details","tags":["tag"],"source":{"author":"Author","postNumber":1},"category":"Cat"}]'],
    });

    const createProviderSpy = vi.spyOn(factoryModule, 'createProvider');

    const config: LLMConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'test-key',
      baseUrl: 'http://localhost',
      temperature: 0.3,
      maxTokens: 2000,
      knowledgeMaxTokens: 2000,
    };

    const partialEntries: KnowledgeEntry[][] = [
      [
        {
          id: '1',
          title: 'Entry 1',
          content: 'Details 1',
          tags: ['tag1'],
          source: { author: 'User1', postNumber: 1 },
          extractedAt: Date.now(),
        },
      ],
    ];

    // entryCap is 15. Expected output budget is min(getModelMaxOutput('gpt-4o-mini'), max(requestedMaxTokens, 15 * 700))
    // getModelMaxOutput('gpt-4o-mini') is 16384. Max of (2000, 10500) is 10500.
    // 10500 fits in contextLimit (128000) - promptTokens. So safeMaxTokens should be 10500!
    await reduceKnowledgeChunks(partialEntries, config, undefined, undefined, undefined, 15);

    expect(createProviderSpy).toHaveBeenCalled();
    const passedConfig = createProviderSpy.mock.calls[0][0];
    expect(passedConfig.maxTokens).toBe(10500);
  });

  it('clamps safeMaxTokens to remaining context if context limit is tight', async () => {
    const mock = createMockProvider({
      responses: ['[]'],
    });

    const createProviderSpy = vi.spyOn(factoryModule, 'createProvider');

    const config: LLMConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'test-key',
      baseUrl: 'http://localhost',
      temperature: 0.3,
      maxTokens: 2000,
      knowledgeMaxTokens: 2000,
      contextWindow: 12000, // Artificially small context window
    };

    const partialEntries: KnowledgeEntry[][] = [
      [
        {
          id: '1',
          title: 'Entry 1',
          content: 'Details 1',
          tags: ['tag1'],
          source: { author: 'User1', postNumber: 1 },
          extractedAt: Date.now(),
        },
      ],
    ];

    // Expected budget without clamping is 15 * 700 = 10500.
    // But contextLimit is 12000.
    // promptTokensUpperBound will be Math.ceil((systemPrompt.length + combinedText.length) / 3) + RESPONSE_BUFFER_TOKENS
    // Combined text: ~140 chars -> ~50 tokens. System prompt: ~1500 chars -> ~500 tokens. RESPONSE_BUFFER_TOKENS = 2000.
    // promptTokensUpperBound ≈ 2550 tokens.
    // Remaining context: 12000 - 2550 = 9450.
    // So safeMaxTokens should be around 9450 (which is less than 10500).
    await reduceKnowledgeChunks(partialEntries, config, undefined, undefined, undefined, 15);

    expect(createProviderSpy).toHaveBeenCalled();
    const passedConfig = createProviderSpy.mock.calls[0][0];
    expect(passedConfig.maxTokens).toBeLessThan(10500);
    expect(passedConfig.maxTokens).toBeGreaterThanOrEqual(512);
  });
});
