# Feature 10: Incremental scraping, News topic detection, Chunked long-topic summarization

## Tổng quan
3 tính năng cải thiện cốt lõi scraping + summarization: (1) chỉ scrape bài mới thay vì toàn bộ, (2) phát hiện chủ đề tin tức và scrape bài báo gốc, (3) chia nhỏ chủ đề dài (>100 trang) thành các phần để scrape + tóm tắt riêng biệt.

---

## Task 1: Chỉ scrape bài viết mới (Incremental Scraping)

### Phân tích hiện trạng

**Flow hiện tại khi "Cập nhật tóm tắt" (incremental):**
1. `handleSummarize(true)` → scrape **TOÀN BỘ** pages → lấy về tất cả posts
2. `confirmSummarize()` → filter `posts.filter(p => p.postNumber > lastPostNumber)` → chỉ gửi bài mới cho LLM
3. **Vấn đề:** Topic 50 trang → scrape 50 trang chỉ để lấy 5-10 bài mới ở trang cuối = lãng phí thời gian + bandwidth

**Dữ liệu đã có trong cache:**
- `lastPostNumber` — số bài cuối cùng đã scrape
- `totalPosts` — tổng bài đã biết
- `totalPages` — tổng trang đã biết (tại thời điểm cache)

**Dữ liệu live:**
- `store.activeTabDetect.value.pageCount` — tổng trang hiện tại
- `store.activeTabDetect.value.postCount` — tổng bài hiện tại

### Cơ chế mới

Khi incremental = true:
1. Xác định trang bắt đầu scrape = `cachedTotalPages` (re-scrape trang cuối cũ vì có thể chưa đầy)
2. Trang kết thúc = `livePageCount` (tổng trang hiện tại)
3. Chỉ scrape `startPage → endPage` thay vì `1 → endPage`
4. Sau khi scrape → filter bài mới bằng `lastPostNumber` như cũ → gửi LLM

**Ước tính tiết kiệm:** Topic 50 trang, thêm 3 trang mới → chỉ scrape 4 trang (trang 50 + 51-53) thay vì 53 trang.

### File: `lib/scrapers/page-loader.ts`

**1a. Thêm function `scrapePageRange()`:**

```typescript
export async function scrapePageRange(
  version: XenForoVersion,
  baseUrl: string,
  startPage: number,
  endPage: number,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<MultiPageResult> {
  const scraper = createScraperForVersion(version);
  if (!scraper) throw new Error(`No scraper for version: ${version}`);

  const allPosts: ScrapedPost[] = [];
  const errors: string[] = [];
  let pagesScraped = 0;
  const totalPages = endPage - startPage + 1;

  for (let page = startPage; page <= endPage; page++) {
    if (signal?.aborted) break;

    // Page 1 of the range: if it's the current active page, use live document
    if (page === 1) {
      // Special case: only use live doc if startPage is 1
      // (for incremental, startPage > 1 so this won't trigger)
      try {
        const page1Data = scraper.scrape(document, window.location.href);
        allPosts.push(...page1Data.posts);
        pagesScraped++;
        onProgress?.(pagesScraped, totalPages, allPosts.length);
        continue;
      } catch (err) {
        errors.push(`Page 1: ${String(err)}`);
        continue;
      }
    }

    const pageUrl = buildPageUrl(baseUrl, page);
    try {
      const res = await fetch(pageUrl, { credentials: 'include' });
      if (res.status === 401 || res.status === 403) {
        errors.push(`Trang ${page}: Không có quyền truy cập.`);
        continue;
      }
      if (!res.ok) {
        errors.push(`Trang ${page}: HTTP ${res.status}`);
        continue;
      }
      const html = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Detect login redirect
      const isLoginPage =
        /login|sign.?in|đăng.nhập/i.test(res.url) ||
        doc.querySelector('form[action*="login"], input[name="password"]') !== null;
      if (isLoginPage) {
        errors.push(`Trang ${page}: Chuyển hướng đến trang đăng nhập.`);
        continue;
      }

      const pageData = scraper.scrape(doc, pageUrl);
      allPosts.push(...pageData.posts);
      pagesScraped++;
      onProgress?.(pagesScraped, totalPages, allPosts.length);
    } catch (err) {
      errors.push(`Page ${page}: ${String(err)}`);
    }

    // Rate limiting
    if (page < endPage && !signal?.aborted) {
      await new Promise((r) => setTimeout(r, 300 + Math.random() * 300));
    }
  }

  // Deduplicate + sort
  const seen = new Set<number>();
  const uniquePosts = allPosts.filter((p) => {
    if (p.postNumber === 0) return true;
    if (seen.has(p.postNumber)) return false;
    seen.add(p.postNumber);
    return true;
  });
  uniquePosts.sort((a, b) => a.postNumber - b.postNumber);

  return { posts: uniquePosts, totalPages: endPage, pagesScraped, errors };
}
```

