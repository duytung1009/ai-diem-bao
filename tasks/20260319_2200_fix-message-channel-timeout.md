# Bug Fix: Message Channel Timeout (Scraping + LLM)

**Date:** 2026-03-19 22:00
**Status:** ✅ DONE

## Problem

Khi scrape/tóm tắt topic > 100 trang, Chrome báo lỗi:
> "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received"

### Nguyên nhân 1 — Scraping channel timeout
`SCRAPE_ALL_PAGES` / `SCRAPE_PAGE_RANGE` cho 100+ trang (100 × 450ms = 45+ giây) vượt quá timeout của Chrome message channel.

### Nguyên nhân 2 — LLM summarization channel timeout
`SUMMARIZE` giữ message channel mở trong suốt quá trình LLM xử lý (có thể 5–10 phút cho 100 trang). Chrome đóng channel trước khi LLM xong.

---

## Fix 1: Chunked Scraping

**File:** `entrypoints/sidepanel/views/SummaryView.vue`

Thêm hàm `scrapeInChunks(tabId, startPage, endPage)`:
- Chia scraping thành chunks 10 trang (`SCRAPE_CHUNK_SIZE = 10`)
- Mỗi chunk gửi 1 message `SCRAPE_PAGE_RANGE` riêng (~5–10 giây)
- Dedup + sort sau khi collect đủ posts
- Nếu `!isScraping.value` (user cancel) → break sớm

```typescript
const SCRAPE_CHUNK_SIZE = 10;
async function scrapeInChunks(tabId, startPage, endPage): Promise<{ posts, errors }> {
  for (let chunkStart = startPage; chunkStart <= endPage; chunkStart += SCRAPE_CHUNK_SIZE) {
    if (!isScraping.value) break;
    const chunkEnd = Math.min(chunkStart + SCRAPE_CHUNK_SIZE - 1, endPage);
    // ... sendMessage SCRAPE_PAGE_RANGE, collect allPosts
  }
  // dedup + sort, return
}
```

Tất cả 3 call site cập nhật dùng `scrapeInChunks`:
- Full scrape trong `handleSummarize()`
- Incremental scrape trong `handleSummarize()`
- Per-segment scrape trong `handleSummarizeSegment()`

---

## Fix 2: Fire-and-Forget LLM Summarize

### lib/types.ts
Thêm `'START_SUMMARIZE'` và `'SUMMARIZE_RESULT'` vào `MessageType`.

### entrypoints/background/index.ts
Thêm `'START_SUMMARIZE'` handler:
- Gọi `sendResponse({ started: true })` **ngay lập tức** để đóng channel
- Chạy LLM async với keepalive (recursive `setTimeout` mỗi 20s để prevent SW idle-kill)
- Khi LLM xong: `browser.runtime.sendMessage({ type: 'SUMMARIZE_RESULT', payload })` push về sidepanel

```typescript
case 'START_SUMMARIZE': {
  sendResponse({ started: true }); // close channel immediately
  let keepAlive = true;
  (function sw_keepalive() {
    if (!keepAlive) return;
    browser.storage.local.get('_sw_ka').catch(() => {});
    setTimeout(sw_keepalive, 20000);
  })();
  getSettings().then(async (config) => { ... })
    .then((summary) => { keepAlive = false; browser.runtime.sendMessage({ type: 'SUMMARIZE_RESULT', ... }); })
    .catch((err) => { keepAlive = false; browser.runtime.sendMessage({ type: 'SUMMARIZE_RESULT', ... }); });
  return false; // already responded
}
```

### entrypoints/sidepanel/views/SummaryView.vue

**State thêm:**
```typescript
type PendingSummarize =
  | { type: 'full' | 'incremental'; posts; topicUrl; topicTitle; topicVersion; topicPageCount }
  | { type: 'segment'; posts; segmentIndex; topicUrl }
  | { type: 'overall'; posts; topicUrl };
const pendingSummarize = ref<PendingSummarize | null>(null);
```

**Lifecycle:**
- `onMessage.addListener(onRuntimeMessage)` chuyển sang `onMounted` thay vì `onActivated`
- `onDeactivated` là no-op — listener tồn tại suốt lifetime view (keep-alive)
- Đảm bảo `SUMMARIZE_RESULT` push không bị miss khi user navigate sang tab khác trong sidepanel

**`confirmSummarize()` refactored:**
- Set `pendingSummarize.value = { type, posts, topicUrl, ... }`
- Gọi `sendMessage('START_SUMMARIZE', { mode, ... })`
- Background ack ngay, result về qua `SUMMARIZE_RESULT`

**`handleSummarizeResult()` thêm mới:**
- Đọc context từ `pendingSummarize.value`
- Xử lý result tùy `type`: `full/incremental` → update summary; `segment` → update segmentSummaries; `overall` → update overallSummary
- Lưu cache, update store, clear state

**`handleSummarizeSegment()` + `generateOverallSummary()` refactored:**
- Post-summarize logic di chuyển vào `handleSummarizeResult()`
- Chỉ còn scraping + set `pendingSummarize` + `sendMessage('START_SUMMARIZE', ...)`

---

## Build Verification
- `npx vue-tsc --noEmit` → ✅ pass
- `npm run build` → ✅ 318 kB
