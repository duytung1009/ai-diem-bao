import type { ScrapedPost, LLMConfig } from '../types';
import type { LLMProvider, LLMResponse } from './types';
import { llmErrorFromStatus, LLMError, LLMErrorCode } from '../errors';
import { withRetry } from './retry';

export class GeminiAdapter implements LLMProvider {
  constructor(private config: LLMConfig) {}

  async summarize(posts: ScrapedPost[], systemPrompt: string): Promise<LLMResponse> {
    const userContent = posts
      .map((p) => `[${p.author}] (#${p.postNumber}):\n${p.content}`)
      .join('\n\n---\n\n');

    return this.generateContent(systemPrompt, userContent);
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.generateContent(
        'You are a helpful assistant.',
        'Respond with "OK" only.',
      );
      return true;
    } catch {
      return false;
    }
  }

  private async generateContent(
    systemInstruction: string,
    userMessage: string,
  ): Promise<LLMResponse> {
    const apiKey = this.config.apiKey;
    if (!apiKey) {
      throw new LLMError(
        LLMErrorCode.AUTH_FAILED,
        'API key chưa được cấu hình. Vui lòng nhập Google AI API key trong cài đặt.',
      );
    }

    return withRetry(async () => {
      const model = this.config.model || 'gemini-2.0-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config.timeoutMs ?? 120000,
      );

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: systemInstruction }],
            },
            contents: [
              {
                role: 'user',
                parts: [{ text: userMessage }],
              },
            ],
            generationConfig: {
              temperature: this.config.temperature,
              maxOutputTokens: this.config.maxTokens ?? 4096,
            },
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errorBody = await res.text().catch(() => '');
          throw llmErrorFromStatus(res.status, errorBody);
        }

        const data = await res.json();
        const content =
          data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        return {
          content,
          tokensUsed: data.usageMetadata
            ? {
                prompt: data.usageMetadata.promptTokenCount ?? 0,
                completion: data.usageMetadata.candidatesTokenCount ?? 0,
              }
            : undefined,
        };
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw new LLMError(
            LLMErrorCode.TIMEOUT,
            'Kết nối LLM quá thời gian. Tăng timeout trong Cài đặt hoặc thử lại.',
          );
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }
    });
  }
}
