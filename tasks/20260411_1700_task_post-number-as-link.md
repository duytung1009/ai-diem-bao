# Task: Post Number as Clickable Link

## Summary
Convert `#postNumber` trong citation của tóm tắt và knowledge tab thành link có thể click, mở trực tiếp bài viết trên forum.

## Files Changed
- `entrypoints/sidepanel/components/SummaryContent.vue`
- `entrypoints/sidepanel/views/SummaryView.vue`
- `entrypoints/sidepanel/views/KnowledgeView.vue`

## Changes

### SummaryContent.vue
- Thêm props `topicUrl?: string` và `postPageMap?: Record<number, number>`
- Thêm `openPostLink(postNumber)`: build URL đúng từ `topicUrl` + page + postNumber → `browser.tabs.create()`
- `#postNumber` trong `<cite>` hiển thị là `<button>` clickable khi có `topicUrl`, fallback về `<span>` nếu không

### SummaryView.vue
- Computed `postPageMap`: scan tất cả posts trong `cachedTopic` (top-level + segments), build map `postNumber → page`
- Pass `:topic-url` và `:post-page-map` xuống cả 3 chỗ dùng `<SummaryContent>`

### KnowledgeView.vue
- Thêm `openPostLink(postNumber)`: lookup post trong `allPosts` để lấy `page`, build URL đúng
- `#postNumber` trong citation hiển thị là `<button>` clickable

## URL Format
- Page 1: `{topicUrl}#post-{id}`
- Page N > 1: `{topicUrl}page-{N}#post-{id}`

## Self-review Results
- Issues found: 1 (ban đầu dùng `topicInfo?.url` nhưng `DetectResult` không có `url` field → TS error)
- Issues fixed: 1 (đổi sang `cachedTopic?.url`)
- Remaining: none
