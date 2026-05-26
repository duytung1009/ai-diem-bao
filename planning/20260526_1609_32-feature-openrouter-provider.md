# Feature 32: OpenRouter Provider

## Overview

Thêm OpenRouter (https://openrouter.ai) như một LLM provider độc lập trong extension. OpenRouter là proxy API tổng hợp hàng trăm model từ nhiều provider (OpenAI, Anthropic, Google, Meta, Mistral...) qua một API key duy nhất, với nhiều model hoàn toàn **miễn phí** (hậu tố `:free`). Đây là lựa chọn lý tưởng cho user muốn dùng cloud LLM nhưng không muốn đăng ký nhiều service khác nhau.

OpenRouter dùng OpenAI-compatible API — về mặt kỹ thuật đây là mở rộng nhỏ của `custom` provider, nhưng cần xử lý riêng vì:
1. Cần gửi thêm headers `HTTP-Referer` và `X-Title` (bắt buộc theo ToS OpenRouter)
2. Model name dùng format `provider/model` (VD: `openai/gpt-4o-mini`, `meta-llama/llama-3.1-8b-instruct:free`)
3. Có section hướng dẫn riêng với khuyến nghị tương tự Local LLM (miễn phí, không lock-in)

## Goals

- User chọn "OpenRouter" trong dropdown Provider, nhập API key, chọn model → hoạt động ngay
- Tự động gửi đúng headers theo OpenRouter ToS (không cần user config thủ công)
- Section hướng dẫn 1.X trong HelpView với các model `:free` khuyến nghị cụ thể
- Không break các provider hiện tại

## Requirements

### Component A: `lib/types.ts` — Mở rộng LLMProvider type

```ts
// Trước
export type LLMProvider = 'openai' | 'claude' | 'gemini' | 'gemini-free' | 'custom';

// Sau
export type LLMProvider = 'openai' | 'claude' | 'gemini' | 'gemini-free' | 'openrouter' | 'custom';
```

### Component B: `lib/llm/openai-adapter.ts` — Hỗ trợ extra headers

OpenRouter bắt buộc gửi hai headers:
- `HTTP-Referer`: URL của ứng dụng (dùng extension ID hoặc GitHub repo URL)
- `X-Title`: Tên ứng dụng

Cách xử lý: kiểm tra `config.provider === 'openrouter'` trong `OpenAIAdapter.buildHeaders()` và thêm headers tương ứng. Không cần thay đổi `LLMConfig` — hardcode trong adapter vì đây là yêu cầu protocol cố định của OpenRouter, không phải config của user.

```ts
// Trong OpenAIAdapter, khi build request headers:
const headers: Record<string, string> = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${this.config.apiKey}`,
};
if (this.config.provider === 'openrouter') {
  headers['HTTP-Referer'] = 'https://github.com/user/ai-diem-bao'; // hoặc extension URL
  headers['X-Title'] = 'Lội Thớt Hộ';
}
```

### Component C: `lib/llm/factory.ts` — Route openrouter → OpenAIAdapter

```ts
case 'openrouter':
  return new OpenAIAdapter(config);
```

OpenRouter endpoint: `https://openrouter.ai/api/v1` (user không cần nhập thủ công — sẽ pre-fill từ `providerDefaults`).

### Component D: `entrypoints/sidepanel/views/SettingsView.vue` — UI

**Dropdown:**
```html
<option value="openrouter">OpenRouter (multi-model)</option>
```
Vị trí: đặt sau `custom`, trước `openai` — khuyến nghị cho user mới.

**`providerDefaults` entry:**
```ts
openrouter: {
  model: 'meta-llama/llama-3.1-8b-instruct:free',
  apiKey: '',
  baseUrl: 'https://openrouter.ai/api/v1',
  temperature: 0.3,
  timeoutMs: 120000,
  maxTokens: 4096,
  contextWindow: undefined,
  thinkingEnabled: false,
  thinkingBudget: undefined,
},
```

**Base URL field:** Pre-fill `https://openrouter.ai/api/v1` và cho phép override (giống custom). Thêm helper text nhỏ dưới field khi provider = openrouter: _"OpenRouter tự động route đến model bạn chọn. Không cần sửa Base URL."_

**`isOpenRouter` computed:**
```ts
const isOpenRouter = computed(() => config.value.provider === 'openrouter');
```

**Model field helper text** khi `isOpenRouter`:
_"Dùng format `provider/model`, VD: `meta-llama/llama-3.1-8b-instruct:free`, `openai/gpt-4o-mini`, `google/gemini-2.0-flash-001:free`. Xem đầy đủ tại openrouter.ai/models"_

### Component E: `entrypoints/sidepanel/views/HelpView.vue` — Section hướng dẫn

Thêm card mới **1.2 — OpenRouter (Khuyến nghị)** ngay sau Local LLM (1.1 hiện tại), đẩy Gemini Free Tier xuống 1.3 và các provider paid xuống tương ứng.

**Nội dung card 1.2:**
- Badge `Khuyến nghị` (tương tự Local LLM)
- Note ngắn: có model `:free` hoàn toàn miễn phí, không cần chạy local
- Các bước:
  1. Đăng ký tài khoản tại `openrouter.ai`
  2. Vào `openrouter.ai/settings/keys` → "Create Key"
  3. Copy API key (bắt đầu bằng `sk-or-v1-...`)
  4. Mở extension → Cài đặt → Provider **"OpenRouter (multi-model)"**
  5. Dán API key
  6. Model name nhập theo format `provider/model` — gợi ý model `:free`:
     - `meta-llama/llama-3.1-8b-instruct:free` (8B, nhanh, miễn phí)
     - `google/gemini-2.0-flash-001:free` (mạnh hơn, miễn phí)
     - `mistralai/mistral-7b-instruct:free` (7B, ổn định)
     - Xem thêm: `openrouter.ai/models?q=free`
  7. Nhấn "Test Connection" → OK

