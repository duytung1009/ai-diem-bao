# Cơ chế Scraping

> Cập nhật: 2026-03-20

## 1. Kiến trúc tổng quan

```
┌──────────────┐   message    ┌───────────────┐   fetch    ┌──────────────┐
│  SummaryView │ ──────────→  │ Content Script │ ────────→  │ Forum Pages  │
│  (sidepanel) │ ←────────── │ (tab context)  │ ←──────── │   (HTML)     │
└──────────────┘   response   └───────────────┘   HTML     └──────────────┘
```

Sidepanel **không trực tiếp** truy cập DOM forum. Thay vào đó gửi message đến **content script** đang chạy trong tab forum → content script thực hiện scrape và trả kết quả.

**Files liên quan:**

| File | Vai trò |
|------|---------|
| `entrypoints/content/index.ts` | Content script — nhận message, điều phối scrape |
| `lib/scrapers/page-loader.ts` | Core scraping logic — fetch pages, parse, dedup |
| `lib/scrapers/xf2-scraper.ts` | Scraper cho XenForo 2 |
| `lib/scrapers/xf1-scraper.ts` | Scraper cho XenForo 1 |
| `lib/scrapers/types.ts` | `TopicScraper` interface (Strategy pattern) |
| `entrypoints/sidepanel/views/SummaryView.vue` | UI — gọi scrape, hiển thị progress |

---

## 2. Phát hiện forum (`DETECT_XF`)

Khi user mở/chuyển tab, `App.vue` gửi message `DETECT_XF` → content script:

1. **`detectXenForoVersion()`** — check DOM để xác định XF1, XF2, hoặc không phải XenForo
2. **`isThreadPage(version)`** — lọc chỉ trang thread (bài viết), bỏ qua danh sách forum/category
   - **XF2:** cần có `article.message` + (`dl.count--replies` hoặc `.p-title-value`)
   - **XF1:** cần có `li.message .messageText`
3. Nếu không phải thread page → `sendResponse(undefined)` → sidepanel bỏ qua
4. Nếu là thread page → trả về `DetectResult`:

```ts
interface DetectResult {
  version: 'xf1' | 'xf2';
  title: string;       // document.title hoặc h1 text
  postCount: number;    // tổng số bài (từ DOM counter)
  pageCount: number;    // tổng số trang (từ pagination)
}
```

---

## 3. Các loại message scrape

| Message | Mục đích | Trang | Async? |
|---------|----------|-------|--------|
| `SCRAPE_TOPIC` | Scrape trang hiện tại duy nhất | 1 trang (live DOM) | Sync |
| `SCRAPE_ALL_PAGES` | Scrape tất cả trang | 1 → totalPages | Async |
| `SCRAPE_PAGE_RANGE` | Scrape khoảng trang chỉ định | startPage → endPage | Async |
| `CANCEL_SCRAPE` | Huỷ scraping đang chạy | — | Sync |

Async message dùng `return true` trong listener để giữ message channel mở.

---

## 4. Core scraping (`page-loader.ts`)

### `scrapeAllPages()` và `scrapePageRange()`

Hai function này hoạt động tương tự, chỉ khác phạm vi trang:

```
Trang 1 (nếu trong range) → dùng `document` (DOM đang mở, không fetch)
Trang 2..N                → fetch(url) → DOMParser → scraper.scrape(doc)
```

### Quy trình mỗi trang (2+)

1. **Build URL:** `baseUrl/page-{N}` — bỏ `/page-N` cũ trước khi append mới
2. **Fetch:** `fetch(pageUrl, { credentials: 'include' })` — giữ cookie đăng nhập
3. **Check lỗi:**
   - HTTP 401/403 → ghi warning "Không có quyền truy cập"
   - Redirect đến login page (detect qua URL pattern hoặc `<form>` login) → skip
4. **Parse HTML:** `new DOMParser().parseFromString(html, 'text/html')`
5. **Scrape:** `scraper.scrape(doc, pageUrl)` → `ScrapedPost[]`
6. **Rate limiting:** `delayMs + random jitter` giữa mỗi request
   - `jitter = Math.random() * Math.min(delayMs * 0.3, 500)`
   - Default `delayMs = 2000ms`, configurable trong Settings
7. **Dedup + Sort:** loại bỏ trùng `postNumber`, sắp xếp tăng dần
8. **Abort support:** kiểm tra `signal.aborted` trước mỗi trang

### Kết quả trả về

```ts
interface MultiPageResult {
  posts: ScrapedPost[];   // bài viết đã dedup + sort
  totalPages: number;
  pagesScraped: number;   // số trang scrape thành công
  errors: string[];       // warning mỗi trang lỗi
}
```

---

## 5. Chunked scraping (tránh message channel timeout)

Chrome message channel có timeout ~5 phút. Topic 100+ trang × 2s delay = 200s+ → vượt timeout.

**Giải pháp:** `scrapeInChunks()` trong SummaryView chia thành nhiều message nhỏ:

