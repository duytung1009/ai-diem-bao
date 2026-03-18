# Fix Bug: Tab Chủ đề bị kẹt loading + Detection không cập nhật

## Vấn đề

### Bug 1: Loading stuck khi mở extension
`detectActiveTabTopic()` trong `App.vue` không có try-catch. Khi mở sidepanel trên tab không có content script (chrome://, about:blank, trang không match content script), `browser.tabs.sendMessage` throw "Could not establish connection" → unhandled promise rejection. Dù TopicHubView `onMounted` có try-catch riêng và `finally { isLoading = false }`, unhandled rejection có thể gây side-effect trong extension runtime.

### Bug 2: Detection chỉ chạy 1 lần
`detectActiveTabTopic()` chỉ chạy trong `App.vue` `onMounted` — tức 1 lần duy nhất khi sidepanel mở. Khi user:
- Chuyển sang tab khác (tab switch)
- Navigate sang topic mới trong cùng tab
- Quay lại tab Chủ đề sau khi tóm tắt

→ `store.activeTabDetect` KHÔNG được cập nhật → "Tab hiện tại" card hiển thị topic cũ hoặc không hiển thị.

### Bug 3: `<keep-alive>` khiến TopicHubView không reload
`App.vue` dùng `<keep-alive>` → `TopicHubView` chỉ mount 1 lần. Khi user quay lại tab "Chủ đề", `onMounted` KHÔNG chạy lại → danh sách topics stale (không phản ánh topics mới được tóm tắt).

---

## Task 1: Thêm try-catch vào `detectActiveTabTopic`

### File: `entrypoints/sidepanel/App.vue`, function `detectActiveTabTopic` (dòng 19-30)

**Cách sửa:** Wrap toàn bộ body trong try-catch:

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
    } else {
      store.setActiveTab(null, null);
    }
  } catch {
    // Content script not available on this tab (chrome://, about:blank, etc.)
    store.setActiveTab(null, null);
  }
}
```

**Thay đổi:**
- Wrap trong try-catch → không còn unhandled rejection
- Khi detect thất bại hoặc version === 'unknown': gọi `store.setActiveTab(null, null)` để clear state cũ

---

## Task 2: Re-detect khi chuyển tab và khi URL thay đổi

### File: `entrypoints/sidepanel/App.vue`

Thêm 2 listener trong `onMounted` (KHÔNG ở module top-level, để cleanup đúng):

```typescript
import { onMounted, onUnmounted, computed } from 'vue';

let tabActivatedListener: ((activeInfo: { tabId: number }) => void) | null = null;
let tabUpdatedListener: ((tabId: number, changeInfo: { url?: string }) => void) | null = null;

onMounted(async () => {
  await detectActiveTabTopic();

  // Re-detect khi chuyển tab
  tabActivatedListener = async (_activeInfo) => {
    await detectActiveTabTopic();
  };
  browser.tabs.onActivated.addListener(tabActivatedListener);

  // Re-detect khi URL thay đổi trong active tab (navigate trong cùng tab)
  tabUpdatedListener = async (tabId, changeInfo) => {
    if (!changeInfo.url) return;
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id === tabId) {
      await detectActiveTabTopic();
    }
  };
  browser.tabs.onUpdated.addListener(tabUpdatedListener);
});

onUnmounted(() => {
  if (tabActivatedListener) browser.tabs.onActivated.removeListener(tabActivatedListener);
  if (tabUpdatedListener) browser.tabs.onUpdated.removeListener(tabUpdatedListener);
});
```

**Lưu ý quan trọng:**
- Listener đăng ký trong `onMounted`, cleanup trong `onUnmounted` → không leak
- `tabs.onActivated`: user chuyển sang tab khác
- `tabs.onUpdated` với `changeInfo.url`: user navigate trong cùng tab (click link, back/forward)
- Cả 2 đều gọi `detectActiveTabTopic()` (đã có try-catch từ Task 1)
- KHÔNG reset `selectedTopic` → task tóm tắt đang chạy KHÔNG bị gián đoạn (chỉ update `activeTabDetect`)

---

## Task 3: TopicHubView reload khi `onActivated` (keep-alive)

### File: `entrypoints/sidepanel/views/TopicHubView.vue`

Với `<keep-alive>`, `onMounted` chỉ chạy 1 lần. Cần dùng `onActivated` để refresh data mỗi khi user quay lại tab Chủ đề.

**Sửa import (dòng 2):**
```typescript
import { ref, computed, onMounted, onActivated } from 'vue';
```

**Thêm `onActivated` sau block `onMounted` (sau dòng 62):**
```typescript
onActivated(async () => {
  // Reload topics mỗi khi user quay lại tab Chủ đề (keep-alive re-activate)
  try {
    const topics = await sendMessage<CachedTopic[]>('GET_ALL_CACHED_TOPICS');
    allTopics.value = topics || [];
  } catch {
    // Keep existing data on error
  }
});
```

**Giải thích:**
- `onMounted`: chạy 1 lần đầu, set `isLoading = false`
- `onActivated`: chạy mỗi khi component được re-activate bởi `<keep-alive>` (bao gồm cả lần đầu)
- Trong `onActivated` KHÔNG set `isLoading` → tránh flash loading spinner, chỉ quietly refresh data
- Nếu fail thì giữ data cũ (không xóa `allTopics`)

---

## Task 4 (Optional): Tương tự cho SummaryView — reload cache khi activate

### File: `entrypoints/sidepanel/views/SummaryView.vue`

Tương tự, nếu user đã mở SummaryView cho 1 topic, chuyển sang Hub, rồi quay lại SummaryView, data nên được refresh từ cache.

Thêm `onActivated`:
```typescript
import { ..., onActivated } from 'vue';

onActivated(async () => {
  const topic = store.selectedTopic.value;
  if (topic?.url) {
    try {
      const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', topic.url);
      if (fresh) {
        cachedTopic.value = fresh;
        if (fresh.summary) {
          summary.value = fresh.summary;
          summarizedPostCount.value = fresh.totalPosts;
        }
      }
    } catch { /* keep existing */ }
  }
});
```

---

## Thứ tự triển khai

1. **Task 1** — try-catch (fix crash, independent)
2. **Task 2** — re-detect listeners (depends on Task 1)
3. **Task 3** — TopicHubView onActivated (independent)
4. **Task 4** — SummaryView onActivated (optional, independent)

## Verification

1. Mở sidepanel trên tab chrome://extensions → không crash, Hub hiển thị empty state (không stuck loading)
2. Mở sidepanel trên tab XenForo → "Tab hiện tại" hiển thị đúng
3. Chuyển sang tab XenForo khác → "Tab hiện tại" cập nhật topic mới
4. Navigate trong cùng tab sang topic khác → "Tab hiện tại" cập nhật
5. Tóm tắt 1 topic → quay lại Hub → topic hiển thị "Đã tóm tắt" (không stale)
6. Đang tóm tắt → chuyển tab → task tóm tắt KHÔNG bị gián đoạn
