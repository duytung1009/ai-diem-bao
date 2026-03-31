# Batch Plan: Bookmark Topic + Knowledge Base Tab

**Ngày:** 2026-03-31
**Features:**
- Feature 18: Bookmark topic + Filter topic đã bookmark ở tab Chủ đề
- Feature 19: Thay tab Ý kiến bằng tab Kiến thức — tổng hợp & lưu kiến thức từ topic

---

## Dependency Graph

```
Feature 18 (Bookmark)                Feature 19 (Knowledge Base)
       │                                      │
       ├─ lib/types.ts                        ├─ lib/types.ts
       │   └─ CachedTopic.bookmarked          │   └─ CachedTopic.knowledgeEntries
       ├─ lib/cache-db.ts                     │   └─ KnowledgeEntry interface
       │   └─ DB_VERSION 2 (index)            ├─ lib/cache-db.ts
       ├─ TopicHubView.vue                    │   └─ DB_VERSION 2 (shared upgrade!)
       │   └─ bookmark toggle + filter        ├─ lib/prompts.ts
       ├─ useTopicStore.ts                    │   └─ KNOWLEDGE_EXTRACT_PROMPT
       │   └─ (minor: propagate update)       ├─ lib/llm/knowledge-extractor.ts (MỚI)
       └─ background/index.ts                ├─ App.vue
           └─ SAVE_CACHED_TOPIC (đã có)      │   └─ tab "Ý kiến" → "Kiến thức"
                                              ├─ views/KnowledgeView.vue (MỚI)
                                              │   └─ thay thế OpinionsView
                                              ├─ main.ts (router)
                                              │   └─ /opinions → /knowledge
                                              ├─ composables/useLLM.ts
                                              │   └─ extractKnowledge()
                                              └─ background/index.ts
                                                  └─ handle 'extract_knowledge' task
```

**Shared touchpoints:**
- `lib/types.ts` — cả hai đều thêm fields vào `CachedTopic`
- `lib/cache-db.ts` — cả hai cần DB migration (upgrade `DB_VERSION` → 2)
- `background/index.ts` — Feature 19 thêm LLM task handler mới

**Conflicts:**
- `lib/types.ts`: Cả hai sửa `CachedTopic` — implement tuần tự, commit types chung 1 lần
- `lib/cache-db.ts`: Cả hai cần DB upgrade — gộp chung vào 1 migration (version 1→2)

---

## Implementation Order

**Feature 18 (Bookmark) trước → Feature 19 (Knowledge Base) sau**

Lý do:
1. Feature 18 đơn giản hơn (~120 LOC), chỉ UI + data field, không đụng LLM — risk thấp, ship nhanh
2. Feature 18 hoàn thành → có nền tảng DB migration (version 2), Feature 19 piggyback thêm index/field
3. Feature 19 phức tạp hơn (LLM prompt, parser, UI view mới, router change) — cần Feature 18 stable trước
4. Feature 19 thay thế tab Ý kiến = breaking change cho navigation — cần test kỹ hơn, tách riêng commit

---

## Shared Components cần tạo trước

1. **DB Migration (version 1→2):** Tạo 1 lần trong Feature 18, Feature 19 sẽ bump thêm nếu cần index riêng (hoặc gộp vào version 2 nếu implement liên tiếp)
2. **`CachedTopic` type changes:** Gộp cả `bookmarked` và `knowledgeEntries` vào types.ts trong Step 1 chung, tránh sửa 2 lần

---

## Feature 18: Bookmark Topic

### Objective & Scope

Thêm khả năng bookmark (đánh dấu) topic trong tab Chủ đề. User có thể:
- Toggle bookmark trên mỗi topic card
- Filter chỉ hiển thị topic đã bookmark
- Topic bookmark hiển thị icon nổi bật & ưu tiên sort lên đầu (khi sort "Mới nhất")

**Ngoài scope:** Sync bookmark qua chrome.storage.sync, export bookmark, bookmark folder/tag.

### Hiện trạng

- TopicHubView hiển thị tất cả cached topic, không có khái niệm bookmark
- Sort chỉ có: recent, posts, title
- Không có filter nào ngoài search text
- `CachedTopic` không có field `bookmarked`

