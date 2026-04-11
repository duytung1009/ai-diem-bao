# Bug Fix: postNumber Hiển Thị Số Thứ Tự Thay Vì Post ID

## Problem
`postNumber` hiển thị các số nhỏ (1, 4, 8, 11...) thay vì post ID thực (`41558917`, `41137424`...).

## Root Cause
`extractPostNumber()` trong `XF2Scraper` đọc **text content** của link `.message-attribution-opposite a` làm nguồn ưu tiên. Trên VOZ (XenForo 2), text trong link đó hiển thị **số thứ tự bài viết trong thread** (ví dụ `Bài #5`), không phải post ID thực.

Post ID thực nằm ở `data-content="post-41558917"` trên `<article>` element — nhưng đây lại là fallback cuối trong logic cũ:

```
// Logic cũ (sai thứ tự):
1. Text content của link → trả về "5" (số thứ tự) ← dừng ở đây
2. data-content → trả về "41558917" (ID thực) ← không bao giờ được gọi
```

## Files Changed
- `lib/scrapers/xf2-scraper.ts`

## Fix
Đổi thứ tự ưu tiên trong `extractPostNumber()`:

```
1. data-content="post-{ID}" trên <article>  → post ID thực ✅ (ưu tiên cao nhất)
2. href của attribution link (#post-{ID})   → post ID thực ✅ (fallback)
3. Text content của link (#5)              → số thứ tự ⚠️ (last resort)
```

## Self-review Results
- Issues found: 0
- Issues fixed: 0
- Remaining: none

## Notes
- Posts đã cache cũ lưu số thứ tự sai → link sẽ không hoạt động đúng với cache cũ
- Re-scrape topic để có postNumber đúng
- XF1Scraper không bị ảnh hưởng (dùng `id="post-{ID}"` attribute trực tiếp)
