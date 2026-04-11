import type { ScrapedPost, LLMConfig } from '../types';
import type { LLMProvider, LLMResponse } from './types';
import { llmErrorFromStatus, LLMError, LLMErrorCode } from '../errors';
import { withRetry } from './retry';

/**
 * Returns true if the text looks like a JSON object that was cut off mid-stream.
 * Used to detect context-window exhaustion on local LLMs that report finish_reason "stop"
 * even when truncated.
 */
function looksLikeTruncatedJson(text: string): boolean {
  // Strip leading/trailing backtick fences and whitespace before checking
  const stripped = text.trim().replace(/^`+/, '').replace(/`+$/, '').trim();
  if (!stripped.startsWith('{')) return false;
  return !stripped.endsWith('}');
}

export class OpenAIAdapter implements LLMProvider {
  constructor(private config: LLMConfig) {}

  async summarize(posts: ScrapedPost[], systemPrompt: string): Promise<LLMResponse> {
    const userContent = posts
      .map((p) => `[${p.author}] (#${p.postNumber}):\n${p.content}`)
      .join('\n\n---\n\n');

    const response = await this.chatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ]);

    return response;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.chatCompletion([
        { role: 'user', content: 'Respond with "OK" only.' },
      ]);
      return true;
    } catch {
      return false;
    }
  }

  private async chatCompletion(
    messages: Array<{ role: string; content: string }>,
  ): Promise<LLMResponse> {
    return withRetry(async () => {
      const baseUrl = this.config.baseUrl.replace(/\/+$/, '');
      const url = `${baseUrl}/chat/completions`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 120000);

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify({
            model: this.config.model,
            messages,
            temperature: this.config.temperature,
          }),
          signal: controller.signal,
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
            'Tóm tắt bị cắt ngắn: output vượt giới hạn max tokens. Tăng "Max tokens" trong Cài đặt.',
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
          throw new LLMError(LLMErrorCode.TIMEOUT, 'Kết nối LLM quá thời gian. Tăng timeout trong Cài đặt hoặc thử lại.');
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }
    });
  }
}
