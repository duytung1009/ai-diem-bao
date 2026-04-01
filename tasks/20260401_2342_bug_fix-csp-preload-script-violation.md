# Bug Fix: CSP violation — `<link rel="preload" as="script">` trong DOMParser

## Bug

**Triệu chứng:**
```
Loading the script 'https://voz.vn/js/xf/preamble.min.js?_v=4d9940a3' violates
the following Content Security Policy directive: "script-src 'self'".
Context: sidepanel.html#/settings
```

**Điều kiện xảy ra:**
- User đang scraping (useSummarize keep-alive vẫn chạy) và điều hướng sang trang `/settings`
- Hoặc bất kỳ lúc nào `scrapePageRange()` được gọi trong sidepanel context

## Root Cause

XenForo 2 khai báo `preamble.min.js` (và các critical scripts khác) theo **2 cách trong `<head>`**:

```html
<!-- Cách 1: <script src> — đã fix trước đó -->
<script src="https://voz.vn/js/xf/preamble.min.js?_v=..."></script>

<!-- Cách 2: <link rel="preload"> — CHƯA fix -->
<link rel="preload" href="https://voz.vn/js/xf/preamble.min.js?_v=..." as="script">
```

Fix trước (`planning/20260401_1213`) chỉ strip `<script>` tags. `<link rel="preload" as="script">` vẫn còn trong HTML khi DOMParser xử lý → Chrome's CSP engine kiểm tra resource này ngay cả trong inert document → CSP violation.

## Fix

**File:** `lib/scrapers/page-loader.ts`

Thay vì chỉ strip `<script>` tags, giờ strip toàn bộ `<head>` block trước:

```typescript
// Trước:
const safeHtml = html.replace(/<script[\s\S]*?<\/script>/gi, '');

// Sau:
const safeHtml = html
  .replace(/<head\b[\s\S]*?<\/head>/gi, '')        // Strip toàn bộ <head>
  .replace(/<script\b[\s\S]*?<\/script>/gi, '');   // Fallback: script trong <body>
```

**Tại sao strip `<head>` thay vì chỉ `<link rel="preload">`:**
- `<head>` chứa TẤT CẢ các resource-loading declarations: `<script>`, `<link rel="preload">`, `<link rel="modulepreload">`, `<link rel="stylesheet">`, `<meta http-equiv="refresh">`, etc.
- Scraper chỉ cần `<body>` content (post articles, pagination) — `<head>` hoàn toàn không cần thiết
- Robust hơn: không cần enumerate từng loại tag problematic

**Tại sao vẫn giữ `<script>` stripping:**
- Safety net cho inline scripts nằm ngoài `<head>` (hiếm nhưng có thể xảy ra trong một số forum)
- `\b` word boundary: `<script\b` match `<script>` và `<script ` nhưng không match `<scripting>` (nếu có)

## Self-review Results

- Issues found: 0
- Issues fixed: 0
- Scraper chỉ dùng body selectors (`article.message`, `li.message`, `.p-title-value`, etc.) — strip head không ảnh hưởng
- `vue-tsc --noEmit` + `npm run build` unaffected (no type changes)
