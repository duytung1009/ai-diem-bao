# Feature: Thêm hỗ trợ Gemini LLM Provider

## Mục tiêu
Thêm Google Gemini vào danh sách LLM provider, cho phép user chọn Gemini trong Settings và dùng để tóm tắt, phân tích ý kiến, tra cứu.

## Phân tích hiện trạng
- **Provider pattern**: `LLMProvider` interface (`lib/llm/types.ts`) → `createProvider()` factory (`lib/llm/factory.ts`) → adapter class
- **Existing adapters**: `OpenAIAdapter`, `ClaudeAdapter` — cả hai implement `summarize()` + `testConnection()`, dùng `withRetry()` + `AbortController` timeout
- **Config type**: `LLMConfig.provider: 'openai' | 'claude' | 'custom'` — cần thêm `'gemini'`
- **SettingsView**: Provider dropdown + conditional UI (model input/select, base URL, API key label)
- **Gemini API**: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` với header `x-goog-api-key`

---

## Task 1: Tạo `GeminiAdapter` class

### File mới: `lib/llm/gemini-adapter.ts`

Tạo file mới theo pattern của `ClaudeAdapter`:

```typescript
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
```

### Lưu ý:
- Gemini dùng `systemInstruction` thay vì message role `system`
- Response path: `data.candidates[0].content.parts[0].text`
- Token usage: `data.usageMetadata.promptTokenCount` / `candidatesTokenCount`
- API key qua header `x-goog-api-key` (không dùng Bearer token)

---

## Task 2: Cập nhật types và factory

### File: `lib/types.ts`

Dòng 26, thay:
```typescript
provider: 'openai' | 'claude' | 'custom';
```
thành:
```typescript
provider: 'openai' | 'claude' | 'gemini' | 'custom';
```

### File: `lib/llm/factory.ts`

Thêm import và case mới:

```typescript
import type { LLMConfig } from '../types';
import type { LLMProvider } from './types';
import { OpenAIAdapter } from './openai-adapter';
import { ClaudeAdapter } from './claude-adapter';
import { GeminiAdapter } from './gemini-adapter';

export function createProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case 'openai':
    case 'custom':
      return new OpenAIAdapter(config);
    case 'claude':
      return new ClaudeAdapter(config);
    case 'gemini':
      return new GeminiAdapter(config);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
```

---

## Task 3: Cập nhật SettingsView UI

### File: `entrypoints/sidepanel/views/SettingsView.vue`

**3a. Thêm Gemini models list** (sau `claudeModels`, khoảng dòng 46):
```typescript
const geminiModels = [
  'gemini-2.5-flash-preview-05-20',
  'gemini-2.5-pro-preview-05-06',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
];
```

**3b. Thêm computed cho Gemini** (sau `isClaude`, dòng 51):
```typescript
const isGemini = computed(() => config.value.provider === 'gemini');
```

**3c. Provider dropdown** — thêm option Gemini (dòng 120-123, trong `<select>`):
```html
<option value="gemini">Google Gemini</option>
```
Đặt trước `</select>`, sau option Claude.

**3d. API Key label** — cập nhật label (dòng 128-130):
Thay:
```html
{{ isClaude ? 'Anthropic API Key' : 'API Key' }}
```
thành:
```html
{{ isClaude ? 'Anthropic API Key' : isGemini ? 'Google AI API Key' : 'API Key' }}
```

Và placeholder (dòng 134):
Thay:
```html
:placeholder="isClaude ? 'sk-ant-...' : 'sk-...'"
```
thành:
```html
:placeholder="isClaude ? 'sk-ant-...' : isGemini ? 'AIza...' : 'sk-...'"
```

**3e. Base URL** — ẩn cho Gemini (dòng 140):
Thay:
```html
<div v-if="!isClaude">
```
thành:
```html
<div v-if="!isClaude && !isGemini">
```

**3f. Model selector cho Gemini** — thêm block mới (sau Claude model selector, dòng 161):
```html
<!-- Model selector for Gemini -->
<div v-if="isGemini">
  <label class="block text-xs font-medium text-gray-600 mb-1">Model</label>
  <select
    v-model="config.model"
    class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
  >
    <option v-for="model in geminiModels" :key="model" :value="model">
      {{ model }}
    </option>
  </select>
</div>
```

**3g. Model input cho OpenAI/Custom** — ẩn khi Gemini (dòng 164):
Thay:
```html
<div v-if="!isClaude">
```
thành:
```html
<div v-if="!isClaude && !isGemini">
```

---

## Verification
1. `npx vue-tsc --noEmit` → pass (kiểm tra type union mới, GeminiAdapter)
2. `npm run build` → pass
3. Mở Settings → Provider dropdown → thấy "Google Gemini"
4. Chọn Gemini → API key label đổi thành "Google AI API Key", placeholder "AIza..."
5. Base URL ẩn, model selector hiện danh sách Gemini models
6. Nhập Gemini API key → Test Connection → thành công
7. Chọn topic → Tóm tắt → nhận được kết quả từ Gemini API
