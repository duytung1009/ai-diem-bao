# PRD: Refactor Knowledge Workflow — Tạo useKnowledge.ts Composable

## Context

Hiện tại, Knowledge workflow có một bất đối xứng kiến trúc lớn so với Summary workflow:

### Summary Workflow (`useSummarize.ts` composable)
- **Composable**: `useSummarize.ts` orchestrates toàn bộ flow (scrape, plan segments, LLM dispatch, save, reduce)
- **Background**: Chỉ execute single LLM calls (1 segment = 1 `START_LLM_TASK`)
- **KnowledgeView.vue**: Chỉ render UI, gọi composable

### Knowledge Workflow (hiện tại — anti-pattern)
- **KnowledgeView.vue** (1127 lines): Chứa toàn bộ orchestration (chunk planning, extract loop, reduce phase, persist, resume, error handling)
- **Background**: Execute single LLM calls (1 chunk = 1 `START_LLM_TASK`)
- **Không có composable**: Mọi thứ nằm trong Vue component

### Tại sao không consolidate background tasks?

Background task = 1 LLM call, fire-and-forget. Mỗi chunk extract cần được persist ngay vào `knowledgeChunks` để resume nếu cancel giữa chừng. Nếu gộp toàn bộ map-reduce vào 1 background task duy nhất, sẽ mất khả năng persist per-chunk → mất resume. Đây là constraint của Chrome MV3 messaging.

Pattern đúng: **composable orchestrates nhiều background tasks, background execute single LLM calls** — giống hệt `useSummarize.ts`.

## Decision

Tạo `useKnowledge.ts` composable, di chuyển toàn bộ orchestration ra khỏi `KnowledgeView.vue`. Cấu trúc mirror `useSummarize.ts`:

