# Task ID: 14

**Title:** F14: Custom Chunk & Reduce Prompt Templates

**Status:** done

**Dependencies:** 13 ✓

**Priority:** low

**Description:** Thêm 2 tab mới 'Tóm tắt phần' và 'Gộp tóm tắt' vào Settings → Prompt Templates, cho phép user tùy chỉnh CHUNK_SUMMARY_PROMPT (map) và REDUCE_SUMMARY_PROMPT (reduce).

**Details:**

planning: planning/20260321_1450_14-feature-custom-chunk-reduce-prompts.md

Affected modules:
- lib/types.ts — mở rộng CustomPrompts interface (thêm chunkSummaryPrompt, reduceSummaryPrompt)
- lib/llm/summarizer.ts — thread custom prompts qua toàn bộ pipeline
- entrypoints/sidepanel/views/SettingsView.vue — thêm 2 tab UI

Background index.ts không cần sửa — prompts từ getCustomPrompts() đã pass vào tất cả 4 hàm LLM.

**Test Strategy:**

Test custom chunk prompt override → verify LLM nhận đúng prompt. Test custom reduce prompt. Test fallback về default khi field rỗng.