### Affected Modules

| File | Thay đổi |
|------|----------|
| `lib/types.ts` | Thêm `bookmarked?: boolean` vào `CachedTopic` |
| `lib/cache-db.ts` | Bump DB_VERSION → 2, thêm index `by-bookmarked` |
| `entrypoints/sidepanel/views/TopicHubView.vue` | Bookmark toggle button, filter toggle, sort logic |
| `entrypoints/background/index.ts` | Không cần sửa — `SAVE_CACHED_TOPIC` đã merge partial |

### Implementation Steps

#### Step 1: Type update (`lib/types.ts`)

Thêm field vào `CachedTopic`:
```typescript
export interface CachedTopic {
  // ... existing fields
  bookmarked?: boolean;           // Feature 18: bookmark flag
  knowledgeEntries?: KnowledgeEntry[];  // Feature 19: knowledge base (thêm luôn)
}
```

#### Step 2: DB Migration (`lib/cache-db.ts`)

Bump `DB_VERSION` từ 1 → 2. Trong `onupgradeneeded`:
```typescript
request.onupgradeneeded = (event) => {
  const database = request.result;
  const oldVersion = event.oldVersion;

  if (oldVersion < 1) {
    const store = database.createObjectStore(STORE_NAME, { keyPath: 'url' });
    store.createIndex('by-cachedAt', 'cachedAt', { unique: false });
  }
  if (oldVersion < 2) {
    const store = request.transaction!.objectStore(STORE_NAME);
    store.createIndex('by-bookmarked', 'bookmarked', { unique: false });
  }
};
```

> **Lưu ý:** Existing records không có `bookmarked` field → index tự bỏ qua (undefined = not indexed). Query `by-bookmarked` với key `true` sẽ chỉ trả bookmark topics.

#### Step 3: TopicHubView.vue — Bookmark toggle

Thêm bookmark button vào mỗi topic card (cạnh nút delete):

```typescript
async function toggleBookmark(topic: CachedTopic) {
  const updated = { ...topic, bookmarked: !topic.bookmarked };
  await sendMessage('SAVE_CACHED_TOPIC', updated);
  // Update local list
  const idx = allTopics.value.findIndex(t => t.url === topic.url);
  if (idx !== -1) allTopics.value[idx] = updated;
  // Sync store nếu đang selected
  if (store.selectedTopic.value?.url === topic.url) {
    store.updateSelectedTopic({ bookmarked: updated.bookmarked });
  }
}
```

UI: Icon bookmark (outline khi chưa bookmark, filled khi đã bookmark) — đặt bên trái nút delete trên topic card.

#### Step 4: TopicHubView.vue — Filter bookmark

Thêm toggle filter bên cạnh search bar:

```vue
<button
  @click="showBookmarkedOnly = !showBookmarkedOnly"
  :class="showBookmarkedOnly ? 'text-yellow-500' : 'text-(--color-text-muted)'"
  title="Chỉ hiện đã đánh dấu"
>
  <!-- Bookmark icon (filled when active) -->
</button>
```

Update `filteredTopics` computed:
```typescript
const showBookmarkedOnly = ref(false);

const filteredTopics = computed(() => {
  let topics = [...allTopics.value];

  // Bookmark filter
  if (showBookmarkedOnly.value) {
    topics = topics.filter(t => t.bookmarked);
  }

  // Search filter (existing)
  const query = searchQuery.value.trim().toLowerCase();
  if (query) {
    topics = topics.filter(t =>
      t.title.toLowerCase().includes(query) ||
      t.url.toLowerCase().includes(query)
    );
  }

  // Sort (existing) — bookmark topics ưu tiên khi sort "recent"
  switch (sortBy.value) {
    case 'recent':
      topics.sort((a, b) => {
        // Bookmarked first, then by cachedAt
        if (a.bookmarked && !b.bookmarked) return -1;
        if (!a.bookmarked && b.bookmarked) return 1;
        return (b.cachedAt || 0) - (a.cachedAt || 0);
      });
      break;
    case 'posts':
      topics.sort((a, b) => b.totalPosts - a.totalPosts);
      break;
    case 'title':
      topics.sort((a, b) => a.title.localeCompare(b.title, 'vi'));
      break;
  }
  return topics;
});
```

