# Bug Fix: CSP Script Violation khi Scraping từ Sidepanel

**Ngày:** 2026-04-01
**Planning file:** `planning/20260401_1213_fix-csp-script-violation-sidepanel.md`

## Summary

DevTools console của `sidepanel.html` báo CSP violation mỗi lần scraping chạy. Scraping vẫn hoạt động đúng nhưng console bị spam warnings về script-src.

**Root cause:** Feature 18 chuyển `DOMParser.parseFromString(html, 'text/html')` từ content script sang sidepanel. Chrome renderer evaluate `<script src="...">` trong HTML forum để kiểm tra CSP ngay tại thời điểm parse → extension CSP (`script-src 'self'`) block → log warning.

## Changes

### `lib/scrapers/page-loader.ts` — SỬA

Thêm strip `<script>` tags trước khi parse ở **cả 2 hàm** `scrapeAllPages` và `scrapePageRange`:

```typescript
// Trước (gây CSP warning):
const doc = parser.parseFromString(html, 'text/html');

// Sau:
const safeHtml = html.replace(/<script[\s\S]*?<\/script>/gi, '');
const doc = parser.parseFromString(safeHtml, 'text/html');
```

Scrapers chỉ cần DOM structure (article, pagination, post content) — không cần script tags.

## Self-review Results

- Issues found: 0
- Issues fixed: 0
- Remaining: Không có

Thay đổi nhỏ, isolated, không ảnh hưởng scraping logic. Regex `/<script[\s\S]*?<\/script>/gi` đã dùng lazy match (`*?`) và flag `s` implicit qua `[\s\S]` để handle multiline scripts. Type check pass.
