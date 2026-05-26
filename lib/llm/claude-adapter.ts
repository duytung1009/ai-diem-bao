import type { ScrapedPost, LLMConfig } from '../types';
import type { LLMProvider, LLMResponse, LLMOptions } from './types';
import { llmErrorFromStatus, LLMError, LLMErrorCode } from '../errors';
import { withRetry } from './retry';
import { mergeAbortSignals, formatPostsForLLM } from './utils';

export class ClaudeAdapter implements LLMProvider {
  constructor(private config: LLMConfig) {}

  async summarize(posts: ScrapedPost[], systemPrompt: string, signal?: AbortSignal, _options?: LLMOptions): Promise<LLMResponse> {
    const userContent = formatPostsForLLM(posts);

    const response = await this.chatCompletion([
      { role: 'user', content: userContent },
    ], systemPrompt, signal);

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
    externalSignal?: AbortSignal,
  ): Promise<LLMResponse> {
    const apiKey = this.config.apiKey;
    if (!apiKey) {
      throw new LLMError(LLMErrorCode.AUTH_FAILED, 'API key chưa được cấu hình. Vui lòng nhập Anthropic API key trong cài đặt.');
    }

    return withRetry(async () => {
      const url = 'https://api.anthropic.com/v1/messages';
      const model = this.config.model;
      if (!model) throw new Error('Model không được cấu hình. Vui lòng chọn model trong cài đặt.');

      const timeoutCtrl = new AbortController();
      const timeoutId = setTimeout(() => timeoutCtrl.abort(), this.config.timeoutMs ?? 120000);
      const merged = mergeAbortSignals(timeoutCtrl.signal, externalSignal);

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
          signal: merged.signal,
        });

        if (!res.ok) {
          const errorBody = await res.text().catch(() => '');
          throw llmErrorFromStatus(res.status, errorBody);
        }

        const data = await res.json();
        const stopReason = data.stop_reason as string | undefined;
        const content = data.content?.[0]?.text || '';

        if (stopReason === 'max_tokens') {
          throw new LLMError(
            LLMErrorCode.INCOMPLETE_RESPONSE,
            'Phản hồi bị cắt ngắn: output vượt giới hạn max tokens. Tăng "Max output tokens" trong Cài đặt. Nếu prompt cũng gần chạm context window, giảm "Context window (tokens)" hoặc Reset về Tự động.',
            undefined,
            content,
          );
        }

        return {
          content,
          tokensUsed: data.usage
            ? { prompt: data.usage.input_tokens, completion: data.usage.output_tokens }
            : undefined,
        };
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          if (timeoutCtrl.signal.aborted) {
            throw new LLMError(LLMErrorCode.TIMEOUT, 'Kết nối LLM quá thời gian. Tăng timeout trong Cài đặt hoặc thử lại.');
          }
          throw err;
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }
    });
  }
}
