# Feature 08: Topic URL navigation, Auto-update cached topics, Xóa ExportButton, Fix CacheIndicator

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
    class="text-(--color-accent-text) hover:text-(--color-accent-hover) truncate max-w-full text-left"
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

## Task 2: Tự động cập nhật thông tin topic khi tab trình duyệt khớp URL đã cache

### Mục tiêu
Khi user đang mở 1 tab forum XenForo mà URL của nó đã có trong IndexedDB cache → tự động cập nhật `totalPosts`/`totalPages` mới nhất vào cache. Không cần nút refresh thủ công.

### Tại sao không dùng nút refresh?
Nút refresh chỉ hoạt động khi active tab trùng URL topic đang xem — UX kém, user phải mở đúng tab trước. Thay vào đó, logic auto-update chạy ngầm trong `App.vue detectActiveTabTopic()` — nơi đã detect mỗi khi tab switch/navigate.

### Cơ chế
1. `detectActiveTabTopic()` đã gọi `DETECT_XF` mỗi khi tab switch hoặc page load xong → có `DetectResult` + `tab.url`
2. **Thêm:** Sau khi detect thành công, dùng `normalizeUrl(tab.url)` check IndexedDB
3. Nếu topic đã cached → so sánh `result.postCount` vs `cached.totalPosts`
4. Nếu khác → update `totalPosts`, `totalPages`, `title` vào IndexedDB
5. Nếu topic đang được select trong store → cũng update store

### File: `entrypoints/sidepanel/App.vue`

**2a. Thêm import:**
```typescript
import { normalizeUrl, getCachedTopic, saveCachedTopic } from '@/lib/cache-manager';
```

**2b. Sửa function `detectActiveTabTopic()`:**

Sau dòng `store.setActiveTab(result, tab.url);` (dòng 56), thêm logic auto-update:

```typescript
async function detectActiveTabTopic() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) return;

    const result = await browser.tabs.sendMessage(tab.id, {
      type: 'DETECT_XF',
    }) as DetectResult | undefined;

    if (result && result.version !== 'unknown') {
      store.setActiveTab(result, tab.url);

      // --- AUTO-UPDATE cached topic if URL matches ---
      await autoUpdateCachedTopic(tab.url, result);
    } else {
      store.setActiveTab(null, null);
    }
  } catch {
    store.setActiveTab(null, null);
  }
}

async function autoUpdateCachedTopic(tabUrl: string, detect: DetectResult) {
  try {
    const cached = await getCachedTopic(tabUrl);
    if (!cached) return; // URL chưa cache → skip

    // So sánh — chỉ update nếu có thay đổi thực sự
    const hasChanges =
      cached.totalPosts !== detect.postCount ||
      cached.totalPages !== detect.pageCount ||
      cached.title !== detect.title;

    if (!hasChanges) return;

    // Update IndexedDB
    const updated = {
      ...cached,
      totalPosts: detect.postCount,
      totalPages: detect.pageCount,
      title: detect.title,
    };
    await saveCachedTopic(updated);

    // Update store nếu topic đang được select
    const normalizedTabUrl = normalizeUrl(tabUrl);
    const selectedUrl = store.selectedTopic.value?.url;
    if (selectedUrl && normalizeUrl(selectedUrl) === normalizedTabUrl) {
      store.updateSelectedTopic({
        totalPosts: detect.postCount,
        totalPages: detect.pageCount,
        title: detect.title,
      });
    }
  } catch {
    // IndexedDB error — silent fail, không ảnh hưởng UX
  }
}
```

**Lưu ý quan trọng:**
- `autoUpdateCachedTopic()` dùng `getCachedTopic()` (đã normalize URL bên trong) nên khớp chính xác với cache key
- Chỉ gọi `saveCachedTopic()` khi `hasChanges === true` → tránh write thừa vào IndexedDB
- Không thay đổi `summary`, `cachedAt`, hay bất kỳ field nào khác — chỉ update metadata (postCount, pageCount, title)
- `console.log` hiện có ở `detectActiveTabTopic()` có thể xóa hoặc giữ tùy ý

### Tác động đến Task 4 (CacheIndicator)
Task 4 đã dùng `store.activeTabDetect.value.postCount` làm `livePostCount`. Với Task 2 mới, data trong IndexedDB cũng được cập nhật, nên khi `loadTopicData()` fetch từ cache, `cachedTopic.totalPosts` đã là giá trị mới → `evaluateFreshness()` chính xác hơn. Hai task bổ trợ lẫn nhau.

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
Task 2 (auto-update cached topic) — sửa App.vue, không phụ thuộc task khác
Task 4 (fix CacheIndicator) — bổ trợ Task 2, dùng livePostCount computed
```

---

## Verification

1. `npx vue-tsc --noEmit` + `npm run build` → pass
2. **URL navigation:** Mở SummaryView → thấy URL topic → bấm → activeTab chuyển đến trang topic
3. **Auto-update:** Mở tab forum có topic đã cache (300 bài) → topic gốc giờ có 310 bài → switch sang tab đó → quay lại extension → TopicMeta hiện 310 bài (không cần bấm gì)
4. **Auto-update không ghi thừa:** Mở tab forum topic đã cache, postCount giống nhau → không có IndexedDB write (kiểm tra qua DevTools > Application > IndexedDB)
5. **ExportButton đã xóa:** Không còn nút "Xuất" trong SummaryView
6. **CacheIndicator:** Khi tab hiện tại có bài mới hơn cache → hiện "Có bài mới" + "(+N)" → bấm "Cập nhật" → trigger incremental summarize
