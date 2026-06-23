import type { ScrapedPost, LLMConfig } from '../types';
import type { LLMProvider, LLMResponse, LLMOptions } from './types';
import { llmErrorFromStatus, LLMError, LLMErrorCode } from '../errors';
import { withRetry } from './retry';
import { mergeAbortSignals, formatPostsForLLM } from './utils';
import { JSON_SCHEMAS, type SchemaName } from './json-schemas';

// Gemini's responseSchema doesn't support `additionalProperties` — strip it recursively.
function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'additionalProperties') continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      result[k] = toGeminiSchema(v as Record<string, unknown>);
    } else if (Array.isArray(v)) {
      result[k] = (v as unknown[]).map(item =>
        item && typeof item === 'object' ? toGeminiSchema(item as Record<string, unknown>) : item,
      );
    } else {
      result[k] = v;
    }
  }
  return result;
}

export class GeminiAdapter implements LLMProvider {
  constructor(private config: LLMConfig) { }

  async summarize(posts: ScrapedPost[], systemPrompt: string, signal?: AbortSignal, options?: LLMOptions): Promise<LLMResponse> {
    const userContent = formatPostsForLLM(posts);

    return this.generateContent(systemPrompt, userContent, signal, options?.jsonMode !== false, options?.schemaName);
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.generateContent(
        'You are a helpful assistant.',
        'Respond with "OK" only.',
        undefined,
        false,
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  private async generateContent(
    systemInstruction: string,
    userMessage: string,
    externalSignal?: AbortSignal,
    jsonMode: boolean = true,
    schemaName?: SchemaName,
  ): Promise<LLMResponse> {
    const apiKey = this.config.apiKey;
    if (!apiKey) {
      throw new LLMError(
        LLMErrorCode.AUTH_FAILED,
        'API key chưa được cấu hình. Vui lòng nhập Google AI API key trong cài đặt.',
      );
    }

    let effectiveSystemInstruction = systemInstruction;

    return withRetry(async () => {
      const model = this.config.model || 'gemini-2.5-flash';
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
              parts: [{ text: effectiveSystemInstruction }],
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
              ...(jsonMode
                ? {
                  responseMimeType: 'application/json',
                  ...(schemaName ? { responseSchema: toGeminiSchema(JSON_SCHEMAS[schemaName].json_schema.schema as Record<string, unknown>) } : {}),
                }
                : { responseMimeType: 'text/plain' }),
              ...(this.config.thinkingEnabled
                ? { thinkingConfig: { thinkingBudget: this.config.thinkingBudget ?? -1 } }
                : {}),
            },
          }),
          signal: merged.signal,
        });

        if (!res.ok) {
          const errorBody = await res.text().catch(() => '');
          throw llmErrorFromStatus(res.status, errorBody);
        }

        const data = await res.json();

        const content =
          data.candidates?.[0]?.content?.parts?.find((p: { text?: string; thought?: string }) => !p.thought)?.text || '';

        const finishReason = data.candidates?.[0]?.finishReason as string | undefined;
        if (finishReason && finishReason !== 'STOP') {
          const FINISH_REASON_MESSAGES: Record<string, string> = {
            MAX_TOKENS: 'Tóm tắt bị cắt ngắn: model đạt giới hạn token đầu ra. Tăng "Max output tokens" trong Cài đặt. Nếu prompt đã lớn gần context window, giảm "Context window (tokens)" hoặc Reset về Tự động. Nếu đang dùng model có thinking: giảm "Thinking budget" hoặc tăng Max output tokens.',
            MALFORMED_RESPONSE: 'Gemini không thể tạo JSON hợp lệ từ nội dung này. Nội dung có thể quá lớn hoặc quá phức tạp — thử giảm kích thước segment trong Cài đặt.',
            SAFETY: 'Nội dung bị chặn bởi bộ lọc an toàn của Gemini.',
            RECITATION: 'Nội dung bị chặn do vi phạm chính sách trích dẫn.',
            LANGUAGE: 'Ngôn ngữ đầu ra không được hỗ trợ bởi Gemini.',
            BLOCKLIST: 'Nội dung chứa cụm từ bị cấm.',
            PROHIBITED_CONTENT: 'Nội dung bị cấm bởi chính sách Gemini.',
          };
          const message = FINISH_REASON_MESSAGES[finishReason]
            ?? `Tóm tắt không hoàn chỉnh (${finishReason}). Vui lòng thử lại.`;
          const partialText = finishReason === 'MAX_TOKENS' ? content : undefined;
          const isRetryable = finishReason === 'RECITATION';
          if (isRetryable && effectiveSystemInstruction === systemInstruction) {
            effectiveSystemInstruction = systemInstruction + '\n\nQUAN TRỌNG: Hãy diễn đạt và viết lại toàn bộ nội dung bằng lời văn của riêng bạn. Không sao chép nguyên văn bất kỳ đoạn nào từ tài liệu nguồn.';
          }
          throw new LLMError(LLMErrorCode.INCOMPLETE_RESPONSE, message, undefined, partialText, isRetryable);
        }

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