**Lưu ý:** `scrapeAllPages` giữ nguyên cho trường hợp full scrape. `scrapePageRange` được gọi từ content script khi nhận message mới.

### File: `entrypoints/content/index.ts`

**1b. Thêm message handler `SCRAPE_PAGE_RANGE`:**

```typescript
if (message.type === 'SCRAPE_PAGE_RANGE') {
  const { startPage, endPage } = message.payload as { startPage: number; endPage: number };
  const scraper = createScraper();
  if (!scraper) {
    sendResponse({ error: 'No scraper available' });
    return true;
  }
  const baseUrl = scraper.scrape().url;

  scrapeAbortController = new AbortController();
  const signal = scrapeAbortController.signal;

  const onProgress = (current: number, total: number, postsScraped: number) => {
    browser.runtime.sendMessage({
      type: 'SCRAPE_PROGRESS',
      payload: { currentPage: startPage + current - 1, totalPages: startPage + total - 1, postsScraped },
    }).catch(() => {});
  };

  scrapePageRange(version, baseUrl, startPage, endPage, onProgress, signal)
    .then((result) => { scrapeAbortController = null; sendResponse(result); })
    .catch((err) => { scrapeAbortController = null; sendResponse({ error: String(err) }); });
  return true;
}
```

**1c. Import `scrapePageRange` trong content script:**
```typescript
import { scrapeAllPages, scrapePageRange } from '@/lib/scrapers/page-loader';
```

### File: `lib/types.ts`

**1d. Thêm `SCRAPE_PAGE_RANGE` vào MessageType union:**
```typescript
export type MessageType =
  | ...existing...
  | 'SCRAPE_PAGE_RANGE'
```

### File: `entrypoints/sidepanel/views/SummaryView.vue`

**1e. Sửa `handleSummarize()` — dùng page range khi incremental:**

Trong block `if (pageCount > 1)` (dòng 220-233), thêm logic:

```typescript
if (pageCount > 1) {
  isScraping.value = true;

  let posts: ScrapedPost[];

  if (incremental && cachedTopic.value) {
    // INCREMENTAL: only scrape from last known page onward
    const cachedPages = cachedTopic.value.totalPages || 1;
    const startPage = Math.max(1, cachedPages); // Re-scrape last cached page
    const endPage = pageCount;

    if (startPage >= endPage) {
      // No new pages — scrape just the last page for new posts
      loadingText.value = `Đang đọc trang ${endPage}...`;
    } else {
      loadingText.value = `Đang đọc trang ${startPage}-${endPage} (${endPage - startPage + 1} trang mới)...`;
    }

    const result = await browser.tabs.sendMessage(tab.id, {
      type: 'SCRAPE_PAGE_RANGE',
      payload: { startPage, endPage },
    }) as MultiPageResult & { error?: string };

    isScraping.value = false;
    if (result.error) throw new Error(result.error);

    // Merge with existing cached posts
    const cachedPosts = cachedTopic.value.posts || [];
    const allPosts = [...cachedPosts, ...result.posts];

    // Deduplicate by postNumber
    const seen = new Set<number>();
    posts = allPosts.filter(p => {
      if (p.postNumber === 0) return true;
      if (seen.has(p.postNumber)) return false;
      seen.add(p.postNumber);
      return true;
    }).sort((a, b) => a.postNumber - b.postNumber);

    if (result.errors.length > 0) scrapingWarnings.value = result.errors;
  } else {
    // FULL SCRAPE: existing behavior
    loadingText.value = `Đang đọc trang 1/${pageCount}...`;
    const result = await browser.tabs.sendMessage(tab.id, {
      type: 'SCRAPE_ALL_PAGES',
      payload: { totalPages: pageCount },
    }) as MultiPageResult & { error?: string };

    isScraping.value = false;
    if (result.error) throw new Error(result.error);
    if (!result.posts?.length) throw new Error('Không tìm thấy bài viết nào.');
    posts = result.posts;
    if (result.errors.length > 0) scrapingWarnings.value = result.errors;
  }

  // ... rest of the function
}
```

