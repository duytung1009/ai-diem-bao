# Feature: Xóa topic khỏi cache

## Mục tiêu
Cho phép user xóa topic đã cache từ TopicHubView. Hỗ trợ xóa từng topic và xóa tất cả.

---

## Task 1: Thêm nút xóa trên topic card trong TopicHubView

### File: `entrypoints/sidepanel/views/TopicHubView.vue`

**Thêm nút xóa (icon X) ở góc phải mỗi topic card:**

Trong mỗi `<button>` card topic (hiện tại là 1 button duy nhất cho click → selectTopic), cần refactor thành:
- Outer container `<div>` thay vì `<button>` để chứa cả card click area và delete button
- Card body vẫn clickable → `selectTopic(topic)`
- Nút X nhỏ ở góc trên phải → `deleteTopic(topic)` với `@click.stop` để không trigger select

**Template mới cho mỗi topic card:**
```html
<div
  v-for="topic in groupedTopics[domain]"
  :key="topic.url"
  class="relative border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50/50 transition-colors"
>
  <button
    class="w-full text-left p-3 space-y-1.5"
    @click="selectTopic(topic)"
  >
    <p class="text-sm font-medium text-gray-900 line-clamp-2 pr-6">{{ topic.title }}</p>
    <!-- ...badges... -->
  </button>
  <button
    class="absolute top-2 right-2 p-1 text-gray-300 hover:text-red-500 transition-colors rounded"
    title="Xóa topic"
    @click.stop="confirmDelete(topic)"
  >
    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
    </svg>
  </button>
</div>
```

**Lưu ý:** `pr-6` trên title để tránh text bị đè bởi nút X.

---

## Task 2: Xác nhận trước khi xóa (confirm dialog đơn giản)

### File: `entrypoints/sidepanel/views/TopicHubView.vue`

**Thêm state và logic:**
```typescript
const pendingDeleteUrl = ref<string | null>(null);

function confirmDelete(topic: CachedTopic) {
  pendingDeleteUrl.value = topic.url;
}

function cancelDelete() {
  pendingDeleteUrl.value = null;
}

async function executeDelete() {
  if (!pendingDeleteUrl.value) return;
  try {
    await sendMessage('DELETE_CACHED_TOPIC', pendingDeleteUrl.value);
    allTopics.value = allTopics.value.filter(
      t => t.url !== pendingDeleteUrl.value
    );
    // Nếu topic đang selected trong store, clear selection
    if (store.selectedTopic.value?.url === pendingDeleteUrl.value) {
      store.clearSelection();
    }
  } catch {
    // Silently fail — topic list sẽ refresh khi onActivated
  } finally {
    pendingDeleteUrl.value = null;
  }
}
```

**UI confirm:** Inline confirmation thay vì modal (đơn giản hơn, phù hợp sidepanel nhỏ):
```html
<!-- Hiển thị ngay dưới topic card khi pendingDeleteUrl match -->
<div
  v-if="pendingDeleteUrl === topic.url"
  class="bg-red-50 border border-red-200 rounded-b-lg px-3 py-2 flex items-center justify-between -mt-px"
>
  <span class="text-xs text-red-700">Xóa topic này?</span>
  <div class="flex gap-2">
    <button
      class="text-xs px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
      @click.stop="executeDelete"
    >
      Xóa
    </button>
    <button
      class="text-xs px-2 py-1 border border-gray-300 text-gray-600 rounded hover:bg-gray-50 transition-colors"
      @click.stop="cancelDelete"
    >
      Hủy
    </button>
  </div>
</div>
```

---

## Task 3: Nút "Xóa tất cả" trong phần cài đặt cache

### File: `entrypoints/sidepanel/views/SettingsView.vue`

Trong block "Cache local" (hiện có progress bar + warning), thêm nút xóa tất cả:

```html
<button
  class="w-full text-xs py-1.5 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
  @click="confirmClearAll"
>
  Xóa tất cả cache
</button>
```

**Logic:**
```typescript
const showClearConfirm = ref(false);

function confirmClearAll() {
  showClearConfirm.value = true;
}

async function executeClearAll() {
  const topics = await sendMessage<CachedTopic[]>('GET_ALL_CACHED_TOPICS');
  for (const topic of topics || []) {
    await sendMessage('DELETE_CACHED_TOPIC', topic.url);
  }
  cacheSizeBytes.value = 0;
  showClearConfirm.value = false;
}
```

Hoặc thêm message type `DELETE_ALL_CACHED_TOPICS` trong background để xóa 1 lần (hiệu quả hơn).

---

## Verification
1. TopicHubView: hover topic card → nút X hiển thị
2. Click X → inline confirm xuất hiện
3. Click "Xóa" → topic biến mất khỏi list
4. Nếu topic đang được chọn → selection bị clear, tabs Tóm tắt/Ý kiến/Tra cứu bị disable
5. Settings → "Xóa tất cả cache" → confirm → cache size về 0
