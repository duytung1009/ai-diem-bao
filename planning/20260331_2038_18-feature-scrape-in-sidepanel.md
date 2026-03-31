# Chuyển Scraping từ Content Script sang Sidepanel

## Context

Khi user điều hướng sang trang khác trong khi đang scrape, content script bị destroy → message channel đóng → scraping thất bại với lỗi "page moved into bfcache". Đã thêm `pagehide` handler để abort sớm, nhưng scraping vẫn bị hủy mỗi khi navigate.

**Insight chính:** `page-loader.ts` hoàn toàn dùng `fetch()` + `DOMParser` — không phụ thuộc live DOM. Content script chỉ đóng vai trò "proxy" chuyển tiếp lệnh. Sidepanel là extension page persistent (tồn tại khi user browse), có `DOMParser`, và với `host_permissions: ['<all_urls>']` có thể `fetch` trực tiếp kèm cookies của forum.

**Kết quả:** Scraping tiếp tục chạy bình thường dù user chuyển tab, điều hướng, hay đóng tab forum.

---

## Phạm vi thay đổi

| File | Action |
|------|--------|
| `entrypoints/sidepanel/views/SummaryView.vue` | **SỬA** — import `scrapePageRange` trực tiếp, xóa `findForumTab`/`scrapeInChunks`/`onRuntimeMessage` |
| `entrypoints/content/index.ts` | **SỬA** — xóa `SCRAPE_ALL_PAGES`/`SCRAPE_PAGE_RANGE`/`CANCEL_SCRAPE` handlers + `pagehide` listener |
| `lib/types.ts` | **SỬA** — xóa message types không còn dùng |
| `entrypoints/sidepanel/composables/useScraper.ts` | **XÓA** — dead code, không được import ở đâu |

**KHÔNG thay đổi:** `lib/scrapers/page-loader.ts`, `lib/scrapers/xf1-scraper.ts`, `lib/scrapers/xf2-scraper.ts`, background, wxt.config.ts

---

## Task 1: SummaryView.vue — Thay thế scraping qua message bằng direct import

### 1a. Thay đổi imports

```typescript
// THÊM:
import { scrapePageRange } from '@/lib/scrapers/page-loader';
import type { XenForoVersion } from '@/lib/types';

// XÓA:
import type { MultiPageResult } from '@/lib/scrapers/page-loader';
// Xóa PageProgress khỏi type import (không còn dùng)
```

### 1b. Xóa state/constants không còn dùng

- `SCRAPE_CHUNK_SIZE = 10` — không còn cần chunk vì không qua message channel
- `currentScrapeTabId` ref — không còn liên quan đến tab
- `onRuntimeMessage()` function — chỉ xử lý `SCRAPE_PROGRESS` (giờ dùng callback trực tiếp)

### 1c. Thêm abort controller

```typescript
let scrapeAbortCtrl: AbortController | null = null; // non-reactive, module-level
```

### 1d. Xóa `findForumTab()` và `scrapeInChunks()`

Cả 2 function không còn cần — scraping trực tiếp, không qua tab.

### 1e. Thêm `scrapeRange()` thay thế

```typescript
async function scrapeRange(
  baseUrl: string,
  startPage: number,
  endPage: number,
  delayMs: number = 2000,
): Promise<{ posts: ScrapedPost[]; errors: string[] }> {
  const version = topicInfo.value?.version;
  if (!version || version === 'unknown') {
    throw new Error('Không xác định được phiên bản diễn đàn.');
  }
  scrapeAbortCtrl = new AbortController();
  try {
    const result = await scrapePageRange(
      version as XenForoVersion,
      baseUrl,
      startPage,
      endPage,
      (current, _total, postsScraped) => {
        scrapeProgress.value = {
          currentPage: startPage + current - 1,
          totalPages: endPage,
          postsScraped,
        };
      },
      scrapeAbortCtrl.signal,
      delayMs,
    );
    return { posts: result.posts, errors: result.errors };
  } finally {
    scrapeAbortCtrl = null;
  }
}
```

### 1f. Update `handleCancel()`

```typescript
async function handleCancel() {
  scrapeAbortCtrl?.abort();
  scrapeAbortCtrl = null;
  isScraping.value = false;
  scrapeProgress.value = null;
  simpleLoadingText.value = '';
}
```

### 1g. Update `handleSummarize()` — 3 call sites

Thay tất cả `scrapeInChunks(tabId, topic.url, ...)` bằng `scrapeRange(topic.url, ...)`:

1. **Incremental scrape** (line ~385): `scrapeInChunks(tabId, topic.url, startPage, endPage, delayMs)` → `scrapeRange(topic.url, startPage, endPage, delayMs)`
2. **Full scrape multi-page** (line ~404): `scrapeInChunks(tabId, topic.url, 1, pageCount, delayMs)` → `scrapeRange(topic.url, 1, pageCount, delayMs)`
3. **Single-page** (line ~416): `scrapeInChunks(tabId, topic.url, 1, 1, 0)` → `scrapeRange(topic.url, 1, 1, 0)`

Xóa toàn bộ:
- `findForumTab(topic.url)` call + null guard + error message
- `currentScrapeTabId.value = tabId` assignments
- `currentScrapeTabId.value = null` resets

Trong catch block, xóa `currentScrapeTabId.value = null`.

### 1h. Update `handleSummarizeSegment()` — 1 call site

Line ~620: `scrapeInChunks(tabId, topic.url, seg.start, seg.end, delayMs)` → `scrapeRange(topic.url, seg.start, seg.end, delayMs)`

Xóa: `findForumTab` call + guard, `currentScrapeTabId` assignments. Trong catch: xóa `currentScrapeTabId.value = null`.