**Lưu ý quan trọng:**
- Khi incremental, `pendingPosts` sẽ chứa **toàn bộ posts** (cached + new). Nhưng `confirmSummarize()` vẫn filter bằng `lastPostNumber` → chỉ gửi bài mới cho LLM.
- Merge + dedup đảm bảo không trùng bài.
- Nếu `startPage >= endPage` (không có trang mới), vẫn scrape trang cuối để bắt bài mới trong trang đó.

---

## Task 2: Phát hiện chủ đề tin tức + Scrape bài báo gốc

### Phân tích

**Chủ đề tin tức (news thread) trên XenForo:**
- Bài viết đầu tiên (OP) thường chứa:
  - 1 hoặc nhiều URL trỏ đến trang báo mạng (vnexpress, tuoitrenews, thanhnien, dantri, v.v.)
  - Trích dẫn một phần nội dung bài báo
  - Bình luận ngắn của OP
- Các bài sau là thảo luận của cộng đồng

**Cách phát hiện:**
1. Kiểm tra bài viết đầu tiên (postNumber nhỏ nhất)
2. Tìm URL external (khác domain forum) trong nội dung
3. Nếu tìm thấy ≥ 1 URL ngoài + nội dung OP ngắn (< 500 từ) → nhiều khả năng là news thread
4. **Bonus:** Có thể check URL domain có phải trang tin tức phổ biến không

### Cơ chế

1. Sau khi scrape xong → phân loại topic: `'discussion' | 'news'`
2. Nếu `'news'` → extract URLs từ OP → fetch + extract nội dung chính từ bài báo
3. Prepend nội dung bài báo vào đầu posts array trước khi gửi LLM
4. Hiển thị indicator trên UI: "Chủ đề tin tức — đã tải nội dung bài báo gốc"

### File: `lib/scrapers/article-extractor.ts` (TẠO MỚI)

**2a. Module trích xuất nội dung bài báo:**

```typescript
export interface ArticleContent {
  url: string;
  title: string;
  content: string;
  source: string; // domain name
}

/**
 * Extract main content from a news article URL
 * Uses Readability-like heuristic: find largest text block
 */
export async function extractArticle(url: string): Promise<ArticleContent | null> {
  try {
    const res = await fetch(url, {
      credentials: 'omit',
      headers: { 'Accept': 'text/html' },
    });
    if (!res.ok) return null;

    const html = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Remove noise elements
    const removeSelectors = [
      'script', 'style', 'nav', 'header', 'footer', 'aside',
      '.sidebar', '.ads', '.advertisement', '.social-share',
      '.comments', '.related-posts', '.breadcrumb',
      '[class*="banner"]', '[class*="popup"]', '[id*="comment"]',
    ];
    removeSelectors.forEach(sel =>
      doc.querySelectorAll(sel).forEach(el => el.remove())
    );

    // Try common article content selectors
    const articleSelectors = [
      'article .content', 'article .body', '.article-content',
      '.article-body', '.post-content', '.entry-content',
      '.detail-content', '.fck_detail', '.content-detail',   // Vietnamese news sites
      '.singular-content', '.td-post-content',
      'article', '[role="article"]', '.post-body',
      'main',
    ];

    let contentEl: Element | null = null;
    for (const sel of articleSelectors) {
      contentEl = doc.querySelector(sel);
      if (contentEl && contentEl.textContent!.trim().length > 200) break;
      contentEl = null;
    }

    // Fallback: find largest text block
    if (!contentEl) {
      const candidates = doc.querySelectorAll('div, section');
      let maxLen = 0;
      for (const el of candidates) {
        const text = el.textContent?.trim() || '';
        if (text.length > maxLen && text.length > 200) {
          maxLen = text.length;
          contentEl = el;
        }
      }
    }

    if (!contentEl) return null;

    const title = doc.querySelector('h1')?.textContent?.trim()
      || doc.querySelector('title')?.textContent?.trim()
      || '';

    const content = contentEl.textContent?.trim() || '';
    // Limit content to ~3000 chars to avoid blowing up context
    const trimmedContent = content.length > 3000 ? content.slice(0, 3000) + '...' : content;

    const source = new URL(url).hostname;

    return { url, title, content: trimmedContent, source };
  } catch {
    return null;
  }
}
```

