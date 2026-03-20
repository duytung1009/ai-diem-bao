# Review: Feature 12 — Scrape Any Tab

Ngày: 2026-03-20

---

## Tổng quan

Feature 12 cho phép scrape topic từ bất kỳ tab nào cùng domain, không cần active tab mở đúng URL topic. Implementation đúng hướng nhưng phát hiện **2 Critical** + **2 Important** issues.

---

## C-1: `isSameTopicUrl()` thiếu trailing slash normalization → loading mất khi quay lại topic

**Mức độ:** Critical
**File:** `SummaryView.vue` dòng 209-220
**Bug report:** "quay lại danh sách xong mở lại chủ đề đang tóm tắt thì mất loading"

### Root Cause

`normalizeUrl()` trong cache-manager.ts luôn thêm trailing slash:
```ts
// cache-manager.ts
u.pathname = u.pathname.replace(/\/page-\d+\/?$/, '');
if (!u.pathname.endsWith('/')) u.pathname += '/';  // ← TRAILING SLASH
```

Nhưng `isSameTopicUrl()` trong SummaryView KHÔNG thêm trailing slash:
```ts
// SummaryView.vue
parsed.pathname = parsed.pathname.replace(/\/page-\d+$/, '/');
// ← KHÔNG có: if (!parsed.pathname.endsWith('/')) parsed.pathname += '/';
```

### Kịch bản lỗi

1. User mở `https://forum.com/threads/test.123` (KHÔNG có trailing slash)
2. `loadTopicData()` → `loadedTopicUrl.value = '.../test.123'` (không slash)
3. User tóm tắt → `confirmSummarize()` → save cache → `normalizeUrl` tạo URL `.../test.123/` (CÓ slash)
4. User quay lại danh sách → TopicHubView load từ cache → URL = `.../test.123/` (có slash)
5. User click cùng topic → `store.setSelectedTopic(cachedTopic)` → URL = `.../test.123/` (có slash)
6. SummaryView `onActivated`:
   - `url = '.../test.123/'` (từ store, đã normalize)
   - `loadedTopicUrl.value = '.../test.123'` (gốc, không slash)
   - `isSameTopicUrl('.../test.123/', '.../test.123')`:
     - normalize(url1) = `.../test.123/` (slash giữ nguyên)
     - normalize(url2) = `.../test.123` (không có `/page-N` nên regex không match, không thêm slash)
     - **Kết quả: FALSE!**
   - → `isSummarizingCurrentTopic = false`
   - → `!isSameTopicUrl(url, loadedTopicUrl)` = true → **gọi `loadTopicData()`**
   - → `loadTopicData()` RESET toàn bộ state: `loadingText = ''` → **loading biến mất!**

7. `confirmSummarize()` vẫn đang chạy (async), khi LLM trả kết quả → set `summary.value` → UI hiện tóm tắt đột ngột

### Fix

Đồng bộ normalize logic giữa `isSameTopicUrl()` và `normalizeUrl()`:

```ts
function isSameTopicUrl(url1: string, url2: string): boolean {
  try {
    const normalize = (u: string) => {
      const parsed = new URL(u);
      parsed.pathname = parsed.pathname.replace(/\/page-\d+\/?$/, '');
      if (!parsed.pathname.endsWith('/')) parsed.pathname += '/';  // ← THÊM
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    };
    return normalize(url1) === normalize(url2);
  } catch { return url1 === url2; }
}
```

**Lưu ý:** Regex cũng nên đổi từ `/\/page-\d+$/` thành `/\/page-\d+\/?$/` để handle cả `page-3` và `page-3/`, nhất quán với `normalizeUrl()`.

---

## C-2: Incremental update không hoạt động — `autoUpdateCachedTopic` đã cập nhật `totalPages` trước

**Mức độ:** Critical
**File:** `SummaryView.vue` dòng 342-362 + `App.vue` `autoUpdateCachedTopic()`
**Bug report:** "cơ chế cập nhật tóm tắt không thấy hoạt động nữa"

### Root Cause

`autoUpdateCachedTopic()` (App.vue) cập nhật `totalPages` trong cache **ngay khi detect** bài mới:
```ts
// App.vue autoUpdateCachedTopic()
await saveCachedTopic({ ...cached, totalPages: detect.pageCount, ... });
store.updateSelectedTopic({ totalPages: detect.pageCount, ... });
```

Sau đó khi user click "Cập nhật" → `handleSummarize(true)`:
```ts
const cachedPages = cachedTopic.value.totalPages || 1;  // ← ĐÃ BẰNG mới!
const startPage = Math.max(1, cachedPages + 1);         // ← startPage > endPage
const endPage = pageCount;                               // ← cùng giá trị
```

