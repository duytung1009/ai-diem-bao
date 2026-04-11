# Cơ chế Tab Kiến thức (Knowledge Extraction)

> Cập nhật: 2026-04-11

## Tổng quan

Tab **Kiến thức** trích xuất thông tin hữu ích (mẹo, kinh nghiệm, cảnh báo, hướng dẫn...) từ các bài viết trong topic theo dạng thẻ có cấu trúc (`KnowledgeEntry`). Kết quả được lưu vào IndexedDB cùng với topic cache, hỗ trợ:

- **Chunked extraction** — chia posts thành chunk theo token budget, không bị giới hạn bởi context window
- **Resume** — mỗi chunk được persist ngay sau khi extract xong; nếu cancel/lỗi giữa chừng sẽ tự resume từ chunk cuối
- **Incremental update** — chỉ extract posts mới, không chạy lại từ đầu
- **Saved entries** — user đánh dấu entries quan trọng, tồn tại qua mọi lần re-extract
- **Excluded posts** — user xóa entry → `postNumber` được đưa vào blocklist, không reappear

**Dependency:** Tab Kiến thức **không tự scrape**. Nó đọc posts từ `cachedTopic.posts` (hoặc `cachedTopic.segments[].posts` của tab Tóm tắt). Phải chạy Tóm tắt trước khi extract kiến thức.

---

## Data Model

### `KnowledgeEntry` (1 đơn vị kiến thức)

```typescript
interface KnowledgeEntry {
  id: string;                    // crypto.randomUUID()
  title: string;                 // tiêu đề ngắn (< 80 ký tự)
  content: string;               // nội dung chi tiết (2-5 câu)
  tags: string[];                // từ danh sách cố định (xem bên dưới)
  source: {
    author: string;
    postNumber: number;
    timestamp?: string;          // enriched từ ScrapedPost sau khi LLM trả về
  };
  extractedAt: number;           // timestamp
  saved?: boolean;               // user đánh dấu giữ lại
}
```

**Tags hợp lệ:** `kinh nghiệm`, `mẹo`, `cảnh báo`, `thống kê`, `so sánh`, `hướng dẫn`, `đánh giá`, `tài nguyên`

### `KnowledgeChunk` (F24 — persist trung gian)

```typescript
interface KnowledgeChunk {
  index: number;              // thứ tự chunk, 0-based
  startPostNumber: number;    // post đầu (inclusive)
  endPostNumber: number;      // post cuối (inclusive)
  entries: KnowledgeEntry[];  // raw entries từ map phase (PRE-reduce)
  extractedAt: number;
  complete?: boolean;         // false = chunk cuối chưa đầy budget → cho phép append posts mới
}
```

### Các fields trong `CachedTopic`

| Field | Kiểu | Mục đích |
|-------|------|----------|
| `knowledgeEntries` | `KnowledgeEntry[]` | Final result hiển thị cho user (sau reduce) |
| `knowledgeChunks` | `KnowledgeChunk[]` | Raw chunks, dùng để resume (F24) |
| `lastKnowledgePostNumber` | `number` | Post số cuối đã extract (derived từ chunk cuối) |
| `excludedKnowledgePostNumbers` | `number[]` | Posts bị user xóa — không reappear |

---

## LLM Functions (`lib/llm/summarizer.ts`)

| Export | Mục đích |
|--------|----------|
| `extractKnowledge()` | Direct path — 1 call, topic nhỏ fit context, dùng `KNOWLEDGE_EXTRACT_PROMPT` |
| `extractKnowledgeChunk()` | Map phase — 1 chunk posts, dùng `KNOWLEDGE_CHUNK_PROMPT` |
| `reduceKnowledgeChunks()` | Reduce phase — merge N mảng entries thành final list |
| `planKnowledgeChunks()` | Tính chunk boundaries theo token budget |
| `KNOWLEDGE_CHUNK_PROMPT_TOKENS` | Pre-computed token count của `KNOWLEDGE_CHUNK_PROMPT` (tính 1 lần) |

### Background task types

| `taskType` | Payload | Result |
|-----------|---------|--------|
| `extract_knowledge` | `{ posts, title }` | `{ entries: KnowledgeEntry[] }` |
| `extract_knowledge_chunk` | `{ posts, title }` | `{ entries: KnowledgeEntry[] }` |
| `reduce_knowledge_chunks` | `{ partialEntries: KnowledgeEntry[][] }` | `{ entries: KnowledgeEntry[] }` |

