# Bug Fix: Segment mode không trả về JSON format

**Date:** 2026-03-31 16:10
**Severity:** Medium
**Files changed:**
- `lib/types.ts`
- `lib/llm/summarizer.ts`
- `entrypoints/background/index.ts`
- `entrypoints/sidepanel/composables/useLLM.ts`
- `entrypoints/sidepanel/views/SummaryView.vue`

## Bug Description

Segment mode (tóm tắt chủ đề dài theo từng đoạn) không hiển thị format JSON mới (với supporter bars, trích dẫn) mà vẫn dùng format Markdown cũ.

Có 2 nguyên nhân riêng biệt:

### Nguyên nhân 1: Old cached segments thiếu `summaryJson`
Các segment được tóm tắt trước Feature 15 (JSON output) không có field `summaryJson` trong cache. Khi load từ cache, `SummaryContent` không có `json` prop → fallback về Markdown renderer.

### Nguyên nhân 2: `generateOverallSummary` dùng sai prompt
`generateOverallSummary` gọi `summarize(segmentPosts)` → dùng `SUMMARY_PROMPT` (thiết kế cho raw forum posts). Nhưng input là các JSON summaries đã được tóm tắt → cần `REDUCE_SUMMARY_PROMPT` (thiết kế để gộp nhiều JSON summaries).

## Fix

### Fix 1: Retroactive parse `summaryJson` khi load cache
Trong `loadTopicData()`, sau khi load `fresh.segments`, map qua từng segment:
- Nếu có `summary` nhưng không có `summaryJson` → thử parse bằng `parseSummaryJSON`
- Nếu parse thành công → populate `summaryJson` on-the-fly (không cần re-summarize)

### Fix 2: Thêm `summarize_segments` task type
- `lib/llm/summarizer.ts`: Thêm `summarizeSegments()` — format segments thành `--- Phần N ---\n{json}` và gọi LLM với `REDUCE_SUMMARY_PROMPT`
- `lib/types.ts`: Thêm `'summarize_segments'` vào `LLMTaskRequest.taskType` union
- `entrypoints/background/index.ts`: Xử lý `case 'summarize_segments'`
- `entrypoints/sidepanel/composables/useLLM.ts`: Thêm `summarizeSegmentsTask()` function
- `entrypoints/sidepanel/views/SummaryView.vue`: `generateOverallSummary` dùng `summarizeSegmentsTask` thay vì `summarize`

## Self-review Results
- Issues found: 2
- Issues fixed: 2
- Remaining: none
