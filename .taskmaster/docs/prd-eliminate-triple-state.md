# PRD: Eliminate Triple-State Pattern — Consolidate to Single Source of Truth

## Context

The application currently has a **triple-state pattern** where topic data exists simultaneously in 3 places:

1. **IndexedDB** (persistent storage, background service worker)
2. **Vue Store** (`useTopicStore.ts` — 53 lines, module-level `ref()` singleton)
3. **Local `cachedTopic` refs** in composables/views (`useSummarize`, `KnowledgeView`, `ResearchView`)

Every data change requires writing to all 3 places manually, causing sync bugs (e.g., the documented `isNewsTopic` bug where the local ref and store diverge).

## Decision

**Keep the Vue Store.** It provides essential cross-component reactivity, router navigation support, and shared transient state (`activeTabDetect`, `summarizingUrl`). The problem is not the store itself but the triple-state duplication.

## Goals

1. **Single source of truth**: All topic data reads from `store.selectedTopic` only
2. **Consistent data access**: All IndexedDB operations go through `sendMessage()` (message passing to background)
3. **Optimistic updates with rollback**: Instant UI feedback, automatic rollback on save failure

## Non-Goals

- Remove the Vue Store (it stays)
- Change the fire-and-forget LLM messaging pattern
- Modify IndexedDB schema or `cache-db.ts`
- Add a test framework (verification via `npm run compile` + manual testing)

---

## Phase 1: Unify IndexedDB Access in App.vue

### Problem

`App.vue` is the **only** component that directly imports and calls `cache-manager.ts` functions (`getCachedTopic`, `saveCachedTopic`). All other components use `sendMessage()` for IndexedDB access. This inconsistency creates confusion and potential race conditions.

### Solution

Replace direct `cache-manager.ts` calls in `App.vue` with `sendMessage()` equivalents. Keep `isSameTopicUrl` and `normalizeUrl` imports (pure functions, no side effects).

### Files Changed

- `entrypoints/sidepanel/App.vue`

### Acceptance Criteria

- `App.vue` no longer imports `getCachedTopic` or `saveCachedTopic` from `cache-manager.ts`
- `autoUpdateCachedTopic()` uses `sendMessage('GET_CACHED_TOPIC')` and `sendMessage('SAVE_CACHED_TOPIC')`
- `isSameTopicUrl` and `normalizeUrl` remain imported (pure functions)
- `npm run compile` passes with zero errors
- Tab detection still updates `totalPages`, `forumPostCount`, `threadDeleted`, `threadLocked` correctly

---

## Phase 2: Eliminate Triple-State in ResearchView

### Problem

`ResearchView.vue` maintains a local `cachedTopic` ref that duplicates `store.selectedTopic`. When data changes, it writes to both places manually.

### Solution

Remove the local `cachedTopic` ref. Read directly from `store.selectedTopic` via a computed property. Update `loadTopicData()` to use `store.updateSelectedTopic()` instead of assigning to local ref.

### Files Changed

- `entrypoints/sidepanel/views/ResearchView.vue`

### Acceptance Criteria

- No `ref<CachedTopic | null>` for `cachedTopic` in ResearchView
- `cachedTopic` is a computed property: `computed(() => store.selectedTopic.value)`
- `loadTopicData()` fetches fresh data from IDB via `sendMessage()`, then calls `store.updateSelectedTopic(fresh)`
- Research history still saves correctly via `sendMessage('SAVE_CACHED_TOPIC')`
- `npm run compile` passes with zero errors

---

## Phase 3: Eliminate Triple-State in KnowledgeView

### Problem

`KnowledgeView.vue` (931 lines) maintains a local `cachedTopic` ref that duplicates `store.selectedTopic`. Knowledge entries are written to both places manually.

### Solution

Remove the local `cachedTopic` ref. Read from `store.selectedTopic` via computed. Replace all `cachedTopic.value = ...` assignments with `store.updateSelectedTopic(...)`.

### Files Changed

- `entrypoints/sidepanel/views/KnowledgeView.vue`

### Acceptance Criteria

- No `ref<CachedTopic | null>` for `cachedTopic` in KnowledgeView
- `cachedTopic` is a computed property: `computed(() => store.selectedTopic.value)`
- `loadTopicData()` fetches fresh from IDB, calls `store.updateSelectedTopic(fresh)`
- Knowledge extract, reduce, and save operations all update store via `store.updateSelectedTopic()`
- `allPosts` computed still works (reads from `cachedTopic.value.segments` or `cachedTopic.value.posts`)
- `npm run compile` passes with zero errors

---

## Phase 4: Eliminate Triple-State in useSummarize (Critical)

### Problem

`useSummarize.ts` (1216 lines) is the heaviest composable and the source of most sync bugs. It maintains a local `cachedTopic` ref that mirrors `store.selectedTopic`. Every operation performs dual-write: `cachedTopic.value = {...}` + `store.updateSelectedTopic({...})`. This is the root cause of the `isNewsTopic` sync bug.

### Key Dual-Write Locations

