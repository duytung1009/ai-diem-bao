import type { ScrapedPost } from '@/lib/types';
import type { LLMProvider, LLMResponse, LLMOptions } from '@/lib/llm/types';

export interface MockProviderOptions {
  responses?: string[];
  delayMs?: number;
  failAfter?: number;
  failMessage?: string;
  invalidJsonBeforeValid?: number;
  abortAfter?: number;
}

export class MockLLMProvider implements LLMProvider {
  private responses: string[];
  private callCount = 0;
  private delayMs: number;
  private failAfter: number;
  private failMessage: string;
  private invalidBeforeValid: number;
  private invalidCount = 0;
  private abortAfter: number;

  constructor(options: MockProviderOptions = {}) {
    this.responses = options.responses ?? [];
    this.delayMs = options.delayMs ?? 0;
    this.failAfter = options.failAfter ?? Infinity;
    this.failMessage = options.failMessage ?? 'LLM API error';
    this.invalidBeforeValid = options.invalidJsonBeforeValid ?? 0;
    this.abortAfter = options.abortAfter ?? Infinity;
  }

  async summarize(_posts: ScrapedPost[], _systemPrompt: string, _signal?: AbortSignal, _options?: LLMOptions): Promise<LLMResponse> {
    this.callCount++;
    this._lastPosts = _posts;

    if (this.delayMs > 0) {
      await new Promise(r => setTimeout(r, this.delayMs));
    }

    if (this.callCount > this.abortAfter) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }

    if (_signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }

    if (this.callCount > this.failAfter) {
      throw new Error(this.failMessage);
    }

    if (this.invalidCount < this.invalidBeforeValid) {
      this.invalidCount++;
      return { content: 'this is not valid json at all', tokensUsed: { prompt: 100, completion: 50 } };
    }

    const response = this.responses.length > 0
      ? this.responses[(this.callCount - 1) % this.responses.length]
      : '{"summary":"mock summary","opinions":[],"conclusion":"mock conclusion"}';

    return { content: response, tokensUsed: { prompt: 100, completion: 50 } };
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    return { ok: true };
  }

  getCallCount(): number {
    return this.callCount;
  }

  getLastPosts(): ScrapedPost[] | null {
    return this._lastPosts ?? null;
  }

  reset(): void {
    this.callCount = 0;
    this.invalidCount = 0;
    this._lastPosts = null;
  }

  private _lastPosts: ScrapedPost[] | null = null;
}