| `useSummarize.ts` | `useKnowledge.ts` |
|---|---|
| `summarize(posts)` | `extractKnowledge(posts, title)` |
| `summarizeSegmentsTask(segments)` | `reduceKnowledgeChunksTask(entries, cap)` |
| `summarizeAndSaveSegment()` | `extractAndPersistChunk()` |
| `generateOverallSummary()` | `runReducePhase()` |
| `runSummarizeJob()` | `handleExtract()` |
| `handleSegmentUpdate()` | `handleResume()` |
| `computeResumeState()` | `computeKnowledgeResumeState()` |
| `computeResumeMode()` | `computeResumeMode()` |
| `scrapeAllPages()` | N/A (knowledge reuses summary's scraped posts) |
| `pl` (usePipeline) | shared `usePipeline` |

## Goals

1. **Tạo `useKnowledge.ts`** composable với toàn bộ state + orchestration của knowledge flow
2. **Simplify `KnowledgeView.vue`** còn ~500-600 lines (chỉ UI: render entries, search/filter, toggleSave, toggleDelete, focus scroll)
3. **Consistent pattern**: Knowledge flow mirror summary flow về composable structure
4. **Shared infrastructure**: Knowledge dùng chung `usePipeline()`, `createRunGuard()`, `useLLM()` với summary
5. **Keep per-chunk persist**: Background tasks vẫn là single LLM call — composable orchestrate

## Non-Goals

- Không thay đổi background LLM functions (`extractKnowledge`, `extractKnowledgeChunk`, `reduceKnowledgeChunks`)
- Không thay đổi IndexedDB schema hoặc `cache-db.ts`
- Không thay đổi `KnowledgeEntry`, `KnowledgeChunk` types
- Không thay đổi Notebook integration
- Không thay đổi prompt system (`buildKnowledgePrompt`)
- Không thay đổi chunk planning (`planKnowledgeChunks`)

---

## Phase 1: Tạo `useKnowledge.ts` Composable — State & Core Functions

### Di chuyển từ `KnowledgeView.vue` sang `useKnowledge.ts`:

**Reactive state** (cùng pattern với `useSummarize`):
- `entries`, `loadedTopicUrl`, `isLoading`, `error`, `llmTaskId`
- `currentChunkIndex`, `totalChunks`, `currentPhase` (`'idle' | 'extracting' | 'reducing'`)
- `currentConfig`, `confirmingExtract`, `confirmingRestore`, `showClearDataAction`
- `activeExtractId` → thay bằng `createRunGuard()` (giống `summarizeGuard`)
- `cachedTopic` = `computed(() => store.selectedTopic.value)` (giống summary)

**Core orchestration functions** (exported):
- `handleExtract()` — full extraction flow (direct hoặc chunked + reduce)
- `handleRestore()` — re-run reduce on cached chunks
- `handleCancel()` — cancel all tasks + reset state
- `handleClearKnowledgeData()` — clear all knowledge from cache
- `handleDelete(entry)` — delete single entry
- `toggleSave(entry)` — toggle save status

**Internal helpers** (private, không export):
- `runDirectExtract(posts, guardId, topicUrl, topicTitle)` — single LLM call path
- `runReducePhase(chunks, excludedNums, guardId, topicUrl)` — reduce orchestration (single/batch/split-output)
- `persistChunks(chunks, guardId, topicUrl)` — save chunks to IndexedDB
- `computeKnowledgeResumeState()` — determine resume from existing chunks
- `enrichEntries(entries)` — add defaults (now, id if missing)
- `mergeSavedWithFresh(saved, fresh)` — saved entries survive re-extract
- `clientSideDedup(entries)` — title-based deduplication
- `calcMaxOutputEntries(contextLimit, promptTokens, inputTokens)` — output budget

**Computed properties**:
- `canRestore` — entries empty but knowledgeChunks exist
- `estimatedExtractApiCalls` — cost estimate for extract
- `showExtractCostWarning` — exceeds threshold
- `estimatedRestoreApiCalls` — cost estimate for restore
- `showRestoreCostWarning` — exceeds threshold
- `allPosts` — từ `cachedTopic.value.segments` hoặc `cachedTopic.value.posts`

**Pipeline**: Dùng `usePipeline()` shared thay vì `buildKnowledgePipeline()` inline per-task.

### Files Changed

- **New**: `entrypoints/sidepanel/composables/useKnowledge.ts`
- `entrypoints/sidepanel/views/KnowledgeView.vue` — import và dùng `useKnowledge()`

### Acceptance Criteria

- `useKnowledge.ts` exports `useKnowledge(store)` function
- Tất cả state từ Phase description có trong composable
- `KnowledgeView.vue` destructures `useKnowledge()` và dùng state/handlers
- `npm run compile` passes với zero errors
- `npm run test` passes

---

## Phase 2: Simplify KnowledgeView.vue — Chỉ Còn UI

### Remove khỏi KnowledgeView.vue:

Tất cả orchestration functions đã chuyển sang `useKnowledge.ts`:
- `handleExtract`, `handleRestore`, `handleCancel`, `handleClearKnowledgeData`
- `runDirectExtract`, `runReducePhase`, `persistChunks`
- `computeKnowledgeResumeState`, `enrichEntries`, `mergeSavedWithFresh`
- `clientSideDedup`, `calcMaxOutputEntries`
- `activeExtractId`, `currentChunkIndex`, `totalChunks`, `currentPhase`, `currentConfig`

### Giữ trong KnowledgeView.vue:

- **UI state**: `searchQuery`, `selectedTags`, `selectedCategory`, `expandedIds`, `showSavedOnly`
- **Template**: toàn bộ HTML + Tailwind classes
- **TAG_CLASSES** map (style cho tag badges)
- **Focus scroll logic**: watch `focusId` param + `router` navigation
- **Derived computed**: `filteredEntries`, `allTags`, `allCategories`, `displayedEntries`
- **Route watchers**: `?restore=true`, `?extract=true`, query params
- **onActivated**: `loadTopicData()` call

### Cấu trúc mới của KnowledgeView.vue (sau refactor):

```typescript
// 1. Imports
import { useKnowledge } from '../composables/useKnowledge';
import { useTopicStore } from '../composables/useTopicStore';
import { useOptimisticUpdate } from '../composables/useOptimisticUpdate';

// 2. Composable setup
const store = useTopicStore();
const knowledge = useKnowledge(store);
const { optimisticUpdate } = useOptimisticUpdate(store);

// 3. Destructure từ composable
const {
  entries, isLoading, error, llmTaskId,
  currentPhase, currentChunkIndex, totalChunks,
  cachedTopic, allPosts, canRestore,
  estimatedExtractApiCalls, showExtractCostWarning,
  estimatedRestoreApiCalls, showRestoreCostWarning,
  confirmingExtract, confirmingRestore, showClearDataAction,
  handleExtract, handleRestore, handleCancel,
  handleDelete, toggleSave, handleClearKnowledgeData,
  handleClearTracking,
} = knowledge;

// 4. Local UI state only
const searchQuery = ref('');
const selectedTags = ref<string[]>([]);
// ... filter/tag/category state

// 5. Template (unchanged structure, use destructured state)
```

### Files Changed

- `entrypoints/sidepanel/views/KnowledgeView.vue`

### Acceptance Criteria

- `KnowledgeView.vue` < 600 lines (ideal: ~500)
- Không còn orchestration logic trong component
- Tất cả LLM dispatch, chunking, reduce, persist logic nằm trong `useKnowledge.ts`
- UI hoạt động identically: extract, restore, cancel, save, delete, filter
- `npm run compile` passes với zero errors
- `npm run test` passes

---

## Phase 3: Cleanup & Consistency

### Verify pattern consistency với useSummarize.ts

| Pattern | `useSummarize.ts` | `useKnowledge.ts` (target) |
|---|---|---|
| Run guard | `summarizeGuard = createRunGuard()` | `knowledgeGuard = createRunGuard()` |
| Pipeline | `pl = usePipeline()` | `pl = usePipeline()` |
| LLM tasks | `summarize(posts)`, `summarizeSegmentsTask(...)` | `extractKnowledge(posts, title)`, `extractKnowledgeChunkTask(...)`, `reduceKnowledgeChunksTask(...)` |
| Cached topic | `computed(() => store.selectedTopic.value)` | same |
| Save | `sendMessage('SAVE_CACHED_TOPIC', ...)` + `store.updateSelectedTopic(...)` | same |
| State cleanup on cancel | `activeExtractId++` pattern | `knowledgeGuard.begin()` + `knowledgeGuard.isStale()` |

### Remove dead code (nếu có):

- Check `KnowledgeView.vue` không còn import nào dư thừa (vd `buildKnowledgePipeline`, `planKnowledgeChunks` nếu không cần)

### Files Changed

- `entrypoints/sidepanel/views/KnowledgeView.vue` (cleanup imports)
- `entrypoints/sidepanel/composables/useKnowledge.ts` (final polish)

### Acceptance Criteria

- Pattern consistency verified manually (side-by-side compare useSummarize + useKnowledge structure)
- Không có dead imports trong KnowledgeView.vue
- `npm run compile` passes
- `npm run test` passes

---

## Verification Plan

Sau mỗi phase, run:

```bash
npm run compile
npm run test
```

Manual testing checklist:

| Phase | Test |
|-------|------|
| 1 | `useKnowledge.ts` compiles, exports đúng interface |
| 2 | Extract knowledge trên thớt nhỏ (direct path) |
| 2 | Extract knowledge trên thớt lớn (chunked path) |
| 2 | Cancel giữa chừng khi extract → resume hoạt động |
| 2 | Restore từ cached chunks |
| 2 | Save/delete entries → persist qua reload |
| 2 | Filter by tag, search, category |
| 3 | Side-by-side compare flow với summary tab |
