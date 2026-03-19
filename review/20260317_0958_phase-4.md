# Phase 4 Code Review

**Date:** 2026-03-17
**Reviewer:** Claude (automated)
**Scope:** Phase 4 implementation — Research, Export, Error Handling, Custom Prompts, UX Polish
**Build status at review:** PASS (254.99 kB, type-check clean)

---

## Summary

Phase 4 is largely complete and functional. Core features — ResearchView, ExportButton, ErrorDisplay, `lib/errors.ts`, retry logic in adapters, custom prompts in SettingsView, and lazy-loaded routes — are all implemented and structurally sound. The build passes and the bundle is within target.

Several bugs and gaps were found ranging from a logic error that silently breaks the incremental-update custom-prompt path, to unhandled async errors in clipboard operations, to a dead parameter in the summarizer, to the `ErrorDisplay` component being created but never used in any view.

---

## Critical

- [ ] **`summarizer.ts` — `updateSummary` uses wrong custom prompt key for incremental updates**

  **File:** `lib/llm/summarizer.ts`, line 44

  ```typescript
  const systemPrompt = customPrompts?.summary || INCREMENTAL_UPDATE_PROMPT;
  ```

  When the user sets a custom prompt for the "summary" tab, `updateSummary` silently uses it as the incremental-update prompt instead of always falling back to `INCREMENTAL_UPDATE_PROMPT`. The `CustomPrompts` interface has no dedicated `incremental` field, so the correct behaviour for incremental updates is to always use `INCREMENTAL_UPDATE_PROMPT` (or add a separate `incremental` key). As written, a custom summary prompt will be used verbatim for incremental updates, which will produce incorrect output because the two prompts have different instructions (the incremental prompt tells the model "you will receive an old summary AND new posts").

  **Fix:** Do not apply `customPrompts.summary` in `updateSummary`. Either keep the default unconditionally or add a `CustomPrompts.incremental` field:
  ```typescript
  // Option A — simplest correct fix:
  const systemPrompt = INCREMENTAL_UPDATE_PROMPT;
  // Option B — add customPrompts.incremental to types and SettingsView
  const systemPrompt = customPrompts?.incremental || INCREMENTAL_UPDATE_PROMPT;
  ```

- [ ] **`summarizer.ts` — `summarizeWithMapReduce` ignores the `_finalPrompt` parameter**

  **File:** `lib/llm/summarizer.ts`, lines 257–266

  ```typescript
  async function summarizeWithMapReduce(
    posts: ScrapedPost[],
    config: LLMConfig,
    onProgress?: (message: string) => void,
    suggestedChunks?: number,
    _finalPrompt?: string,   // ← prefixed with _ and never used
  ): Promise<string> {
    const combined = await summaryChunks(posts, config, onProgress, suggestedChunks);
    return combined;
  }
  ```

  The caller at line 28 passes `systemPrompt` (the custom or default summary prompt) as the fifth argument intending it to be used as the final reduce prompt:
  ```typescript
  return summarizeWithMapReduce(posts, config, onProgress, contextCheck.chunksNeeded, systemPrompt);
  ```
  But `_finalPrompt` is never forwarded to `summaryChunks` or used anywhere. For large topics that require map-reduce, the custom summary prompt is completely ignored and the hardcoded `REDUCE_SUMMARY_PROMPT` is always used instead.

  **Fix:** Forward `_finalPrompt` to the reduce step. Rename the parameter and pass it through:
  ```typescript
  async function summarizeWithMapReduce(
    posts: ScrapedPost[],
    config: LLMConfig,
    onProgress?: (message: string) => void,
    suggestedChunks?: number,
    finalPrompt?: string,
  ): Promise<string> {
    const combined = await summaryChunks(posts, config, onProgress, suggestedChunks, undefined, finalPrompt);
    return combined;
  }
  ```

---

## Important

- [ ] **`ExportButton.vue` — clipboard operations have no error handling**

  **File:** `entrypoints/sidepanel/components/ExportButton.vue`, lines 53–57, 59–62

  ```typescript
  async function copyMarkdown() {
    await navigator.clipboard.writeText(buildMarkdown());  // can throw
    showToast('Đã sao chép Markdown!');
    showDropdown.value = false;
  }
  ```

  `navigator.clipboard.writeText()` throws if clipboard permission is denied (e.g. the side panel does not have focus). An unhandled rejection will be silently swallowed, but the toast will never appear and the user sees no feedback.

  **Fix:** Wrap each clipboard call in try/catch and show an error toast on failure.

- [ ] **`ErrorDisplay.vue` is created but never used in any view**

  **File:** `entrypoints/sidepanel/components/ErrorDisplay.vue`

  The component was created as planned in 4.3, but no view (`SummaryView.vue`, `OpinionsView.vue`, `ResearchView.vue`) imports or renders it. All views use inline `<div class="bg-red-50 ...">` error blocks instead. The component provides the planned "Thử lại" / "Kiểm tra cài đặt" action buttons that are not present in inline error blocks.

  **Fix:** Replace inline error divs in each view with `<ErrorDisplay>`.

