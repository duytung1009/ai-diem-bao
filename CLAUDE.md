# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Task Master AI Instructions
**Import Task Master's development workflow commands and guidelines, treat as if import is in the main CLAUDE.md file.**
@./.taskmaster/CLAUDE.md

---

## Build & Dev Commands

```bash
npm run dev          # Dev server (Chrome)
npm run build        # Production build → .output/chrome-mv3/
npm run compile      # TypeScript type-check only (vue-tsc --noEmit)
npm run zip          # Package for Chrome Web Store
```

No test runner is configured. Type-checking (`npm run compile`) is the primary verification step.

## Architecture Overview

**Chrome Extension (Manifest V3) built with WXT framework + Vue 3 + TypeScript + Tailwind CSS v4.**

### Entry Points

| File | Role |
|------|------|
| `entrypoints/background/index.ts` | Service worker — handles all LLM calls, cache read/write, message routing |
| `entrypoints/content/index.ts` | Content script — detects XenForo version, responds to `DETECT_XF`, scrapes posts |
| `entrypoints/sidepanel/` | Vue 3 SPA — the full UI (router, views, composables) |

### Message-Passing Architecture

All cross-context communication goes through typed messages in `lib/messaging.ts`. The sidepanel never calls LLM APIs directly — it sends `START_LLM_TASK` (fire-and-forget) and receives `LLM_PROGRESS` / `LLM_RESULT` back from the background service worker. Message types are defined in `lib/types.ts` (`MessageType`).

**Fire-and-forget LLM pattern:** `START_LLM_TASK` returns `{ started: true }` immediately; results arrive via `browser.runtime.sendMessage` from background → sidepanel listener. This is necessary because Chrome MV3 service workers can be terminated mid-request.

### Sidepanel SPA Structure

- **Router** (`main.ts`): hash-history, routes: `/` (hub), `/summary`, `/knowledge`, `/research`, `/settings`
- **`useTopicStore`** (`composables/useTopicStore.ts`): module-level singleton refs (not Pinia). State: `selectedTopic`, `activeTabDetect`, `activeTabUrl`, `summarizingUrl`. Always exposed as `readonly()` — mutate only via store actions like `updateSelectedTopic()`.
- **`useSummarize`** (`composables/useSummarize.ts`): heavy composable managing the full summarize lifecycle — scraping, LLM task dispatch, segment state, cache save.
- **`useLLM`** (`composables/useLLM.ts`): lower-level task manager that sends `START_LLM_TASK` and listens for `LLM_PROGRESS`/`LLM_RESULT`.
- **`App.vue`**: mounts `<TopicMeta>` once above `<router-view>` (shared across summary/knowledge/research tabs). Handles tab detection and auto-update of cached topic metadata.

### LLM Stack (`lib/llm/`)

- `factory.ts` — `createProvider(config)` → OpenAIAdapter | ClaudeAdapter | GeminiAdapter
- `summarizer.ts` — all LLM operations: `summarizeTopic`, `updateSummary`, `analyzeOpinions`, `researchTopic`, `extractKnowledge`, `summarizeSegments`, `generateThreadAnalysis`; includes `parseSummaryJSON` with `repairUnescapedQuotes` fallback
- `utils.ts` — `mergeAbortSignals()` (shared across all 3 adapters)
- `cost-estimator.ts` — pre-flight API call estimation (cost guard)
- `retry.ts` — `withRetry<T>` (3 attempts, exponential backoff)

### Cache Layer

- `lib/cache-db.ts` — raw IndexedDB wrapper (`dbPut`, `dbGet`, `dbGetAll`, `dbDelete`)
- `lib/cache-manager.ts` — public API (`getCachedTopic`, `saveCachedTopic`, etc.) + URL normalization

Settings stored in `browser.storage.sync`; topic cache stored in IndexedDB (migrated from `storage.local`).

### Segment Mode

Always active — `isSegmentMode = Boolean(topicInfo)`. Long threads are split into segments for LLM context management. Legacy cached topics (have `summary` but no `segments`) are synthesized into `segmentSummaries[0]`. Dynamic segment sizing uses `lib/token-estimator.ts` to fit within the model's context window.

### Styling

Tailwind CSS v4 via Vite plugin. Design tokens as CSS vars `--color-*` in `assets/main.css`. Reusable `@utility` classes: `btn`, `card`, `badge`, `alert`. Full conventions in `STYLE_GUIDE.md`.

### Path Alias

`@/` maps to the project root (configured by WXT). Use `@/lib/...`, `@/assets/...` etc.
