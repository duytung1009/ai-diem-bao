# Final Review Fix — Summary

**Date:** 2026-03-18
**Based on:** `review/final-review.md` (28 issues: 4 Critical, 13 Important, 11 Minor)
**Build after fix:** PASS (278.31 kB, type-check clean)

---

## Fixes Applied

### Critical

**[C-1] XSS via unsanitized `v-html` in MarkdownContent.vue**
- Installed `dompurify` + `@types/dompurify`
- `MarkdownContent.vue`: `html = DOMPurify.sanitize(marked.parse(...))` — sanitizes before rendering

**[C-2] ClaudeAdapter silent mock response when API key is empty**
- Removed mock path and `generateMockResponse()` entirely
- Now throws `new LLMError(LLMErrorCode.AUTH_FAILED, 'API key chưa được cấu hình...')` when `apiKey` is falsy

**[C-3] `max_tokens` hardcoded to 2000 in ClaudeAdapter**
- Added `maxTokens?: number` to `LLMConfig` in `lib/types.ts`
- ClaudeAdapter now uses `this.config.maxTokens ?? 4096` when calling Claude API

**[C-4] `SCRAPE_PROGRESS` messages don't reach sidepanel**
- Background `index.ts`: `SCRAPE_PROGRESS` case now calls `browser.runtime.sendMessage(message).catch(() => {})` before returning `false`
- Service worker re-broadcasts to all extension pages (sidepanel)

---

### Important

**[I-4] `willExceedContext` double-counts system prompt in chunksNeeded**
- `lib/token-estimator.ts`: `usableTokensPerChunk = contextLimit - responseBuffer - systemPromptLength`
- Previously subtracted only `responseBuffer`, making `chunksNeeded` under-estimated

**[I-5] `chunkPosts` buffer always uses `CHUNK_SUMMARY_PROMPT` size**
- `lib/llm/summarizer.ts`: `chunkPosts` now accepts `mapPrompt: string` as 3rd parameter
- Buffer = `estimateTokens(mapPrompt) + 2000` instead of hardcoded `CHUNK_SUMMARY_PROMPT`
- `summaryChunks` passes the actual `mapPrompt` through

**[I-6] `evictOldest` removes only one item**
- `lib/cache-manager.ts`: Replaced single-evict with a `while (usage > MAX_CACHE_BYTES)` loop
- Removes oldest topics one by one until usage drops below 8 MB
- Deleted the now-redundant `evictOldest()` helper

**[I-7] `withRetry` duplicated in both adapters**
- Extracted to `lib/llm/retry.ts`
- Both `openai-adapter.ts` and `claude-adapter.ts` now import `{ withRetry }` from `./retry`

**[I-9] `onTabActivated` fires for all windows**
- `SummaryView.vue`: Added `currentWindowId: number | undefined` variable
- `detectTopic()` captures `tab.windowId` alongside `tab.id`
- `onTabActivated` signature updated to `{ tabId, windowId }`, returns early if `windowId !== currentWindowId`

**[I-11] `resetPrompt` does not persist**
- `SettingsView.vue`: `resetPrompt()` now calls `savePrompts()` after clearing the local ref

**[I-13] Recursive reduce discards original mapPrompt (bonus fix while touching summarizer.ts)**
- Recursive `summaryChunks` call now passes `reducePrompt` as mapPrompt (instead of hardcoded `REDUCE_SUMMARY_PROMPT`)

---

### Minor

**[M-4] `XF2Scraper.getCurrentPage` uses incorrect CSS selector**
- `lib/scrapers/xf2-scraper.ts`: Changed `.pageNav-page--current .pageNav-page` → `.pageNav-page--current`

**[M-8] `ExportButton.vue` — no Escape key dismissal**
- Added `@keydown.escape.window="showDropdown = false"` on the outer container `<div>`

---

## Not Fixed (Deferred)

| ID | Reason |
|----|--------|
| I-1 | Refactoring composables — large scope, no functional regression |
| I-2 | Intentional: `updateSummary` uses `INCREMENTAL_UPDATE_PROMPT` by design |
| I-10 | Background cache look-up for ResearchView — requires messaging contract change |
| I-12 | `getCacheSize` efficiency — `getBytesInUse()` scope change, low risk |
| M-1 | `normalizeUrl` dedup — refactor, no functional bug |
| M-2 | Post dedup with `postNumber===0` — rare edge case |
| M-3 | `OPINION_ANALYSIS_PROMPT` JSON promise — prompt wording, no crash |
| M-5 | Already fixed in Phase 4 (`setTimeout` on `revokeObjectURL`) |
| M-6 | Already fixed in Phase 4 (Unicode regex) |
| M-7 | Already fixed in Phase 4 (`:key="entry.askedAt"`) |
| M-9 | Content script returns `false` for non-XF — sidepanel handles `undefined` gracefully |
| M-10 | Token ratio comment — documentation only |
| M-11 | Messaging listener pattern — refactor, no functional bug |

---

## Files Changed

| File | Changes |
|------|---------|
| `package.json` | Added `dompurify`, `@types/dompurify` |
| `entrypoints/sidepanel/components/MarkdownContent.vue` | DOMPurify sanitization |
| `entrypoints/sidepanel/views/SummaryView.vue` | `currentWindowId` guard, window-scoped tab listener |
| `entrypoints/sidepanel/views/SettingsView.vue` | `resetPrompt()` calls `savePrompts()` |
| `entrypoints/sidepanel/components/ExportButton.vue` | Escape key dismissal |
| `entrypoints/background/index.ts` | Forward `SCRAPE_PROGRESS` to sidepanel |
| `lib/types.ts` | `maxTokens?: number` added to `LLMConfig` |
| `lib/llm/claude-adapter.ts` | Remove mock, throw on empty key, use `maxTokens`, use shared `withRetry` |
| `lib/llm/openai-adapter.ts` | Use shared `withRetry` from `./retry` |
| `lib/llm/retry.ts` | **New** — shared `withRetry` implementation |
| `lib/llm/summarizer.ts` | `chunkPosts` takes `mapPrompt`, fix recursive reduce prompt, fix I-5/I-13 |
| `lib/token-estimator.ts` | Fix `usableTokensPerChunk` formula (subtract `systemPromptLength`) |
| `lib/cache-manager.ts` | Loop eviction, remove `evictOldest()` |
| `lib/scrapers/xf2-scraper.ts` | Fix `.pageNav-page--current` selector |
