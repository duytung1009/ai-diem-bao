# Fix: CSP Script Violation khi Scraping từ Sidepanel

## Objective & Scope

**Bug:** DevTools console của `sidepanel.html` báo CSP violation mỗi lần scraping:
> "Loading the script '<URL>' violates the following Content Security Policy directive: script-src 'self'..."

**Root cause:** Feature 18 chuyển scraping từ content script sang sidepanel. `DOMParser.parseFromString(html, 'text/html')` bây giờ chạy trong extension page context. Chrome renderer evaluate các `<script src="...">` trong HTML forum để kiểm tra CSP → extension CSP (`script-src 'self'`) block → log warning per script tag, per page scraped.

Trước Feature 18: `DOMParser` chạy trong content script → same-origin với forum → forum's CSP áp dụng, không có extension CSP violation.

Scraping vẫn hoạt động đúng nhưng console bị spam warnings.

## Affected Modules

| File | Action |
|------|--------|
| `lib/scrapers/page-loader.ts` | **SỬA** — strip `<script>` tags trước `DOMParser.parseFromString` |

## Implementation Steps

Trong cả `scrapeAllPages` và `scrapePageRange`, trước dòng `parser.parseFromString(html, 'text/html')`:

```typescript
const safeHtml = html.replace(/<script[\s\S]*?<\/script>/gi, '');
const doc = parser.parseFromString(safeHtml, 'text/html');
```

Scrapers chỉ cần DOM structure (article, pagination, post content) — không cần `<script>` tags.

## Decision Log

### QD1: Strip trước khi parse, không phải sau
- **Đã chọn:** `html.replace(/<script...>)` trước `parseFromString`
- **Lý do:** CSP check xảy ra tại thời điểm parse — nếu remove sau thì warning đã xuất hiện rồi
- **Đã cân nhắc nhưng loại:** `doc.querySelectorAll('script').forEach(el => el.remove())` sau parse — quá muộn