| Line | Pattern | Fields |
|------|---------|--------|
| 148-149 | `cachedTopic.value = {...}; store.updateSelectedTopic({topicType})` | topicType (news detection) |
| 233 | `cachedTopic.value = topic as CachedTopic` | Full topic on load |
| 267-279 | `cachedTopic.value = {...}; store.updateSelectedTopic({...})` | Fresh data from IDB |
| 441-442 | `cachedTopic.value = {...}; store.updateSelectedTopic({topicType: 'news'})` | topicType (auto-summarize) |
| 518 | `store.updateSelectedTopic({...})` | Scraping results |
| 543-545 | `store.updateSelectedTopic(...); if (saved) cachedTopic.value = saved` | Segment summary |
| 586-588 | `store.updateSelectedTopic(...); if (saved) cachedTopic.value = saved` | Segment update |
| 632-634 | `store.updateSelectedTopic(...); if (saved) cachedTopic.value = saved` | Overall summary |
| 826 | `store.updateSelectedTopic({...})` | Auto-summarize results |
| 1014-1015 | `cachedTopic.value = {...}; store.updateSelectedTopic({topicType: 'news'})` | topicType (auto-summarize news) |

### Solution

1. Remove `const cachedTopic = ref<CachedTopic | null>(null)` (line 32)
2. Replace with `const cachedTopic = computed(() => store.selectedTopic.value)`
3. Remove ALL `cachedTopic.value = {...}` assignments — rely solely on `store.updateSelectedTopic()`
4. Update all computed properties that read `cachedTopic.value` to read `store.selectedTopic.value` (via the computed alias)
5. Export `cachedTopic` computed so `SummaryView.vue` can still destructure it

### Files Changed

- `entrypoints/sidepanel/composables/useSummarize.ts`
- `entrypoints/sidepanel/views/SummaryView.vue` (no code change needed — receives `cachedTopic` from useSummarize export)

### Acceptance Criteria

- No `ref<CachedTopic | null>` for `cachedTopic` in useSummarize
- `cachedTopic` is a computed: `computed(() => store.selectedTopic.value)`
- Zero `cachedTopic.value = {...}` assignments remain (only `store.updateSelectedTopic()` mutates data)
- `isNewsTopic`, `summarizedPostCount`, `topicInfo` computed properties work correctly
- `loadTopicData()` updates store via `store.updateSelectedTopic()` with fresh IDB data
- All summarize operations (segment, overall, auto-summarize) update store correctly
- News type detection updates store correctly
- `npm run compile` passes with zero errors

---

## Phase 5: Add Optimistic Update with Rollback

### Problem

Currently, store updates and IndexedDB saves are not atomic. If IDB save fails, the store is already updated with data that won't persist. There is no rollback mechanism.

### Solution

Create a `useOptimisticUpdate` composable that:
1. Saves the previous store state
2. Updates the store immediately (instant UI feedback)
3. Sends `SAVE_CACHED_TOPIC` to background
4. If save fails, rolls back the store to previous state

### New File

- `entrypoints/sidepanel/composables/useOptimisticUpdate.ts`

### Files Updated

- `entrypoints/sidepanel/composables/useSummarize.ts` — use `optimisticUpdate()` for field updates
- `entrypoints/sidepanel/views/KnowledgeView.vue` — use for knowledge entries save
- `entrypoints/sidepanel/views/ResearchView.vue` — use for research history save
- `entrypoints/sidepanel/views/TopicHubView.vue` — use in `toggleBookmark()`
- `entrypoints/sidepanel/App.vue` — use in `autoUpdateCachedTopic()`

### Acceptance Criteria

- `useOptimisticUpdate.ts` exports `optimisticUpdate(partial: Partial<CachedTopic>): Promise<boolean>`
- Returns `true` on success, `false` on failure (after rollback)
- Logs error to console on rollback
- Existing dual-write patterns (`store.updateSelectedTopic()` + `sendMessage('SAVE_CACHED_TOPIC')`) are replaced with `optimisticUpdate()`
- `npm run compile` passes with zero errors

---

## Phase 6: Cleanup TopicHubView Sync

### Problem

`TopicHubView.vue` uses a fragile computed key string to detect store changes:

```typescript
const selectedTopicKey = computed(() => {
  const t = store.selectedTopic.value;
  if (!t) return null;
  return `${t.url}|${t.summary?.slice(0, 20) ?? ''}|${t.segments?.length ?? 0}|...`;
});
```

This watch is brittle (misses deep changes, depends on string slicing) and unnecessary once the store is the single source of truth.

### Solution

Replace the computed key watch with a simpler URL-based watch. Since the store is now the single source, TopicHubView only needs to know when a **different** topic is selected (URL change), not when the same topic's fields change.

### Files Changed

- `entrypoints/sidepanel/views/TopicHubView.vue`

### Acceptance Criteria

- `selectedTopicKey` computed is removed
- Replaced with `watch(() => store.selectedTopic.value?.url, ...)` or equivalent
- Topic list still syncs when a new topic is selected
- Topic list still syncs when bookmark is toggled
- Topic list still shows "Đang tóm tắt..." indicator for summarizing topics
- `npm run compile` passes with zero errors

---

## Verification Plan

After each phase, run:

```bash
npm run compile
```

Manual testing checklist:

| Phase | Test |
|-------|------|
| 1 | Open sidepanel → switch tabs → verify `totalPages`, `forumPostCount` update correctly |
| 2 | Select topic → navigate to ResearchView → ask question → verify history saves |
| 3 | Open KnowledgeView → extract knowledge → verify entries persist after reload |
| 4 | Summarize a segment → verify summary shows instantly → reload → verify persists |
| 4 | Detect news topic → verify "Tin tức" badge shows immediately |
| 5 | Toggle bookmark → verify instant UI update → disconnect network → verify rollback |
| 6 | Update topic in SummaryView → verify TopicHubView list syncs without manual refresh |
