# Task: Feature 21 — News Topic Auto-Detection & Badge

## Summary

Tự động phát hiện chủ đề tin tức (news thread) và hiển thị badge "Tin tức" trong UI. Đồng thời refactor vị trí button "Cập nhật" và CacheIndicator trong SummaryView.

## Files Changed

| File | Thay đổi |
|------|----------|
| `entrypoints/sidepanel/composables/useSummarize.ts` | Thêm `detectAndCacheTopicType()`, `isNewsTopic` computed, tích hợp news enrichment khi summarize |
| `entrypoints/sidepanel/views/SummaryView.vue` | Hiển thị isNews badge, di chuyển CacheIndicator vào header row, thêm button "Cập nhật" ở actions row |
| `entrypoints/sidepanel/components/CacheIndicator.vue` | Gỡ bỏ button "Cập nhật" và `newPostCount` computed (chuyển lên SummaryView) |
| `entrypoints/sidepanel/components/TopicMeta.vue` | Thêm `isNews` prop, hiển thị badge "Tin tức" |
| `entrypoints/sidepanel/views/TopicHubView.vue` | Thêm `title` attribute cho topic button (tooltip on hover) |

## Implementation Details

### detectAndCacheTopicType() — fire-and-forget
- Fetch page 1 silently bằng `scrapePageRange` để detect xem topic có phải news thread không.
- Chỉ persist vào cache nếu topic đã có summary trước đó.
- Guard: kiểm tra `isSameTopicUrl` trước khi ghi để tránh race condition.
- Update in-memory `cachedTopic` ngay lập tức để badge hiển thị ngay.

### isNewsTopic computed
- Derive từ `cachedTopic.value?.topicType === 'news'`.
- Exposed ra từ `useSummarize` để SummaryView + TopicMeta dùng.

### News enrichment khi summarize (segment 0)
- Gọi `enrichWithNewsArticles()` cho segment đầu tiên.
- Nếu phát hiện news posts (postNumber < 0), cập nhật `topicType: 'news'` vào cachedTopic và persist qua `saveTopic`.

### CacheIndicator refactor
- Xóa button "Cập nhật" ra khỏi CacheIndicator component (component giờ chỉ hiển thị thông tin freshness).
- SummaryView: đặt CacheIndicator inline với post count header (justify-between).
- Button "Cập nhật" trong segment mode actions bar, kèm `newPostCount` computed từ SummaryView.

### postCount fix
- Dùng `countRealPosts()` thay vì `segPosts.length` để không tính các news article posts (postNumber < 0).

### Type safety
- `saveTopic` signature đổi từ `CachedTopic` → `DeepReadonly<CachedTopic>`.
- Gỡ toàn bộ `as CachedTopic` cast dư thừa.

## Self-review Results

- Issues found: 0
- Issues fixed: 0
- Remaining: không có

### Checklist
| Category | Status | Notes |
|----------|--------|-------|
| Logic correctness | ✅ | Guard conditions đầy đủ, fire-and-forget detection có race condition guard |
| Edge cases covered | ✅ | Topic chưa summarize không persist type; guard `isSameTopicUrl` tránh stale write |
| Error handling | ✅ | `detectAndCacheTopicType` có try-catch; `enrichWithNewsArticles` có try-catch; saveTopic có `.catch(() => {})` |
| Performance concerns | ✅ | Detection là fire-and-forget, không block UI |
| Security implications | N/A | |
| Consistency with patterns | ✅ | Follows existing composable pattern |
| Type safety | ✅ | `DeepReadonly<CachedTopic>` thay `CachedTopic`, xóa bỏ unsafe cast |
| Test coverage | N/A | |
