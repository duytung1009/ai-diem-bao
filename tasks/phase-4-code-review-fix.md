# Phase 4 — Code Review Fix

**Date:** 2026-03-17
**Based on review:** `review/phase-4.md`
**Build status after fix:** PASS (255.75 kB, type-check clean)

---

## Fixes Applied

### Critical

1. **`lib/llm/summarizer.ts` — `updateSummary` wrong prompt key**
   - `customPrompts?.summary || INCREMENTAL_UPDATE_PROMPT` → `INCREMENTAL_UPDATE_PROMPT`
   - Incremental updates no longer incorrectly use the custom summary prompt.

2. **`lib/llm/summarizer.ts` — `summarizeWithMapReduce` ignores `_finalPrompt`**
   - Renamed `_finalPrompt` → `finalPrompt` in `summarizeWithMapReduce`.
   - Added `reducePrompt: string = REDUCE_SUMMARY_PROMPT` parameter to `summaryChunks`.
   - `summaryChunks` now uses `reducePrompt` in the reduce step instead of the hardcoded constant.
   - Recursive reduce call now forwards `reducePrompt` through.
   - `summarizeWithMapReduce` passes `finalPrompt` as `reducePrompt` to `summaryChunks`.
   - Effect: custom summary prompts now work correctly for large topics that require map-reduce.

### Important

3. **`entrypoints/sidepanel/components/ExportButton.vue` — clipboard error handling**
   - Wrapped `copyMarkdown()` and `copyText()` in try/catch.
   - On failure shows error toast `'Không thể sao chép. Thử lại sau.'` instead of silently failing.

4. **`ErrorDisplay.vue` — unused component integrated into views**
   - Imported `ErrorDisplay` in `SummaryView.vue`, `OpinionsView.vue`, `ResearchView.vue`.
   - Replaced all inline `<div class="bg-red-50 ...">` error blocks with `<ErrorDisplay>`.
   - Views now show "Thử lại" / "Kiểm tra cài đặt" action buttons on error.

5. **`entrypoints/sidepanel/views/ResearchView.vue` — `suggestedQuestions` ignores title**
   - First suggestion now incorporates `title`: `Kết luận chính của topic "${title}" là gì?`

6. **`lib/llm/claude-adapter.ts` — hardcoded fallback model**
   - Removed `this.config.model || 'claude-opus-4-6'` silent fallback.
   - Now throws explicit error if `config.model` is empty: `'Model không được cấu hình. Vui lòng chọn model trong cài đặt.'`

### Minor / Code Quality

7. **`entrypoints/sidepanel/views/SettingsView.vue` — misleading `{{posts}}` validation**
   - Removed `for`-loop validation that required `{{posts}}` in custom prompts.
   - Removed the placeholder hint paragraph (`{{posts}}`, `{{topic_title}}`) from the template.
   - Reason: these placeholders were never actually interpolated into the LLM request.

8. **`entrypoints/sidepanel/components/ExportButton.vue` — `URL.revokeObjectURL` timing**
   - Changed `URL.revokeObjectURL(url)` → `setTimeout(() => URL.revokeObjectURL(url), 100)`.
   - Prevents potential race condition where the URL is revoked before the browser queues the download.

9. **`entrypoints/sidepanel/components/ExportButton.vue` — filename sanitisation regex**
   - Changed `[^a-zA-Z0-9À-ỹ\s]` → `[^\p{L}\p{N}\s]/gu` (Unicode-aware).
   - Correctly handles all Vietnamese tonal marks and non-ASCII characters.

10. **`entrypoints/sidepanel/views/ResearchView.vue` — `v-for` key on history**
    - Changed `:key="idx"` → `:key="entry.askedAt"`.
    - Prevents incorrect DOM reuse when items are prepended to the list.

11. **`lib/errors.ts` — `CacheError` and `NetworkError` lack error codes**
    - Added `CacheErrorCode` enum: `READ_FAILED`, `WRITE_FAILED`, `QUOTA_EXCEEDED`.
    - Added `NetworkErrorCode` enum: `OFFLINE`, `TIMEOUT`, `DNS_FAILED`.
    - Updated `CacheError` and `NetworkError` constructors to accept a code parameter.

---

## Deferred (not addressed — remain low-priority or out-of-scope)

- Dark mode
- Keyboard shortcuts
- Extension badge
- Service worker keep-alive
- Memory cleanup in content script
- Automated tests
- `ErrorDisplay` "Báo lỗi" action button
- `summarizeWithMapReduce` trivial wrapper inlining (kept for clarity)

---

## Files Changed

| File | Changes |
|---|---|
| `lib/llm/summarizer.ts` | Fix `updateSummary` prompt key; fix `_finalPrompt` forwarding; add `reducePrompt` param to `summaryChunks` |
| `lib/llm/claude-adapter.ts` | Remove silent model fallback, throw on empty model |
| `lib/errors.ts` | Add `CacheErrorCode` and `NetworkErrorCode` enums |
| `entrypoints/sidepanel/components/ExportButton.vue` | Clipboard try/catch; `revokeObjectURL` setTimeout; Unicode filename regex |
| `entrypoints/sidepanel/views/SummaryView.vue` | Import + use `ErrorDisplay` |
| `entrypoints/sidepanel/views/OpinionsView.vue` | Import + use `ErrorDisplay` |
| `entrypoints/sidepanel/views/ResearchView.vue` | Import + use `ErrorDisplay`; fix `suggestedQuestions` to use title; fix `v-for` key |
| `entrypoints/sidepanel/views/SettingsView.vue` | Remove `{{posts}}` validation and placeholder hint |