`startPage > endPage` → vòng lặp `scrapeInChunks` không chạy → trả về 0 posts mới → `confirmSummarize()` filter ra `newPosts.length === 0` → silently return old summary → **user thấy không có gì thay đổi, không có error**.

### Fix

Lưu số trang ĐÃ SCRAPE riêng biệt với `totalPages` (số trang hiện tại của topic):

**Cách 1 (ít thay đổi):** Không cập nhật `totalPages` trong cache khi auto-update, chỉ cập nhật store:

```ts
// App.vue autoUpdateCachedTopic()
// Giữ nguyên cache totalPages (= trang đã scrape lần cuối)
// Chỉ update store cho display
store.updateSelectedTopic({ totalPages: detect.pageCount, title: detect.title || cached.title });
// KHÔNG gọi saveCachedTopic với totalPages mới
await saveCachedTopic({ ...cached, title: detect.title || cached.title });
// totalPages trong cache vẫn giữ giá trị cũ (lần tóm tắt cuối)
```

Nhược điểm: reload extension → `totalPages` hiển thị lại giá trị cũ cho đến khi tab mở đúng topic. Nhưng `cacheFreshness` vẫn đúng vì dùng `livePostCount` (từ detect), không phải `totalPages`.

**Cách 2 (clean hơn):** Thêm field `scrapedTotalPages` vào `CachedTopic`:
```ts
interface CachedTopic {
  // ...
  totalPages: number;          // current total (auto-updated)
  scrapedTotalPages?: number;  // pages actually scraped & summarized
}
```

Incremental dùng `scrapedTotalPages`:
```ts
const scrapedPages = cachedTopic.value.scrapedTotalPages ?? cachedTopic.value.totalPages ?? 1;
const startPage = Math.max(1, scrapedPages);  // bỏ +1, scrape lại page cuối để bắt thêm bài mới
const endPage = pageCount;
```

`SAVE_CACHED_TOPIC` handler set `scrapedTotalPages = totalPages` khi save sau summarization.

---

## I-1: `pageCount` lấy từ `activeTabDetect` mà không verify cùng topic

**Mức độ:** Important
**File:** `SummaryView.vue` dòng 335

### Vấn đề

```ts
const pageCount = store.activeTabDetect.value?.pageCount ?? topic.totalPages ?? 1;
```

Sau Feature 12, user có thể scrape topic A trong khi active tab đang mở topic B (cùng domain). `store.activeTabDetect` chứa info của topic B → **lấy nhầm `pageCount` của topic B** để scrape topic A.

### Fix

Guard: chỉ dùng `activeTabDetect` khi URL khớp:

```ts
const detectMatchesTopic = store.activeTabUrl.value
  && isSameTopicUrl(store.activeTabUrl.value, topic.url);
const pageCount = (detectMatchesTopic ? store.activeTabDetect.value?.pageCount : null)
  ?? topic.totalPages ?? 1;
```

**Tương tự ở `handleSummarizeSegment()`** nếu có dùng `activeTabDetect`.

---

## I-2: `SCRAPE_TOPIC` (single-page) không truyền `baseUrl`, không dùng `findForumTab`

**Mức độ:** Important
**File:** `SummaryView.vue` dòng 373-381

### Vấn đề

```ts
} else {
  loadingText.value = 'Đang đọc bài viết...';
  const scraped = await browser.tabs.sendMessage(tabId, {
    type: 'SCRAPE_TOPIC',
  }) as { posts?: ScrapedPost[]; error?: string };
```

`SCRAPE_TOPIC` dùng `tabId` từ `findForumTab()` (bất kỳ tab cùng domain), nhưng content script handler cho `SCRAPE_TOPIC` vẫn scrape live `document` của tab đó. Nếu tab đó mở topic khác → **scrape nhầm topic**.

### Fix

Hai lựa chọn:
1. Đổi `SCRAPE_TOPIC` thành `SCRAPE_PAGE_RANGE` với `startPage=1, endPage=1, baseUrl`
2. Hoặc guard: chỉ dùng `SCRAPE_TOPIC` khi tab đang mở đúng topic URL

---

## Tóm tắt

| ID | Mức độ | Vấn đề | File |
|----|--------|--------|------|
| C-1 | Critical | `isSameTopicUrl` thiếu trailing slash → loading mất khi quay lại | SummaryView.vue |
| C-2 | Critical | autoUpdate `totalPages` → incremental range rỗng | SummaryView.vue + App.vue |
| I-1 | Important | `pageCount` lấy nhầm từ active tab khác topic | SummaryView.vue |
| I-2 | Important | `SCRAPE_TOPIC` (1 trang) scrape nhầm topic | SummaryView.vue |
