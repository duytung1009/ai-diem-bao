# Task ID: 25

**Title:** F25: Thread Analysis View

**Status:** done

**Dependencies:** 14 ✓

**Priority:** medium

**Description:** Thêm loại tóm tắt 'Phân tích Thread VOZ' với 8 sections (TỔNG QUAN, USER TIÊU BIỂU, LUỒNG TRANH LUẬN, COMBAT, TIMELINE, COMMENT NỔI BẬT, KẾT LUẬN, KIẾM HIỆP). 2 sub-tab trong Tổng quan, copy plain-text.

**Details:**

planning: planning/20260415_1948_25-feature-thread-analysis-view.md

Affected modules:
- lib/types.ts — ThreadAnalysisJSON interface + threadAnalysis? field trong CachedTopic
- lib/prompts.ts — THREAD_ANALYSIS_PROMPT
- lib/llm/summarizer.ts — generateThreadAnalysis(summaryJson, meta, config)
- entrypoints/background/index.ts — handler cho task mới trong START_LLM_TASK
- entrypoints/sidepanel/composables/useSummarize.ts — threadAnalysis ref + handleGenerateAnalysis()
- entrypoints/sidepanel/components/ThreadAnalysisContent.vue — component mới render 8 sections
- entrypoints/sidepanel/views/SummaryView.vue — 2 sub-tab 'Tóm tắt' / 'Phân tích'

**Test Strategy:**

Generate analysis sau khi có summary. Verify 8 sections present. Test copy plain-text. Test persist + reload từ cache. Test với news vs regular topic.