- [ ] **`ResearchView.vue` — `suggestedQuestions` computed ignores the actual topic title**

  **File:** `entrypoints/sidepanel/views/ResearchView.vue`, lines 15–24

  The computed reads `title` but then returns four static strings that do not reference `title` at all. The plan (4.1) specified "Gợi ý keyword/câu hỏi dựa trên nội dung topic đã scrape".

  **Fix:** Incorporate `title` into at least one suggestion, or remove the unused variable.

- [ ] **`claude-adapter.ts` — hardcoded fallback model name `'claude-opus-4-6'`**

  **File:** `lib/llm/claude-adapter.ts`, line 74

  `this.config.model || 'claude-opus-4-6'` — the fallback is only reached if `config.model` is an empty string, which indicates a misconfiguration that should be surfaced to the user, not silently overridden.

  **Fix:** Remove the silent fallback or replace with an explicit error.

---

## Minor / Code Quality

- [ ] **`SettingsView.vue` — custom prompt `{{posts}}` placeholder validation is misleading**

  **File:** `entrypoints/sidepanel/views/SettingsView.vue`, lines 95–101

  The validation requires `{{posts}}` in custom prompts, but this placeholder is never actually interpolated in `summarizer.ts` — the posts are formatted and appended separately by the adapter. Users who type `{{posts}}` will see the literal string in the LLM request.

  **Fix:** Either implement actual placeholder interpolation, or remove the placeholder hint and validation.

- [ ] **`ExportButton.vue` — `URL.revokeObjectURL` called synchronously after `a.click()`**

  **File:** `entrypoints/sidepanel/components/ExportButton.vue`, lines 65–77

  Revoking synchronously may revoke before the browser has queued the download. Use `setTimeout(() => URL.revokeObjectURL(url), 100)`.

- [ ] **`ExportButton.vue` — Vietnamese filename sanitisation may miss some characters**

  **File:** `entrypoints/sidepanel/components/ExportButton.vue`, line 71

  The regex `[^a-zA-Z0-9À-ỹ\s]` may not cover all Vietnamese tonal marks. More reliable: `[^\p{L}\p{N}\s]/gu`.

- [ ] **`ResearchView.vue` — Q&A history keyed by array index**

  **File:** `entrypoints/sidepanel/views/ResearchView.vue`, line 160

  Keying `v-for` by index causes incorrect DOM reuse when items are prepended. Key by `entry.askedAt` instead.

- [ ] **`lib/errors.ts` — `CacheError` and `NetworkError` have no error codes**

  **File:** `lib/errors.ts`, lines 80–94

  Unlike `ScrapingError` and `LLMError`, these lack code enums. The plan (4.3) specified "Error codes enum cho từng loại lỗi".

- [ ] **`summarizer.ts` — `summarizeWithMapReduce` is a trivial wrapper**

  **File:** `lib/llm/summarizer.ts`, lines 257–266

  Once the `_finalPrompt` bug is fixed, consider inlining the call to `summaryChunks` to remove unnecessary indirection.

---

## Deferred (planned but explicitly not implemented)

- [ ] **4.5 Dark mode** — `prefers-color-scheme` support or toggle
- [ ] **4.5 Keyboard shortcuts** — `Ctrl+Shift+S` global (requires `commands` in manifest)
- [ ] **4.5 Extension badge** — background polling for cache status
- [ ] **4.6 Service worker keep-alive** — no explicit keep-alive mechanism
- [ ] **4.6 Memory cleanup in content script** — listener disposal on unload not verified
- [ ] **4.8 Automated tests** — no test framework set up
- [ ] **`ErrorDisplay.vue` — "Báo lỗi" action button** — planned in 4.3, not implemented

---

## Plan vs Implementation Gap Summary

| Planned Item | Status | Notes |
|---|---|---|
| 4.1 ResearchView — Q&A input | DONE | |
| 4.1 ResearchView — Suggested questions | PARTIAL | Static list, not derived from topic content |
| 4.1 ResearchView — History persisted to cache | DONE | |
| 4.1 RESEARCH_PROMPT in prompts.ts | DONE | |
| 4.2 ExportButton — Copy Markdown/Text/Download | DONE | |
| 4.2 Toast notification | DONE | |
| 4.3 Custom error classes + codes | PARTIAL | `CacheError`/`NetworkError` lack codes |
| 4.3 Retry 3x exponential backoff in adapters | DONE | |
| 4.3 ErrorDisplay component | DONE (unused) | Component exists but not referenced in views |
| 4.4 SettingsView custom prompts section | DONE | |
| 4.4 Validate `{{posts}}` placeholder | DONE (misleading) | Placeholder not actually interpolated |
| 4.4 `chrome.storage.sync` persistence | DONE | |
| 4.5 Dark mode | DEFERRED | |
| 4.5 Keyboard shortcuts | DEFERRED | |
| 4.5 Extension badge | DEFERRED | |
| 4.6 Lazy load routes | DONE | |
| 4.6 Bundle < 500 kB | DONE | 254.99 kB |
| 4.7 README.md | DONE | |
| 4.8 Testing | DEFERRED | |
