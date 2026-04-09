# Feature 22: Knowledge Tab Improvements

## Objective & Scope

Cải tiến tab Kiến thức với 5 tính năng:
1. **Collapse/expand** mỗi entry — compact view để browse
2. **Hiển thị ngày đăng** bài nguồn trong expanded view
3. **Lưu/xóa entry** — đánh dấu kiến thức quan trọng
4. **Filter "Đã lưu"** — xem riêng các entries đã save
5. **Re-extract incremental** — chỉ extract posts mới, track deleted posts, "Xóa tracking" để re-extract lại

## Affected Modules

- `lib/types.ts` — types
- `entrypoints/background/index.ts` — SAVE_CACHED_TOPIC merge
- `entrypoints/sidepanel/views/KnowledgeView.vue` — toàn bộ UI + logic

## Files cần sửa

| File | Thay đổi |
|------|----------|
| `lib/types.ts` | Thêm `saved?: boolean`, `timestamp?: string` vào `KnowledgeEntry.source`; thêm `lastKnowledgePostNumber?`, `excludedKnowledgePostNumbers?` vào `CachedTopic` |
| `entrypoints/background/index.ts` | Merge 2 fields mới trong SAVE_CACHED_TOPIC |
| `entrypoints/sidepanel/views/KnowledgeView.vue` | Collapse/expand, save/delete toggle, saved filter, timestamp display, incremental re-extract, clear tracking |

---

## Implementation Steps

### Step 1: `lib/types.ts`

```typescript
export interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  tags: string[];
  source: {
    author: string;
    postNumber: number;
    timestamp?: string;   // ← THÊM: ISO datetime từ ScrapedPost.timestamp
  };
  extractedAt: number;
  saved?: boolean;         // ← THÊM
}

export interface CachedTopic {
  // ... existing fields ...
  knowledgeEntries?: KnowledgeEntry[];
  lastKnowledgePostNumber?: number;         // ← THÊM: max postNumber của lần extract gần nhất
  excludedKnowledgePostNumbers?: number[];  // ← THÊM: postNumbers user đã xóa, không re-extract
}
```

### Step 2: `entrypoints/background/index.ts` — Merge fields mới

Trong SAVE_CACHED_TOPIC handler (sau `knowledgeEntries` line ~110).
**QUAN TRỌNG:** Dùng `!== undefined` thay vì `??` cho 2 fields mới để clear về `[]` hoặc `0` hoạt động đúng:

```typescript
knowledgeEntries: partial.knowledgeEntries ?? existing?.knowledgeEntries,
lastKnowledgePostNumber: partial.lastKnowledgePostNumber !== undefined
  ? partial.lastKnowledgePostNumber
  : existing?.lastKnowledgePostNumber,
excludedKnowledgePostNumbers: partial.excludedKnowledgePostNumbers !== undefined
  ? partial.excludedKnowledgePostNumbers
  : existing?.excludedKnowledgePostNumbers,
```

### Step 3: `KnowledgeView.vue` — Collapse/expand

State: `expandedIds = ref<Set<string>>(new Set())` — mặc định tất cả collapsed.

```typescript
function toggleExpand(id: string) {
  const s = new Set(expandedIds.value);
  s.has(id) ? s.delete(id) : s.add(id);
  expandedIds.value = s;
}
```

Template — dùng CSS Grid pattern từ `AccordionItem.vue` (`grid-rows-[0fr]`/`grid-rows-[1fr]`, transition 200ms):

