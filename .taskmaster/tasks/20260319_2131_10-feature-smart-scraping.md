# Task: Feature 10 — Incremental Scraping, News Detection, Segment Summarization

**Date:** 2026-03-19 21:31
**Status:** ✅ DONE
**Planning:** `planning/20260319_1710_10-feature-smart-scraping.md`

## Task 1: Incremental Scraping (SCRAPE_PAGE_RANGE)

### Files changed:
- **`lib/scrapers/page-loader.ts`** — thêm `scrapePageRange(startPage, endPage)`: scrape chỉ trang range chỉ định, dedup + sort giống `scrapeAllPages`
- **`lib/types.ts`** — thêm `'SCRAPE_PAGE_RANGE'` vào `MessageType`
- **`entrypoints/content/index.ts`** — thêm handler `SCRAPE_PAGE_RANGE`: lấy baseUrl từ scraper, dùng `scrapePageRange()`, gửi progress về sidepanel
- **`entrypoints/sidepanel/views/SummaryView.vue`** — sửa `handleSummarize()`: khi `incremental=true` + có cached → chỉ scrape từ `cachedTotalPages` đến `livePageCount`; merge + dedup với cached posts

### Tiết kiệm: topic 50 trang + 3 trang mới → scrape 4 trang thay vì 53

## Task 2: News Thread Detection + Article Scraping

### Files created:
- **`lib/scrapers/article-extractor.ts`** — `extractArticle(url)`: fetch + parse bài báo (selectors cho VN news sites), trả về `{url, title, content, source}`; giới hạn 3000 chars
- **`lib/scrapers/news-detector.ts`** — `detectNewsThread(posts, forumDomain)`: phân tích OP, tìm external URLs, heuristic opWordCount < 800 → isNews

### Files changed:
- **`lib/types.ts`** — thêm `'SCRAPE_ARTICLE'` vào `MessageType`
- **`wxt.config.ts`** — thêm `host_permissions: ['<all_urls>']` (cần cho background fetch cross-origin)
- **`entrypoints/background/index.ts`** — import `extractArticle`, thêm case `'SCRAPE_ARTICLE'`
- **`entrypoints/sidepanel/views/SummaryView.vue`** — import `detectNewsThread`, `ArticleContent`; sau full scrape: detect → fetch articles → prepend articlePosts với postNumber âm; push warning vào `scrapingWarnings`

## Task 3: Segment Summarization (topics > 100 trang)

### Files changed:
- **`lib/types.ts`** — thêm `TopicSegment` interface (`startPage/endPage/posts/summary/postCount/summarizedAt`); thêm vào `CachedTopic`: `topicType?`, `segments?`, `overallSummary?`
- **`entrypoints/background/index.ts`** — merge `segments` + `overallSummary` + `topicType` trong `SAVE_CACHED_TOPIC`
- **`entrypoints/sidepanel/views/SummaryView.vue`**:
  - State: `segmentSummaries`, `activeSegmentIndex`, `SEGMENT_SIZE=100`, `SEGMENT_THRESHOLD=100`
  - Computed: `isSegmentMode`, `segments` (array of {start, end, label})
  - Reset: clear `segmentSummaries` + `activeSegmentIndex`
  - `loadTopicData()`: load `fresh.segments` vào `segmentSummaries`
  - `handleSummarizeSegment(i)`: SCRAPE_PAGE_RANGE → SUMMARIZE → save + update local state
  - `generateOverallSummary()`: combine segment summaries via fake posts → SUMMARIZE
  - Template: segment mode (banner + tabs + overall view + segment view) với guard `isSegmentMode`; normal mode unchanged
- **`entrypoints/sidepanel/views/TopicHubView.vue`** — import `TopicSegment`; spread `segments` khi construct CachedTopic (fix DeepReadonly TS error)

## Build verification
- `npx vue-tsc --noEmit` → ✅ pass
- `npm run build` → ✅ 317 kB