### File: `lib/scrapers/news-detector.ts` (TẠO MỚI)

**2b. Module phát hiện chủ đề tin tức:**

```typescript
import type { ScrapedPost } from '../types';

export interface NewsDetection {
  isNews: boolean;
  articleUrls: string[];
}

/**
 * Analyze the first post to detect if this is a news discussion thread
 */
export function detectNewsThread(posts: ScrapedPost[], forumDomain: string): NewsDetection {
  if (posts.length === 0) return { isNews: false, articleUrls: [] };

  // Get first post (lowest postNumber, skip postNumber 0)
  const firstPost = posts.reduce((min, p) =>
    (p.postNumber > 0 && (min.postNumber === 0 || p.postNumber < min.postNumber)) ? p : min,
    posts[0],
  );

  // Extract URLs from first post content
  const urlRegex = /https?:\/\/[^\s<>"')\]]+/gi;
  const urls = (firstPost.content.match(urlRegex) || [])
    .filter(url => {
      try {
        const hostname = new URL(url).hostname;
        // Exclude: same domain, images, social media share links
        if (hostname.includes(forumDomain)) return false;
        if (/\.(jpg|jpeg|png|gif|webp|svg|mp4|mp3)$/i.test(url)) return false;
        if (/facebook\.com\/sharer|twitter\.com\/intent/i.test(url)) return false;
        return true;
      } catch { return false; }
    });

  if (urls.length === 0) return { isNews: false, articleUrls: [] };

  // Heuristic: news thread if OP has external URLs AND content is relatively short
  // (OP of news threads usually just pastes article excerpt + link)
  const opWordCount = firstPost.content.split(/\s+/).length;
  const isLikelyNews = urls.length >= 1 && opWordCount < 800;

  return {
    isNews: isLikelyNews,
    articleUrls: urls.slice(0, 3), // Max 3 articles
  };
}
```

### File: `entrypoints/content/index.ts`

**2c. Thêm message handler `SCRAPE_ARTICLE`:**

```typescript
if (message.type === 'SCRAPE_ARTICLE') {
  const { url } = message.payload as { url: string };
  // Import dynamically to avoid bundling in non-news contexts
  import('@/lib/scrapers/article-extractor').then(({ extractArticle }) => {
    extractArticle(url).then(sendResponse).catch(() => sendResponse(null));
  });
  return true;
}
```

**Hoặc** xử lý trong background script (tốt hơn vì background có thể fetch cross-origin):

### File: `entrypoints/background/index.ts`

**2d. Thêm handler `SCRAPE_ARTICLE` trong background:**

```typescript
case 'SCRAPE_ARTICLE': {
  const { url } = message.payload as { url: string };
  import('@/lib/scrapers/article-extractor').then(({ extractArticle }) => {
    extractArticle(url).then(sendResponse).catch(() => sendResponse(null));
  });
  return true;
}
```

**Lưu ý:** Content script bị giới hạn CORS khi fetch external URLs. Background service worker có thể fetch tự do hơn. **Khuyến nghị dùng background handler.**

### File: `lib/types.ts`

**2e. Thêm types + message type:**

```typescript
export type MessageType = ...existing... | 'SCRAPE_ARTICLE';

// Thêm vào CachedTopic:
export interface CachedTopic {
  ...existing...
  topicType?: 'discussion' | 'news';
  articleContents?: string; // extracted article text prepended to summary context
}
```

### File: `entrypoints/sidepanel/views/SummaryView.vue`

