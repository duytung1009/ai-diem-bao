# Phase 3 Implementation Summary

**Ngày thực hiện:** 2026-03-15
**Code review fixes:** 2026-03-15
**Status:** DONE + Code Review Fixes — Build thành công, type-check sạch
**Bundle size:** 224.78 kB

---

## Code Review Fixes (review/phase-3.md)

### Critical
- **[FIXED]** `ClaudeAdapter` silent mock fallback: Removed catch block that returned fake data for any `fetch` error. Real network errors now propagate correctly.
- **[FIXED]** `OpinionsView` opinions not persisted: After `runAnalysis()` returns, now calls `sendMessage('SAVE_CACHED_TOPIC', { opinions })`. On `onMounted`, restores `opinions.value` from `cached.opinions` if present.

### Important
- **[FIXED]** `SAVE_CACHED_TOPIC` handler overwrites existing data on partial update: Now loads existing `CachedTopic` first and merges with `??` operator, so saving only `{ opinions }` doesn't wipe `posts`/`summary`.
- **[FIXED]** `CachedTopic` type missing `opinions` field: Added `opinions?: string` to interface in `lib/types.ts`.
- **[FIXED]** `OpinionsView` used raw `browser.runtime.sendMessage`: Replaced with typed `sendMessage<CachedTopic | null>('GET_CACHED_TOPIC')`.
- **[FIXED]** `willExceedContext` double-counting `responseBuffer` in `chunksNeeded`: Separated `contentTokens` (no buffer) for `chunksNeeded` formula; `estimatedTokens` (with buffer) only for the `exceeds` boolean check.
- **[FIXED]** `chunkPosts` merge path created oversized chunks: Removed post-process merge logic. Instead, when `suggestedChunks` is provided, pre-compute `maxTokensPerChunk` from `totalPostTokens / suggestedChunks` so splitting is correct from the start.
- **[FIXED]** Stale `cachedTopic.value` in `SummaryView` after save: After `SAVE_CACHED_TOPIC`, reloads with `GET_CACHED_TOPIC` to get authoritative record (real URL + llmConfig) instead of a hand-crafted partial object.

### Minor
- **[FIXED]** `useScraper.isScripting` false for single-page: `isScripting.value = true` now set unconditionally before `try`, not conditionally on `totalPages > 1`.
- **[FIXED]** `analyzeOpinions` chunking used wrong intermediate prompt: Added `OPINION_CHUNK_PROMPT` (asks LLM to extract structured author/stance/quote per-chunk) and passed as `mapPrompt` to `summaryChunks` path. Map phase now preserves opinion signals for the reduce step.
- **[FIXED]** No recursive reduce: `summaryChunks` now checks if `combinedText` of partial summaries would exceed context. If so, converts partials to fake posts and recursively calls itself before final reduce.

---

## Tổng quan

Phase 3 thêm các tính năng phân tích nâng cao: Claude adapter, opinion analysis, map-reduce chunking cho topic dài, token estimation UI, và composables refactor.

---

## Các file mới tạo

### `lib/prompts.ts`
Tập trung tất cả system prompts vào một file. Xuất các hằng số:
- `SUMMARY_PROMPT` — prompt tóm tắt chính, output Markdown với 3 section cố định
- `INCREMENTAL_UPDATE_PROMPT` — prompt cập nhật incremental
- `OPINION_ANALYSIS_PROMPT` — prompt phân tích ý kiến, yêu cầu output JSON với schema cố định
- `CHUNK_SUMMARY_PROMPT` — prompt tóm tắt từng chunk (map phase)
- `REDUCE_SUMMARY_PROMPT` — prompt gộp partial summaries (reduce phase)

### `lib/token-estimator.ts`
Utilities ước lượng token và chi phí:
- `estimateTokens(text)` — heuristic `chars / 3.5`
- `getContextLimit(model)` — lấy context limit theo model
- `estimateCost(inputTokens, outputTokens, model)` — tính chi phí USD theo bảng giá hardcode
- `willExceedContext(posts, model, ...)` — kiểm tra có cần chunking không, trả về `chunksNeeded`
- `formatTokenCount(n)` / `formatCost(n)` — format cho hiển thị UI
- Bảng giá: OpenAI (gpt-4o, gpt-4o-mini, gpt-4-turbo, gpt-3.5-turbo) và Claude (opus-4-6, sonnet-4-6, haiku-4-5)

### `lib/llm/claude-adapter.ts`
Implement `LLMProvider` interface cho Anthropic Messages API:
- URL: `https://api.anthropic.com/v1/messages`
- Headers: `x-api-key`, `anthropic-version: 2023-06-01`
- Request: `{ model, max_tokens: 2000, system, messages }`
- Response: extract `content[0].text`
- Error handling: 401 (invalid key), 429 (rate limit), 529 (overloaded)
- **Mock fallback:** Nếu API key = `mock-claude-key-for-testing` hoặc fetch lỗi → trả về bản tóm tắt mẫu (for testing)

### `entrypoints/sidepanel/views/OpinionsView.vue`
Tab mới "Ý kiến" trong side panel:
- Load `CachedTopic` từ background qua `GET_CACHED_TOPIC`
- Nút "Phân tích Ý kiến" → gọi `useLLM().analyzeOpinions(posts)` → `ANALYZE_OPINIONS` message
- Parse JSON response từ LLM (với regex strip code fences)
- Hiển thị: đề tài chính, sentiment (color-coded), danh sách quan điểm + supporters + trích dẫn, tổng kết
- Fallback sang MarkdownContent nếu parse JSON thất bại
- Warning nếu chưa có cached posts

