# Bug Fix: Post URL Thiếu Page Number

## Problem
URL link bài viết chỉ đúng cho trang 1. Bài viết ở các trang sau cần có `/page-N` trong URL:
- Đúng (page 1): `https://voz.vn/t/topic.123456/#post-41565134`
- Đúng (page 3): `https://voz.vn/t/topic.123456/page-3#post-41137424`
- Sai (trước fix): `https://voz.vn/t/topic.123456/#post-41137424` (missing `/page-3`)

## Root Cause
`ScrapedPost` không lưu thông tin page. Không có cách nào biết bài viết nằm ở trang nào.

## Files Changed
- `lib/types.ts`
- `lib/scrapers/page-loader.ts`
- `entrypoints/sidepanel/components/SummaryContent.vue`
- `entrypoints/sidepanel/views/SummaryView.vue`
- `entrypoints/sidepanel/views/KnowledgeView.vue`

## Changes

### lib/types.ts
- Thêm `page?: number` vào `ScrapedPost` (optional để backward compat với cache cũ)

### lib/scrapers/page-loader.ts
- Trong `scrapePageRange`, sau khi scrape mỗi trang: `allPosts.push(...pageData.posts.map(p => ({ ...p, page })))`
- Mỗi post được tag với page number ngay tại source

### SummaryContent.vue
- `openPostLink()` lookup `postPageMap[postNumber]` để lấy page, build URL với `/page-N` khi `page > 1`

### SummaryView.vue
- Computed `postPageMap`: `Record<number, number>` từ tất cả posts trong cache
- Pass xuống `<SummaryContent>`

### KnowledgeView.vue
- `openPostLink()` lookup `allPosts` để lấy `page`, build URL đúng

## Notes
- Posts đã cache cũ không có `page` field → fallback về no-page-segment (URL không có `/page-N`, chỉ đúng cho page 1)
- Re-scrape topic để có page info đúng

## Self-review Results
- Issues found: 0
- Issues fixed: 0
- Remaining: none
