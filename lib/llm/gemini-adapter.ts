import type { ScrapedPost, LLMConfig } from '../types';
import type { LLMProvider, LLMResponse } from './types';
import { llmErrorFromStatus, LLMError, LLMErrorCode } from '../errors';
import { withRetry } from './retry';
import { mergeAbortSignals } from './utils';

export class GeminiAdapter implements LLMProvider {
  constructor(private config: LLMConfig) {}

  async summarize(posts: ScrapedPost[], systemPrompt: string, signal?: AbortSignal): Promise<LLMResponse> {
    const userContent = posts
      .map((p) => `[${p.author}] (#${p.postNumber}):\n${p.content}`)
      .join('\n\n---\n\n');

    return this.generateContent(systemPrompt, userContent, signal);
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
    externalSignal?: AbortSignal,
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

      const timeoutCtrl = new AbortController();
      const timeoutId = setTimeout(
        () => timeoutCtrl.abort(),
        this.config.timeoutMs ?? 120000,
      );
      const merged = mergeAbortSignals(timeoutCtrl.signal, externalSignal);

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
              ...(this.config.thinkingEnabled === false
                ? { thinkingConfig: { thinkingBudget: 0 } }
                : {
                    thinkingConfig: {
                      thinkingBudget: this.config.thinkingBudget ?? -1,
                    },
                  }),
            },
          }),
          signal: merged.signal,
        });

        if (!res.ok) {
          const errorBody = await res.text().catch(() => '');
          throw llmErrorFromStatus(res.status, errorBody);
        }

        const data = await res.json();

        const finishReason = data.candidates?.[0]?.finishReason as string | undefined;
        if (finishReason && finishReason !== 'STOP') {
          const FINISH_REASON_MESSAGES: Record<string, string> = {
            MAX_TOKENS: 'Tóm tắt bị cắt ngắn: model đạt giới hạn token đầu ra. Hãy tăng "Max tokens" trong Cài đặt. Nếu đang dùng model có thinking: giảm "Thinking budget" hoặc tăng Max tokens đủ lớn hơn thinking budget.',
            SAFETY: 'Nội dung bị chặn bởi bộ lọc an toàn của Gemini.',
            RECITATION: 'Nội dung bị chặn do vi phạm chính sách trích dẫn.',
            LANGUAGE: 'Ngôn ngữ đầu ra không được hỗ trợ bởi Gemini.',
            BLOCKLIST: 'Nội dung chứa cụm từ bị cấm.',
            PROHIBITED_CONTENT: 'Nội dung bị cấm bởi chính sách Gemini.',
          };
          const message = FINISH_REASON_MESSAGES[finishReason]
            ?? `Tóm tắt không hoàn chỉnh (${finishReason}). Vui lòng thử lại.`;
          throw new LLMError(LLMErrorCode.INCOMPLETE_RESPONSE, message);
        }

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
          if (timeoutCtrl.signal.aborted) {
            throw new LLMError(
              LLMErrorCode.TIMEOUT,
              'Kết nối LLM quá thời gian. Tăng timeout trong Cài đặt hoặc thử lại.',
            );
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