#### Step 5: Visual feedback

- Bookmark icon: SVG bookmark (★ hoặc 🔖 style), vàng khi active
- Topic card có bookmark: thêm subtle left border accent (vàng) hoặc small badge
- Bookmark count hiển thị bên cạnh filter button: `(3)` nếu có bookmark

### Edge Cases

- **Existing topics:** Không có `bookmarked` field → `undefined` = falsy → hiển thị như chưa bookmark. OK.
- **Delete bookmarked topic:** Delete hoạt động bình thường, bookmark không ngăn delete
- **Bookmark + summarizing temp topic:** Temp topic chưa có URL ổn định → disable bookmark cho temp topic
- **DB upgrade trên user cũ:** Version 1→2 migration thêm index, data hiện tại giữ nguyên

### Test Plan

- [ ] Click bookmark → icon chuyển filled, topic được đánh dấu
- [ ] Click lại → unbookmark, icon chuyển outline
- [ ] Bật filter bookmark → chỉ hiển thị topic đã bookmark
- [ ] Tắt filter → hiển thị tất cả
- [ ] Sort "Mới nhất" → bookmarked topics xuất hiện đầu trong mỗi nhóm domain
- [ ] Refresh sidepanel → bookmark state persist (từ IndexedDB)
- [ ] Delete topic đã bookmark → xóa bình thường
- [ ] Extension upgrade (DB version 1→2) → existing topics giữ nguyên, có thể bookmark

### Rollback Plan

1. Revert `CachedTopic.bookmarked` field (optional, không breaking)
2. Revert DB_VERSION về 1 (cần clear IndexedDB hoặc handle downgrade)
3. Revert TopicHubView.vue changes

---

## Feature 19: Tab Kiến thức (thay thế Ý kiến)

### Objective & Scope

Thay thế tab "Ý kiến" bằng tab "Kiến thức" với mục đích hoàn toàn mới:
- **Trích xuất kiến thức** từ posts trong topic (dùng LLM)
- **Lưu trữ** dưới dạng structured entries có format thống nhất
- **Hiển thị** dạng danh sách dễ đọc, scroll, search
- **Tra cứu** nhanh trong các kiến thức đã trích xuất

Khác biệt với tab Ý kiến cũ:
| | Tab Ý kiến (cũ) | Tab Kiến thức (mới) |
|---|---|---|
| **Mục đích** | Phân tích quan điểm & sentiment | Trích xuất kiến thức chia sẻ |
| **Output** | Danh sách opinions + supporters | Danh sách knowledge entries có tag |
| **Dùng lại** | Hiếm khi xem lại | Tra cứu thường xuyên |
| **Format** | Accordion với quote | Cards với tag + source |

**Ngoài scope:** Export kiến thức ra file, cross-topic knowledge graph, auto-categorization.

### Hiện trạng

- Tab Ý kiến hiện dùng `OpinionsView.vue` → route `/opinions`
- Output là JSON `OpinionAnalysis` (mainTopic, sentiment, opinions[])
- `CachedTopic.opinions` lưu raw JSON string
- Prompt `analyzeOpinions` trong `lib/prompts.ts`
- `useLLM.ts` có `analyzeOpinions()` method

### Affected Modules

| File | Thay đổi |
|------|----------|
| `lib/types.ts` | Thêm `KnowledgeEntry` interface, `CachedTopic.knowledgeEntries` |
| `lib/prompts.ts` | Thêm `KNOWLEDGE_EXTRACT_PROMPT` |
| `entrypoints/sidepanel/views/KnowledgeView.vue` | **TẠO MỚI** — view chính cho tab Kiến thức |
| `entrypoints/sidepanel/views/OpinionsView.vue` | Giữ lại file (không xóa), bỏ khỏi router |
| `entrypoints/sidepanel/main.ts` | Route `/opinions` → `/knowledge`, component → `KnowledgeView` |
| `entrypoints/sidepanel/App.vue` | Tab label "Ý kiến" → "Kiến thức", route check `opinions` → `knowledge` |
| `entrypoints/sidepanel/composables/useLLM.ts` | Thêm `extractKnowledge()` method |
| `entrypoints/background/index.ts` | Handle `extract_knowledge` task type |

