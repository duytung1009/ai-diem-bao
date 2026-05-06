# Task ID: 28

**Title:** Fix: Knowledge Reduce Output Overflow Prevention

**Status:** done

**Dependencies:** 24 ✓

**Priority:** medium

**Description:** runReducePhase không kiểm tra output budget. Chia thành nhiều call nhỏ nếu finalCap quá lớn cho 1 call, rồi client-side dedup.

**Details:**

planning: planning/20260417_1608_fix-knowledge-output-overflow.md

Vấn đề: finalCap = min(150, max(20, chunks×3)) không check output budget. 81 entries × ~100 tokens = ~8.1K output → dễ tràn 16K context.

Affected modules:
- entrypoints/sidepanel/views/KnowledgeView.vue — runReducePhase (thay đổi chính)
- lib/constants.ts — TOKENS_PER_KNOWLEDGE_ENTRY = 100, REDUCE_OUTPUT_FRACTION = 0.35

Implementation:
- maxOutputTokens = contextWindow × REDUCE_OUTPUT_FRACTION
- maxEntriesPerCall = floor(maxOutputTokens / TOKENS_PER_KNOWLEDGE_ENTRY)
- Chia input thành batches → concat + dedup by title+source
- guard finalEntries.length === 0 → throw error

**Test Strategy:**

Test với topic 27+ chunks → verify không tràn context. Verify dedup loại entries trùng title. Verify guard throw khi empty.
