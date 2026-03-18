# Final Code Review — AI Diem Bao

**Date:** 2026-03-17
**Scope:** Full project review after all Phase 1–4 fixes applied
**Build status:** PASS (255 kB, type-check clean)

---

## Critical

- [ ] **[C-1] XSS via unsanitized `v-html` in MarkdownContent.vue**
  - File: `entrypoints/sidepanel/components/MarkdownContent.vue`
  - `marked.parse()` output rendered via `v-html` without sanitization. LLM responses or scraped posts with `<script>`, `onerror` attributes execute in extension context (access to `chrome.storage`, API keys).
  - Fix: Install `DOMPurify`, sanitize before rendering: `DOMPurify.sanitize(marked.parse(content))`

- [ ] **[C-2] ClaudeAdapter silent mock response when API key is empty**
  - File: `lib/llm/claude-adapter.ts`, lines 56–61
  - Falls back to `'mock-claude-key-for-testing'` and returns `generateMockResponse()` when `apiKey` is falsy. User sees fake summary with no indication it's not real.
  - Fix: Remove mock path entirely. Throw `LLMError(AUTH_FAILED, 'API key chưa được cấu hình.')` when key is empty.

- [ ] **[C-3] `max_tokens` hardcoded to 2000 in ClaudeAdapter**
  - File: `lib/llm/claude-adapter.ts`, line 77
  - Claude API's `max_tokens` is required and controls output length. 2000 tokens may truncate summaries mid-sentence silently. OpenAI adapter has no equivalent cap.
  - Fix: Add `maxTokens` to `LLMConfig` (default 4096), pass through: `max_tokens: this.config.maxTokens ?? 4096`

- [ ] **[C-4] `SCRAPE_PROGRESS` messages likely don't reach sidepanel**
  - File: `entrypoints/content/index.ts` line 66, `entrypoints/sidepanel/views/SummaryView.vue` line 47
  - Content script sends via `browser.runtime.sendMessage` which routes to background SW. Background returns `false` and does not forward. Sidepanel progress listener may never fire — `loadingText` stays at "trang 1/N" throughout.
  - Fix: In background, forward progress to sidepanel: `browser.runtime.sendMessage(message).catch(() => {})` for `SCRAPE_PROGRESS` case.

---

## Important

- [ ] **[I-1] `useScraper` and `useCache` composables created but never used**
  - Files: `composables/useScraper.ts`, `composables/useCache.ts`, `views/SummaryView.vue`
  - SummaryView duplicates scraping logic and `evaluateFreshness` inline instead of using composables. Bug fixes must be applied in 2 places.
  - Fix: Refactor SummaryView to use `useScraper()` and `useCache()`.

- [ ] **[I-2] `updateSummary` ignores `customPrompts` parameter**
  - File: `lib/llm/summarizer.ts`, line 44
  - Always uses `INCREMENTAL_UPDATE_PROMPT`. Custom summary prompt not applied for incremental updates.
  - Fix: `const systemPrompt = INCREMENTAL_UPDATE_PROMPT;` — keep as-is (incremental has different instructions), but document the decision.

- [ ] **[I-3] `summarizeWithMapReduce` ignores `_finalPrompt` parameter**
  - File: `lib/llm/summarizer.ts`, lines 258–266
  - Parameter prefixed with `_` and never forwarded. Custom prompt ignored during map-reduce.
  - Fix: Rename to `finalPrompt`, forward to `summaryChunks` reduce phase.

- [ ] **[I-4] `willExceedContext` double-counts system prompt in chunksNeeded**
  - File: `lib/token-estimator.ts`, lines 97–101
  - `contentTokens` includes `systemPromptLength`, but `usableTokensPerChunk` doesn't subtract it. Each chunk budgeted as if it has full context minus only response buffer.
  - Fix: `const usableTokensPerChunk = contextLimit - responseBuffer - systemPromptLength;`

- [ ] **[I-5] `chunkPosts` buffer always uses `CHUNK_SUMMARY_PROMPT` size**
  - File: `lib/llm/summarizer.ts`, line 146
  - Actual `mapPrompt` may be different (opinion chunk prompt, custom prompt). Oversized chunks possible.
  - Fix: Accept `mapPrompt` parameter in `chunkPosts`, use its token count for buffer.

- [ ] **[I-6] `evictOldest` removes only one item — may not free enough space**
  - File: `lib/cache-manager.ts`, lines 66–75
  - Single eviction may not bring usage below 8MB threshold. Subsequent `set` can hit Chrome's 10MB hard limit.
  - Fix: Loop eviction until usage is below threshold.

- [ ] **[I-7] `withRetry` duplicated in both adapters**
  - Files: `lib/llm/openai-adapter.ts` lines 7–22, `lib/llm/claude-adapter.ts` lines 7–22
  - Identical code. Divergence risk on future changes.
  - Fix: Extract to `lib/llm/retry.ts`.

- [ ] **[I-8] `ExportButton.vue` clipboard ops have no error handling**
  - File: `entrypoints/sidepanel/components/ExportButton.vue`, lines 53–62
  - `navigator.clipboard.writeText()` throws if sidepanel doesn't have focus. Toast never shows.
  - Fix: Wrap in try/catch, show error toast on failure.