**2f. Tích hợp vào flow tóm tắt:**

Sau khi scrape xong posts (trong `handleSummarize`), trước khi set `pendingPosts`:

```typescript
// --- NEWS DETECTION ---
import { detectNewsThread } from '@/lib/scrapers/news-detector';

// After scraping posts:
const forumDomain = new URL(topic.url).hostname;
const newsCheck = detectNewsThread(posts, forumDomain);

if (newsCheck.isNews && newsCheck.articleUrls.length > 0) {
  loadingText.value = `Phát hiện chủ đề tin tức — đang tải bài báo gốc...`;

  // Fetch article contents (parallel, max 3)
  const articlePromises = newsCheck.articleUrls.map(url =>
    sendMessage<ArticleContent | null>('SCRAPE_ARTICLE', { url }).catch(() => null)
  );
  const articles = (await Promise.all(articlePromises)).filter(Boolean);

  if (articles.length > 0) {
    // Prepend article content as a special "post" at the beginning
    const articlePosts: ScrapedPost[] = articles.map((a, i) => ({
      author: `[BÀI BÁO GỐC — ${a!.source}]`,
      content: `Tiêu đề: ${a!.title}\n\nNội dung:\n${a!.content}`,
      timestamp: '',
      postNumber: -(i + 1), // Negative to sort before real posts
    }));
    posts = [...articlePosts, ...posts];
    scrapingWarnings.value.push(
      `Đã tải ${articles.length} bài báo gốc: ${articles.map(a => a!.source).join(', ')}`
    );
  }
}
// --- END NEWS DETECTION ---

pendingPosts.value = posts;
```

**2g. Hiển thị indicator "Chủ đề tin tức" (optional):**

Thêm badge nhỏ bên cạnh TopicMeta:
```html
<span v-if="isNewsTopic" class="badge bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-400">
  Tin tức
</span>
```

### Giới hạn + Edge cases
- Một số trang báo block fetch từ extension → `extractArticle` trả về `null` → graceful skip
- Nội dung bài báo giới hạn 3000 ký tự → tránh blow up context
- Max 3 URL để tránh fetch quá nhiều
- CORS: dùng background fetch, service worker có quyền cross-origin fetch nếu domain nằm trong `host_permissions` hoặc dùng `fetch` mode phù hợp. **Cần thêm `host_permissions: ["<all_urls>"]`** trong manifest nếu chưa có.

---

## Task 3: Chia nhỏ chủ đề dài (>100 trang) — Segment Summarization

### Phân tích

**Vấn đề:**
- Topic 300 trang (~6000 bài) → scrape hết = rất lâu (3-5 phút) + tốn API tokens cực lớn
- Map-reduce hiện tại: scrape hết → chunk posts → summarize từng chunk → reduce = 1 bản tóm tắt
- User không thể xem chi tiết từng giai đoạn thảo luận

**Giải pháp: Segment-based scraping + summarization**

Chia topic thành các segment (mỗi segment = 100 trang):
```
Topic 350 trang:
  Segment 1: Trang 1—100
  Segment 2: Trang 101—200
  Segment 3: Trang 201—300
  Segment 4: Trang 301—350
```

User có thể:
1. Scrape + tóm tắt từng segment riêng
2. Sau khi có ≥ 2 segment summaries → tạo tóm tắt tổng quan
3. Xem tóm tắt tổng quan HOẶC tóm tắt từng segment

### Data Model

#### File: `lib/types.ts`

**3a. Thêm interfaces:**

```typescript
export interface TopicSegment {
  startPage: number;
  endPage: number;
  posts: ScrapedPost[];
  summary: string;
  postCount: number;
  summarizedAt: number;
}

export interface CachedTopic {
  ...existing...
  segments?: TopicSegment[];
  overallSummary?: string; // generated from segment summaries
}
```

**3b. Thêm `SCRAPE_PAGE_RANGE` vào MessageType** (nếu chưa thêm ở Task 1).

### UI Flow

#### File: `entrypoints/sidepanel/views/SummaryView.vue`

**3c. Thêm state cho segment mode:**