```vue
<div v-for="entry in filteredEntries" :key="entry.id" class="card">
  <!-- Header: luôn visible, click để expand -->
  <div class="flex items-start gap-2 cursor-pointer" @click="toggleExpand(entry.id)">
    <svg :class="expandedIds.has(entry.id) ? 'rotate-90' : ''"
         class="w-3.5 h-3.5 mt-0.5 shrink-0 transition-transform duration-200 text-(--color-text-muted)">
      <!-- chevron-right icon -->
    </svg>
    <p class="text-sm font-semibold text-(--color-text-primary) flex-1 leading-snug">
      {{ entry.title }}
    </p>
    <!-- Save button -->
    <button @click.stop="toggleSave(entry)"
            class="shrink-0 p-0.5 transition-colors"
            :class="entry.saved ? 'text-amber-500' : 'text-(--color-text-muted) hover:text-amber-500'">
      <!-- bookmark-solid nếu saved, bookmark-outline nếu không -->
    </button>
    <!-- Delete button -->
    <button @click.stop="handleDelete(entry)"
            class="shrink-0 p-0.5 text-(--color-text-muted) hover:text-red-500 transition-colors">
      <!-- trash icon -->
    </button>
  </div>

  <!-- Body: collapsible với CSS Grid animation -->
  <div class="grid transition-all duration-200 ease-in-out"
       :class="expandedIds.has(entry.id) ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'">
    <div class="overflow-hidden">
      <div class="pt-2 space-y-2">
        <p class="text-xs text-(--color-text-secondary) leading-relaxed">{{ entry.content }}</p>
        <div v-if="entry.tags.length" class="flex flex-wrap gap-1">
          <span v-for="tag in entry.tags" :key="tag"
                class="px-1.5 py-0.5 rounded text-xs" :class="getTagClass(tag)">
            {{ tag }}
          </span>
        </div>
        <p class="text-xs text-(--color-text-muted)">
          — {{ entry.source.author }}<span v-if="entry.source.postNumber">, bài #{{ entry.source.postNumber }}</span>
          <span v-if="entry.source.timestamp"> · {{ formatTimestamp(entry.source.timestamp) }}</span>
        </p>
      </div>
    </div>
  </div>
</div>
```

Reset `expandedIds` về `new Set()` sau khi extract xong.

**Timestamp helper:**
```typescript
function formatTimestamp(ts: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts; // fallback: raw string nếu parse fail
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
```

### Step 4: `KnowledgeView.vue` — Delete + tracking

```typescript
async function handleDelete(entry: KnowledgeEntry) {
  const updated = entries.value.filter(e => e.id !== entry.id);
  const excluded = [
    ...(cachedTopic.value?.excludedKnowledgePostNumbers ?? []),
    entry.source.postNumber,
  ];
  entries.value = updated;
  store.updateSelectedTopic({ knowledgeEntries: updated });
  await sendMessage('SAVE_CACHED_TOPIC', {
    url: cachedTopic.value!.url,
    knowledgeEntries: updated,
    excludedKnowledgePostNumbers: excluded,
  }).catch(() => {});
}

const excludedCount = computed(() =>
  cachedTopic.value?.excludedKnowledgePostNumbers?.length ?? 0
);

async function handleClearTracking() {
  await sendMessage('SAVE_CACHED_TOPIC', {
    url: cachedTopic.value!.url,
    excludedKnowledgePostNumbers: [],
    lastKnowledgePostNumber: 0,  // 0 = signal re-extract all; QD5
  }).catch(() => {});
  const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', cachedTopic.value!.url);
  if (fresh) cachedTopic.value = fresh;
}
```

UI: "Xóa tracking (N)" button chỉ hiện khi `excludedCount > 0`, đặt dưới stats row.

### Step 5: `KnowledgeView.vue` — Save/unsave toggle

```typescript
async function toggleSave(entry: KnowledgeEntry) {
  const updated = entries.value.map(e =>
    e.id === entry.id ? { ...e, saved: !e.saved } : e
  );
  entries.value = updated;
  store.updateSelectedTopic({ knowledgeEntries: updated });
  await sendMessage('SAVE_CACHED_TOPIC', {
    url: cachedTopic.value!.url,
    knowledgeEntries: updated,
  }).catch(() => {});
}
```

### Step 6: `KnowledgeView.vue` — Filter "Đã lưu"

```typescript
const showSavedOnly = ref(false);
const savedCount = computed(() => entries.value.filter(e => e.saved).length);

const filteredEntries = computed(() => {
  let result = entries.value;
  if (showSavedOnly.value) result = result.filter(e => e.saved);
  const q = searchQuery.value.trim().toLowerCase();
  if (q) result = result.filter(e =>
    e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q));
  if (selectedTags.value.length > 0)
    result = result.filter(e => e.tags.some(t => selectedTags.value.includes(t)));
  return result;
});
```

