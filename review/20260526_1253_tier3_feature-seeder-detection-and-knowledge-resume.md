# Review: Feature 28 (Seeder Detection) + Tasks 269–274 (Knowledge Chunk Resume)

### Metadata
- **Files reviewed:** 26 files, 2139 insertions / 117 deletions
- **Review tier:** tier3
- **Model used:** sonnet
- **Diff size:** ~2139 LOC added

---

### Checklist

| Category | Status | Notes |
|----------|--------|-------|
| Logic correctness | ✅ | Salvage chain, resume logic, trust scoring all correct |
| Edge cases covered | ✅ | no_meta path, VOZ title-only, partial JSON rescue, empty chunks |
| Error handling | ✅ | Trust scorer wrapped in try/catch (non-fatal), salvage on INCOMPLETE_RESPONSE |
| Performance concerns | ✅ | Trust computation O(n) per user, seenUsers dedup in scraper |
| Security implications | ✅ | No new attack surface; scores are display-only |
| Consistency with patterns | ✅ | Follows singleton composable pattern, LLMError extension |
| Type safety | ✅ | Post-fix: all compile errors resolved |
| Test coverage | ⚠️ | No new unit tests for trust-scorer.ts or tryRescuePartialArray |

---

### Issues Found

| # | Severity | Category | Description | Suggestion |
|---|----------|----------|-------------|------------|
| 1 | critical | Build | 6 TypeScript errors from truncated working-tree files (errors.ts, openai/claude/gemini adapters, background/index.ts, useKnowledge.ts) | **FIXED** — restored from git index via `git show :<file>` |
| 2 | critical | Build | lib/types.ts also truncated (375 vs 379 lines), causing `PipelineDefinition` to be undefined | **FIXED** — restored from git index |
| 3 | major | Debug leak | `SummaryContent.vue` onMounted: `console.log('userTrustScores:', props.userTrustScores)` left in | **FIXED** — removed |
| 4 | major | Debug leak | `SummaryContent.vue` lines 67–68: two `console.log` inside sections computed (parsing section raw, parsed section) | **FIXED** — removed |
| 5 | major | UX/Production | `SettingsView.vue` line 587: Claude provider labeled `"Anthropic Claude (Chắc không ai dùng đâu nhỉ)"` | **FIXED** — changed to `"Anthropic Claude"` |
| 6 | major | Logic | `lowTrustWarning` in ThreadAnalysisContent included `no_meta` users (score=0) in ratio — could falsely trigger ≥30% threshold on threads where metadata simply isn't available | **FIXED** — filter out `flags.includes('no_meta')` before computing ratio |
| 7 | minor | UX | `SettingsView.vue`: provider dropdown reordered with `custom` first. Original order was openai → gemini → gemini-free → claude → custom. New order puts custom first, which may be unexpected for most users | Left as-is — arguably better for power users; not a correctness issue |

---

### What Looks Good

- **Salvage chain is clean end-to-end**: adapter captures partial text in `LLMError.partialText` → background salvages via `tryRescuePartialArray` → sets `result.truncated` → `useKnowledge` marks `chunk.failed` → `computeKnowledgeResumeState` finds first failed chunk for resume. No gaps.
- **`tryRescuePartialArray`** backward scan is a solid approach — finds the last complete `}` and closes the array. Handles the common LLM truncation pattern of cutting mid-object.
- **Trust scorer is well-structured**: pure function, testable, additive penalties with clear thresholds. VOZ rank path (title-only) and OtoFun vehicle-tier system handled as separate branches.
- **`seenUsers` dedup** in scrapers is correct — first-seen-wins prevents score dilution from users who post many times.
- **Non-fatal trust computation** in background: wrapped in try/catch, failures don't break save flow.
- **`KnowledgeChunk.failed` flag** is the right data model choice — persisted to cache so resume works across sessions.
- **Resume logic in `computeKnowledgeResumeState`** correctly slices `existingChunks` to `firstFailedIdx` (exclusive), so previously extracted chunks aren't re-processed.
- **`estimateAutoSummarizeCostFromSegments`** uses actual segment count instead of re-deriving — fixes the cost estimate accuracy bug.
- **`mergePartialTopic`** preserves `userTrustScores` — avoids clobber on partial saves.

---

### Summary

- **Overall:** approve (with fixes applied)
- **Key concern:** All 4 critical/major issues were fixed in-session. The only remaining gap is test coverage for the new pure functions (`computeTrustScores`, `tryRescuePartialArray`) — recommended as follow-up tasks rather than blockers.