**Alert trong card:**
> ℹ️ Model `:free` có rate limit (thường 20 req/min hoặc 200 req/ngày tùy model). Đủ cho dùng cá nhân, nếu cần nhiều hơn thì nạp credit và dùng model trả phí.

## Technical Considerations

- **OpenAI-compatible**: OpenRouter dùng exact same request/response format như OpenAI API — không cần adapter mới, chỉ cần headers bổ sung
- **Streaming**: OpenRouter hỗ trợ SSE streaming (giống OpenAI) — `OpenAIAdapter` hiện tại đã xử lý
- **Model pricing**: OpenRouter có pricing riêng cho từng model. Hiện tại `PRICING_TABLE` trong `token-estimator.ts` không có OpenRouter models — `costUsd` sẽ trả về `null` (hiển thị "N/A" trong UI). Không cần fix ngay — là known limitation
- **`finish_reason: 'length'`**: OpenRouter trả về OpenAI format — `LLMError.partialText` chain hoạt động sẵn
- **Context window**: Khác nhau theo từng model — user có thể override bằng "Context Window Override" field đã có sẵn
- **`perProvider` state**: Pattern save/restore settings per-provider đã có sẵn trong SettingsView — OpenRouter tự động được hưởng lợi
- **`HTTP-Referer` value**: Dùng `https://github.com/vuduytung/ai-diem-bao` hoặc một URL cố định — cần confirm URL đúng với owner

## Implementation Notes

Thứ tự implement:
1. `lib/types.ts` — thêm `'openrouter'` vào union type (ít nhất là để TypeScript không báo lỗi ở các bước sau)
2. `lib/llm/factory.ts` — thêm case
3. `lib/llm/openai-adapter.ts` — thêm OpenRouter headers
4. `entrypoints/sidepanel/views/SettingsView.vue` — dropdown + defaults + helper text
5. `entrypoints/sidepanel/views/HelpView.vue` — thêm card 1.2, renumber 1.2→1.3, 1.3→1.4

Files cần sửa:
- `lib/types.ts`
- `lib/llm/factory.ts`
- `lib/llm/openai-adapter.ts`
- `entrypoints/sidepanel/views/SettingsView.vue`
- `entrypoints/sidepanel/views/HelpView.vue`

## Test Plan

1. `npm run compile` — pass
2. Chọn OpenRouter → baseUrl tự điền `https://openrouter.ai/api/v1`
3. Nhập API key + model `meta-llama/llama-3.1-8b-instruct:free` → Test Connection → pass
4. Chạy tóm tắt một thread nhỏ → kết quả hiển thị đúng
5. Verify trong Network tab: request có headers `HTTP-Referer` và `X-Title`
6. Switch sang provider khác và back → settings được restore đúng
7. HelpView section 1.2 hiển thị đúng, các section 1.3, 1.4 vẫn đúng numbering

## Decision Log

### Quyết định 1: Provider mới vs dùng lại `custom`

- **Đã chọn:** Provider mới `'openrouter'`
- **Lý do:** `custom` yêu cầu user tự nhập base URL và tự biết cần headers gì — không user-friendly. OpenRouter có UX rõ ràng: một dropdown entry, pre-fill URL, auto-header, hướng dẫn step-by-step riêng. Về kỹ thuật chỉ là OpenAI adapter với vài dòng khác biệt nhưng UX improvement rất lớn.
- **Đã cân nhắc nhưng loại:**
  - Dùng lại `custom` và thêm preset button "Fill OpenRouter defaults" — loại vì UX phức tạp hơn, user vẫn phải biết headers
- **Điều kiện thay đổi:** Nếu số provider được yêu cầu tăng nhiều thì cân nhắc cơ chế preset/template thay vì hardcode từng case

### Quyết định 2: Extra headers — config vs hardcode trong adapter

- **Đã chọn:** Hardcode trong `OpenAIAdapter` khi `config.provider === 'openrouter'`
- **Lý do:** `HTTP-Referer` và `X-Title` là yêu cầu protocol cố định của OpenRouter, không phải preference của user. Không cần expose ra UI hay lưu vào config. Thêm field `extraHeaders` vào `LLMConfig` là over-engineering cho use case này.
- **Đã cân nhắc nhưng loại:**
  - `extraHeaders?: Record<string, string>` trong `LLMConfig` — loại vì complexity không cần thiết hiện tại
- **Điều kiện thay đổi:** Nếu có thêm provider khác cần custom headers thì mới nên generalize

### Quyết định 3: Vị trí trong dropdown

- **Đã chọn:** Đặt thứ 2 trong dropdown (sau Local LLM nhưng trước các provider paid)
- **Lý do:** OpenRouter free tier là lựa chọn cloud tốt nhất cho user mới (không cần credit card, có model mạnh miễn phí). Thứ tự phản ánh khuyến nghị: Local → OpenRouter free → Gemini free → Paid providers
- **Điều kiện thay đổi:** Nếu OpenRouter thay đổi chính sách free tier thì xem xét lại vị trí
