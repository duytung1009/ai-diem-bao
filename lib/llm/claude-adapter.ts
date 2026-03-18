import type { ScrapedPost, LLMConfig } from '../types';
import type { LLMProvider, LLMResponse } from './types';
import { llmErrorFromStatus, LLMError, LLMErrorCode } from '../errors';
import { withRetry } from './retry';

export class ClaudeAdapter implements LLMProvider {
  constructor(private config: LLMConfig) {}

  async summarize(posts: ScrapedPost[], systemPrompt: string): Promise<LLMResponse> {
    const userContent = posts
      .map((p) => `[${p.author}] (#${p.postNumber}):\n${p.content}`)
      .join('\n\n---\n\n');

    const response = await this.chatCompletion([
      { role: 'user', content: userContent },
    ], systemPrompt);

    return response;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.chatCompletion(
        [{ role: 'user', content: 'Respond with "OK" only.' }],
        'You are a helpful assistant.',
      );
      return true;
    } catch {
      return false;
    }
  }

  private async chatCompletion(
    messages: Array<{ role: string; content: string }>,
    systemPrompt: string,
  ): Promise<LLMResponse> {
    const apiKey = this.config.apiKey;
    if (!apiKey) {
      throw new LLMError(LLMErrorCode.AUTH_FAILED, 'API key chưa được cấu hình. Vui lòng nhập Anthropic API key trong cài đặt.');
    }

    return withRetry(async () => {
      const url = 'https://api.anthropic.com/v1/messages';
      const model = this.config.model;
      if (!model) throw new Error('Model không được cấu hình. Vui lòng chọn model trong cài đặt.');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 120000);

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: this.config.maxTokens ?? 4096,
            system: systemPrompt,
            messages,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errorBody = await res.text().catch(() => '');
          throw llmErrorFromStatus(res.status, errorBody);
        }

        const data = await res.json();
        const content = data.content?.[0]?.text || '';

        return {
          content,
          tokensUsed: data.usage
            ? { prompt: data.usage.input_tokens, completion: data.usage.output_tokens }
            : undefined,
        };
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw new LLMError(LLMErrorCode.TIMEOUT, 'Kết nối LLM quá thời gian. Tăng timeout trong Cài đặt hoặc thử lại.');
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }
    });
  }
}
