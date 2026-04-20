# Task: Refactor Technical Debt — SummaryView + TopicHubView + Shared Code

**Planning file:** `planning/20260401_1330_batch_refactor-technical-debt.md`
**Commit:** `ecc8559`
**Status:** DONE

---

## Changes Made

### Batch 1: Extract `useSummarize` composable
- **TẠO:** `entrypoints/sidepanel/composables/useSummarize.ts` (~450 LOC)
- **SỬA:** `entrypoints/sidepanel/views/SummaryView.vue`: ~1008 LOC → ~105 LOC trong `<script setup>`
- Toàn bộ state (13 refs), computed (8), watch, functions (11) đã chuyển vào composable
- SummaryView.vue giữ lại: imports, `useSummarize(store)` destructure, `onMounted`, `onActivated`, template

### Batch 2: Deduplicate cache save + post count helpers (tích hợp trong useSummarize.ts)
- Thêm `countRealPosts(posts)`: dedup pattern `posts.filter(p => p.postNumber > 0).length` (4x)
- Thêm `saveTopic(topic, fields)`: dedup pattern `sendMessage('SAVE_CACHED_TOPIC', ...)` (8x)

### Batch 3: Extract news detection subprocess (tích hợp trong useSummarize.ts)
- Thêm `enrichWithNewsArticles(posts, url, onStatus, onInfo)`: extract 30 LOC news detection
- `handleSummarize` giảm nesting từ 4 → 2 levels

### Batch 4: Deduplicate useLLM Promise wrappers
- **SỬA:** `entrypoints/sidepanel/composables/useLLM.ts`
- Thêm `createTask<TPayload>()` factory function
- 6 wrapper functions (`summarize`, `summarizeIncremental`, `analyzeOpinions`, `researchTopic`, `extractKnowledge`, `summarizeSegmentsTask`) → one-liners (~65 LOC saved)

### Batch 5: TopicHubView cleanup
- **SỬA:** `entrypoints/sidepanel/views/TopicHubView.vue`
- **5a:** Xóa `normalizeForCompare()` → import `normalizeUrl` từ `@/lib/cache-manager` (2 call sites)
- **5b:** Extract `refreshTopicList(showLoading)` → dedup `onMounted` và `onActivated` (~20 LOC saved)
- **5c:** Thay deep watch `store.selectedTopic` bằng `selectedTopicKey` computed watch (không còn deep-scan posts array)
- **5d:** Fix pre-existing TS error: `knowledgeEntries` readonly — thêm spread + `as KnowledgeEntry[]`

### Batch 6: Dead code cleanup + constants extraction
- **XÓA:** `entrypoints/sidepanel/composables/useCache.ts` (54 LOC, zero imports)
- **XÓA:** `scrapeAllPages()` từ `lib/scrapers/page-loader.ts` (80 LOC, zero imports sau Feature 18)
- **THÊM vào `lib/constants.ts`:** 9 named constants:
  - `KEEPALIVE_INTERVAL_MS = 20_000`
  - `FALLBACK_MS_PER_TOKEN = 20`
  - `LLM_TASK_CLEANUP_DELAY_MS = 5_000`
  - `MAP_REDUCE_CHUNK_DELAY_MS = 100`
  - `RESPONSE_BUFFER_TOKENS = 2_000`
  - `FRESHNESS_ONE_DAY_MS`, `FRESHNESS_ONE_WEEK_MS`
  - `MAX_CACHE_DISPLAY_BYTES = 50 * 1024 * 1024`
- **THÊM vào `lib/types.ts`:** `LLMProgressCallback` type
- **CẬP NHẬT call sites:** `lib/llm/summarizer.ts`, `useLLM.ts`, `background/index.ts`, `SettingsView.vue`

### Batch 7: page-loader.ts dedup
- **SỬA:** `lib/scrapers/page-loader.ts`
- Extract `deduplicateAndSort(posts)` helper
- `scrapePageRange` dùng helper thay vì inline dedup+sort

---

## LOC Impact

| File | Before | After | Delta |
|------|--------|-------|-------|
| SummaryView.vue | 1008 | ~338 (template giữ nguyên) | -670 |
| useSummarize.ts | — | 450 | +450 |
| useLLM.ts | ~230 | ~175 | -55 |
| TopicHubView.vue | ~280 | ~265 | -15 |
| useCache.ts | 54 | 0 (deleted) | -54 |
| page-loader.ts | ~185 | ~110 | -75 |
| constants.ts | 25 | 50 | +25 |
| types.ts | ~175 | ~177 | +2 |
| summarizer.ts | ~370 | ~372 | +2 |

**Net:** -390 LOC

---

## Self-review Results

- Issues found: 3
- Issues fixed: 3
- Remaining: 1 pre-existing error (KnowledgeView.vue readonly knowledgeEntries — out of scope)

**Issues fixed during implementation:**
1. `saveTopic()` type signature tổng quát hóa `segments` field để chấp nhận `(TopicSegment | null)[]`
2. `knowledgeEntries` readonly error trong TopicHubView watch — thêm `as KnowledgeEntry[]`
3. Variable shadowing `cachedPosts` trong `handleSummarize` — rename inner variable thành `existingPosts`

---

## Verification

- `npx vue-tsc --noEmit`: PASS (1 pre-existing error trong KnowledgeView.vue không liên quan)
- `npm run build`: PASS (372.26 kB total, built in 4.841s)
