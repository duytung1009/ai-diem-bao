# Task 20: Unified Segment Mode (Remove Normal Mode)

## Summary

Gộp Normal Mode và Segment Mode thành 1 mode duy nhất — luôn dùng Segment Mode.

**Commit:** `d9dbdca`

## Changes

### `entrypoints/sidepanel/composables/useSummarize.ts`
- `isSegmentMode` computed: `Boolean(topicInfo)` thay vì `pageCount > segmentSize`
- `loadTopicData`: backward compat — legacy normal-mode topic (có `summary` nhưng không có `segments`) → synthesize `segmentSummaries[0]`
- `generateOverallSummary`: xử lý single-segment — copy trực tiếp, không gọi LLM
- `handleSegmentUpdate`: `completedCount >= 2` → `>= 1`
- Xóa `handleSummarize()`, `confirmSummarize()`, `cancelPendingSummarize()` (dead code)
- Xóa `pendingPosts`, `pendingIncremental` refs
- Xóa `tokenEstimation` computed
- Xóa `summarizeIncremental` từ useLLM destructuring
- Cập nhật return statement

### `entrypoints/sidepanel/views/SummaryView.vue`
- Xóa normal-mode "Tóm tắt" button và token estimation confirmation dialog
- Xóa normal-mode summary display block
- Outer template: `v-if="isSegmentMode && !isProcessing && !pendingPosts"` → `v-if="isSegmentMode && !isProcessing"`
- Info banner: `v-if="segments.length > 1"` (ẩn cho single-segment)
- Progress bar + pill grid: wrapped trong `v-if="segments.length > 1"`
- "Tổng quan" view: phân nhánh `segments.length === 1` vs multi-segment
  - Single: hiển thị `segmentSummaries[0].summary` trực tiếp + "Tóm tắt lại" button
  - Single (chưa tóm tắt): "Tóm tắt" button → `handleSummarizeSegment(0)`
  - Multi: giữ nguyên flow "Tạo tóm tắt tổng quan"

## Self-review Results
- Issues found: 0
- Issues fixed: 0
- Build: ✅ pass
- Type check: ✅ no new errors (pre-existing KnowledgeView error)

## Diff size: 169 insertions, 387 deletions (net -218 LOC)