### Data Model

```typescript
// lib/types.ts

export interface KnowledgeEntry {
  id: string;               // nanoid hoặc crypto.randomUUID()
  title: string;            // Tiêu đề kiến thức (1 dòng)
  content: string;          // Nội dung chi tiết (2-5 câu, plain text)
  tags: string[];           // Tags phân loại (e.g. "kinh nghiệm", "cảnh báo", "mẹo", "thống kê")
  source: {                 // Nguồn trích dẫn
    author: string;         // Tên tác giả
    postNumber: number;     // Số bài viết (#N)
  };
  extractedAt: number;      // Timestamp trích xuất
}

// Thêm vào CachedTopic:
export interface CachedTopic {
  // ... existing fields
  knowledgeEntries?: KnowledgeEntry[];  // Feature 19
}
```

**Rationale cho format này:**
- `title` + `content`: Dễ scan nhanh (đọc title) và đọc chi tiết (content)
- `tags`: Cho phép filter/group theo loại kiến thức
- `source`: Truy xuất nguồn gốc, tăng tin cậy
- `id`: Cho phép thao tác individual (xóa, sửa sau này)
- Flat array (không nested) → đơn giản cho storage và render

### LLM Prompt Design

```
KNOWLEDGE_EXTRACT_PROMPT:

Nhiệm vụ: Trích xuất các kiến thức hữu ích, mẹo, kinh nghiệm, thông tin quan trọng
được chia sẻ trong topic diễn đàn sau.

BẮT BUỘC:
- Output PHẢI là JSON array hợp lệ, KHÔNG có text nào khác
- Mỗi entry là một kiến thức độc lập, có thể hiểu mà không cần đọc topic
- Chỉ trích xuất kiến thức thực sự hữu ích, bỏ qua chat rác, reaction, off-topic
- Tags phải từ danh sách: "kinh nghiệm", "mẹo", "cảnh báo", "thống kê", "so sánh",
  "hướng dẫn", "đánh giá", "tài nguyên"
- Tối đa 20 entries (ưu tiên chất lượng hơn số lượng)

Format output:
[
  {
    "title": "Tiêu đề ngắn gọn (< 80 ký tự)",
    "content": "Nội dung chi tiết 2-5 câu. Phải tự đứng được mà không cần context.",
    "tags": ["tag1", "tag2"],
    "source": { "author": "Tên tác giả", "postNumber": 5 }
  }
]

Topic: {title}
Bài viết:
{posts}
```

### Implementation Steps

#### Step 1: Type definitions (`lib/types.ts`)

Thêm `KnowledgeEntry` interface và update `CachedTopic` (đã gộp ở Feature 18 Step 1).

Thêm `'extract_knowledge'` vào `LLMTaskRequest.taskType`:
```typescript
export interface LLMTaskRequest {
  taskId: string;
  taskType: 'summarize' | 'summarize_incremental' | 'analyze_opinions' | 'research' | 'extract_knowledge';
  payload: unknown;
}
```

#### Step 2: LLM Prompt (`lib/prompts.ts`)

Thêm `KNOWLEDGE_EXTRACT_PROMPT` constant và `getKnowledgePrompt(title: string, posts: string)` function. Pattern tương tự `getSummaryPrompt()` / `getOpinionsPrompt()`.

#### Step 3: Knowledge Extractor (`lib/llm/knowledge-extractor.ts` — MỚI)

```typescript
// Tương tự lib/llm/opinion-analyzer.ts
// Input: posts[], title, llmConfig
// Output: KnowledgeEntry[]
// Logic:
//   1. Format posts thành text (giống summarizer)
//   2. Gọi LLM với KNOWLEDGE_EXTRACT_PROMPT
//   3. Parse JSON output → KnowledgeEntry[]
//   4. Validate: filter entries thiếu title/content, sanitize tags
//   5. Gán id (crypto.randomUUID()) + extractedAt cho mỗi entry
```

JSON repair: Reuse `repairJson()` logic từ OpinionsView (extract thành shared util nếu chưa có).

#### Step 4: Background handler (`entrypoints/background/index.ts`)

