# Phase 3 — Analysis Features

**Mục tiêu:** Thêm Claude adapter, phân tích luồng ý kiến, chunking/map-reduce cho topic dài, và token estimation.

---

## 3.1 Claude (Anthropic) Adapter

- [ ] `src/background/llm/claude-adapter.ts`:
  - Implement `LLMProvider` dùng Anthropic Messages API (`/v1/messages`)
  - Headers: `x-api-key`, `anthropic-version: 2023-06-01`
  - Request format: `{ model, max_tokens, messages: [{ role: "user", content }] }`
  - Response parsing: extract `content[0].text`
  - Error handling: 401 (invalid key), 429 (rate limit), 529 (overloaded)
- [ ] Update `factory.ts`: thêm case `'claude'` → `ClaudeAdapter`
- [ ] Update `SettingsView.vue`:
  - Dropdown provider: thêm "Anthropic Claude"
  - Khi chọn Claude: ẩn Base URL field, hiện model selector (claude-sonnet-4-20250514, claude-haiku-4-5-20251001...)
  - "Test Connection" hoạt động cho cả 2 provider

## 3.2 Opinion Analysis

- [ ] `src/sidepanel/views/OpinionsView.vue`:
  - UI hiển thị phân tích luồng ý kiến:
    - Các phe/quan điểm chính (grouped)
    - Số người ủng hộ mỗi quan điểm
    - Trích dẫn tiêu biểu
    - Sentiment tổng quan (tích cực / tiêu cực / trung lập)
  - Nút "Phân tích ý kiến" trigger riêng (không dùng summary prompt)
  - Lưu kết quả vào `cached.summaries.opinions`
- [ ] Prompt template cho opinion analysis:
  - System prompt tiếng Việt chuyên phân tích diễn đàn
  - Yêu cầu output structured: JSON hoặc markdown format cố định
  - Ví dụ output mẫu trong prompt (few-shot)
- [ ] `src/shared/prompts.ts` (mới):
  - `SUMMARY_PROMPT` — prompt cho tóm tắt chính
  - `OPINION_PROMPT` — prompt cho phân tích ý kiến
  - `INCREMENTAL_UPDATE_PROMPT` — prompt cho cập nhật incremental
  - Mỗi prompt có placeholder `{{posts}}`, `{{topic_title}}`, etc.

## 3.3 Chunking / Map-Reduce cho Topic Dài

- [ ] `src/background/summarizer.ts` — upgrade logic:
  - **Chunk splitter:**
    - Ước lượng tokens cho mỗi post (chars / 4 cho tiếng Anh, chars / 2 cho tiếng Việt)
    - Chunk posts sao cho mỗi chunk < model context limit (với buffer cho prompt + response)
    - Giữ nguyên post boundaries (không cắt giữa post)
  - **Map phase:**
    - Mỗi chunk → gửi LLM với prompt "Tóm tắt đoạn thảo luận này"
    - Chạy sequential (tránh rate limit) hoặc parallel (nếu user muốn nhanh)
    - Collect partial summaries
  - **Reduce phase:**
    - Gộp tất cả partial summaries → gửi LLM với prompt "Tổng hợp các bản tóm tắt thành 1 bản cuối cùng"
    - Nếu reduce vẫn quá dài → recursive reduce
- [ ] Progress reporting cho map-reduce:
  - "Đang tóm tắt phần 2/5..."
  - Hiển thị trên Side Panel

## 3.4 Token Estimation

- [ ] `src/background/token-estimator.ts`:
  - `estimateTokens(text: string): number` — ước lượng nhanh (không cần tiktoken)
    - Heuristic: `Math.ceil(text.length / 3.5)` cho mix tiếng Việt/Anh
  - `estimateCost(tokens: number, model: string): { input: number, output: number, total: number }`
    - Bảng giá per-model (có thể hardcode hoặc config)
  - `willExceedContext(posts: ScrapedPost[], model: string): { exceeds: boolean, estimatedTokens: number, contextLimit: number, chunksNeeded: number }`
- [ ] UI trước khi chạy LLM:
  - Hiển thị: "Ước tính ~15,000 tokens (khoảng $0.02)"
  - Nếu cần chunking: "Topic dài, cần chia thành 3 phần để tóm tắt"
  - Nút xác nhận trước khi gọi API (tránh tốn tiền ngoài ý muốn)

## 3.5 Composables Refactor

- [ ] `src/sidepanel/composables/useLLM.ts`:
  - `useLLM()` → `{ summarize, analyzeOpinions, isLoading, error, progress }`
  - Wrap messaging logic, reactive state
- [ ] `src/sidepanel/composables/useCache.ts`:
  - `useCache(topicUrl)` → `{ cached, freshness, refresh, clear }`
- [ ] `src/sidepanel/composables/useScraper.ts`:
  - `useScraper()` → `{ scrape, isScripting, progress, cancel }`

## 3.6 Integration & Testing

- [ ] Test Claude adapter với API key thật
- [ ] Test opinion analysis trên topic có nhiều tranh luận
- [ ] Test map-reduce trên topic 100+ trang
- [ ] Test token estimation accuracy (so sánh với actual usage)
- [ ] Verify cache lưu đúng khi có cả summary + opinions

---

**Definition of Done Phase 3:**
Extension hỗ trợ cả OpenAI và Claude, phân tích được luồng ý kiến, xử lý topic dài bằng map-reduce, và hiển thị ước lượng token/cost trước khi chạy.