### Composables

**`entrypoints/sidepanel/composables/useLLM.ts`**
- `summarize(posts)` → gọi `SUMMARIZE` message
- `summarizeIncremental(previousSummary, newPosts)` → gọi `SUMMARIZE_INCREMENTAL`
- `analyzeOpinions(posts)` → gọi `ANALYZE_OPINIONS`
- Reactive: `isLoading`, `error`, `progress`

**`entrypoints/sidepanel/composables/useCache.ts`**
- `load()` — load từ background, set `cached` và `freshness`
- `save(partial)` — gọi `SAVE_CACHED_TOPIC`
- `clear()` — gọi `DELETE_CACHED_TOPIC`
- `updateLocal(topic)` — cập nhật local ref + đặt freshness = 'fresh'
- `evaluateFreshness(topic, currentPostCount?)` — logic tính fresh/stale/outdated

**`entrypoints/sidepanel/composables/useScraper.ts`**
- `scrape(tabId, totalPages)` — single page hoặc multi-page, trả về `{ posts, warnings, error? }`
- `cancel(tabId)` — gửi `CANCEL_SCRAPE`
- `startListening()` / `stopListening()` — subscribe `SCRAPE_PROGRESS` messages
- Reactive: `isScripting`, `progress`

---

## Các file sửa đổi

### `lib/llm/factory.ts`
Thêm `import { ClaudeAdapter }` và `case 'claude': return new ClaudeAdapter(config)`.

### `lib/llm/summarizer.ts`
**Rewrite hoàn toàn** từ 2 functions đơn giản thành full map-reduce engine:
- `summarizeTopic(posts, config, onProgress?)` — entry point, auto-detect cần chunking không
- `updateSummary(prev, newPosts, config, onProgress?)` — incremental update với chunking
- `analyzeOpinions(posts, config, onProgress?)` — opinion analysis với chunking nếu cần
- `testLLMConnection(config)` — giữ nguyên
- `chunkPosts(posts, model)` — split posts theo context limit, giữ post boundaries
- `summaryChunks(posts, config, onProgress)` — map phase: tóm tắt sequential + reduce phase: gộp
- `summarizeWithMapReduce(posts, config, onProgress)` — wrapper

### `lib/types.ts`
Thêm `'ANALYZE_OPINIONS'` vào `MessageType`.

### `entrypoints/background/index.ts`
- Thêm `analyzeOpinions` vào import từ summarizer
- Thêm case `ANALYZE_OPINIONS` → gọi `analyzeOpinions(posts, config)` → `sendResponse({ opinions })`

### `entrypoints/sidepanel/main.ts`
Thêm route `/opinions` → `OpinionsView` vào Vue Router.

### `entrypoints/sidepanel/App.vue`
Thêm tab "Ý kiến" vào nav bar (3 tabs: Tóm tắt, Ý kiến, Cài đặt).

### `entrypoints/sidepanel/views/SettingsView.vue`
- Provider dropdown: thêm option "Anthropic Claude"
- Khi chọn Claude: ẩn Base URL field, hiện model selector với danh sách hardcode
- `isClaude` và `isCustom` computed refs
- API Key label/placeholder đổi theo provider

### `entrypoints/sidepanel/views/SummaryView.vue`
**Token estimation flow (Phase 3.4):**
- Sau khi scrape xong → không gọi LLM ngay
- Lưu `pendingPosts` + show confirmation panel với token estimate & cost
- User xác nhận → `confirmSummarize()` gọi LLM
- User huỷ → `cancelPendingSummarize()` clear state
- Load config từ background on mount để có model name cho estimation

---

## Architecture Notes

### Message Flow
```
UI (OpinionsView) → useLLM.analyzeOpinions()
  → sendMessage('ANALYZE_OPINIONS', posts)
  → background/index.ts case 'ANALYZE_OPINIONS'
  → lib/llm/summarizer.analyzeOpinions(posts, config)
  → ClaudeAdapter.summarize(posts, OPINION_ANALYSIS_PROMPT)
  → Anthropic API (hoặc mock)
  → return { opinions: string }
```

### Map-Reduce Flow (cho topic dài)
```
summarizeTopic(posts)
  → willExceedContext() → chunksNeeded > 1?
  → chunkPosts() → ScrapedPost[][]
  → sequential: summarize(chunk[0]) → partial[0]
                summarize(chunk[1]) → partial[1]
                ...
  → reduce: summarize(join partials, REDUCE_SUMMARY_PROMPT) → final
```

### Provider Selection
- `LLMConfig.provider = 'claude'` → `ClaudeAdapter`
- `LLMConfig.provider = 'openai' | 'custom'` → `OpenAIAdapter`
- Factory pattern trong `lib/llm/factory.ts`

---

## Mock/Testing Notes
- Claude adapter: API key = `mock-claude-key-for-testing` → trả về canned response
- Không cần real API key để test UI flow
- Opinion analysis: JSON có thể được wrap trong markdown code fence → regex strip trước khi parse

---

## Điều chưa làm (reserved for Phase 4)
- SummaryView chưa dùng `useScraper` / `useCache` composables (refactor shallow)
- Progress reporting cho map-reduce chưa có real-time UI update (chỉ có `onProgress` callback nội bộ)
- Token estimation chưa dùng actual tokenizer cho cao độ chính xác (vẫn dùng heuristic chars/3.5)