### `useLLM` wrappers

```typescript
extractKnowledge(posts, title)          // → createTask('extract_knowledge', ...)
extractKnowledgeChunkTask(posts, title) // → createTask('extract_knowledge_chunk', ...)
reduceKnowledgeChunksTask(partialEntries) // → createTask('reduce_knowledge_chunks', ...)
```

---

## Chunking (`planKnowledgeChunks`)

```
budget = floor(contextLimit × 0.75) - KNOWLEDGE_CHUNK_PROMPT_TOKENS - 2000

for each post:
  postTokens = estimateTokens("[author] (#N):\n content")
  if chunkTokens + postTokens > budget AND chunk not empty:
    → cắt chunk tại đây
  else:
    accum post vào chunk hiện tại

# Edge case: 1 post vượt budget → force vào chunk riêng (log warning)
```

Budget dùng `calculateSegmentBudget(model, KNOWLEDGE_CHUNK_PROMPT_TOKENS, 2000, contextWindow?)` — hỗ trợ override context window từ Settings người dùng.

---

## Flow Extract (`handleExtract` trong `KnowledgeView.vue`)

### Cancel guard

Giống `activeSummarizeId` ở tab Tóm tắt:

```typescript
let activeExtractId = 0; // non-reactive (không cần reactivity)

async function handleExtract() {
  const thisId = ++activeExtractId;
  // ... await LLM ...
  if (thisId !== activeExtractId) return; // đã cancel hoặc bắt đầu extract mới
}

function handleCancel() {
  activeExtractId++; // invalidate guard
  // partial chunks đã persist → auto-resume khi click lại
}
```

### Resume state (`computeKnowledgeResumeState`)

```
knowledgeChunks = []  →  startFromPostNumber = 0, existingChunks = []
                          (fresh extract, chạy từ đầu)

knowledgeChunks = [A, B, C (complete: false)]
                       →  startFromPostNumber = C.startPostNumber
                          existingChunks = [A, B]
                          (drop C, re-extract từ C.startPostNumber)

knowledgeChunks = [A, B, C (complete: true)]
                       →  startFromPostNumber = C.endPostNumber + 1
                          existingChunks = [A, B, C]
                          (chỉ extract posts sau C)
```

### Quyết định path

```
posts to process = allPosts
  .filter(p => p.postNumber >= startFromPostNumber && !excluded)
  .sort by postNumber

if totalTokens(posts) <= budget AND existingChunks.length === 0:
  → Direct path (1 call, skip reduce)
else:
  → Chunked path (map + reduce)
```

### Direct path (topic nhỏ)

1. Gọi `extract_knowledge` task (dùng `KNOWLEDGE_EXTRACT_PROMPT`)
2. Enrich entries với timestamp từ `allPosts`
3. Tạo **1 chunk record** để resume logic đồng nhất (QD4)
   - `complete: chunkTokens >= budget × 0.8`
4. Merge với saved entries hiện tại
5. Persist `knowledgeEntries` + `knowledgeChunks` + `lastKnowledgePostNumber`

### Chunked path (topic lớn)

```
planKnowledgeChunks(posts)  →  [{startIndex, endIndex}, ...]

for each chunkPlan[i]:
  1. slice posts từ startIndex..endIndex
  2. gọi extract_knowledge_chunk task
  3. enrich entries với timestamp
  4. tạo KnowledgeChunk record:
       complete = i < last ? true
                           : (chunkTokens >= budget × 0.8)
  5. push vào newChunks
  6. persistChunks(newChunks) → SAVE_CACHED_TOPIC với knowledgeChunks
     (persist ngay → resume nếu cancel sau bước này)

reduce phase:
  if newChunks.length === 1:
    → skip reduce call, dùng trực tiếp entries của chunk đó
  else:
    → gọi reduce_knowledge_chunks task với partialEntries[][]

filter: loại entries có source.postNumber trong excludedKnowledgePostNumbers
merge: savedEntries + fresh (saved không bị ghi đè bởi reduce)

persist: knowledgeEntries + knowledgeChunks + lastKnowledgePostNumber
```

### Progress UI

```
currentPhase = 'extracting' + totalChunks > 0  →  "Đang trích xuất phần N/M..."
currentPhase = 'extracting' + totalChunks = 0  →  "Đang trích xuất kiến thức..."
currentPhase = 'reducing'                      →  "Đang gộp kiến thức..."
```

---

## Merge Strategy (Saved Entries)

