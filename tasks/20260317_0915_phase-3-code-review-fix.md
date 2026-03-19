# Phase 3 Code Review — Fix Summary

**Date:** 2026-03-15
**Review source:** `review/phase-3.md`
**Status:** All Critical + Important + Minor bugs fixed. Type check passes.

---

## Files Changed

| File | Bugs Fixed |
|---|---|
| `lib/types.ts` | Added `opinions?: string` to `CachedTopic` |
| `entrypoints/sidepanel/views/OpinionsView.vue` | BUG 1, BUG 4 (raw sendMessage) |
| `lib/llm/claude-adapter.ts` | BUG 2 (mock fallback removed by linter cleanup) |
| `lib/token-estimator.ts` | BUG 3 (double-counting responseBuffer) |
| `lib/llm/summarizer.ts` | BUG (chunkPosts merge), ISSUE 2 (OPINION_CHUNK_PROMPT), +recursive reduce (linter bonus) |
| `entrypoints/sidepanel/views/SummaryView.vue` | BUG 6 (stale local cachedTopic) |
| `entrypoints/sidepanel/composables/useScraper.ts` | ISSUE 1 (isScripting single-page) |
| `lib/prompts.ts` | Added `OPINION_CHUNK_PROMPT` |

---

## Fixes Applied

### Critical

#### BUG 1 — OpinionsView: opinions không lưu vào cache
- **File:** `entrypoints/sidepanel/views/OpinionsView.vue`
- `handleAnalyze()`: sau khi `opinions.value = result`, gọi `sendMessage('SAVE_CACHED_TOPIC', { opinions: result })`
- `onMounted`: load `result.opinions` từ cache nếu tồn tại để restore state qua reload

#### BUG 2 — ClaudeAdapter: mock fallback nuốt lỗi mạng thật
- **File:** `lib/llm/claude-adapter.ts`
- Toàn bộ `try/catch` block bao quanh `fetch()` đã được loại bỏ — lỗi thật sẽ propagate bình thường
- Mock response chỉ còn hoạt động khi `apiKey === 'mock-claude-key-for-testing'` (early return, trước fetch)

---

### Important

#### BUG 3 — `willExceedContext` double-count `responseBuffer`
- **File:** `lib/token-estimator.ts`
- **Trước:** `estimatedTokens = contentTokens + responseBuffer`, `chunksNeeded = ceil(estimatedTokens / (contextLimit - responseBuffer))` → responseBuffer bị trừ hai lần
- **Sau:** `chunksNeeded = ceil(contentTokens / (contextLimit - responseBuffer))` — `estimatedTokens` giữ nguyên để hiển thị UI, nhưng `chunksNeeded` không còn tính responseBuffer vào tử số

#### BUG 4 — `chunkPosts` merge path tạo chunk vượt context
- **File:** `lib/llm/summarizer.ts`
- **Trước:** split theo `contextLimit - bufferTokens`, nếu quá `maxChunks` thì `.flat()` merge → chunk có thể gấp đôi/gấp ba kích thước
- **Sau:** khi `suggestedChunks` được truyền vào, tính `maxTokensPerChunk = min(ceil(totalTokens / suggestedChunks), contextLimit - bufferTokens)` ngay từ đầu, split sạch tại post boundary

#### BUG 5 — `OpinionsView` dùng raw `browser.runtime.sendMessage`
- **File:** `entrypoints/sidepanel/views/OpinionsView.vue`
- `onMounted`: thay `browser.runtime.sendMessage({ type: 'GET_CACHED_TOPIC' })` bằng typed `sendMessage<CachedTopic | null>('GET_CACHED_TOPIC')` từ `@/lib/messaging`

#### BUG 6 — `SummaryView` giữ local copy `cachedTopic` với `url: ''`, `llmConfig: {}`
- **File:** `entrypoints/sidepanel/views/SummaryView.vue`
- **Trước:** sau `SAVE_CACHED_TOPIC`, construct local object thủ công với các field rỗng
- **Sau:** gọi `GET_CACHED_TOPIC` để lấy bản ghi đầy đủ từ background

---

### Minor / Code Quality

#### ISSUE 1 — `useScraper` không set `isScripting = true` cho single-page scrape
- **File:** `entrypoints/sidepanel/composables/useScraper.ts`
- `isScripting.value = true` đặt trước `try` block (vô điều kiện), `finally` reset về `false`
- Xóa `isScripting.value = false` dư thừa bên trong `if (totalPages > 1)`

#### ISSUE 2 — `analyzeOpinions` dùng `CHUNK_SUMMARY_PROMPT` (prose) cho map phase
- **File:** `lib/prompts.ts` + `lib/llm/summarizer.ts`
- Thêm `OPINION_CHUNK_PROMPT`: yêu cầu LLM liệt kê tác giả + lập trường + trích dẫn ngắn, không tóm tắt prose
- `summaryChunks()` nhận tham số `mapPrompt: string = CHUNK_SUMMARY_PROMPT`
- `analyzeOpinions` truyền `OPINION_CHUNK_PROMPT` vào map phase để giữ structured opinion signals cho reduce

---

### Bonus (linter applied during session)

#### Recursive reduce (plan 3.3, deferred)
- **File:** `lib/llm/summarizer.ts`
- Linter đã implement: sau map phase, nếu `combinedTokens > contextLimit && partialSummaries.length > 2`, convert partials thành fake posts và gọi đệ quy `summaryChunks` thay vì single-pass reduce
- Giải quyết "Recursive reduce not implemented" trong review

---

## Deferred to Phase 4 (không thay đổi)

- Refactor `SummaryView.vue` để dùng `useScraper` và `useCache` composables
- Real-time progress reporting qua streaming message từ background
- Integration testing với real API keys
