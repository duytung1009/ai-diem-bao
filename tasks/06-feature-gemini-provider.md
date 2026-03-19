# Feature 06: Gemini LLM Provider — Tóm tắt thực hiện

## Mục tiêu
Thêm Google Gemini vào danh sách LLM provider, cho phép user chọn và sử dụng Gemini trong Settings.

## Các file đã thay đổi

### Mới: `lib/llm/gemini-adapter.ts`
- Tạo `GeminiAdapter` class implement `LLMProvider` interface
- Dùng Gemini REST API: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- API key qua header `x-goog-api-key` (không dùng Bearer token)
- Payload: `systemInstruction.parts[].text` + `contents[{role:'user', parts:[{text}]}]`
- Response: `candidates[0].content.parts[0].text` + `usageMetadata.promptTokenCount/candidatesTokenCount`
- Default model: `gemini-2.0-flash`; timeout và retry theo pattern chuẩn (`withRetry` + `AbortController`)

### Sửa: `lib/types.ts`
- `LLMConfig.provider`: thêm `'gemini'` vào union type

### Sửa: `lib/llm/factory.ts`
- Import và thêm `case 'gemini': return new GeminiAdapter(config)` vào switch

### Sửa: `entrypoints/sidepanel/views/SettingsView.vue`
- Thêm `geminiModels` array: 4 model (flash-preview, pro-preview, flash, flash-lite)
- Thêm `isGemini` computed ref
- Provider dropdown: thêm option `<option value="gemini">Google Gemini</option>`
- API Key label: `isGemini ? 'Google AI API Key' : 'API Key'`
- API Key placeholder: `isGemini ? 'AIza...' : 'sk-...'`
- Base URL field: ẩn khi `isGemini` (`v-if="!isClaude && !isGemini"`)
- Gemini model selector: block `v-if="isGemini"` với dropdown 4 model
- OpenAI model input: ẩn khi `isGemini` (`v-if="!isClaude && !isGemini"`)

## Verification
- `npx vue-tsc --noEmit` → pass (chỉ có npm warn không liên quan)
- `npm run build` → pass, 307.76 kB total