UI: toggle pill "Đã lưu (N)" cạnh search bar, chỉ hiện khi `savedCount > 0`.

### Step 7: `KnowledgeView.vue` — Incremental re-extract

```typescript
async function handleExtract() {
  if (!allPosts.value.length) return;

  const lastPostNum = cachedTopic.value?.lastKnowledgePostNumber ?? -1;
  const excludedNums = new Set(cachedTopic.value?.excludedKnowledgePostNumbers ?? []);
  const postsToExtract = allPosts.value.filter(p =>
    p.postNumber > lastPostNum && !excludedNums.has(p.postNumber)
  );

  if (!postsToExtract.length) {
    error.value = 'Không có bài viết mới để trích xuất kiến thức.';
    return;
  }

  isLoading.value = true;
  error.value = '';
  llmTaskId.value = null;
  if (lastPostNum < 0) {
    searchQuery.value = '';
    selectedTags.value = [];
  }

  try {
    const { taskId, result } = runExtract(postsToExtract, cachedTopic.value!.title);
    llmTaskId.value = taskId;
    const llmResult = await result;
    const newEntries: KnowledgeEntry[] = ((llmResult.data as { entries?: KnowledgeEntry[] })?.entries) ?? [];

    // Enrich với timestamp từ allPosts
    const enriched = newEntries.map(e => {
      const post = allPosts.value.find(p => p.postNumber === e.source.postNumber);
      return post?.timestamp ? { ...e, source: { ...e.source, timestamp: post.timestamp } } : e;
    });

    // Merge strategy:
    // - lastPostNum > 0 (incremental): giữ tất cả entries cũ + append mới
    // - lastPostNum === 0 (sau clear tracking — full re-extract): giữ saved + new
    const savedEntries = entries.value.filter(e => e.saved);
    const merged = lastPostNum > 0
      ? [...entries.value, ...enriched]
      : [...savedEntries, ...enriched.filter(e => !savedEntries.some(s => s.source.postNumber === e.source.postNumber))];

    const newLastPostNum = Math.max(...allPosts.value.map(p => p.postNumber), lastPostNum);

    entries.value = merged;
    expandedIds.value = new Set();
    store.updateSelectedTopic({ knowledgeEntries: merged });
    await sendMessage('SAVE_CACHED_TOPIC', {
      url: cachedTopic.value!.url,
      knowledgeEntries: merged,
      lastKnowledgePostNumber: newLastPostNum,
    }).catch(() => {});
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    isLoading.value = false;
    llmTaskId.value = null;
  }
}
```

**Button labels:**
- Chưa có entries: `"Trích xuất Kiến thức"` (button primary, full width)
- Đã có entries: `"Trích xuất bài mới"` (link button cạnh stats)

```typescript
const newPostsCount = computed(() => {
  const last = cachedTopic.value?.lastKnowledgePostNumber ?? -1;
  if (last < 0) return 0;
  return allPosts.value.filter(p => p.postNumber > last).length;
});
```

---

## Edge Cases

1. **Lần đầu extract** (`lastKnowledgePostNumber` undefined): `lastPostNum = -1` → extract tất cả posts
2. **Re-extract không có posts mới và không có excluded cleared**: `postsToExtract.length = 0` → thông báo, không gọi LLM
3. **Clear tracking → re-extract**: `lastPostNum = 0` → extract tất cả; merge giữ saved entries
4. **Entry legacy** (không có `saved`, `timestamp`): falsy/undefined → UI gracefully skip ✅
5. **`excludedKnowledgePostNumbers: []` bị `??` bỏ qua**: Dùng `!== undefined` check trong background (đã xử lý ở Step 2)
6. **Timestamp parse fail**: `formatTimestamp` fallback raw string
7. **Article posts** (postNumber < 0): timestamp enrich skip vì `find()` trả undefined ✅
8. **Xóa entry saved**: bị xóa, postNumber vào excluded; save flag không ngăn delete

