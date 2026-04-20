# Task: Feature 24 — Dynamic Chunks for Knowledge Extraction

## Summary

Đưa cơ chế dynamic segment (F23) sang tab Kiến thức: mỗi chunk được persist ngay sau khi extract, flow có thể resume từ chunk bị gián đoạn, incremental update chỉ re-process phần mới.

## Files Changed

| File | Thay đổi |
|------|----------|
| `lib/types.ts` | Thêm `KnowledgeChunk` interface; thêm `knowledgeChunks?: KnowledgeChunk[]` vào `CachedTopic`; thêm 2 task types mới vào `LLMTaskRequest` |
| `lib/llm/summarizer.ts` | Tách 4 export mới: `KNOWLEDGE_CHUNK_PROMPT_TOKENS`, `extractKnowledgeChunk()`, `reduceKnowledgeChunks()`, `planKnowledgeChunks()`; đơn giản hóa `extractKnowledge()` thành single-call (bỏ map-reduce nội bộ) |
| `entrypoints/background/index.ts` | Import 2 hàm mới; thêm 2 case `extract_knowledge_chunk` + `reduce_knowledge_chunks`; thêm `knowledgeChunks` vào SAVE_CACHED_TOPIC merge |
| `entrypoints/sidepanel/composables/useLLM.ts` | Import `KnowledgeEntry`; thêm 2 wrapper `extractKnowledgeChunkTask()` + `reduceKnowledgeChunksTask()`; export 2 hàm mới |
| `entrypoints/sidepanel/views/KnowledgeView.vue` | Refactor toàn bộ `handleExtract()`; thêm chunked flow, cancel guard, resume logic, progress UI; thêm nút "Hủy"; cập nhật `handleClearTracking()` |
| `entrypoints/sidepanel/views/TopicHubView.vue` | Import `KnowledgeChunk`; thêm spread `knowledgeChunks` trong topic update watcher (tránh readonly type conflict) |
| `docs/architecture/knowledge.md` | Tạo mới — tài liệu kiến trúc đầy đủ cho tab Kiến thức |

## Implementation Details

### `KnowledgeChunk` data model

```typescript
interface KnowledgeChunk {
  index: number;              // 0-based
  startPostNumber: number;    // inclusive
  endPostNumber: number;      // inclusive
  entries: KnowledgeEntry[];  // raw entries từ map phase (PRE-reduce)
  extractedAt: number;
  complete?: boolean;         // false = chunk cuối chưa đầy → append posts mới vào
}
```

Chunks được persist vào `CachedTopic.knowledgeChunks` sau mỗi map call. `knowledgeEntries` (final) chỉ cập nhật sau reduce.

### `planKnowledgeChunks` (chunking algorithm)

Duyệt posts tuần tự, tích lũy `estimateTokens(post)`. Khi vượt `budget` → cắt chunk. Budget tính bằng `calculateSegmentBudget(model, KNOWLEDGE_CHUNK_PROMPT_TOKENS, 2000, contextWindow?)`. Edge case: 1 post > budget → force vào chunk riêng (log warning).

### Cancel guard (`activeExtractId`)

Dùng non-reactive counter (không cần Vue reactivity vì chỉ dùng trong logic JS):

```typescript
let activeExtractId = 0;  // non-reactive — intentional

async function handleExtract() {
  const thisId = ++activeExtractId;
  // ... mọi await đều check: if (thisId !== activeExtractId) return;
}

function handleCancel() {
  activeExtractId++;  // invalidate
}
```

### Resume logic (`computeKnowledgeResumeState`)

| Trạng thái chunks | Resume từ |
|------------------|-----------|
| `[]` (trống) | Post 0 — fresh extract |
| Chunk cuối `complete: false` | `chunk.startPostNumber` — drop chunk cuối, re-extract |
| Tất cả `complete: true` | `lastChunk.endPostNumber + 1` — chỉ extract posts mới |

### Decision path

- `totalTokens(posts) <= budget` **VÀ** `existingChunks.length === 0` → **Direct path** (1 call, task `extract_knowledge`, skip reduce)
- Còn lại → **Chunked path** (N calls `extract_knowledge_chunk` + 1 call `reduce_knowledge_chunks`)

Single chunk sau chunked path: skip reduce, dùng trực tiếp `allPartial[0]`.

### Last chunk incomplete (80% rule)

```
complete = chunkTokens >= budget × 0.8
```

- `true`: bài mới sẽ tạo chunk mới
- `false`: bài mới sẽ drop chunk này và re-extract cùng với posts cũ

### Merge strategy (saved entries)

Saved entries (`entry.saved = true`) được preserve qua mọi lần re-extract:

```typescript
savedNotInFresh + fresh
// saved entries có cùng postNumber → bị fresh thay thế
// saved entries không có trong fresh → giữ lại ở đầu
```

### `handleClearTracking` update

Thêm `knowledgeChunks: []` vào reset payload (ngoài `excludedKnowledgePostNumbers: []` và `lastKnowledgePostNumber: 0` đã có từ F22).

### `extractKnowledge` simplification

Bỏ map-reduce loop nội bộ — trách nhiệm chunking đã chuyển lên composable/view layer (đồng nhất với F23 pattern). `extractKnowledge()` giờ chỉ là single LLM call dùng `KNOWLEDGE_EXTRACT_PROMPT`.

## Self-review Results

- Issues found: 2
- Issues fixed: 2
  1. `ScrapedPost` thiếu trong import của `KnowledgeView.vue` (dùng trong type annotation hàm `runDirectExtract`) → đã thêm
  2. `KnowledgeChunk` thiếu import trong `TopicHubView.vue` khi thêm spread pattern → đã thêm
- Remaining: không
