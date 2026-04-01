# Cơ chế Scraping

> Cập nhật: 2026-04-01

## 1. Kiến trúc tổng quan

```
┌──────────────────────────────────┐
│   useSummarize (sidepanel)       │
│   scrapeRange()                  │
│       │                          │
│       ▼                          │
│   scrapePageRange()              │  fetch()   ┌───────────────┐
│   (lib/scrapers/page-loader.ts)  │ ─────────→ │  Forum Pages  │
│       │                          │ ←───────── │  (HTML)       │
│   DOMParser → scraper.scrape()   │  response  └───────────────┘
└──────────────────────────────────┘

Content script (tab) — CHỈ dùng cho DETECT_XF (đọc DOM của tab hiện tại):
┌──────────────┐  DETECT_XF   ┌────────────────┐
│  App.vue     │ ───────────→ │ Content Script │
│  (sidepanel) │ ←─────────── │ (tab context)  │
└──────────────┘  DetectResult└────────────────┘
```

Kể từ **Feature 18**, scraping hoàn toàn xảy ra **trong sidepanel**:
- `page-loader.ts` được import trực tiếp vào `useSummarize` composable
- Dùng `fetch(url, { credentials: 'include' })` với `host_permissions: ['<all_urls>']`
- Content script **không còn tham gia** vào quá trình scrape

**Files liên quan:**

| File | Vai trò |
|------|---------|
| `entrypoints/content/index.ts` | Content script — chỉ xử lý `DETECT_XF` |
| `lib/scrapers/page-loader.ts` | Core scraping: `scrapePageRange()` (fetch + DOMParser) |
| `lib/scrapers/xf2-scraper.ts` | Scraper cho XenForo 2 |
| `lib/scrapers/xf1-scraper.ts` | Scraper cho XenForo 1 |
| `lib/scrapers/types.ts` | `TopicScraper` interface (Strategy pattern) |
| `entrypoints/sidepanel/composables/useSummarize.ts` | Orchestration — gọi `scrapePageRange`, quản lý state |

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
  title: string;       // h1.p-title-value hoặc document.title
  postCount: number;   // tổng số bài (từ DOM counter)
  pageCount: number;   // tổng số trang (từ pagination)
}
```

---

## 3. Các loại message liên quan đến scraping

| Message | Chiều | Mục đích |
|---------|-------|----------|
| `DETECT_XF` | Sidepanel → Content Script | Phát hiện forum, đọc metadata topic |
| `SCRAPE_ARTICLE` | Sidepanel → Background | Fetch bài báo gốc (news detection) |

> **Lưu ý:** `SCRAPE_PAGE_RANGE`, `SCRAPE_TOPIC`, `SCRAPE_ALL_PAGES`, `SCRAPE_PROGRESS`, `CANCEL_SCRAPE` đã **bị xóa** kể từ Feature 18. Scraping không còn đi qua background hay content script.

---

## 4. Core scraping (`page-loader.ts`)

### `scrapePageRange()`

Hàm duy nhất còn lại (sau khi `scrapeAllPages` bị xóa là dead code ở Feature 18).

```typescript
scrapePageRange(version, baseUrl, startPage, endPage, onProgress?, signal?, delayMs?)
  → Promise<MultiPageResult>
```

### Quy trình mỗi trang

1. **Build URL:** `buildPageUrl(baseUrl, page)` — xóa `/page-N` cũ → append mới
   - Page 1 → URL gốc (không thêm `/page-1`)
   - Page 2+ → `baseUrl/page-N`
2. **Fetch:** `fetch(pageUrl, { credentials: 'include' })` — giữ cookie đăng nhập
3. **Check lỗi:**
   - HTTP 401/403 → ghi warning "Không có quyền truy cập"
   - Redirect đến login page (check URL pattern + `form[action*="login"]`) → skip
4. **Strip script tags (CSP safety):**
   ```typescript
   const safeHtml = html.replace(/<script[\s\S]*?<\/script>/gi, '');
   ```
   Cần thiết vì `DOMParser` trong extension page context sẽ trigger CSP check cho `<script src>`.
5. **Parse HTML:** `new DOMParser().parseFromString(safeHtml, 'text/html')`
6. **Scrape:** `scraper.scrape(doc, pageUrl)` → `ScrapedPost[]`
7. **Rate limiting:** `delayMs + random jitter` giữa mỗi request
   - `jitter = Math.random() * Math.min(delayMs * 0.3, 500)`
   - Default `delayMs = 2000ms`, configurable trong Settings
8. **Progress callback:** `onProgress(pagesScraped, totalPagesInRange, allPosts.length)` sau mỗi trang thành công
9. **Abort support:** kiểm tra `signal?.aborted` trước mỗi trang

### Kết quả trả về

```ts
interface MultiPageResult {
  posts: ScrapedPost[];   // bài viết đã dedup + sort tăng dần theo postNumber
  totalPages: number;     // = endPage (max page trong range)
  pagesScraped: number;   // số trang scrape thành công
  errors: string[];       // warning mỗi trang lỗi
}
```

### Dedup + Sort

```typescript
function deduplicateAndSort(posts: ScrapedPost[]): ScrapedPost[] {
  // postNumber === 0 → giữ lại (bài viết chưa đánh số)
  // postNumber trùng → loại bỏ bản sau
  // Sort tăng dần theo postNumber
}
```

---

## 5. `scrapeRange()` wrapper trong `useSummarize`

`useSummarize` composable wrap `scrapePageRange()` với:
- **Version detection:** lấy từ `store.selectedTopic.value.version`
- **Progress callback → state:** cập nhật `scrapeProgress.value` realtime
- **AbortSignal:** từ `scrapeAbortCtrl` — user cancel → `abort()`

```typescript
async function scrapeRange(
  url: string, startPage: number, endPage: number, delayMs: number,
): Promise<{ posts: ScrapedPost[]; errors: string[] }> {
  scrapeAbortCtrl = new AbortController();
  const version = store.selectedTopic.value!.version;
  const result = await scrapePageRange(
    version, url, startPage, endPage,
    (cur, total, cnt) => { scrapeProgress.value = { currentPage: cur, totalPages: total, postsScraped: cnt }; },
    scrapeAbortCtrl.signal,
    delayMs,
  );
  scrapeAbortCtrl = null;
  return { posts: result.posts, errors: result.errors };
}
```

---

## 6. Ba flow tóm tắt sử dụng scraping

### 6a. Normal mode (topic ≤ segmentSize trang)

```
handleSummarize(incremental=false)            handleSummarize(incremental=true)
       │                                              │
       ▼                                              ▼