- [ ] **[I-9] `onTabActivated` fires for all windows**
  - File: `entrypoints/sidepanel/views/SummaryView.vue`, lines 54–59
  - Tab switch in a second window triggers `resetState()` + `detectTopic()` in sidepanel of first window, wiping a valid summary.
  - Fix: Store `windowId` on mount, guard: `if (activeInfo.windowId !== currentWindowId) return;`

- [ ] **[I-10] ResearchView sends all raw posts on every query**
  - File: `entrypoints/sidepanel/views/ResearchView.vue`, lines 48–50
  - Full post array serialized via `sendMessage` on every research query. Background could load from cache directly.
  - Fix: Background loads posts from `getCachedTopic(url)`, UI sends only `question`.

- [ ] **[I-11] `resetPrompt` does not persist — reset lost if user navigates away**
  - File: `entrypoints/sidepanel/views/SettingsView.vue`, lines 103–105
  - Only clears local ref, doesn't call `savePrompts()`. Reset lost on next open.
  - Fix: Call `savePrompts()` inside `resetPrompt()`.

- [ ] **[I-12] `getCacheSize` fetches all storage on every save**
  - File: `lib/cache-manager.ts`, lines 55–64
  - `browser.storage.local.get(null)` reads everything. Use `browser.storage.local.getBytesInUse()` instead.

- [ ] **[I-13] Recursive reduce discards original mapPrompt for opinion analysis**
  - File: `lib/llm/summarizer.ts`, line 239
  - Recursive call hardcodes `REDUCE_SUMMARY_PROMPT` as `mapPrompt`, losing `OPINION_CHUNK_PROMPT`.

---

## Minor

- [ ] **[M-1] `normalizeUrl` duplicated in 3 files**
  - Files: `lib/scrapers/xf2-scraper.ts`, `lib/scrapers/xf1-scraper.ts`, `lib/cache-manager.ts`
  - Fix: Extract to shared `lib/url-utils.ts`.

- [ ] **[M-2] Posts with `postNumber === 0` bypass deduplication**
  - File: `lib/scrapers/page-loader.ts`, lines 95–100
  - Fix: Add secondary dedup key (`author + timestamp`) for posts without numbers.

- [ ] **[M-3] `OPINION_ANALYSIS_PROMPT` requests JSON but result never parsed**
  - Files: `lib/prompts.ts`, `lib/llm/summarizer.ts`
  - Prompt says "PHẢI tuân theo format JSON" but `analyzeOpinions` returns raw string.
  - Fix: Either parse JSON in `analyzeOpinions`, or change prompt to request Markdown.

- [ ] **[M-4] `XF2Scraper.getCurrentPage` uses incorrect CSS selector**
  - File: `lib/scrapers/xf2-scraper.ts`, lines 37–38
  - `.pageNav-page--current .pageNav-page` looks for descendant, but they're the same element.
  - Fix: `.pageNav-page--current`

- [ ] **[M-5] `ExportButton.vue` — `URL.revokeObjectURL` called synchronously after `a.click()`**
  - Fix: `setTimeout(() => URL.revokeObjectURL(url), 100)`

- [ ] **[M-6] Vietnamese filename sanitisation regex may miss characters**
  - File: `entrypoints/sidepanel/components/ExportButton.vue`, line 71
  - Fix: Use `[^\p{L}\p{N}\s]/gu` instead of `[^a-zA-Z0-9À-ỹ\s]`

- [ ] **[M-7] ResearchView Q&A history keyed by array index**
  - File: `entrypoints/sidepanel/views/ResearchView.vue`, line 160
  - Items prepended, so index keys cause incorrect DOM reuse. Fix: Key by `entry.askedAt`.

- [ ] **[M-8] `ExportButton` dropdown has no Escape key dismissal**
  - Fix: Add `@keydown.escape.window="showDropdown = false"`

- [ ] **[M-9] `content/index.ts` — `DETECT_XF` silently drops message for non-XF pages**
  - Lines 15–17: Returns `false` without `sendResponse`. Sidepanel gets `undefined`.
  - Fix: Respond with `{ version: 'unknown' }` explicitly, or document the contract.

- [ ] **[M-10] Token ratio `3.5` chars/token undocumented for Vietnamese**
  - File: `lib/token-estimator.ts`, line 4
  - Fix: Add comment citing source; ideally validate against real tokenizer counts.

- [ ] **[M-11] `messaging.ts` — N listeners registered for N message types**
  - File: `lib/messaging.ts`
  - Each `onMessage` call registers a new `addListener`. 16+ listeners all fire on every message.
  - Fix: Consider single-listener dispatch map pattern.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 4 |
| Important | 13 |
| Minor | 11 |
| **Total** | **28** |

### Priority order for fixes:
1. **C-1** XSS sanitization (security)
2. **C-2** Remove mock response (correctness)
3. **C-3** `max_tokens` config (silent truncation)
4. **C-4** Progress forwarding (UX broken feature)
5. **I-1** Use composables (maintainability)
6. **I-3** Forward `finalPrompt` in map-reduce (custom prompts broken)
7. **I-4 + I-5** Token estimation fixes (chunking accuracy)
8. **I-6** Cache eviction loop (storage reliability)
9. **I-8** Clipboard error handling (UX)
10. **I-9** Window-scoped tab listener (multi-window bug)
