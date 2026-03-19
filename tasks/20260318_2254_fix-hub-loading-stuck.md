# Task Summary: Fix Tab Chủ đề Bị Kẹt Loading + Detection Không Cập Nhật

## Trạng thái: DONE ✓
- Type check: pass
- Source: `planning/fix-hub-loading-stuck.md`

## Vấn đề

### Bug 1: Unhandled rejection → hub stuck loading
`detectActiveTabTopic()` trong `App.vue` không có try-catch. Khi mở sidepanel trên tab không có content script (chrome://, about:blank, v.v.), `browser.tabs.sendMessage` throw "Could not establish connection" → unhandled promise rejection.

### Bug 2: Detection chỉ chạy 1 lần
`detectActiveTabTopic()` chỉ gọi trong `onMounted` → chỉ chạy 1 lần khi sidepanel mở. Chuyển tab hoặc navigate trong cùng tab không trigger re-detect → "Tab hiện tại" card hiển thị thông tin cũ hoặc không hiện.

### Bug 3: `<keep-alive>` khiến TopicHubView không reload
`App.vue` dùng `<keep-alive>` → `TopicHubView` chỉ mount 1 lần. Khi user quay lại tab "Chủ đề", `onMounted` KHÔNG chạy lại → danh sách topics stale.

---

## Thay đổi đã thực hiện

### 1. `entrypoints/sidepanel/App.vue`

**Import:** Thêm `onUnmounted` vào import từ `vue`.

**`detectActiveTabTopic()`:** Wrap toàn bộ body trong try-catch.
- Khi `browser.tabs.sendMessage` throw (tab không có content script): gọi `store.setActiveTab(null, null)` thay vì để unhandled rejection.
- Khi `result.version === 'unknown'` hoặc không có result: cũng gọi `store.setActiveTab(null, null)` để clear state cũ.

**Thêm 2 tab listeners trong `onMounted`:**
- `browser.tabs.onActivated`: re-detect khi user chuyển tab
- `browser.tabs.onUpdated` (chỉ khi `changeInfo.url` có giá trị, chỉ khi tab đó là active tab): re-detect khi user navigate trong cùng tab

**Cleanup trong `onUnmounted`:** Remove cả 2 listeners để tránh memory leak.

### 2. `entrypoints/sidepanel/views/TopicHubView.vue`

**Import:** Thêm `onActivated` từ `vue`.

**Thêm `onActivated` handler** (sau `onMounted`): Mỗi khi `<keep-alive>` re-activate component (user quay lại tab Chủ đề), fetch lại `GET_ALL_CACHED_TOPICS` và update `allTopics`. Không set `isLoading` → không có flash spinner. Nếu fail thì giữ data cũ.

### 3. `entrypoints/sidepanel/views/SummaryView.vue`

**Không cần thay đổi.** File đã có `onActivated` đúng từ trước: add/remove runtime message listener và call `loadTopicData()` nếu URL thay đổi.

---

## Invariant sau fix

- Mở sidepanel trên chrome:// hoặc about:blank → không crash, Hub hiển thị empty state bình thường.
- Chuyển sang tab XenForo → "Tab hiện tại" cập nhật đúng topic.
- Navigate trong cùng tab sang topic khác → "Tab hiện tại" cập nhật ngay.
- Tóm tắt 1 topic → quay lại Hub → topic hiển thị "Đã tóm tắt" (không stale).
- Đang tóm tắt → chuyển tab → task tóm tắt KHÔNG bị gián đoạn.