scrapeRange(1 → totalPages)            scrapeRange(cachedTotalPages+1 → totalPages)
       │                                     │  merge + dedup với cachedTopic.posts
       ▼                                     ▼
[news detection: enrichWithNewsArticles]    [news detection]
       │                                              │
       ▼                                              ▼
saveTopic(posts) ← Feature 16: lưu posts          saveTopic(posts)
trước LLM để không phải re-scrape khi LLM fail        │
       │                                              ▼
       ▼                                  pendingPosts (chờ confirm)
pendingPosts → confirmSummarize()                     │
       │                                              ▼
       ▼                                  confirmSummarize()
SUMMARIZE via useLLM                      SUMMARIZE_INCREMENTAL via useLLM
       │                                              │
       ▼                                              ▼
SAVE_CACHED_TOPIC                         SAVE_CACHED_TOPIC
```

### 6b. Segment mode (topic > segmentSize trang, mặc định 20)

```
segments = [(1-20), (21-40), ..., (lastStart-end)]  ← computed từ totalPages + segmentSize

handleSummarizeSegment(segmentIndex):
  1. Check: segmentSummaries[index]?.posts?.length > 0?
     → Có: dùng cached posts (skip scraping)
     → Không: scrapeRange(seg.start → seg.end)
  2. saveTopic({segments: [..., {posts, summary:''}]}) ← pre-LLM save (Feature 16)
  3. Update segmentSummaries[index] in UI state
  4. SUMMARIZE via useLLM (chỉ posts của segment)
  5. Cập nhật segmentSummaries[index].summary
  6. saveTopic({segments: [...]}) ← post-LLM save

generateOverallSummary():
  1. Gom tất cả segment summaries (filter: s?.summary truthy)
  2. SUMMARIZE_SEGMENTS via useLLM (reduce các segment summaries)
  3. Lưu overallSummary

handleSegmentUpdate():  [cập nhật khi có bài mới]
  1. Tính segments chưa tóm tắt hoặc bị mở rộng (totalPages tăng)
  2. handleSummarizeSegment() cho mỗi segment cần update
  3. generateOverallSummary()
```

### 6c. News detection (tự động, trước khi gửi LLM)

```typescript
enrichWithNewsArticles(posts, topicUrl, onStatus, onInfo):
  detectNewsThread(posts, forumDomain)
    → isNews? + articleUrls[]
    → Promise.all(SCRAPE_ARTICLE messages) → ArticleContent[]
    → prepend articlePosts (postNumber âm) vào posts trả về
```

LLM nhận cả bài báo gốc + bình luận forum.

---

## 7. Progress tracking

Progress scraping được track qua **callback** trực tiếp (không qua message):

```typescript
// Trong scrapePageRange:
onProgress?.(pagesScraped, totalPagesInRange, allPosts.length);

// Trong scrapeRange wrapper (useSummarize):
(cur, total, cnt) => {
  scrapeProgress.value = { currentPage: cur, totalPages: total, postsScraped: cnt };
}
```

`ProgressIndicator` component nhận `scrapeProgress` prop và tính ETA dựa trên `scrapeDelayMs`.

---

## 8. Cancel scraping

User bấm "Huỷ" → `handleCancel()` trong `useSummarize`:

```typescript
function handleCancel() {
  scrapeAbortCtrl?.abort(); // → signal.aborted = true → scrapePageRange dừng vòng lặp
  // Cleanup state: isScraping, scrapeProgress, simpleLoadingText, pendingPosts, etc.
  ++activeSummarizeId; // invalidate stale LLM callbacks
  store.setSummarizing(null);
}
```

`scrapePageRange` kiểm tra `signal?.aborted` trước mỗi trang → dừng ngay.

---

## 9. Incremental scraping (tránh re-scrape toàn bộ)

Khi topic có bài mới:

```typescript
const startPage = Math.max(1, existingCachedPages + 1);
const { posts: newPosts } = await scrapeRange(url, startPage, endPage, delayMs);

// Merge với cached posts + dedup
const merged = [...existingPosts, ...newPosts];
```

Scraper chỉ đọc từ trang mới nhất đã cache → hiệu quả với topic nhiều trang.

---

## 10. Lưu posts sớm (Feature 16 — tránh re-scrape khi LLM fail)

Sau khi scrape xong nhưng **trước khi** gọi LLM, posts được lưu vào cache:

```typescript
// handleSummarize (normal mode):
await saveTopic(topic, { posts, totalPages, totalPosts });

// handleSummarizeSegment (segment mode):
await sendMessage('SAVE_CACHED_TOPIC', { ..., segments: tempUpdated }); // summary = ''
segmentSummaries.value = tempUpdated; // update UI state
```

Nếu LLM sau đó lỗi, posts không bị mất. Lần retry tiếp theo sẽ dùng cached posts.
