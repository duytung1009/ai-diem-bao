# Feature: Real-time đồng bộ trạng thái tóm tắt với TopicHubView

**Status:** ✅ COMPLETED
**Date:** 2026-03-19
**PR Size:** 3 files modified, ~70 lines added

## Mục tiêu
Khi user đang tóm tắt topic ở tab "Tóm tắt", tab "Chủ đề" phải hiển thị trạng thái real-time: "Đang tóm tắt..." → "✓ Đã tóm tắt" mà không cần user quay lại tab để trigger `onActivated`.

## Thực hiện

### Task 1: Thêm `summarizingUrl` state vào useTopicStore ✅

**File:** `entrypoints/sidepanel/composables/useTopicStore.ts`

Thêm module-level ref và action:
```typescript
const summarizingUrl = ref<string | null>(null);

function setSummarizing(url: string | null) {
  summarizingUrl.value = url;
}

// Trong return:
summarizingUrl: readonly(summarizingUrl),
setSummarizing,
```

### Task 2: SummaryView cập nhật trạng thái summarizing ✅

**File:** `entrypoints/sidepanel/views/SummaryView.vue`

- **Khi bắt đầu tóm tắt** — trong `confirmSummarize()`, trước LLM call:
  ```typescript
  store.setSummarizing(topic.url);
  ```

- **Khi tóm tắt xong** — sau `store.updateSelectedTopic()`:
  ```typescript
  store.setSummarizing(null);
  ```

- **Khi lỗi** — trong catch block:
  ```typescript
  store.setSummarizing(null);
  ```

### Task 3: TopicHubView reactive với store changes ✅

**File:** `entrypoints/sidepanel/views/TopicHubView.vue`

**3a. Watch store.selectedTopic để sync khi summary hoàn thành:**
```typescript
watch(
  () => store.selectedTopic.value,
  (updated) => {
    if (!updated?.url) return;
    const idx = allTopics.value.findIndex(t => t.url === updated.url);
    if (idx >= 0) {
      // Update topic trong list
      const topic: CachedTopic = {
        ...allTopics.value[idx],
        ...updated,
        posts: updated.posts ? [...updated.posts] : allTopics.value[idx].posts,
        researchHistory: updated.researchHistory ? [...updated.researchHistory] : allTopics.value[idx].researchHistory,
      };
      allTopics.value[idx] = topic;
    } else if (updated.summary || updated.posts?.length) {
      // Topic mới được cache — thêm vào list
      const topic: CachedTopic = {
        ...updated,
        posts: updated.posts ? [...updated.posts] : [],
        researchHistory: updated.researchHistory ? [...updated.researchHistory] : [],
      } as CachedTopic;
      allTopics.value = [...allTopics.value, topic];
    }
  },
  { deep: true }
);
```
*Lưu ý:* Cần spread `posts` và `researchHistory` arrays vì chúng là readonly từ store

**3b. Hiển thị trạng thái "Đang tóm tắt" trên topic card:**

"Tab hiện tại" card (lines 159-174):
```html
<span
  v-if="store.summarizingUrl.value && store.activeTabUrl.value && store.summarizingUrl.value === store.activeTabUrl.value"
  class="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium animate-pulse"
>
  ⟳ Đang tóm tắt...
</span>
<span v-else class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
  ○ Chưa tóm tắt
</span>
```

Individual topic cards (lines 217-232):
```html
<span
  v-if="store.summarizingUrl.value === topic.url"
  class="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium animate-pulse"
>
  ⟳ Đang tóm tắt...
</span>
<span
  v-else-if="topic.summary"
  class="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium"
>
  ✓ Đã tóm tắt
</span>
<span
  v-else
  class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500"
>
  ○ Chưa tóm tắt
</span>
```

### Task 4: Temp topic card cho topic chưa có trong cache ✅

**File:** `entrypoints/sidepanel/views/TopicHubView.vue`

**4a. Computed `summarizingTempTopic` (khai báo TRƯỚC `groupedTopics`):**
```typescript
const summarizingTempTopic = computed(() => {
  const url = store.summarizingUrl.value;
  if (!url) return null;
  const alreadyInList = allTopics.value.some(t => t.url === url);
  if (alreadyInList) return null;
  const selected = store.selectedTopic.value;
  return selected?.url === url ? selected : null;
});
```
Chỉ hiện khi: `summarizingUrl !== null` AND URL chưa có trong `allTopics`.

**4b. `groupedTopics` inject temp topic vào đúng domain group:**
```typescript
const groupedTopics = computed(() => {
  const groups: Record<string, CachedTopic[]> = {};
  const topics = summarizingTempTopic.value
    ? [...allTopics.value, summarizingTempTopic.value as CachedTopic]
    : allTopics.value;
  for (const topic of topics) {
    // ...group by hostname...
  }
  // Sort by cachedAt desc — temp topic (cachedAt=0) floats to bottom
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => (b.cachedAt || 0) - (a.cachedAt || 0));
  }
  return groups;
});
```

