# Feature: Real-time đồng bộ trạng thái tóm tắt với TopicHubView

## Mục tiêu
Khi user đang tóm tắt topic ở tab "Tóm tắt", tab "Chủ đề" phải hiển thị trạng thái real-time: "Đang tóm tắt..." → "✓ Đã tóm tắt" mà không cần user quay lại tab để trigger `onActivated`.

## Phân tích hiện trạng
- TopicHubView chỉ refresh data khi `onActivated` (user quay lại tab)
- SummaryView gọi `store.updateSelectedTopic()` sau khi tóm tắt xong, nhưng TopicHubView dùng `allTopics` local ref — không reactive với store
- Cần cơ chế push từ store → TopicHubView

---

## Task 1: Thêm trạng thái "summarizing" vào topic store

### File: `entrypoints/sidepanel/composables/useTopicStore.ts`

Thêm ref mới:
```typescript
const summarizingUrl = ref<string | null>(null);

// Trong return:
summarizingUrl: readonly(summarizingUrl),

// Actions mới:
function setSummarizing(url: string | null) {
  summarizingUrl.value = url;
}
```

---

## Task 2: SummaryView cập nhật trạng thái summarizing

### File: `entrypoints/sidepanel/views/SummaryView.vue`

**Khi bắt đầu tóm tắt** — trong `confirmSummarize()`, trước LLM call (khoảng dòng 220):
```typescript
store.setSummarizing(topic.url);
```

**Khi tóm tắt xong** — sau `store.updateSelectedTopic(...)` (khoảng dòng 264):
```typescript
store.setSummarizing(null);
```

**Khi lỗi** — trong catch block (khoảng dòng 272):
```typescript
store.setSummarizing(null);
```

---

## Task 3: TopicHubView reactive với store changes

### File: `entrypoints/sidepanel/views/TopicHubView.vue`

**3a. Watch `store.selectedTopic` để sync khi summary hoàn thành:**
```typescript
import { watch } from 'vue';

// Khi store.selectedTopic được update (summary mới), sync lại allTopics
watch(
  () => store.selectedTopic.value,
  (updated) => {
    if (!updated?.url) return;
    const idx = allTopics.value.findIndex(t => t.url === updated.url);
    if (idx >= 0) {
      // Update topic trong list mà không cần reload từ background
      allTopics.value[idx] = { ...allTopics.value[idx], ...updated };
    } else if (updated.summary || updated.posts?.length) {
      // Topic mới được cache — thêm vào list
      allTopics.value = [...allTopics.value, updated];
    }
  },
  { deep: true }
);
```

**3b. Hiển thị trạng thái "Đang tóm tắt" trên topic card:**

Trong template, thay block badge hiện tại (dòng 158-169):
```html
<!-- Status badge -->
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

**3c. Cũng apply cho "Tab hiện tại" card** (khoảng dòng 135):
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

---

## Verification
1. Mở topic → click "Tóm tắt" → chuyển sang tab "Chủ đề" → thấy "⟳ Đang tóm tắt..." (pulse animation)
2. Khi tóm tắt xong → badge tự chuyển thành "✓ Đã tóm tắt" mà không cần refresh
3. Nếu tóm tắt lỗi → badge quay về "○ Chưa tóm tắt"
4. `npx vue-tsc --noEmit` + `npm run build` → pass