Thêm case `'extract_knowledge'` trong `START_LLM_TASK` handler:
```typescript
case 'extract_knowledge': {
  const { posts, title, url } = payload;
  const entries = await extractKnowledge(posts, title, config);
  // Return entries → sidepanel saves via SAVE_CACHED_TOPIC
  return { entries };
}
```

#### Step 5: useLLM composable (`composables/useLLM.ts`)

Thêm `extractKnowledge()` method:
```typescript
function extractKnowledge(posts: ScrapedPost[], title: string, topicUrl: string): string {
  const taskId = generateTaskId();
  sendMessage('START_LLM_TASK', {
    taskId,
    taskType: 'extract_knowledge',
    payload: { posts, title, url: topicUrl },
  });
  return taskId;  // fire-and-forget, track via activeTasks
}
```

#### Step 6: Router update (`main.ts`)

```typescript
// Thay đổi:
// { path: '/opinions', name: 'opinions', component: () => import('./views/OpinionsView.vue') }
// →
{ path: '/knowledge', name: 'knowledge', component: () => import('./views/KnowledgeView.vue') }
```

Giữ route `/opinions` redirect sang `/knowledge` cho backward compat (nếu có deep link):
```typescript
{ path: '/opinions', redirect: '/knowledge' }
```

#### Step 7: App.vue — Tab update

Thay đổi tab "Ý kiến" → "Kiến thức":
```vue
<!-- Thay: -->
<button ... :class="route.name === 'opinions' ..." @click="... navigateTo('/opinions')">
  Ý kiến
</button>
<!-- Bằng: -->
<button ... :class="route.name === 'knowledge' ..." @click="... navigateTo('/knowledge')">
  Kiến thức
</button>
```

#### Step 8: KnowledgeView.vue (TẠO MỚI)

**Layout structure:**

```
┌─────────────────────────────────┐
│ ← Chủ đề    [Topic Title]      │  ← TopicMeta component
│ 120 bài · 12 trang             │
├─────────────────────────────────┤
│ [🔍 Tìm kiến thức...]  [Tag ▼] │  ← Search + Tag filter
├─────────────────────────────────┤
│ ┌─ Kiến thức 1 ──────────────┐ │
│ │ 📌 Title here               │ │
│ │ Content text 2-5 sentences  │ │
│ │ [kinh nghiệm] [mẹo]        │ │  ← Tag badges
│ │ — Tác giả, #bài viết 5     │ │  ← Source citation
│ └─────────────────────────────┘ │
│ ┌─ Kiến thức 2 ──────────────┐ │
│ │ ...                         │ │
│ └─────────────────────────────┘ │
│           ...                   │
├─────────────────────────────────┤
│ [Trích xuất kiến thức]          │  ← Action button (nếu chưa có)
│ [Trích xuất lại]                │  ← Re-extract (nếu đã có)
│ 15 kiến thức · trích xuất lúc.. │  ← Stats
└─────────────────────────────────┘
```

**Key features:**
- **Search:** Filter entries by title/content text match (client-side, instant)
- **Tag filter:** Dropdown multi-select tags → filter entries có tag matching
- **Cards:** Mỗi entry hiển thị title (bold), content, tag badges (color-coded), source
- **Empty state:** "Chưa có kiến thức. Nhấn 'Trích xuất' để bắt đầu." + action button
- **Loading state:** Dùng `ProgressIndicator` component (Feature 17)

**Tag color mapping:**
```typescript
const TAG_COLORS: Record<string, string> = {
  'kinh nghiệm': 'bg-blue-100 text-blue-700',
  'mẹo': 'bg-green-100 text-green-700',
  'cảnh báo': 'bg-red-100 text-red-700',
  'thống kê': 'bg-purple-100 text-purple-700',
  'so sánh': 'bg-orange-100 text-orange-700',
  'hướng dẫn': 'bg-teal-100 text-teal-700',
  'đánh giá': 'bg-yellow-100 text-yellow-700',
  'tài nguyên': 'bg-indigo-100 text-indigo-700',
};
```

