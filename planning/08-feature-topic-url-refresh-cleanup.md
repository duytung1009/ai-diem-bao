# Feature 08: Topic URL navigation, Refresh topic info, Xóa ExportButton, Fix CacheIndicator

## Tổng quan
4 yêu cầu nhỏ gộp chung, liên quan đến UX của màn hình Chủ đề và Tóm tắt.

---

## Task 1: Hiển thị URL topic + cho phép điều hướng activeTab đến topic

### Mục tiêu
User có thể bấm vào URL/link của topic để điều hướng activeTab (tab trình duyệt hiện tại) đến trang topic đó. Hữu ích khi user muốn xem bài gốc hoặc khi activeTab đang ở trang khác.

### File: `entrypoints/sidepanel/views/SummaryView.vue`

**1a. Thêm link URL bên dưới TopicMeta:**

Sau dòng `<TopicMeta :info="topicInfo" />` (dòng 316), thêm:

```html
<!-- Topic URL — click to navigate active tab -->
<div class="flex items-center gap-1.5 text-xs">
  <button
    class="text-[var(--color-accent-text)] hover:text-[var(--color-accent-hover)] truncate max-w-full text-left"
    :title="store.selectedTopic.value?.url"
    @click="navigateToTopic"
  >
    {{ store.selectedTopic.value?.url }}
  </button>
</div>
```

**1b. Thêm function `navigateToTopic()`:**

```typescript
async function navigateToTopic() {
  const url = store.selectedTopic.value?.url;
  if (!url) return;
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await browser.tabs.update(tab.id, { url });
    }
  } catch {
    // Fallback: open in new tab
    await browser.tabs.create({ url });
  }
}
```

### File: `entrypoints/sidepanel/views/TopicHubView.vue`

**1c. Hiển thị hostname bên dưới title của mỗi topic card (tùy chọn):**

Topic cards hiện chỉ hiện title + badges. Thêm domain dưới title giúp user nhận diện nhanh hơn. Tuy nhiên domain đã hiện ở group header, nên đây là **optional**. Bỏ qua nếu không cần thiết.

---

## Task 2: Nút refresh thông tin topic (fetch lại postCount/pageCount)

### Mục tiêu
Khi topic đã cached, thông tin `totalPosts`/`totalPages` trong store là dữ liệu cũ từ lúc cache. User cần 1 nút để fetch lại thông tin mới nhất từ trang gốc (gửi `DETECT_XF` đến active tab nếu URL khớp).

### Cơ chế
1. Kiểm tra activeTab URL có khớp topic URL không
2. Nếu khớp → gửi `DETECT_XF` đến tab → nhận `DetectResult` mới (`postCount`, `pageCount`)
3. Cập nhật `store.updateSelectedTopic({ totalPosts, totalPages })`
4. Nếu không khớp → hiện error "Hãy mở topic này trên trình duyệt để cập nhật thông tin"

### File: `entrypoints/sidepanel/views/SummaryView.vue`

**2a. Thêm state:**
```typescript
const isRefreshing = ref(false);
```

**2b. Thêm function `refreshTopicInfo()`:**
```typescript
async function refreshTopicInfo() {
  const topic = store.selectedTopic.value;
  if (!topic) return;

  // Check active tab matches topic URL
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !isSameTopicUrl(tab.url, topic.url)) {
    error.value = 'Hãy mở topic này trên trình duyệt để cập nhật thông tin.';
    return;
  }

  isRefreshing.value = true;
  error.value = '';
  try {
    const result = await browser.tabs.sendMessage(tab.id, {
      type: 'DETECT_XF',
    }) as DetectResult | undefined;

    if (result && result.version !== 'unknown') {
      store.updateSelectedTopic({
        totalPosts: result.postCount,
        totalPages: result.pageCount,
        title: result.title,
      });
      // Re-evaluate cache freshness with new live post count
      if (cachedTopic.value) {
        cacheFreshness.value = evaluateFreshness(cachedTopic.value, result.postCount);
      }
    } else {
      error.value = 'Không thể detect topic trên tab hiện tại.';
    }
  } catch {
    error.value = 'Lỗi khi kết nối đến tab. Thử reload trang.';
  } finally {
    isRefreshing.value = false;
  }
}
```

**2c. Thêm nút refresh trong template:**

Đặt bên cạnh nút "← Quay lại danh sách" (dòng 309-313), tạo thành 1 hàng flex:

