# Phase 2 — Cache + Multi-page + XF1

**Mục tiêu:** Hỗ trợ XenForo 1.x, scrape nhiều trang, cache kết quả local, và incremental update.

---

## 2.1 XenForo 1.x Scraper

- [ ] `src/content/scrapers/xf1-scraper.ts`:
  - Implement `TopicScraper` cho XenForo 1.x
  - Selectors: `li.message`, `.messageContent .messageText`, `.messageMeta`
  - Extract: author, nội dung (strip quotes `.bbCodeQuote`, strip signatures `.signature`)
  - Extract topic title từ `.titleBar h1`
  - Lấy pagination info từ `.PageNav`
- [ ] Scraper factory trong `src/content/index.ts`:
  - Dựa vào `detectXenForoVersion()` → khởi tạo scraper tương ứng
  - Fallback: thử XF2 trước, XF1 sau, rồi báo lỗi
- [ ] Test trên ít nhất 2 forum XF1 thực tế (VD: voz.vn cũ, các forum dùng XF1)

## 2.2 Multi-page Scraping

- [ ] `src/content/page-loader.ts`:
  - `scrapeAllPages(scraper: TopicScraper, totalPages: number): AsyncGenerator<PageProgress>`
  - Fetch từng trang bằng `fetch()` (cùng domain, không cần CORS)
  - Parse HTML response → DOMParser → chạy scraper trên DOM mới
  - Yield progress: `{ currentPage, totalPages, postsScraped }`
  - Rate limiting: delay 500ms-1s giữa các request để tránh bị block
  - Abort signal support để user có thể cancel
- [ ] Update `SummaryView.vue`:
  - Hiển thị progress bar: "Đang đọc trang 3/15 (120 bài viết)..."
  - Nút Cancel khi đang scrape multi-page
- [ ] Xử lý edge cases:
  - Topic chỉ có 1 trang (skip multi-page)
  - Trang bị lỗi 403/404 (skip + warning)
  - Forum yêu cầu đăng nhập (detect + thông báo)

## 2.3 Cache System

- [ ] `src/background/cache-manager.ts`:
  - `getCachedTopic(url: string): Promise<CachedTopic | null>`
  - `saveCachedTopic(topic: CachedTopic): Promise<void>`
  - `deleteCachedTopic(url: string): Promise<void>`
  - `getAllCachedTopics(): Promise<CachedTopic[]>` (cho settings/management)
  - `getCacheSize(): Promise<number>` (bytes used)
  - URL normalization: strip page number, query params, hash
- [ ] Implement `CachedTopic` type theo dev_plan (posts, summaries, llmConfig, timestamps)
- [ ] Storage quota management:
  - `chrome.storage.local` có limit 10MB (có thể request `unlimitedStorage`)
  - Nếu gần đầy: xóa cache cũ nhất (LRU strategy)
  - Hiển thị warning khi storage > 80%

## 2.4 Cache Freshness Indicator

- [ ] `evaluateFreshness()` function theo logic trong dev_plan:
  - `fresh`: cache < 24h và số posts không đổi
  - `stale`: có posts mới hoặc cache > 24h
  - `outdated`: cache > 7 ngày
- [ ] `src/sidepanel/components/CacheIndicator.vue`:
  - Badge màu: xanh (fresh), vàng (stale), đỏ (outdated)
  - Text: thời gian cache + số posts lúc cache
  - So sánh với post count hiện tại trên trang
  - Nút "Cập nhật" khi stale/outdated
- [ ] Tích hợp vào `SummaryView.vue`:
  - Khi mở topic đã có cache → hiển thị summary cũ + CacheIndicator
  - Khi chưa có cache → auto trigger scrape + summarize

## 2.5 Incremental Update

- [ ] Logic trong `page-loader.ts`:
  - Nhận `lastPostNumber` từ cache
  - Khi scrape: chỉ lấy posts có `postNumber > lastPostNumber`
  - Nếu posts mới ít → chỉ append vào cache, không re-summarize toàn bộ
- [ ] Logic trong `summarizer.ts`:
  - Khi incremental: gửi summary cũ + posts mới → LLM cập nhật summary
  - Prompt template riêng cho incremental update
- [ ] Update cache sau khi incremental update thành công

## 2.6 Integration & Testing

- [ ] Test flow: mở topic đã cache → hiển thị kết quả cũ → nhấn "Cập nhật" → scrape posts mới → update summary
- [ ] Test multi-page scraping trên topic dài (50+ trang)
- [ ] Test XF1 + XF2 trên các forum khác nhau
- [ ] Test cache size management khi có nhiều topics được cache

---

**Definition of Done Phase 2:**
Extension hỗ trợ cả XF1 và XF2, scrape được multi-page với progress, cache kết quả local, hiển thị freshness indicator, và hỗ trợ incremental update khi có posts mới.
