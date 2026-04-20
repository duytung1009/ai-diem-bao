# Task: Feature 23 — Dynamic Segments + Auto Summarize All

## Summary

Implemented dynamic segment calculation based on token count and "Tóm tắt toàn bộ" button for one-click auto summarize of all segments.

## Files Changed

| File | Thay đổi |
|------|----------|
| `lib/constants.ts` | Added `CONTEXT_USAGE_RATIO = 0.75`, `DEFAULT_DYNAMIC_SEGMENTS = true` |
| `lib/types.ts` | Added `dynamicSegments?: boolean` to `LLMConfig`; added `complete?: boolean` to `TopicSegment` |
| `lib/token-estimator.ts` | Added `calculateSegmentBudget(model, systemPromptTokens, responseBuffer?)` |
| `entrypoints/sidepanel/composables/useSummarize.ts` | Major additions (see below) |
| `entrypoints/sidepanel/views/SummaryView.vue` | "Tóm tắt toàn bộ" button + dynamic info banner |
| `entrypoints/sidepanel/views/SettingsView.vue` | Dynamic segments toggle, conditional segment size slider |

## useSummarize.ts — Chi tiết thay đổi

- **`dynamicSegmentBoundaries`** ref: tracks dynamic segment boundaries reactively; restored from cache on `loadTopicData`
- **`segments` computed**: nếu `dynamicSegments=true` và boundaries đã có → dùng dynamic; fallback về fixed
- **`summarizeAndSaveSegment()`**: helper nội bộ — cập nhật boundaries, lưu posts sớm, gọi LLM, persist kết quả, xử lý stale guard
- **`autoSummarizeDynamic()`**: scrape từng trang một, tích lũy token, khi đạt budget → tách segment và summarize ngay; tiếp tục trang tiếp theo
- **`handleAutoSummarizeAll()`**: entry point công khai — dynamic mode lấy budget từ actual system prompt (custom hoặc default), fixed mode chạy từng segment theo thứ tự; cuối cùng generate overall summary

## Decisions

- **Scrape 1 trang/lần** thay vì batch 10 (planning): thời gian tổng đồng nhất vì delay/trang giống nhau; boundary detection chính xác hơn → tag [DECISION_NEEDED] trong code
- **`complete: false`** cho segment cuối khi `pendingTokens < budgetTokens`: cho phép append bài mới sau

## Self-review Results

- Issues found: 1
- Issues fixed: 1
  - `topicVersion: XenForoVersion` param truyền vào `autoSummarizeDynamic()` nhưng không dùng bên trong (hàm `scrapeRange` đọc version từ `topicInfo` nội bộ) → đã xoá param
- Remaining: không