---

## Decision Log

### QD1: `saved?: boolean` trong KnowledgeEntry
- **Đã chọn:** Field inline trong `KnowledgeEntry`
- **Lý do:** Consistent với `bookmarked` pattern; merge qua `SAVE_CACHED_TOPIC` không đổi
- **Loại bỏ:** Separate `savedKnowledgeEntries[]` — duplicate data, merge phức tạp

### QD2: Default collapsed
- **Đã chọn:** Tất cả entries collapsed khi load
- **Lý do:** 20 entries all-expanded → list rất dài; title đủ để browse
- **Điều kiện thay đổi:** Nếu user feedback thấy bất tiện

### QD3: Approach B — track `lastKnowledgePostNumber`
- **Đã chọn:** Track max postNumber → re-extract chỉ posts mới
- **Lý do:** LLM không tốn token re-process posts cũ; entries cũ (saved + unsaved) vẫn còn giá trị
- **Loại bỏ:** Approach A (chỉ skip source của saved entries) — vẫn re-process nhiều posts cũ không cần thiết

### QD4: Giữ cả unsaved entries cũ khi re-extract incremental
- **Đã chọn:** Merge append (cũ + mới), không xóa entries cũ
- **Lý do:** User chưa save không có nghĩa là vô giá trị; incremental = thêm mới, không thay thế
- **Loại bỏ:** Chỉ giữ saved + thêm mới — mất entries chưa save có thể hữu ích

### QD5: `lastKnowledgePostNumber = 0` để signal "full re-extract sau clear tracking"
- **Đã chọn:** Reset về `0` thay vì `undefined`/`null`
- **Lý do:** `undefined` bị `??` merge operator giữ lại giá trị cũ trong background; `0` < mọi postNumber thực (postNumber bắt đầu từ 1); phân biệt với "chưa extract lần nào" (`-1`)
- **Loại bỏ:** Reset về `undefined` → background `??` merge giữ giá trị cũ → không có tác dụng clear

### QD6: Timestamp enrich ở frontend
- **Đã chọn:** Lookup `allPosts.find(p => p.postNumber === e.source.postNumber)?.timestamp` sau khi nhận entries
- **Lý do:** LLM không cần biết timestamp; enrich ở frontend đơn giản và đáng tin hơn
- **Loại bỏ:** Truyền timestamp vào prompt → tốn context, LLM có thể sai format

---

## Test Plan

1. `npm run build` + `npx vue-tsc --noEmit` — pass
2. **Collapse/expand**: Load entries → all collapsed; click title/chevron → expand; click lại → collapse; animation smooth
3. **Timestamp**: Expand entry → thấy ngày đăng bài bên cạnh author/postNumber
4. **Save/unsave**: Click bookmark icon → amber filled; reload tab → vẫn saved; click lại → unsave; filter "Đã lưu" hoạt động
5. **Delete + tracking**: Click trash icon → entry biến mất; "Xóa tracking (N)" xuất hiện
6. **Re-extract bỏ qua excluded**: Re-extract sau khi xóa → deleted entries không xuất hiện lại
7. **Clear tracking**: Click "Xóa tracking" → confirm → về 0; next re-extract có thể tạo lại entries cũ
8. **Re-extract sau clear tracking**: `lastPostNum = 0` → extract tất cả (trừ excluded đã cleared) → saved entries vẫn còn
9. **First extract**: `lastKnowledgePostNumber` undefined → extract tất cả → set `lastKnowledgePostNumber`
10. **Re-extract không có posts mới**: `postsToExtract.length = 0` → thông báo rõ ràng, không gọi LLM
11. **Filter kết hợp**: saved filter + search + tag filter đồng thời hoạt động đúng

---

## Rollback Plan

Revert `lib/types.ts` (xóa 3 fields), `background/index.ts` (xóa 2 dòng merge), `KnowledgeView.vue`. Không ảnh hưởng cache layer hay LLM layer.
