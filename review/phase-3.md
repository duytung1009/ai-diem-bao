# Phase 3 Code Review

**Reviewed:** 2026-03-15
**Scope:** Phase 3 implementation — Claude adapter, opinion analysis, map-reduce chunking, token estimation, composables refactor
**Plan reference:** `planning/phase-3.md`
**Implementation reference:** `tasks/phase-3-implement.md`

---

## Plan vs Implementation Status

| Plan Item | Status | Notes |
|---|---|---|
| 3.1 Claude adapter — Anthropic Messages API | DONE | Correct headers, error codes, response parsing |
| 3.1 factory.ts — add `'claude'` case | DONE | |
| 3.1 SettingsView — Claude provider dropdown | DONE | |
| 3.1 SettingsView — hide Base URL for Claude | DONE | |
| 3.1 SettingsView — Claude model selector | DONE | |
| 3.1 SettingsView — Test Connection for both providers | DONE | |
| 3.2 OpinionsView.vue | DONE | |
| 3.2 Opinion analysis prompt | DONE | JSON schema in `OPINION_ANALYSIS_PROMPT` |
| 3.2 `lib/prompts.ts` with all named prompts | DONE | |
| 3.2 Cache opinions in `cached.summaries.opinions` | PARTIAL — see Bug 1 below | Opinions result is not saved to cache after analysis |
| 3.3 Chunk splitter (post-boundary aware) | DONE | |
| 3.3 Map phase — sequential summarization | DONE | |
| 3.3 Reduce phase — combine partial summaries | DONE | |
| 3.3 Recursive reduce if reduce still too long | NOT DONE | Single reduce pass only; no recursion |
| 3.3 Progress reporting for map-reduce in UI | NOT DONE | `onProgress` callback exists but background never forwards progress to UI via messaging |
| 3.4 `token-estimator.ts` — `estimateTokens` | DONE | heuristic `chars / 3.5` |
| 3.4 `estimateCost` | DONE | |
| 3.4 `willExceedContext` | DONE — with a bug, see Bug 3 below | |
| 3.4 Token/cost UI before calling API | DONE | Confirmation panel in SummaryView |
| 3.4 Chunking notice in confirmation UI | DONE | |
| 3.5 `useLLM` composable | DONE | |
| 3.5 `useCache` composable | DONE | |
| 3.5 `useScraper` composable | DONE — with a minor issue, see Bug 5 below | |
| 3.6 Integration tests with real API keys | NOT DONE | Deferred by implementation (Phase 4) |

---

## Bugs and Issues

### Critical

- [ ] **BUG: Opinion analysis result is never persisted to cache**
  - File: `entrypoints/sidepanel/views/OpinionsView.vue`, `handleAnalyze()` (line 46-52)
  - After `runAnalysis()` returns a result, `opinions.value` is set locally but no `SAVE_CACHED_TOPIC` message is sent. The plan (section 3.2) explicitly requires saving to `cached.summaries.opinions`. On page reload the analysis is lost.
  - Fix: After setting `opinions.value = result`, call `browser.runtime.sendMessage({ type: 'SAVE_CACHED_TOPIC', payload: { opinions: result } })` or use the `useCache` composable `save()` method.

- [ ] **BUG: Silent mock fallback swallows real network errors in ClaudeAdapter**
  - File: `lib/llm/claude-adapter.ts`, lines 89-94
  - The catch block returns a mock response for any error whose message contains `'fetch'`. `TypeError: Failed to fetch` (CORS, DNS failure, timeout) matches this and causes the adapter to silently return fake data instead of surfacing the error. Users with misconfigured network or no internet will see a fake "success" summary.
  - Fix: Remove the mock fallback from the catch block entirely, or restrict it to a specific condition (e.g. only in dev/test mode via a build flag). Let real errors propagate.
  ```ts
  // Remove or guard this block:
  if (error instanceof Error && error.message.includes('fetch')) {
    return this.generateMockResponse(); // <-- remove
  }
  ```

### Important

- [ ] **BUG: `willExceedContext` double-counts `responseBuffer` in `chunksNeeded` formula**
  - File: `lib/token-estimator.ts`, lines 97-99
  - `estimatedTokens` (line 97) already includes `responseBuffer` added to the post tokens and prompt. Then `chunksNeeded` divides by `(contextLimit - responseBuffer)` (line 99), subtracting the buffer again from the denominator. This causes the available tokens per chunk to be understated, leading to over-chunking on borderline topics.
  - Fix: Either exclude `responseBuffer` from `estimatedTokens` and keep the denominator as-is, or include it in `estimatedTokens` and use `contextLimit` (not `contextLimit - responseBuffer`) as the denominator.
  ```ts
  // Corrected option (recommended) — separate concerns clearly:
  const contentTokens = estimateTokens(postsText) + systemPromptLength;
  const usableTokensPerChunk = contextLimit - responseBuffer;
  const chunksNeeded = Math.ceil(contentTokens / usableTokensPerChunk);
  ```