Saved entries (`entry.saved = true`) phải tồn tại qua mọi lần re-extract:

```typescript
function mergeSavedWithFresh(saved: KnowledgeEntry[], fresh: KnowledgeEntry[]): KnowledgeEntry[] {
  const freshByPostNum = new Set(fresh.map(e => e.source.postNumber));
  const savedNotInFresh = saved.filter(e => !freshByPostNum.has(e.source.postNumber));
  return [...savedNotInFresh, ...fresh];
}
```

- `fresh` entries thay thế saved entries có cùng `source.postNumber`  
- Saved entries không có trong fresh → giữ lại ở đầu list
- Sau reduce: `savedEntries = entries.value.filter(e => e.saved)` → pass vào merge

---

## Last Chunk Incomplete Flag (80% rule)

```
chunkTokens = sum of estimateTokens(post) for posts in last chunk

complete = chunkTokens >= budget × 0.8
         = true  → chunk đã đầy, post mới sẽ tạo chunk mới
         = false → chunk chưa đầy, post mới sẽ append vào (re-extract chunk này)
```

Lý do 80%: chừa 20% dư để append vài bài mới mà không vượt budget ngay.

---

## User Actions

### Trích xuất (Extract)

- Lần đầu: gọi `handleExtract()` full flow từ đầu
- Có bài mới: nút "Trích xuất bài mới (N)" → cùng `handleExtract()`, resume tự động từ `lastKnowledgePostNumber`
- Cancel: nút "Hủy" → `handleCancel()` → chunks đã persist được giữ lại

### Save/Unsave entry

`toggleSave(entry)` → update `entries.value`, persist `knowledgeEntries` ngay

### Xóa entry (`handleDelete`)

1. Remove khỏi `entries.value`
2. Thêm `entry.source.postNumber` vào `excludedKnowledgePostNumbers`
3. Persist cả hai

Entry này sẽ không reappear trong các lần extract sau (filter ở reduce step).

### Xóa tracking (`handleClearTracking`)

Reset hết: `excludedKnowledgePostNumbers = []`, `lastKnowledgePostNumber = 0`, `knowledgeChunks = []`

Lần click "Trích xuất" tiếp theo sẽ chạy full flow từ bài 1. Saved entries được giữ lại qua merge strategy.

---

## Filter & Search

`filteredEntries` computed:
1. `showSavedOnly` → chỉ hiện saved
2. `searchQuery` → tìm trong `title` + `content` (case-insensitive)
3. `selectedTags` → chỉ entries có ít nhất 1 tag được chọn

Thứ tự áp dụng: saved → text search → tag filter.

---

## Posts Source

```typescript
const allPosts = computed(() => {
  if (!cachedTopic.value) return [];
  if (cachedTopic.value.posts?.length) return cachedTopic.value.posts;         // legacy / normal mode
  return cachedTopic.value.segments?.flatMap(s => s?.posts ?? []) ?? [];       // segment mode
});
```

Tab Kiến thức không phân biệt normal hay segment mode — đọc toàn bộ posts từ cả hai nơi.

---

## Backward Compatibility

Topics cũ (có `knowledgeEntries` nhưng không có `knowledgeChunks`):
- `computeKnowledgeResumeState()` trả về `startFromPostNumber = 0, existingChunks = []`
- Trigger full re-extract → rebuild chunks từ đầu
- `savedEntries` được preserve qua merge strategy
- Không cần migration — `knowledgeChunks` là optional field, hoàn toàn additive

---

## Edge Cases

| Tình huống | Xử lý |
|-----------|-------|
| Cancel giữa chunk N | Chunks 0..N-1 đã persist → click lại, resume từ chunk N |
| LLM error giữa chunk N | Tương tự cancel |
| Chunk cuối < 80% budget | `complete: false` → lần sau drop và re-extract từ `startPostNumber` của nó |
| Topic < 1 chunk (direct path) | 1 call, không reduce, tạo 1 chunk record |
| 1 chunk sau reduce (2 chunks) | Skip reduce call, dùng trực tiếp `allPartial[0]` |
| 1 post > budget | Force vào chunk riêng, log warning, tiếp tục |
| Không có posts | Hiện warning "Vui lòng tóm tắt topic trước" |
| excludedNums lớn | Filter ở reduce step (sau LLM), không rebuild chunks |
| Cancel trong reduce phase | `activeExtractId++` → reduce result bị bỏ qua; chunks đã persist; click lại → skip extract, chỉ re-run reduce |
