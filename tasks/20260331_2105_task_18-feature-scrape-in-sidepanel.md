# Task: Feature 18 — Chuyển Scraping từ Content Script sang Sidepanel

**Ngày:** 2026-03-31
**Planning file:** `planning/20260331_2038_18-feature-scrape-in-sidepanel.md`

## Summary

Chuyển toàn bộ logic scraping từ content script sang sidepanel bằng cách gọi trực tiếp `scrapePageRange` từ `SummaryView.vue`. Sidepanel là extension page persistent — không bị destroy khi user điều hướng, có `DOMParser`, và fetch được cross-origin URL kèm cookies nhờ `host_permissions: ['<all_urls>']`.

**Kết quả:** Scraping tiếp tục chạy bình thường dù user chuyển tab, điều hướng, hay đóng tab forum. Bỏ được toàn bộ chunking logic phức tạp (`SCRAPE_CHUNK_SIZE`, `scrapeInChunks`) vì không còn message channel timeout.

## Changes

### `entrypoints/sidepanel/views/SummaryView.vue` — SỬA

**Imports:**
- Thêm `import { scrapePageRange } from '@/lib/scrapers/page-loader'`
- Thêm `XenForoVersion` vào type imports
- Xóa `import type { MultiPageResult }`, `Message`, `PageProgress`
- Xóa `onDeactivated`, `onUnmounted` khỏi Vue imports (hooks không còn dùng)

**State:**
- Xóa `SCRAPE_CHUNK_SIZE = 10` constant
- Xóa `currentScrapeTabId` ref
- Thêm `scrapeAbortCtrl: AbortController | null = null` (non-reactive, module-level)

**Functions xóa:**
- `onRuntimeMessage()` — không còn nhận `SCRAPE_PROGRESS` qua message; progress qua callback trực tiếp
- `findForumTab()` — không cần tìm forum tab nữa
- `scrapeInChunks()` — không cần chunk vì không có channel timeout

**Function thêm — `scrapeRange()`:**
```typescript
async function scrapeRange(baseUrl, startPage, endPage, delayMs): Promise<{ posts, errors }>
```
- Gọi `scrapePageRange` trực tiếp với abort signal + progress callback
- Callback cập nhật `scrapeProgress.value` in-place (không qua message)
- Sau khi return, kiểm tra `signal.aborted` → throw `AbortError` nếu bị cancel (tránh process partial results)

**`handleCancel()` — cập nhật:**
- `scrapeAbortCtrl?.abort()` thay vì `browser.tabs.sendMessage(tabId, CANCEL_SCRAPE)`

**`handleSummarize()` — cập nhật 3 call sites:**
- Xóa `findForumTab()` call + null guard + error message
- Xóa tất cả `currentScrapeTabId` assignments
- `scrapeInChunks(tabId, url, ...)` → `scrapeRange(url, ...)`
- Catch block: swallow `AbortError` silently

**`handleSummarizeSegment()` — cập nhật 1 call site:**
- Xóa `findForumTab()` call + guard + `currentScrapeTabId` assignments
- `scrapeInChunks(tabId, url, ...)` → `scrapeRange(url, ...)`
- Catch block: swallow `AbortError` silently

**Lifecycle hooks:**
- Xóa `onDeactivated` hook (chỉ chứa `removeListener`)
- Xóa `onUnmounted` hook (chỉ chứa `removeListener`)
- Xóa `addListener(onRuntimeMessage)` khỏi `onActivated`

---

### `entrypoints/content/index.ts` — SỬA (~40 dòng, detect only)

**Xóa:**
- Import `scrapeAllPages`, `scrapePageRange` từ `page-loader`
- Import `TopicData` từ `types`
- `scrapeAbortController`, `pendingSendResponse` state
- `pagehide` event listener
- `SCRAPE_TOPIC` handler
- `SCRAPE_ALL_PAGES` handler
- `SCRAPE_PAGE_RANGE` handler
- `CANCEL_SCRAPE` handler

**Giữ nguyên:**
- `DETECT_XF` handler — cần live DOM để detect XenForo version + post/page count
- `createScraper()` helper
- Imports: `XF2Scraper`, `XF1Scraper`, `detectXenForoVersion`

---

### `lib/types.ts` — SỬA

**Xóa khỏi `MessageType`:**
- `'SCRAPE_TOPIC'`
- `'SCRAPE_ALL_PAGES'`
- `'SCRAPE_PAGE_RANGE'`
- `'SCRAPE_PROGRESS'`
- `'CANCEL_SCRAPE'`

**Xóa interface:**
- `PageProgress` (progress qua callback trực tiếp, không qua message)

---

### `entrypoints/sidepanel/composables/useScraper.ts` — XÓA

Dead code. Không được import ở bất kỳ file nào. Dùng message types đã bị xóa.

---

## Self-review Results

- Issues found: 1
- Issues fixed: 1
- Remaining: Không có

**Issue found:** `scrapePageRange` trả về partial results khi abort (không throw) — nếu không kiểm tra `signal.aborted` sau khi return, `handleSummarize` tiếp tục xử lý partial posts và hiển thị dialog xác nhận token với dữ liệu không đầy đủ sau khi user bấm Hủy.

**Fix:** `scrapeRange` lưu signal ref riêng trước khi gán `scrapeAbortCtrl = new AbortController()`, kiểm tra `signal.aborted` sau khi `scrapePageRange` return → throw `DOMException('Scraping cancelled', 'AbortError')`. Các catch block trong `handleSummarize` và `handleSummarizeSegment` swallow `AbortError` silently (không set `error.value`).
