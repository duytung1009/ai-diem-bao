# Feature 12: Scrape từ bất kỳ tab cùng domain

Ngày: 2026-03-20

---

## Mục tiêu

Cho phép scrape topic mà không cần tab active mở đúng URL topic đó. Chỉ cần có **bất kỳ tab nào** đang mở trên **cùng domain** forum là đủ.

**Trước:** "Hãy mở topic này trên trình duyệt để đọc bài viết."
**Sau:** Scrape hoạt động miễn là có 1 tab forum cùng domain đang mở.

---

## Phân tích hiện tại

### Tại sao cần tab cùng domain?

1. **Cookie session:** `fetch({ credentials: 'include' })` trong content script gửi cookie của origin → cần content script chạy trên cùng domain forum
2. **Trang 1:** hiện dùng `document` (live DOM) thay vì fetch → bắt buộc đúng topic URL

### Thay đổi cần thiết

1. Trang 1 chuyển sang **fetch** thay vì dùng `document` → mọi trang đều fetch
2. SummaryView tìm **bất kỳ tab cùng domain** thay vì chỉ active tab
3. Content script nhận `baseUrl` từ message thay vì tự đọc từ scraper

---

## Task 1: `page-loader.ts` — Trang 1 dùng fetch thay vì `document`

### File: `lib/scrapers/page-loader.ts`

**`scrapeAllPages()`** (dòng 42–50):

Trước:
```ts
// Page 1: use the live document (already loaded)
try {
  const page1Data = scraper.scrape(document, window.location.href);
  allPosts.push(...page1Data.posts);
  pagesScraped = 1;
  onProgress?.(1, totalPages, allPosts.length);
} catch (err) {
  errors.push(`Page 1: ${String(err)}`);
}

// Pages 2..N: fetch and parse
for (let page = 2; page <= totalPages; page++) {
```

Sau:
```ts
// ALL pages: fetch and parse (no live document dependency)
for (let page = 1; page <= totalPages; page++) {
```

Tương tự **`scrapePageRange()`** (dòng 136–147): bỏ block `if (page === 1 && startPage === 1)` dùng `document`, mọi trang đều đi vào nhánh fetch.

**Lưu ý:** `baseUrl` giờ phải là URL chuẩn của topic (không phải `window.location.href`). Xem Task 2.

---

## Task 2: Content script — Nhận `baseUrl` từ message payload

### File: `entrypoints/content/index.ts`

Hiện tại content script tự lấy `baseUrl` từ scraper:

```ts
const baseUrl = scraper.scrape().url; // scrape DOM hiện tại để lấy URL
```

Vấn đề: nếu tab đang mở topic A nhưng muốn scrape topic B → `scraper.scrape().url` trả về URL topic A.

### Fix

Nhận `baseUrl` từ payload thay vì tự detect:

**`SCRAPE_ALL_PAGES` handler:**
```ts
// Trước:
const { totalPages, delayMs } = message.payload;
const baseUrl = scraper.scrape().url;

// Sau:
const { totalPages, delayMs, baseUrl } = message.payload;
// Không cần scraper.scrape() nữa — chỉ cần version để chọn parser
```

**`SCRAPE_PAGE_RANGE` handler:**
```ts
// Trước:
const { startPage, endPage, delayMs } = message.payload;
const baseUrl = scraper.scrape().url;

// Sau:
const { startPage, endPage, delayMs, baseUrl } = message.payload;
```

**`SCRAPE_TOPIC` handler:** giữ nguyên (chỉ dùng cho single-page topic trên tab hiện tại, vẫn hữu ích).

**Cập nhật type** trong `lib/types.ts`:
```ts
// Thêm baseUrl vào payload type nếu có typed messages
```

---

## Task 3: SummaryView — Tìm tab cùng domain thay vì bắt buộc active tab

### File: `entrypoints/sidepanel/views/SummaryView.vue`

**Tạo helper function `findForumTab()`:**

```ts
/**
 * Tìm tab đang mở trên cùng domain với topicUrl.
 * Ưu tiên: (1) active tab nếu cùng domain, (2) bất kỳ tab cùng domain.
 */
async function findForumTab(topicUrl: string): Promise<number | null> {
  const domain = new URL(topicUrl).hostname;

  // Ưu tiên active tab
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id && activeTab.url) {
    try {
      if (new URL(activeTab.url).hostname === domain) return activeTab.id;
    } catch { /* invalid URL */ }
  }

  // Fallback: tìm bất kỳ tab cùng domain
  const allTabs = await browser.tabs.query({ currentWindow: true });
  for (const tab of allTabs) {
    if (tab.id && tab.url) {
      try {
        if (new URL(tab.url).hostname === domain) return tab.id;
      } catch { /* skip */ }
    }
  }
  return null;
}
```