```typescript
const SEGMENT_SIZE = 100; // pages per segment
const SEGMENT_THRESHOLD = 100; // enable segments when > 100 pages

const isSegmentMode = computed(() =>
  (topicInfo.value?.pageCount ?? 0) > SEGMENT_THRESHOLD
);

const segments = computed(() => {
  if (!isSegmentMode.value || !topicInfo.value) return [];
  const total = topicInfo.value.pageCount;
  const segs: { start: number; end: number; label: string }[] = [];
  for (let start = 1; start <= total; start += SEGMENT_SIZE) {
    const end = Math.min(start + SEGMENT_SIZE - 1, total);
    segs.push({ start, end, label: `Trang ${start}—${end}` });
  }
  return segs;
});

// Which segment is currently selected for viewing
const activeSegmentIndex = ref<number | null>(null); // null = overall summary
const segmentSummaries = ref<TopicSegment[]>([]);
```

**3d. Thêm computed `displayedSummary`:**

```typescript
const displayedSummary = computed(() => {
  if (!isSegmentMode.value) return summary.value;
  if (activeSegmentIndex.value === null) {
    // Show overall summary
    return cachedTopic.value?.overallSummary || '';
  }
  // Show segment summary
  const seg = segmentSummaries.value[activeSegmentIndex.value];
  return seg?.summary || '';
});
```

**3e. Thêm function `handleSummarizeSegment(segmentIndex)`:**

```typescript
async function handleSummarizeSegment(segmentIndex: number) {
  const seg = segments.value[segmentIndex];
  if (!seg || !topicInfo.value) return;
  const topic = store.selectedTopic.value!;

  error.value = '';
  scrapingWarnings.value = [];
  store.setSummarizing(topic.url);

  try {
    // Check active tab
    const isActiveTab = store.activeTabUrl.value && isSameTopicUrl(store.activeTabUrl.value, topic.url);
    if (!isActiveTab) {
      error.value = 'Hãy mở topic này trên trình duyệt để đọc bài viết.';
      store.setSummarizing(null);
      return;
    }

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('Không tìm thấy tab');

    // Scrape page range
    isScraping.value = true;
    loadingText.value = `Đang đọc ${seg.label}...`;

    const result = await browser.tabs.sendMessage(tab.id, {
      type: 'SCRAPE_PAGE_RANGE',
      payload: { startPage: seg.start, endPage: seg.end },
    }) as MultiPageResult & { error?: string };

    isScraping.value = false;
    if (result.error) throw new Error(result.error);
    if (!result.posts?.length) throw new Error('Không tìm thấy bài viết nào.');
    if (result.errors.length > 0) scrapingWarnings.value = result.errors;

    // Summarize this segment
    loadingText.value = `Đang tóm tắt ${seg.label} (${result.posts.length} bài)...`;
    const summaryResult = await sendMessage<{ summary?: string; error?: string }>(
      'SUMMARIZE',
      result.posts,
    );
    if (summaryResult.error) throw new Error(summaryResult.error);

    // Save segment
    const newSegment: TopicSegment = {
      startPage: seg.start,
      endPage: seg.end,
      posts: result.posts,
      summary: summaryResult.summary || '',
      postCount: result.posts.length,
      summarizedAt: Date.now(),
    };

    // Update local state
    const existing = [...segmentSummaries.value];
    existing[segmentIndex] = newSegment;
    segmentSummaries.value = existing;

    // Save to cache
    await sendMessage('SAVE_CACHED_TOPIC', {
      url: topic.url,
      segments: existing,
    });
    store.updateSelectedTopic({ segments: existing } as any);

    // Auto-switch to this segment's summary
    activeSegmentIndex.value = segmentIndex;

    store.setSummarizing(null);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    store.setSummarizing(null);
    isScraping.value = false;
  } finally {
    loadingText.value = '';
  }
}
```

**3f. Thêm function `generateOverallSummary()`:**

