<context>
# Overview

Cập nhật và mở rộng danh sách LLM provider cho extension:
1. **Review & cleanup**: xóa Gemini 2.0 deprecated models, kiểm tra pricing
2. **DeepSeek**: thêm provider mới (OpenAI-compatible, giá rẻ)
3. **Grok (xAI)**: thêm provider mới (OpenAI-compatible)

# Core Features

## DeepSeek Provider
- Dùng OpenAI-compatible API (reuse OpenAIAdapter)
- Base URL: `https://api.deepseek.com/v1`
- Models: `deepseek-v4-flash` (1M context, $0.14/$0.28 per 1M tokens), `deepseek-v4-pro`
- Hỗ trợ thinking mode (server-side, adapter không cần xử lý gì thêm)
- API key format: `sk-...`

## Grok (xAI) Provider
- Dùng OpenAI-compatible API (reuse OpenAIAdapter)
- Base URL: `https://api.x.ai/v1`
- Models: `grok-4`, `grok-4-mini`
- Hỗ trợ reasoning mode

## Review & Cleanup
- Xóa `gemini-2.0-flash` và `gemini-2.0-flash-lite` khỏi PRICING_TABLE và DEFAULT_GEMINI_MODELS (deprecated)
- Kiểm tra độ chính xác pricing hiện tại

# User Experience
- Settings dropdown có thêm `DeepSeek` và `Grok (xAI)` options
- Hiển thị model và base URL mặc định tương ứng
- API key placeholder cập nhật cho từng provider
- HelpView có thêm 2 mục hướng dẫn cho DeepSeek và Grok
</context>
<PRD>
# Technical Architecture

## Component A: Review & Cleanup Existing Providers
Files cần sửa:
- `lib/token-estimator.ts`: Xóa gemini-2.0-flash, gemini-2.0-flash-lite khỏi PRICING_TABLE
- `entrypoints/sidepanel/views/SettingsView.vue`: Xóa gemini-2.0-flash, gemini-2.0-flash-lite khỏi DEFAULT_GEMINI_MODELS
- Kiểm tra các model pricing còn chính xác không

## Component B: Add DeepSeek Provider
Files cần sửa:
- `lib/types.ts:79`: Thêm `'deepseek'` vào LLMProvider union
- `lib/llm/factory.ts`: Thêm `case 'deepseek'` → OpenAIAdapter
- `lib/llm/provider-origins.ts`: Thêm base URL `https://api.deepseek.com/v1`
- `entrypoints/sidepanel/views/SettingsView.vue`:
  - Thêm providerDefaults entry
  - Thêm `<option value="deepseek">DeepSeek</option>` vào dropdown
  - Cập nhật placeholder text cho API key
- `lib/token-estimator.ts`: Thêm deepseek-v4-flash, deepseek-v4-pro vào PRICING_TABLE
- `entrypoints/sidepanel/views/HelpView.vue`: Thêm mục 1.5 hướng dẫn DeepSeek

Chi tiết pricing:
| Model | Input/1M | Output/1M | Context | Max Output | Thinking |
|---|---|---|---|---|---|
| deepseek-v4-flash | $0.14 | $0.28 | 1,000,000 | 393,216 | 0 (server-side) |
| deepseek-v4-pro | $0.435 (đang giảm 75%) | $0.87 | 1,000,000 | 393,216 | 0 (server-side) |

## Component C: Add Grok (xAI) Provider
Files cần sửa:
- `lib/types.ts:79`: Thêm `'grok'` vào LLMProvider union
- `lib/llm/factory.ts`: Thêm `case 'grok'` → OpenAIAdapter
- `lib/llm/provider-origins.ts`: Thêm base URL `https://api.x.ai/v1`
- `entrypoints/sidepanel/views/SettingsView.vue`:
  - Thêm providerDefaults entry
  - Thêm `<option value="grok">Grok (xAI)</option>` vào dropdown
- `lib/token-estimator.ts`: Thêm grok-4, grok-4-mini vào PRICING_TABLE
- `entrypoints/sidepanel/views/HelpView.vue`: Thêm mục 1.6 hướng dẫn Grok

Chi tiết pricing:
| Model | Input/1M | Output/1M | Context | Max Output | Thinking |
|---|---|---|---|---|---|
| grok-4 | $2.50 | $10.00 | 1,000,000 | 131,072 | 0 |
| grok-4-mini | $0.50 | $3.00 | 1,000,000 | 131,072 | 0 |

# Development Roadmap

## Phase 1: Review & Cleanup (Component A)
- [ ] Task 1: Update PRICING_TABLE: xóa Gemini 2.0 deprecated models, verify pricing
- [ ] Task 2: Update DEFAULT_GEMINI_MODELS: xóa Gemini 2.0 models

## Phase 2: DeepSeek Provider (Component B)
- [ ] Task 3: Thêm type + factory + provider-origins cho DeepSeek
- [ ] Task 4: Cập nhật SettingsView.vue cho DeepSeek
- [ ] Task 5: Thêm DeepSeek pricing vào PRICING_TABLE
- [ ] Task 6: Cập nhật HelpView.vue cho DeepSeek

## Phase 3: Grok Provider (Component C)
- [ ] Task 7: Thêm type + factory + provider-origins cho Grok
- [ ] Task 8: Cập nhật SettingsView.vue cho Grok
- [ ] Task 9: Thêm Grok pricing vào PRICING_TABLE
- [ ] Task 10: Cập nhật HelpView.vue cho Grok

## Phase 4: Verification
- [ ] Task 11: npm run compile + kiểm tra lỗi
- [ ] Task 12: Kiểm thử UI: chọn từng provider, test connection

# Logical Dependency Chain
1. Review & cleanup trước — xóa dữ liệu deprecated, tránh conflict sau
2. DeepSeek trước Grok (ưu tiên vì đã có pricing chính xác từ trang chủ)
3. Cả DeepSeek và Grok đều reuse OpenAIAdapter → không cần adapter mới
4. Verification cuối cùng

# Risks and Mitigations
- DeepSeek v4-pro pricing đang giảm 75% đến 2026/05/31 — cần monitoring để cập nhật sau
- Grok pricing có thể thay đổi — cần verify trước khi merge
- Cả hai đều dùng API key sk-... format tương tự OpenAI — có thể gây nhầm lẫn, cần placeholder riêng
- Grok 4 thinking/reasoning mode sử dụng response_format khác — adapter hiện tại bỏ qua reason_content field, chỉ đọc content → hoạt động bình thường

# Test Plan
1. npm run compile — zero TS errors
2. npm run test — all tests pass
3. UI: chọn từng provider, verify defaults load đúng
4. Test Connection với DeepSeek API key thật (nếu có)
5. Test Connection với Grok API key thật (nếu có)
</PRD>