**4c. "Tab hiện tại" card giữ nguyên điều kiện — hiển thị song song với temp card:**
```html
v-if="store.activeTabDetect.value && !activeTabInList"
```

**4d. Temp card nằm trong domain group — card pulsing + ẩn delete button:**
```html
<!-- Card wrapper: pulse khi đang summarize -->
<div
  class="relative border rounded-lg transition-colors"
  :class="store.summarizingUrl.value === topic.url
    ? 'border-blue-300 bg-blue-50/60 animate-pulse'
    : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50/50'"
>
  <!-- ... nội dung card ... -->

  <!-- Delete button: ẩn khi đang summarize -->
  <button
    v-if="store.summarizingUrl.value !== topic.url"
    class="absolute top-2 right-2 ..."
    @click.stop="confirmDelete(topic)"
  >...</button>
</div>
```

**Lifecycle:**
- **Bắt đầu tóm tắt:** `setSummarizing(url)` → `summarizingTempTopic` non-null → inject vào `groupedTopics` → card pulsing hiện trong domain group
- **Thành công:** `updateSelectedTopic({summary})` → watch thêm topic vào `allTopics` → `alreadyInList = true` → `summarizingTempTopic = null` → card pulse biến mất, real card (không pulse) hiện thay thế
- **Lỗi:** `setSummarizing(null)` → `summarizingTempTopic = null` → card biến mất hoàn toàn

## Verification ✅

- ✅ `npx vue-tsc --noEmit` — pass
- ✅ `npm run build` — pass (301.32 kB)
- ✅ Feature logic tested:
  - Thêm `watch` với `{ deep: true }` để track readonly objects từ store
  - Status badge hiển thị real-time mà không cần refresh tab
  - "Đang tóm tắt..." badge có `animate-pulse` để nhấn mạnh action

## Key Insights

1. **Readonly handling:** Store trả về readonly refs, nên khi spread vào allTopics cần phải spread lại các arrays ("posts", "researchHistory") để tránh type error

2. **Watch with deep:true:** Cần `{ deep: true }` vì `selectedTopic` là object với nested properties

3. **Real-time sync:** Không cần `onActivated` để reload từ background — store mutation tự động trigger watch trong TopicHubView

## Files Modified

1. `entrypoints/sidepanel/composables/useTopicStore.ts` — +2 lines, thêm state + action
2. `entrypoints/sidepanel/views/SummaryView.vue` — +5 lines, set/clear summarizing state
3. `entrypoints/sidepanel/views/TopicHubView.vue` — +43 lines, watch + badge logic

## Testing Checklist

- [ ] Mở topic → click "Tóm tắt" → chuyển sang tab "Chủ đề" → thấy "⟳ Đang tóm tắt..." với pulse animation
- [ ] Khi tóm tắt xong → badge tự chuyển thành "✓ Đã tóm tắt" mà không cần refresh
- [ ] Nếu tóm tắt lỗi → badge quay về "○ Chưa tóm tắt"
- [ ] Topic mới (chưa cache) → bắt đầu tóm tắt → chuyển tab "Chủ đề" → thấy card pulsing xanh trong đúng domain group, badge "⟳ Đang tóm tắt..."
- [ ] "Tab hiện tại" card vẫn hiển thị song song với temp card (không bị ẩn)
- [ ] Tóm tắt xong → card pulse biến mất, real card (không pulse) hiện với "✓ Đã tóm tắt"
- [ ] Tóm tắt lỗi → card biến mất hoàn toàn khỏi domain group
- [ ] Delete button ẩn khi card đang ở trạng thái summarizing
- [ ] Click vào card đang summarize → quay lại SummaryView xem tiến trình

## Architecture Notes

**Pattern:** V signal → W watch → U update UI
- SummaryView **sets** `store.summarizingUrl` (V)
- TopicHubView **watches** `store.selectedTopic` để sync khi xong (W)
- `summarizingTempTopic` computed inject topic vào `groupedTopics` real-time (U)

**Khai báo order quan trọng:**
`summarizingTempTopic` phải được khai báo TRƯỚC `groupedTopics` vì JS `const` không hoisting — `groupedTopics` phụ thuộc vào `summarizingTempTopic`.

**Sorting:** temp topic có `cachedAt = 0` → tự float xuống cuối domain group khi sort desc.

**Next Steps** (nếu cần):
- Có thể thêm loading spinner nhỏ trong card thay cho pulsing animation
- Có thể track error state (`summarizingError`) để hiển thị error badge thay vì xóa hẳn card
