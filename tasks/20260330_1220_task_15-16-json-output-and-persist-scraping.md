# Task: Feature 15 + 16 — JSON Output & Persist Scraping

**Ngày:** 2026-03-30
**Planning file:** `planning/20260330_1220_batch_json-output-and-persist-scraping.md`

## Summary

### Feature 15: JSON Output + Quote bài viết
LLM output tóm tắt chuyển từ Markdown tự do sang JSON có cấu trúc (`SummaryJSON`), mỗi quan điểm bổ sung mảng `quotes[]` chứa trích dẫn nguyên văn kèm `postNumber`.

### Feature 16: Persist Scraping Data
Save posts vào IndexedDB ngay sau khi scrape xong, trước khi chờ user confirm/LLM. User cancel hay LLM fail → không cần scrape lại lần sau.

---

## Changes

### `lib/types.ts`
- Thêm `QuoteItem`, `OpinionItem`, `SummaryJSON` interfaces
- Thêm `summaryJson?: SummaryJSON` vào `CachedTopic`
- Thêm `summaryJson?: SummaryJSON` vào `TopicSegment`

### `lib/prompts.ts`
- **SUMMARY_PROMPT**: rewrite → JSON output format với `summary/opinions[]/conclusion`; mỗi opinion có `title/description/supporters[]/quotes[]`
- **CHUNK_SUMMARY_PROMPT**: rewrite → JSON output format, giới hạn 300 từ, bảo toàn quotes cho map phase
- **REDUCE_SUMMARY_PROMPT**: rewrite → JSON output format, merge supporters, chọn tối đa 3 quotes/opinion

### `lib/llm/summarizer.ts`
- Thêm `export function parseSummaryJSON(raw: string): SummaryJSON | null` — parse + validate, xử lý markdown code fences
- `summarizeTopic()`: wrap kết quả qua `parseSummaryJSON()`, return `JSON.stringify(parsed)` nếu valid, hoặc raw string nếu không
- `updateSummary()`: giữ nguyên Markdown (INCREMENTAL_UPDATE_PROMPT vẫn dùng Markdown)

### `entrypoints/background/index.ts`
- `SAVE_CACHED_TOPIC` handler: thêm `summaryJson: partial.summaryJson ?? existing?.summaryJson` vào merge logic

### `entrypoints/sidepanel/components/SummaryContent.vue`
- Thêm `json?: SummaryJSON` prop
- JSON mode: render trực tiếp từ `SummaryJSON` — `summary` → MarkdownContent, `opinions[]` → AccordionItem + blockquotes cho `quotes[]`, `conclusion` → MarkdownContent
- Markdown fallback: giữ nguyên regex parse cho cache cũ / custom prompts
- `totalJsonSupporters` computed cho supporter bars

### `entrypoints/sidepanel/views/SummaryView.vue`
- `summaryJson` ref (`SummaryJSON | null`)
- Import `parseSummaryJSON` từ `lib/llm/summarizer` (bỏ duplicate local function)
- `loadTopicData()`: load `fresh.summaryJson` vào ref; reset `summaryJson.value = null` trong RESET block
- `handleSummarize(false)`: clear `summaryJson.value = null` cùng với `summary.value = ''`
- **Feature 16**: sau scrape + news detection, `SAVE_CACHED_TOPIC` với posts ngay, refresh `cachedTopic.value`
- `confirmSummarize()`: `tryParseSummaryJSON()` trên LLM result, save + set `summaryJson` prop
- `handleSummarizeSegment()`: Feature 16 save segment posts trước LLM; parse `segSummaryJson` sau LLM; save `summaryJson` vào segment
- `generateOverallSummary()`: parse `overallSummaryJson`, save + set `summaryJson`

### `entrypoints/sidepanel/views/TopicHubView.vue`
- Thêm import `SummaryJSON` từ `@/lib/types`
- Thêm `summaryJson: updated.summaryJson as SummaryJSON | undefined` trong watch khi merge vào `allTopics` (fix DeepReadonly TypeScript error)

---

## Self-review Results

- Issues found: 3
- Issues fixed: 3
- Remaining: none

### Issues fixed:

**C-1 (Critical) — Type error `TopicHubView.vue`:**
`store.selectedTopic` là `DeepReadonly<CachedTopic>` → `summaryJson.opinions` là `readonly OpinionItem[]`, không assign được vào mutable `SummaryJSON`. Fix: `summaryJson: updated.summaryJson as SummaryJSON | undefined` + thêm import.

**I-1 (Important) — Duplicate `parseSummaryJSON`:**
`tryParseSummaryJSON()` trong SummaryView.vue trùng hoàn toàn với `parseSummaryJSON()` trong summarizer.ts. Fix: import từ summarizer, alias local.

**I-2 (Important) — `summaryJson.value` không được clear khi Tóm tắt lại:**
`handleSummarize(false)` clear `summary.value = ''` nhưng không clear `summaryJson.value`. Về mặt template thì safe (section ẩn khi `!summary`), nhưng state inconsistent. Fix: thêm `summaryJson.value = null` trong block `!incremental`.

Type check: `npx vue-tsc --noEmit` → **PASS** ✅
