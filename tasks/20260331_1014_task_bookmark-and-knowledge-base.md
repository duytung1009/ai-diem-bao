# Task: Feature 18 + 19 — Bookmark Topic & Knowledge Base Tab

**Ngày:** 2026-03-31
**Loại:** feature batch
**Planning file:** `planning/20260331_1000_batch_bookmark-and-knowledge-base.md`

---

## Thay đổi thực hiện

### Shared (cả hai feature)

| File | Thay đổi |
|------|----------|
| `lib/types.ts` | Thêm `KnowledgeEntry` interface; thêm `bookmarked?: boolean` và `knowledgeEntries?: KnowledgeEntry[]` vào `CachedTopic`; thêm `'extract_knowledge'` vào `LLMTaskRequest.taskType`; thêm `knowledge?: string` vào `CustomPrompts` |
| `lib/cache-db.ts` | Bump `DB_VERSION` 1→2; refactor `onupgradeneeded` sang versioned migration pattern; thêm index `by-bookmarked` cho version 2 |

### Feature 18 — Bookmark Topic

| File | Thay đổi |
|------|----------|
| `entrypoints/sidepanel/views/TopicHubView.vue` | Thêm `showBookmarkedOnly` ref + `bookmarkCount` computed; update `filteredTopics` thêm bookmark filter + prioritize bookmarks khi sort "recent"; thêm `toggleBookmark()` async function; update template: bookmark filter toggle button trong search bar, bookmark toggle button trên mỗi topic card; tăng `pr-12` → `pr-16` cho title text |
| `entrypoints/background/index.ts` | Thêm `bookmarked` và `knowledgeEntries` vào `SAVE_CACHED_TOPIC` merge logic |

### Feature 19 — Knowledge Base Tab

| File | Thay đổi |
|------|----------|
| `lib/prompts.ts` | Thêm `KNOWLEDGE_EXTRACT_PROMPT` constant |
| `lib/llm/summarizer.ts` | Import `KNOWLEDGE_EXTRACT_PROMPT`; thêm `extractKnowledge()` export function (V1: truncate posts nếu exceed context) |
| `entrypoints/background/index.ts` | Import `extractKnowledge` từ summarizer; import `KnowledgeEntry` từ types; thêm `case 'extract_knowledge'` trong `processLLMTask`; thêm `parseKnowledgeEntries()` helper |
| `entrypoints/sidepanel/composables/useLLM.ts` | Thêm `extractKnowledge()` wrapper function; export nó trong return |
| `entrypoints/sidepanel/main.ts` | Thêm route `/knowledge` → `KnowledgeView.vue`; thêm redirect `/opinions` → `/knowledge` |
| `entrypoints/sidepanel/App.vue` | Đổi tab "Ý kiến" → "Kiến thức", route check `opinions` → `knowledge` |
| `entrypoints/sidepanel/views/KnowledgeView.vue` | **TẠO MỚI** — view đầy đủ với search, tag filter, card list, extract/re-extract action, empty states |

---

## Self-review Results

- Issues found: 1
- Issues fixed: 1
- Remaining (cần review thêm): không có

### Issues

| # | Severity | Category | Description | Fix |
|---|----------|----------|-------------|-----|
| 1 | minor | UI layout | `pr-12` (48px) không đủ khi có 2 action buttons (~54px). Title text bị overlap. | Tăng lên `pr-16` (64px) ✓ |

### Checklist
| Category | Status | Notes |
|----------|--------|-------|
| Error handling | ✅ | `toggleBookmark`, `handleExtract`, `loadTopicData`, `parseKnowledgeEntries` đều có try-catch/catch |
| Null safety | ✅ | `?.entries ?? []`, guard `loadedTopicUrl !== url` against stale async, optional chaining |
| Naming consistency | ✅ | Theo pattern hiện có: `handleExtract`, `loadTopicData`, `toggleBookmark` |
| Missing imports/exports | ✅ | Tất cả imports verified qua successful build |
| Debug code | ✅ | Không có console.log mới (1 cái cũ trong background/index.ts không phải do feature này) |
| Hardcoded values | ✅ | Tag list trong KnowledgeView.vue là UI constant (ko cần lib/constants) |
| TypeScript types | ✅ | Không có `any`; proper type narrowing trong `parseKnowledgeEntries` |
| Reactive patterns (Vue) | ✅ | `ref`, `computed`, `splice` mutation trên reactive array được Vue 3 track |

---

## Build

- `npm run build` ✅ — 0 errors, 0 warnings