```html
<div class="flex items-center justify-between">
  <button
    class="text-xs text-blue-600 hover:text-blue-700"
    @click="router.push('/')"
  >
    ← Quay lại danh sách
  </button>
  <button
    class="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent-text)] flex items-center gap-1"
    :disabled="isRefreshing"
    title="Cập nhật thông tin topic từ tab hiện tại"
    @click="refreshTopicInfo"
  >
    <svg class="w-3.5 h-3.5" :class="{ 'animate-spin': isRefreshing }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
    {{ isRefreshing ? 'Đang cập nhật...' : 'Cập nhật' }}
  </button>
</div>
```

### File: `entrypoints/sidepanel/views/TopicHubView.vue`

**2d. Thêm nút refresh trên mỗi topic card (cạnh nút xóa):**

Hiện tại nút xóa (X) nằm ở `absolute top-2 right-2`. Thêm nút refresh bên trái nút xóa:

```html
<!-- Action buttons — top-right corner -->
<div
  v-if="store.summarizingUrl.value !== topic.url"
  class="absolute top-2 right-2 flex items-center gap-0.5"
>
  <button
    class="p-1 text-gray-300 dark:text-gray-600 hover:text-blue-500 dark:hover:text-blue-400 transition-colors rounded"
    title="Cập nhật thông tin"
    @click.stop="refreshTopic(topic)"
  >
    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  </button>
  <button
    class="p-1 text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 transition-colors rounded"
    title="Xóa topic"
    @click.stop="confirmDelete(topic)"
  >
    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
    </svg>
  </button>
</div>
```

**Lưu ý:** Cần thay nút xóa hiện tại (dòng 268-277) thành block trên — gộp 2 nút vào 1 container `<div>`.

Và thay title padding từ `pr-6` thành `pr-12` (dòng 239) để tránh overlap với 2 nút.

**2e. Thêm function `refreshTopic(topic)` trong TopicHubView:**

```typescript
const refreshingUrl = ref<string | null>(null);

async function refreshTopic(topic: CachedTopic) {
  // Check active tab matches
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !normalizeForCompare(tab.url).startsWith(normalizeForCompare(topic.url).slice(0, -1))) {
    // Active tab doesn't match — can't refresh
    return;
  }

  refreshingUrl.value = topic.url;
  try {
    const result = await browser.tabs.sendMessage(tab.id, {
      type: 'DETECT_XF',
    }) as DetectResult | undefined;

    if (result && result.version !== 'unknown') {
      // Update local allTopics list
      const idx = allTopics.value.findIndex(t => t.url === topic.url);
      if (idx >= 0) {
        allTopics.value[idx] = {
          ...allTopics.value[idx],
          totalPosts: result.postCount,
          totalPages: result.pageCount,
          title: result.title,
        };
      }
      // Also update store if this topic is selected
      if (store.selectedTopic.value?.url === topic.url) {
        store.updateSelectedTopic({
          totalPosts: result.postCount,
          totalPages: result.pageCount,
          title: result.title,
        });
      }
    }
  } catch {
    // Silently fail — content script not available
  } finally {
    refreshingUrl.value = null;
  }
}
```

**2f. Hiển thị spinning state trên nút refresh:**

Trên icon SVG của nút refresh trong topic card:
```html
<svg class="w-3.5 h-3.5" :class="{ 'animate-spin': refreshingUrl === topic.url }" ...>
```

---

## Task 3: Xóa ExportButton khỏi SummaryView

### Mục tiêu
Nút "Xuất" hiện không hoạt động (có thể do `navigator.clipboard` hoặc `Blob URL` không hoạt động đúng trong sidepanel context). Xóa bỏ.

### File: `entrypoints/sidepanel/views/SummaryView.vue`

**3a. Xóa import:**
Dòng 13, xóa:
```typescript
import ExportButton from '../components/ExportButton.vue';
```

**3b. Xóa usage trong template:**
Dòng 422, xóa:
```html
<ExportButton v-if="cachedTopic" :topic="cachedTopic" />
```

Dòng 415, container `<div class="flex gap-2">` giờ chỉ còn 1 nút "Tóm tắt lại" → đổi `flex-1` thành `w-full`:
```html
<button
  class="w-full btn btn-secondary"
  @click="handleSummarize(false)"
>
  Tóm tắt lại
</button>
```

