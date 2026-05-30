import type { ScrapedPost, LLMConfig } from '../types';
import type { LLMProvider, LLMResponse, LLMOptions } from './types';
import { JSON_SCHEMAS } from './json-schemas';
import { llmErrorFromStatus, LLMError, LLMErrorCode } from '../errors';
import { withRetry } from './retry';
import { mergeAbortSignals, formatPostsForLLM } from './utils';

export class OpenAIAdapter implements LLMProvider {
  constructor(private config: LLMConfig) {}

  async summarize(posts: ScrapedPost[], systemPrompt: string, signal?: AbortSignal, options?: LLMOptions): Promise<LLMResponse> {
    const userContent = formatPostsForLLM(posts);

    const response = await this.chatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ], signal, options);

    return response;
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.chatCompletion([
        { role: 'user', content: 'Respond with "OK" only.' },
      ], undefined, { jsonMode: false });
      return { ok: true };
    } catch (err) {
      console.error('Error testing LLM connection:', err);
      return { ok: false, error: String(err) };
    }
  }

  private async chatCompletion(
    messages: Array<{ role: string; content: string }>,
    externalSignal?: AbortSignal,
    options?: LLMOptions,
  ): Promise<LLMResponse> {
    return withRetry(async () => {
      const baseUrl = this.config.baseUrl.replace(/\/+$/, '');
      const url = `${baseUrl}/chat/completions`;

      const timeoutCtrl = new AbortController();
      const timeoutId = setTimeout(() => timeoutCtrl.abort(), this.config.timeoutMs ?? 120000);
      const merged = mergeAbortSignals(timeoutCtrl.signal, externalSignal);

      const jsonMode = options?.jsonMode !== false;
      const responseFormat = jsonMode
        ? this.config.provider === 'openai' || this.config.provider === 'openrouter'
          ? { response_format: { type: 'json_object' as const } }
          : this.config.provider === 'custom' && options?.schemaName
            ? { response_format: JSON_SCHEMAS[options.schemaName] }
            : undefined
        : undefined;

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
            ...(this.config.provider === 'openrouter' ? {
              'HTTP-Referer': 'https://github.com/duytung1009/ai-diem-bao',
              'X-OpenRouter-Title': 'loi-thot-ho',
            } : {}),
          },
          body: JSON.stringify({
            model: this.config.model,
            messages,
            temperature: this.config.temperature,
            max_tokens: this.config.maxTokens ?? 4096,
            ...(responseFormat ?? {}),
          }),
          signal: merged.signal,
        });

        if (!res.ok) {
          const errorBody = await res.text().catch(() => '');
          throw llmErrorFromStatus(res.status, errorBody);
        }
        
        const data = await res.json();
        const choice = data.choices?.[0];
        const finishReason = choice?.finish_reason as string | undefined;
        const content: string = choice?.message?.content || '';

        // Standard OpenAI signal: output hit max_tokens limit
        if (finishReason === 'length') {
          throw new LLMError(
            LLMErrorCode.INCOMPLETE_RESPONSE,
            'Tóm tắt bị cắt ngắn: output vượt giới hạn max tokens. Tăng "Max output tokens" trong Cài đặt. Nếu prompt cũng gần chạm context window, giảm "Context window (tokens)" hoặc Reset về Tự động.',
            undefined,
            content,
          );
        }

        return {
          content,
          tokensUsed: data.usage
            ? { prompt: data.usage.prompt_tokens, completion: data.usage.completion_tokens }
            : undefined,
        };
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          if (timeoutCtrl.signal.aborted) {
            // Timeout fired — wrap as LLM timeout error
            throw new LLMError(LLMErrorCode.TIMEOUT, 'Kết nối LLM quá thời gian. Tăng timeout trong Cài đặt hoặc thử lại.');
          }
          // User cancel — propagate AbortError as-is
          throw err;
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }
    });
  }
}