**Script logic (tương tự OpinionsView pattern):**
```typescript
// State
const entries = ref<KnowledgeEntry[]>([]);
const searchQuery = ref('');
const selectedTags = ref<string[]>([]);
const llmTaskId = ref<string | null>(null);

// Computed
const filteredEntries = computed(() => {
  let result = entries.value;
  // Search filter
  const q = searchQuery.value.trim().toLowerCase();
  if (q) {
    result = result.filter(e =>
      e.title.toLowerCase().includes(q) ||
      e.content.toLowerCase().includes(q)
    );
  }
  // Tag filter
  if (selectedTags.value.length > 0) {
    result = result.filter(e =>
      e.tags.some(t => selectedTags.value.includes(t))
    );
  }
  return result;
});

const allTags = computed(() => {
  const tags = new Set<string>();
  entries.value.forEach(e => e.tags.forEach(t => tags.add(t)));
  return [...tags].sort();
});

// Load from cache on mount
onActivated(async () => {
  const topic = store.selectedTopic.value;
  if (!topic) return;
  const cached = await sendMessage<CachedTopic>('GET_CACHED_TOPIC', topic.url);
  entries.value = cached?.knowledgeEntries ?? [];
});

// Extract action
async function handleExtract() {
  const topic = store.selectedTopic.value;
  if (!topic?.posts?.length) return;
  llmTaskId.value = extractKnowledge(topic.posts, topic.title, topic.url);
  // Wait for result via useLLM activeTasks watcher
}

// On LLM result → save entries to cache
watch(() => activeTasks.get(llmTaskId.value)?.status, (status) => {
  if (status === 'done') {
    const result = activeTasks.get(llmTaskId.value!)?.result;
    entries.value = result.entries;
    // Save to cache
    sendMessage('SAVE_CACHED_TOPIC', {
      ...store.selectedTopic.value,
      knowledgeEntries: entries.value,
    });
    store.updateSelectedTopic({ knowledgeEntries: entries.value });
  }
});
```

#### Step 9: Cleanup

- `OpinionsView.vue`: Giữ file trong codebase (không xóa). Bỏ khỏi router chỉ bằng route change.
- `CachedTopic.opinions`: Giữ field trong type (backward compat). Không hiển thị nữa nhưng data cũ không bị mất.
- Custom prompt `opinions` trong `CustomPrompts`: Giữ nguyên, thêm `knowledge?: string` cho custom prompt mới.

### Edge Cases

- **Topic không có posts (chưa scrape):** Disable nút "Trích xuất", hiện message "Cần tóm tắt topic trước để có dữ liệu bài viết"
- **Ít bài viết (< 5):** LLM có thể trả ít entries → OK, hiển thị bao nhiêu có bấy nhiêu
- **LLM trả JSON invalid:** Dùng `repairJson()` rồi retry parse. Nếu vẫn fail → hiển thị error + cho retry
- **LLM trả entries rỗng:** Hiện "Không tìm thấy kiến thức đáng ghi nhận trong topic này"
- **Tags ngoài danh sách chuẩn:** Accept vẫn hiển thị, dùng màu default (gray)
- **Existing Opinion data:** `CachedTopic.opinions` giữ nguyên trong DB, không migrate/xóa. Tab Ý kiến chỉ bị ẩn, không mất data
- **Topic switch nhanh:** Guard bằng `loadedTopicUrl` (pattern từ OpinionsView) — bỏ qua result nếu topic đã đổi
- **Re-extract:** Cho phép extract lại → overwrite entries cũ (confirm dialog trước khi overwrite)
- **Large topic (nhiều posts):** Có thể cần chunking tương tự map-reduce cho summary. V1 gửi toàn bộ posts, nếu exceed context → truncate posts cuối. Cải thiện ở version sau.

### Test Plan

- [ ] Navigate đến tab Kiến thức → hiện empty state đúng
- [ ] Click "Trích xuất" → ProgressIndicator hiện → kết quả render đúng
- [ ] Entries hiển thị title, content, tags, source đầy đủ
- [ ] Search filter: gõ keyword → entries filter real-time
- [ ] Tag filter: chọn tag → chỉ hiện entries có tag đó
- [ ] Kết hợp search + tag filter
- [ ] Switch topic → entries load từ cache hoặc hiện empty state
- [ ] Re-extract → confirm → entries mới thay thế cũ
- [ ] Topic chưa có posts → nút extract disabled + message rõ ràng
- [ ] LLM error → ErrorDisplay hiện, cho retry
- [ ] Route cũ `/opinions` redirect sang `/knowledge`
- [ ] Tab label hiện "Kiến thức" thay "Ý kiến"
- [ ] Dark mode → tag colors, cards hiển thị đúng