```typescript
async function generateOverallSummary() {
  const topic = store.selectedTopic.value;
  if (!topic) return;

  const completedSegments = segmentSummaries.value.filter(s => s?.summary);
  if (completedSegments.length < 2) {
    error.value = 'Cần ít nhất 2 phần đã tóm tắt để tạo tóm tắt tổng quan.';
    return;
  }

  store.setSummarizing(topic.url);
  loadingText.value = 'Đang tạo tóm tắt tổng quan...';

  try {
    // Create fake posts from segment summaries
    const segmentPosts: ScrapedPost[] = completedSegments.map((seg, i) => ({
      author: `[PHẦN ${i + 1}: Trang ${seg.startPage}-${seg.endPage}]`,
      content: seg.summary,
      timestamp: '',
      postNumber: i + 1,
    }));

    // Use REDUCE_SUMMARY_PROMPT to combine
    const result = await sendMessage<{ summary?: string; error?: string }>(
      'SUMMARIZE',
      segmentPosts,
    );
    if (result.error) throw new Error(result.error);

    const overallSummary = result.summary || '';
    summary.value = overallSummary;

    // Save to cache
    await sendMessage('SAVE_CACHED_TOPIC', {
      url: topic.url,
      summary: overallSummary,
      // Note: don't overwrite segments
    });
    store.updateSelectedTopic({ summary: overallSummary });

    activeSegmentIndex.value = null; // Switch to overall view
    store.setSummarizing(null);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    store.setSummarizing(null);
  } finally {
    loadingText.value = '';
  }
}
```

**3g. Template — Segment UI:**

Thay thế/bổ sung block hiện tại. Khi `isSegmentMode`, hiện giao diện segment:

```html
<!-- SEGMENT MODE: Topic > 100 pages -->
<template v-if="isSegmentMode">
  <!-- Segment info banner -->
  <div class="alert alert-info text-xs">
    <p class="font-medium">Chủ đề dài ({{ topicInfo.pageCount }} trang)</p>
    <p>Chia thành {{ segments.length }} phần, mỗi phần ~{{ SEGMENT_SIZE }} trang. Tóm tắt từng phần rồi xem tổng quan.</p>
  </div>

  <!-- Segment tabs / selector -->
  <div class="flex flex-wrap gap-1.5">
    <!-- Overall tab -->
    <button
      class="px-2.5 py-1 text-xs rounded-full transition-colors"
      :class="activeSegmentIndex === null
        ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400 font-medium'
        : 'text-(--color-text-secondary) hover:bg-(--color-bg-muted)'"
      @click="activeSegmentIndex = null"
    >
      Tổng quan
    </button>
    <!-- Segment tabs -->
    <button
      v-for="(seg, i) in segments"
      :key="i"
      class="px-2.5 py-1 text-xs rounded-full transition-colors flex items-center gap-1"
      :class="activeSegmentIndex === i
        ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400 font-medium'
        : 'text-(--color-text-secondary) hover:bg-(--color-bg-muted)'"
      @click="activeSegmentIndex = i"
    >
      {{ seg.label }}
      <!-- Status dot -->
      <span
        v-if="segmentSummaries[i]?.summary"
        class="w-1.5 h-1.5 rounded-full bg-green-500"
        title="Đã tóm tắt"
      />
    </button>
  </div>

  <!-- Overall summary view -->
  <template v-if="activeSegmentIndex === null">
    <div v-if="summary" class="card p-4">
      <SummaryContent :content="summary" />
    </div>
    <div v-else class="text-center py-4 space-y-2">
      <p class="text-xs text-(--color-text-muted)">
        Tóm tắt từng phần trước, sau đó tạo tóm tắt tổng quan.
      </p>
      <button
        v-if="segmentSummaries.filter(s => s?.summary).length >= 2"
        class="btn btn-primary"
        :disabled="!!loadingText"
        @click="generateOverallSummary"
      >
        Tạo tóm tắt tổng quan
      </button>
      <p v-else class="text-xs text-(--color-text-muted)">
        (Cần ít nhất 2 phần đã tóm tắt)
      </p>
    </div>
  </template>

  <!-- Individual segment view -->
  <template v-if="activeSegmentIndex !== null">
    <div v-if="segmentSummaries[activeSegmentIndex]?.summary" class="space-y-3">
      <div class="flex items-center justify-between text-xs text-(--color-text-secondary)">
        <span>{{ segmentSummaries[activeSegmentIndex].postCount }} bài viết</span>
        <span>{{ timeAgo(segmentSummaries[activeSegmentIndex].summarizedAt) }}</span>
      </div>
      <div class="card p-4">
        <SummaryContent :content="segmentSummaries[activeSegmentIndex].summary" />
      </div>
      <button
        class="w-full btn btn-secondary text-xs"
        :disabled="!!loadingText"
        @click="handleSummarizeSegment(activeSegmentIndex)"
      >
        Tóm tắt lại phần này
      </button>
    </div>
    <div v-else class="text-center py-4">
      <button
        class="btn btn-primary"
        :disabled="!!loadingText"
        @click="handleSummarizeSegment(activeSegmentIndex)"
      >
        Tóm tắt {{ segments[activeSegmentIndex].label }}
      </button>
    </div>
  </template>
</template>

<!-- NORMAL MODE: Topic ≤ 100 pages (existing UI, unchanged) -->
<template v-else>
  ... existing summary UI ...
</template>
```

