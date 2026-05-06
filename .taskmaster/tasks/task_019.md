# Task ID: 19

**Title:** F19: Cross-Segment Author Deduplication

**Status:** done

**Dependencies:** 20 ✓

**Priority:** medium

**Description:** Phân tách trách nhiệm: LLM làm semantic grouping, code làm exact dedup (đếm tác giả duy nhất cross-segment, xây bảng thống kê).

**Details:**

planning: planning/20260402_1409_19-feature-cross-segment-author-dedup.md

Vấn đề: LLM không dedup chính xác tác giả xuất hiện ở nhiều segment. Nghiêm trọng hơn khi segment count > 20.

Affected modules:
- lib/llm/summarizer.ts — buildAuthorCrossReference(), deduplicateSupporters(), sửa summarizeSegments()
- lib/prompts.ts — cập nhật REDUCE_SUMMARY_PROMPT với instruction bảng tác giả

**Test Strategy:**

Test với topic có tác giả xuất hiện ở nhiều segment. Verify supporter count không bị inflate. Verify giảm LLM hallucination ở opinion grouping.