Và xóa wrapper `<div class="flex gap-2">` (giờ chỉ 1 nút, không cần flex).

**3c. KHÔNG xóa file `ExportButton.vue`** — giữ lại component trong codebase phòng trường hợp cần dùng lại sau.

---

## Task 4: Fix CacheIndicator không hoạt động

### Phân tích root cause

`CacheIndicator` nhận prop `currentPosts` từ SummaryView (dòng 408):
```html
:current-posts="topicInfo?.postCount ?? 0"
```

Nhưng `topicInfo.postCount` = `store.selectedTopic.value.totalPosts` — đây là giá trị **cached**, không phải giá trị live. Vì vậy:
- `cachedPosts === currentPosts` luôn luôn → `newPostCount = 0`
- `evaluateFreshness()` so sánh `currentPostCount > cached.totalPosts` → luôn false
- → `cacheFreshness` chỉ phụ thuộc vào `ageMs` (thời gian) → "Có bài mới" badge không bao giờ hiện

### Fix: Dùng `activeTabDetect.postCount` làm `currentPosts` khi khả dụng

### File: `entrypoints/sidepanel/views/SummaryView.vue`

**4a. Thêm computed `livePostCount`:**

```typescript
const livePostCount = computed(() => {
  const topic = store.selectedTopic.value;
  if (!topic) return 0;
  // If active tab is viewing this topic, use live detect data
  if (store.activeTabDetect.value && store.activeTabUrl.value &&
      isSameTopicUrl(store.activeTabUrl.value, topic.url)) {
    return store.activeTabDetect.value.postCount;
  }
  // Fallback to cached value
  return topic.totalPosts;
});
```

**4b. Sửa CacheIndicator props:**

Dòng 408, thay:
```html
:current-posts="topicInfo?.postCount ?? 0"
```
thành:
```html
:current-posts="livePostCount"
```

**4c. Sửa `loadTopicData()` — luôn dùng `livePostCount` cho freshness:**

Trong `loadTopicData()` (dòng 86-90), thay logic `evaluateFreshness`:

```typescript
if (fresh) {
  cachedTopic.value = fresh;
  if (fresh.summary) {
    summary.value = fresh.summary;
    summarizedPostCount.value = fresh.totalPosts;
  }
  cacheFreshness.value = evaluateFreshness(fresh, livePostCount.value);
}
```

(Bỏ if/else phân nhánh — dùng computed `livePostCount` thống nhất.)

**4d. Update freshness khi `livePostCount` thay đổi:**

Khi user bấm nút refresh (Task 2), `store.activeTabDetect` được cập nhật → `livePostCount` computed thay đổi. Tuy nhiên `cacheFreshness` là ref thường, không tự update. Thêm watch:

```typescript
watch(livePostCount, (newCount) => {
  if (cachedTopic.value && newCount > 0) {
    cacheFreshness.value = evaluateFreshness(cachedTopic.value, newCount);
  }
});
```

**4e. CacheIndicator "Cập nhật" button flow:**

Hiện tại `@update="handleSummarize(true)"` — trigger incremental summarize. Cần thêm điều kiện: nếu topic không phải active tab → hiện error thay vì âm thầm fail. Logic `handleSummarize(true)` đã handle case này (dòng 166-171) nên **không cần sửa thêm**.

---

## Thứ tự triển khai

```
Task 3 (xóa ExportButton) — đơn giản nhất, làm trước
Task 1 (URL navigation) — độc lập
Task 4 (fix CacheIndicator) — cần làm trước Task 2
Task 2 (refresh button) — phụ thuộc Task 4 (refresh cập nhật livePostCount → CacheIndicator tự update)
```

---

## Verification

1. `npx vue-tsc --noEmit` + `npm run build` → pass
2. **URL navigation:** Mở SummaryView → thấy URL topic → bấm → activeTab chuyển đến trang topic
3. **Refresh (SummaryView):** Bấm "Cập nhật" → postCount/pageCount cập nhật → CacheIndicator re-evaluate freshness
4. **Refresh (TopicHubView):** Bấm icon refresh trên card → thông tin topic cập nhật
5. **Refresh khi tab không khớp:** Hiện error rõ ràng
6. **ExportButton đã xóa:** Không còn nút "Xuất" trong SummaryView
7. **CacheIndicator:** Khi có bài mới → hiện "Có bài mới" + "(+N)" → bấm "Cập nhật" → trigger incremental summarize