### Rollback Plan

1. Revert router: `/knowledge` → `/opinions`, component → `OpinionsView`
2. Revert App.vue tab label
3. Xóa `KnowledgeView.vue`, `knowledge-extractor.ts`
4. Revert type changes (xóa `KnowledgeEntry`, `knowledgeEntries`)
5. `OpinionsView.vue` không bị xóa → restore router là đủ

---

## Decision Log

### Quyết định 1: Giữ OpinionsView.vue, không xóa
- **Đã chọn:** Giữ file, chỉ bỏ khỏi router
- **Lý do:** Tránh mất code reference, có thể cần revert nhanh, data `opinions` trong cache vẫn còn
- **Đã cân nhắc nhưng loại:**
  - Xóa file hoàn toàn — loại vì khó rollback, code có logic `repairJson` có thể reuse
  - Merge vào KnowledgeView — loại vì mục đích hoàn toàn khác, code bloat
- **Điều kiện thay đổi:** Khi chắc chắn không cần tab Ý kiến nữa (sau 2-3 tuần stable), có thể xóa

### Quyết định 2: Flat array cho KnowledgeEntry (không nested categories)
- **Đã chọn:** `knowledgeEntries: KnowledgeEntry[]` — flat array với tags
- **Lý do:** Đơn giản nhất cho V1, tags đủ để filter/group, không cần category hierarchy
- **Đã cân nhắc nhưng loại:**
  - Nested category → entries — loại vì over-engineering cho V1, LLM categorize không ổn định
  - Map<tag, entries[]> — loại vì entry có thể có nhiều tag, map structure phức tạp
- **Điều kiện thay đổi:** Khi user feedback cần organize theo folder/category → refactor thành tree structure

### Quyết định 3: Tags từ danh sách có sẵn (semi-controlled)
- **Đã chọn:** Prompt yêu cầu dùng tags từ danh sách chuẩn, nhưng UI accept mọi tag
- **Lý do:** LLM đôi khi sáng tạo tag mới hợp lý. Danh sách chuẩn giúp consistency 80%+, nhưng không block edge case
- **Đã cân nhắc nhưng loại:**
  - Strict validation (reject unknown tags) — loại vì mất thông tin, LLM có thể tạo tag hay
  - Hoàn toàn tự do (không gợi ý) — loại vì tags sẽ inconsistent, khó filter
- **Điều kiện thay đổi:** Nếu tags quá loạn → thêm post-processing normalize bước

### Quyết định 4: Bookmark ưu tiên khi sort "Mới nhất" (không tạo sort mode riêng)
- **Đã chọn:** Bookmarked topics đẩy lên đầu trong sort "Mới nhất", các sort khác không ảnh hưởng
- **Lý do:** Minimal change, user habit chủ yếu là sort recent, bookmark = "quan trọng nên xem trước"
- **Đã cân nhắc nhưng loại:**
  - Sort mode riêng "Đã bookmark" — loại vì đã có filter toggle, thêm sort mode là redundant
  - Bookmark ưu tiên mọi sort mode — loại vì sort "Tên A-Z" và "Nhiều bài" có semantic riêng, inject bookmark priority sẽ confusing
- **Điều kiện thay đổi:** Nếu user feedback muốn bookmark priority ở mọi sort → thêm

### Quyết định 5: DB version bump 1→2 (single migration)
- **Đã chọn:** Gộp cả `by-bookmarked` index vào 1 migration version 2
- **Lý do:** Implement liên tiếp, 1 migration đơn giản, tránh version 2→3 nhanh
- **Đã cân nhắc nhưng loại:**
  - Mỗi feature 1 version bump (2, 3) — loại vì implement cùng batch, unnecessary complexity
  - Không tạo index (query toàn bộ rồi filter JS) — loại vì có index sẵn thì query bookmark list nhanh hơn khi cần
- **Điều kiện thay đổi:** Nếu Feature 19 cần index riêng cho knowledge → bump thêm version