```
SCRAPE_CHUNK_SIZE = 10 trang/message

Topic 50 trang → 5 message SCRAPE_PAGE_RANGE:
  [1-10], [11-20], [21-30], [31-40], [41-50]
```

Mỗi chunk:
- Gửi 1 message `SCRAPE_PAGE_RANGE` riêng
- Nhận response riêng (~10-20s mỗi chunk)
- Tổng hợp posts + dedup ở cuối

```ts
async function scrapeInChunks(tabId, startPage, endPage, delayMs) {
  for (let chunkStart = startPage; chunkStart <= endPage; chunkStart += SCRAPE_CHUNK_SIZE) {
    const chunkEnd = Math.min(chunkStart + SCRAPE_CHUNK_SIZE - 1, endPage);
    const result = await browser.tabs.sendMessage(tabId, {
      type: 'SCRAPE_PAGE_RANGE',
      payload: { startPage: chunkStart, endPage: chunkEnd, delayMs },
    });
    allPosts.push(...result.posts);
  }
  // dedup + sort
}
```

---

## 6. Ba flow tóm tắt sử dụng scraping

### 6a. Normal mode (topic < N trang)

```
handleSummarize(false)               handleSummarize(true) [incremental]
       │                                    │
       ▼                                    ▼
  scrapeInChunks(1 → totalPages)       scrapeInChunks(cachedPages+1 → totalPages)
       │                                    │  merge với cached posts
       ▼                                    ▼
  pendingPosts = posts                 pendingPosts = mergedPosts
       │                                    │
       ▼                                    ▼
  confirmSummarize()                   confirmSummarize()
       │                                    │
       ▼                                    ▼
  SUMMARIZE → LLM                      SUMMARIZE_INCREMENTAL → LLM
       │                                    │
       ▼                                    ▼
  SAVE_CACHED_TOPIC                    SAVE_CACHED_TOPIC
```

### 6b. Segment mode (topic > N trang, mặc định N=20)

```
segments = chia topic thành khoảng N trang
  VD: 65 trang, segmentSize=20 → [1-20], [21-40], [41-60], [61-65]

handleSummarizeSegment(index):
  1. scrapeInChunks(seg.start → seg.end)
  2. SUMMARIZE → LLM (chỉ posts của segment)
  3. Lưu TopicSegment vào segmentSummaries[]
  4. SAVE_CACHED_TOPIC (với segments array)

generateOverallSummary():
  1. Gom segment summaries thành pseudo-posts
  2. SUMMARIZE → LLM (tóm tắt các tóm tắt)
  3. Lưu overall summary

handleSegmentUpdate():  [cập nhật khi có bài mới]
  1. Tính segments chưa tóm tắt hoặc bị mở rộng
  2. handleSummarizeSegment() cho mỗi segment cần update
  3. generateOverallSummary()
```

### 6c. News detection (tự động, trước khi gửi LLM)

```
detectNewsThread(posts, forumDomain)
  → isNews? → SCRAPE_ARTICLE messages → fetch bài báo gốc
  → prepend articlePosts (postNumber âm) vào posts
  → LLM nhận cả bài báo + bình luận
```

---

## 7. Progress tracking

Content script gửi `SCRAPE_PROGRESS` message về sidepanel sau mỗi trang:

```ts
// Content script → sidepanel
{ type: 'SCRAPE_PROGRESS', payload: { currentPage, totalPages, postsScraped } }
```

SummaryView listen qua `browser.runtime.onMessage` và cập nhật `loadingText` realtime:
*"Đang đọc trang 5/30 (120 bài)..."*

---

## 8. Cancel

User bấm "Huỷ" → `CANCEL_SCRAPE` message → content script gọi `abortController.abort()` → vòng lặp scrape kiểm tra `signal.aborted` → dừng.

SummaryView cũng set `isScraping.value = false` → `scrapeInChunks()` kiểm tra flag này trước mỗi chunk.

---

## 9. Hạn chế hiện tại

### Phải mở đúng topic trên tab active

```ts
// SummaryView.vue - handleSummarize()
const isActiveTab = store.activeTabUrl.value
  && isSameTopicUrl(store.activeTabUrl.value, topic.url);
if (!isActiveTab) {
  error.value = 'Hãy mở topic này trên trình duyệt...';
  return;
}
```

**Lý do:**
- `browser.tabs.sendMessage(tabId, ...)` gửi đến content script trong tab cụ thể
- Hiện dùng `browser.tabs.query({ active: true, currentWindow: true })` → chỉ lấy tab active
- Trang 1 scrape từ `document` trực tiếp (không fetch)
- `fetch({ credentials: 'include' })` cần content script chạy trên cùng origin forum

**Vấn đề:** Trang 2+ hoàn toàn dùng fetch, không cần live DOM. Chỉ cần content script trên cùng domain forum — không nhất thiết đúng topic URL.

> **Xem planning cải thiện:** `planning/20260320_1319_12-feature-scrape-any-tab.md`