- [ ] **BUG: `chunkPosts()` merge path can produce chunks that exceed context limit**
  - File: `lib/llm/summarizer.ts`, lines 127-135
  - When `chunks.length > maxChunks`, the code flattens adjacent chunk groups with `.flat()`. Each merged group combines multiple chunk's posts, potentially doubling or tripling the token count of a single chunk above `maxTokensPerChunk`. The resulting oversized chunk is sent to the LLM as-is, which will either truncate, error, or exceed context.
  - Fix: Do not merge already-split chunks. Instead, when `suggestedChunks` is provided, use it as a hint to set a larger `maxTokensPerChunk` from the start (re-derive chunk size from `Math.ceil(totalTokens / suggestedChunks)`), then split cleanly at post boundaries.

- [ ] **BUG: `OpinionsView.vue` uses raw `browser.runtime.sendMessage` instead of typed `sendMessage`**
  - File: `entrypoints/sidepanel/views/OpinionsView.vue`, line 39
  - All other views use `sendMessage()` from `@/lib/messaging` for type safety and consistent error handling. `OpinionsView` directly calls `browser.runtime.sendMessage({ type: 'GET_CACHED_TOPIC' })` without a typed wrapper. This is inconsistent and bypasses any centralized error handling.
  - Fix: Replace with the `useCache` composable `load()` method, or at minimum import and use `sendMessage` from `@/lib/messaging`:
  ```ts
  // Replace:
  const result = await browser.runtime.sendMessage({ type: 'GET_CACHED_TOPIC' });
  // With:
  const result = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC');
  ```

- [ ] **BUG: Local `cachedTopic` copy in `SummaryView.vue` has stale empty `url` and `llmConfig`**
  - File: `entrypoints/sidepanel/views/SummaryView.vue`, lines 247-257
  - After `confirmSummarize()` saves to the background via `SAVE_CACHED_TOPIC`, the local reactive `cachedTopic.value` is constructed manually with `url: ''` and `llmConfig: { provider: '', model: '' }`. The background fills in the real URL and config when persisting, but the front-end copy diverges. If any future code reads `cachedTopic.value.url` (e.g. for display or for `useCache.clear()`) it will get an empty string.
  - Fix: After `SAVE_CACHED_TOPIC` resolves successfully, reload the cached topic from background with `GET_CACHED_TOPIC` to get the authoritative stored record, rather than constructing a partial local copy.

### Minor / Code Quality

- [ ] **ISSUE: `useScraper` does not set `isScripting = true` for single-page scrapes**
  - File: `entrypoints/sidepanel/composables/useScraper.ts`, line 35
  - `isScripting.value = totalPages > 1` means single-page scrapes never flip `isScripting` to `true`. Any consumer checking `isScripting` to gate UI during single-page scraping will see it remain false. Only `progress` is set for single-page cases.
  - Fix: Set `isScripting.value = true` before the `try` block unconditionally and rely on the `finally` block to reset it.

- [ ] **ISSUE: `analyzeOpinions` chunking path uses wrong intermediate prompt**
  - File: `lib/llm/summarizer.ts`, lines 72-79
  - When topic is too large for the context, the function calls `summaryChunks()` which uses `CHUNK_SUMMARY_PROMPT` (a general prose summary prompt). The partial summaries it produces are then fed into `OPINION_ANALYSIS_PROMPT`. Since `CHUNK_SUMMARY_PROMPT` optimizes for prose summaries rather than preserving author names, supporter counts, and direct quotes, the reduce phase loses the structured opinion signals the JSON schema needs.
  - Fix: Add a dedicated `OPINION_CHUNK_PROMPT` that instructs the LLM to list authors, their stances, and quotes for each chunk, then feed those structured partial results into the reduce phase.

- [ ] **ISSUE: Recursive reduce not implemented (plan 3.3)**
  - File: `lib/llm/summarizer.ts`, `summaryChunks()` reduce phase
  - The plan states "Recursive reduce." The current reduce phase generates one combined text, then passes it in a single-element `reduceChunks` array to the LLM without checking whether the combined text itself exceeds context. For very long topics (100+ pages) this could still fail.
  - Fix: After the map phase, check if `combinedText` exceeds context. If so, run `summaryChunks` recursively on the partial summaries before the final reduce.

---

## Deferred Items (Phase 4)

These were intentionally deferred per the implementation summary and need follow-up:

- [ ] Refactor `SummaryView.vue` to use `useScraper` and `useCache` composables (currently duplicates scraping logic inline)
- [ ] Real-time progress reporting for map-reduce operations via streaming message from background to side panel
- [ ] Integration testing with real Claude and OpenAI API keys (plan section 3.6)
- [ ] Recursive reduce phase for very long topics