### File: `entrypoints/sidepanel/views/SummaryView.vue`

**3h. Load segments from cache trong `loadTopicData()`:**

Trong block fetch cache (sau `if (fresh.summary)`):

```typescript
if (fresh) {
  cachedTopic.value = fresh;
  if (fresh.summary) {
    summary.value = fresh.summary;
    summarizedPostCount.value = fresh.totalPosts;
  }
  // Load segments if available
  if (fresh.segments) {
    segmentSummaries.value = fresh.segments;
  }
  cacheFreshness.value = evaluateFreshness(fresh, livePostCount.value);
}
```

Và thêm `segmentSummaries.value = [];` vào block reset state.

### File: `entrypoints/background/index.ts`

**3i. Cập nhật SAVE_CACHED_TOPIC handler** để handle `segments` field:

Trong block merge (dòng 116-129), thêm:

```typescript
const topic: CachedTopic = {
  ...existing fields...
  segments: partial.segments ?? existing?.segments,
  overallSummary: partial.overallSummary ?? existing?.overallSummary,
};
```

### Tính toán segment size

| Tổng trang | Số segment | Mỗi segment |
|---|---|---|
| 101-200 | 2 | ~100 trang |
| 201-300 | 3 | ~100 trang |
| 301-400 | 4 | ~100 trang |
| 500 | 5 | 100 trang |
| 1000 | 10 | 100 trang |

`SEGMENT_SIZE = 100` phù hợp cho hầu hết trường hợp. Có thể để user chỉnh trong Settings nếu cần.

---

## Thứ tự triển khai

```
Task 1 (incremental scraping) — nền tảng, Task 3 phụ thuộc vào SCRAPE_PAGE_RANGE
Task 2 (news detection) — độc lập, có thể làm song song
Task 3 (segment mode) — phức tạp nhất, phụ thuộc Task 1 (SCRAPE_PAGE_RANGE)
```

---

## Verification

1. `npx vue-tsc --noEmit` + `npm run build` → pass

2. **Incremental scraping:**
   - Topic 20 trang đã cache (300 bài) → bài mới ở trang 21-22
   - Bấm "Cập nhật" → chỉ scrape trang 20-22 (3 trang) → progress bar hiện "Đang đọc trang 20-22"
   - Tóm tắt incremental hoạt động bình thường

3. **News detection:**
   - Mở topic tin tức (bài đầu có link vnexpress/thanhnien) → scrape → thấy warning "Đã tải 1 bài báo gốc: vnexpress.net"
   - Nội dung tóm tắt include thông tin từ bài báo
   - Topic thảo luận bình thường → không trigger news detection

4. **Segment mode:**
   - Topic 150 trang → hiện banner "Chủ đề dài" + 2 segment tabs (1-100, 101-150) + tab Tổng quan
   - Bấm "Tóm tắt Trang 1-100" → scrape 100 trang → tóm tắt → hiện dot xanh ✓
   - Bấm "Tóm tắt Trang 101-150" → scrape 50 trang → tóm tắt → hiện dot xanh ✓
   - Bấm "Tạo tóm tắt tổng quan" → LLM combine 2 summaries → hiện ở tab Tổng quan
   - Switch giữa các tab segment → hiện đúng nội dung từng phần
   - Reload extension → segments + summaries load từ cache đúng