### 1i. Xóa listener registration

- `onActivated`: xóa `browser.runtime?.onMessage.addListener(onRuntimeMessage)`
- `onDeactivated`: xóa `browser.runtime?.onMessage.removeListener(onRuntimeMessage)` (toàn bộ hook nếu chỉ còn dòng này)
- `onUnmounted`: xóa `browser.runtime?.onMessage.removeListener(onRuntimeMessage)` (toàn bộ hook nếu chỉ còn dòng này)

---

## Task 2: Content script — Xóa scraping handlers

File: `entrypoints/content/index.ts`

### Xóa:
- Import `scrapeAllPages`, `scrapePageRange` từ `@/lib/scrapers/page-loader`
- `let scrapeAbortController` + `let pendingSendResponse`
- `pagehide` event listener
- `SCRAPE_TOPIC` handler (lines 66-79) — không còn được gọi từ bất kỳ đâu
- `SCRAPE_ALL_PAGES` handler (lines 81-107)
- `SCRAPE_PAGE_RANGE` handler (lines 109-139)
- `CANCEL_SCRAPE` handler (lines 141-148)

### Giữ:
- `DETECT_XF` handler — cần live DOM để detect XenForo version + thread page
- `createScraper()` helper — vẫn cần cho `DETECT_XF` (getPostCount, getPageCount)
- Import `XF2Scraper`, `XF1Scraper`, `detectXenForoVersion`, types

### Kết quả: content script chỉ còn ~40 dòng (detect only)

---

## Task 3: Cleanup types

File: `lib/types.ts`

Xóa khỏi `MessageType` union:
- `'SCRAPE_TOPIC'`
- `'SCRAPE_ALL_PAGES'`
- `'SCRAPE_PAGE_RANGE'`
- `'SCRAPE_PROGRESS'`
- `'CANCEL_SCRAPE'`

Xóa interface `PageProgress` (không còn dùng — progress qua callback trực tiếp).

---

## Task 4: Xóa dead code

Xóa file: `entrypoints/sidepanel/composables/useScraper.ts`

Lý do: Không được import ở bất kỳ file nào (confirmed via grep). Dùng message types sẽ bị xóa (`SCRAPE_ALL_PAGES`, `SCRAPE_TOPIC`, `CANCEL_SCRAPE`, `SCRAPE_PROGRESS`).

---

## Task 5 (Optional): Di chuyển article extraction sang sidepanel

Hiện tại `SCRAPE_ARTICLE` đi qua background service worker → `extractArticle()`. Vì `extractArticle` cũng dùng `fetch` + `DOMParser`, có thể gọi trực tiếp từ sidepanel.

**Quyết định:** BỎ QUA task này. `SCRAPE_ARTICLE` hoạt động tốt qua background, không bị ảnh hưởng bởi navigation. Giữ nguyên để giảm scope thay đổi.

---

## Decision Log

### QD1: Scraping trực tiếp từ sidepanel thay vì content script
- **Đã chọn:** Import `scrapePageRange` trực tiếp vào SummaryView
- **Lý do:** Sidepanel persistent, không bị destroy khi navigate; `page-loader.ts` dùng `fetch`+`DOMParser` (không cần live DOM); `host_permissions: ['<all_urls>']` cho phép cross-origin fetch kèm cookies
- **Đã cân nhắc nhưng loại:**
  - Giữ content script + retry on navigate — vẫn mất progress, UX kém
  - Chuyển sang background service worker — không có `DOMParser` (Chrome < 124), phức tạp hơn
  - Offscreen document — overkill cho use case này
- **Rủi ro cookies:** Extension pages với `host_permissions` gửi cookies cho target domain khi dùng `credentials: 'include'`. Nếu forum yêu cầu đăng nhập và cookies không được gửi → `page-loader.ts` đã có login detection → error message rõ ràng
- **Điều kiện thay đổi:** Nếu Chrome thay đổi cookie policy cho extension pages

### QD2: Không chunk scraping nữa
- **Đã chọn:** Gọi `scrapePageRange` một lần cho toàn bộ range
- **Lý do:** Chunking (`SCRAPE_CHUNK_SIZE=10`) chỉ cần để tránh message channel timeout. Gọi trực tiếp không có channel → không cần chunk
- **Lợi ích phụ:** Code đơn giản hơn rất nhiều, bỏ được `scrapeInChunks` + dedup logic

### QD3: Xóa SCRAPE_TOPIC message type
- **Đã chọn:** Xóa hoàn toàn
- **Lý do:** SummaryView đã không dùng từ Feature 12 (thay bằng `SCRAPE_PAGE_RANGE` 1-1); `useScraper.ts` là dead code
- **Điều kiện thay đổi:** Nếu cần scrape live DOM cho mục đích khác

---

## Verification

1. `npx vue-tsc --noEmit` + `npm run build` → pass
2. **Scrape bình thường:** Mở topic → Tóm tắt → kiểm tra posts được scrape đúng
3. **Navigate during scrape:** Bắt đầu tóm tắt topic dài → chuyển tab/điều hướng → scraping vẫn tiếp tục trong sidepanel
4. **Cancel:** Bấm hủy khi đang scrape → dừng ngay
5. **Segment mode:** Tóm tắt topic > segmentSize trang → scrape từng segment → hoạt động bình thường
6. **Incremental:** Topic đã cache → có bài mới → tóm tắt cập nhật → chỉ scrape trang mới
7. **Forum cần đăng nhập:** Mở forum private → scrape → kiểm tra có báo lỗi rõ ràng (login redirect detection)
8. **Content script detect:** Navigate đến forum → sidepanel hiện đúng thông tin topic (DETECT_XF vẫn hoạt động)