**Sửa `handleSummarize()`:**

```ts
// Trước:
const isActiveTab = store.activeTabUrl.value
  && isSameTopicUrl(store.activeTabUrl.value, topic.url);
if (!isActiveTab) {
  error.value = 'Hãy mở topic này trên trình duyệt để tải bài viết mới.';
  return;
}
const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
if (!tab?.id) throw new Error('Không tìm thấy tab');

// Sau:
const tabId = await findForumTab(topic.url);
if (!tabId) {
  error.value = 'Không tìm thấy tab nào đang mở forum này. Hãy mở ít nhất một trang của diễn đàn.';
  return;
}
```

Thay tất cả `tab.id` thành `tabId` trong hàm. Bỏ `browser.tabs.query({ active: true })`.

**Truyền `baseUrl` vào payload:**

```ts
// Trước:
await scrapeInChunks(tab.id, 1, pageCount, delayMs);

// Sau — truyền thêm baseUrl:
await scrapeInChunks(tabId, topic.url, 1, pageCount, delayMs);
```

**Sửa tương tự cho `handleSummarizeSegment()`** — thay thế check `isActiveTab` + `tabs.query` bằng `findForumTab()`.

---

## Task 4: `scrapeInChunks()` — Truyền `baseUrl` trong payload

### File: `entrypoints/sidepanel/views/SummaryView.vue`

Cập nhật signature và payload:

```ts
// Trước:
async function scrapeInChunks(tabId: number, startPage: number, endPage: number, delayMs = 2000)

// Sau:
async function scrapeInChunks(tabId: number, baseUrl: string, startPage: number, endPage: number, delayMs = 2000)
```

```ts
const result = await browser.tabs.sendMessage(tabId, {
  type: 'SCRAPE_PAGE_RANGE',
  payload: { startPage: chunkStart, endPage: chunkEnd, delayMs, baseUrl },
  //                                                           ^^^^^^^^ MỚI
});
```

Cập nhật tất cả call sites của `scrapeInChunks()` (3 chỗ: `handleSummarize` full, incremental, `handleSummarizeSegment`).

---

## Task 5: Permission — `tabs` URL access

### File: `wxt.config.ts`

Kiểm tra xem extension đã có quyền đọc `tab.url` chưa. Hiện `host_permissions: ['<all_urls>']` đã cho phép. Nếu chưa, thêm permission `"tabs"` vào manifest:

```ts
permissions: [...existing, 'tabs'],
```

> `browser.tabs.query()` trả `tab.url` chỉ khi có `tabs` permission hoặc `host_permissions` match.

---

## Task 6: Error message cập nhật

Cập nhật tất cả error message liên quan:

| Vị trí | Trước | Sau |
|--------|-------|-----|
| `handleSummarize()` | "Hãy mở topic này trên trình duyệt để tải bài viết mới." | "Không tìm thấy tab nào đang mở diễn đàn này. Hãy mở ít nhất một trang của diễn đàn." |
| `handleSummarize()` (non-incremental) | "Hãy mở topic này trên trình duyệt để đọc bài viết." | (cùng message trên) |
| `handleSummarizeSegment()` | "Hãy mở topic này trên trình duyệt để đọc bài viết." | (cùng message trên) |

---

## Tóm tắt thay đổi

| File | Thay đổi |
|------|----------|
| `lib/scrapers/page-loader.ts` | Bỏ special case trang 1 dùng `document`, mọi trang đều fetch |
| `entrypoints/content/index.ts` | `SCRAPE_ALL_PAGES` + `SCRAPE_PAGE_RANGE` nhận `baseUrl` từ payload |
| `SummaryView.vue` | `findForumTab()` helper; thay `isActiveTab` check + `tabs.query` active; truyền `baseUrl` vào payload; cập nhật error message |
| `wxt.config.ts` | Verify `tabs` permission (có thể đã đủ nhờ `host_permissions`) |
| `lib/types.ts` | Cập nhật payload type nếu có typed message definitions |

## Verification

1. `npx vue-tsc --noEmit` + `npm run build` → pass
2. Mở tab A = forum topic X, chọn topic Y (khác URL) từ danh sách cache → bấm "Tóm tắt" → scrape thành công (dùng tab A để fetch)
3. Mở tab A = forum, tab B = Google → chọn topic từ cache → scrape dùng tab A (không phải active tab B)
4. Không có tab forum nào → hiện message lỗi mới
5. Scrape topic 1 trang (SCRAPE_TOPIC) vẫn hoạt động bình thường (không bị ảnh hưởng)
6. Cancel scraping vẫn hoạt động
7. Incremental scraping vẫn merge đúng
8. Segment mode vẫn hoạt động
