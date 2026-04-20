# Task: Feature 12 — Scrape từ bất kỳ tab cùng domain

Ngày: 2026-03-20
Dựa trên: `planning/20260320_1319_12-feature-scrape-any-tab.md`

---

## Tóm tắt

Cho phép scrape topic mà không cần active tab mở đúng URL topic. Chỉ cần có bất kỳ tab nào đang mở trên cùng domain forum là đủ.

---

## Thay đổi đã thực hiện

### 1. `lib/scrapers/page-loader.ts`

**`scrapeAllPages()`:** Bỏ block đặc biệt cho trang 1 dùng `document` + `window.location.href`. Mọi trang (kể cả trang 1) giờ đều dùng `fetch + DOMParser`.

**`scrapePageRange()`:** Bỏ `if (page === 1 && startPage === 1)` block dùng live DOM. Mọi trang đều đi vào nhánh fetch.

### 2. `entrypoints/content/index.ts`

**`SCRAPE_ALL_PAGES` handler:** Bỏ `createScraper()` + `scraper.scrape().url`. Thay bằng `baseUrl` lấy từ `message.payload`:
```ts
const { totalPages, delayMs, baseUrl } = message.payload as { ... baseUrl: string };
```

**`SCRAPE_PAGE_RANGE` handler:** Tương tự — lấy `baseUrl` từ payload thay vì từ DOM.

`DETECT_XF` và `SCRAPE_TOPIC` giữ nguyên (vẫn đọc từ trang hiện tại).

### 3. `entrypoints/sidepanel/views/SummaryView.vue`

**Thêm `currentScrapeTabId` ref:** Theo dõi tab đang scraping để cancel đúng tab.

**`findForumTab()` helper (mới):** Tìm tab cùng domain với topicUrl. Ưu tiên active tab nếu cùng domain, fallback sang bất kỳ tab cùng domain trong window hiện tại.

**`handleCancel()`:** Dùng `currentScrapeTabId.value` thay vì luôn gửi cancel đến active tab.

**`scrapeInChunks()`:** Thêm param `baseUrl: string`. Truyền vào payload `SCRAPE_PAGE_RANGE`.

**`handleSummarize()`:**
- Bỏ `isActiveTab` check + error message cũ
- Thay `tabs.query({ active: true })` bằng `findForumTab(topic.url)`
- Error message mới: "Không tìm thấy tab nào đang mở diễn đàn này. Hãy mở ít nhất một trang của diễn đàn."
- Set/clear `currentScrapeTabId` khi scraping bắt đầu/kết thúc
- Dùng `topic.totalPages` làm fallback cho `pageCount` thay vì chỉ `activeTabDetect`

**`handleSummarizeSegment()`:**
- Bỏ `isActiveTab` check
- Thay `tabs.query({ active: true })` bằng `findForumTab(topic.url)`
- Error message mới: cùng như trên
- Set/clear `currentScrapeTabId`

### 4. `wxt.config.ts`

Không cần thay đổi — `tabs` permission đã có sẵn.

### 5. `lib/types.ts`

Không cần thay đổi — payload types là inline cast (không phải typed interface).

---

## Kết quả

- `npx vue-tsc --noEmit` → pass
- `npm run build` → pass (build ~7.68 MB)
- Feature hoạt động: scrape topic từ bất kỳ tab forum cùng domain
