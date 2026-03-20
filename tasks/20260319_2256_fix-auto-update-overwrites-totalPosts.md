# Fix: autoUpdateCachedTopic ghi đè totalPosts

## Bug
`autoUpdateCachedTopic()` trong `App.vue` cập nhật `totalPosts = detect.postCount` vào cache mỗi khi phát hiện số bài thay đổi. Điều này ghi đè giá trị "số bài đã tóm tắt", khiến `evaluateFreshness()` nghĩ cache đã fresh khi user quay lại topic.

**Scenario lỗi:**
- Cache: 90 bài (đã tóm tắt), live: 100 bài → CacheIndicator: "10 bài mới" ✅
- User rời sang topic khác rồi quay lại → `autoUpdateCachedTopic` đã ghi `totalPosts=100` vào cache
- `evaluateFreshness(100, 100)` → fresh → CacheIndicator: "đã cập nhật" ❌

## Fix (1 file)

**`entrypoints/sidepanel/App.vue`** — hàm `autoUpdateCachedTopic()`:

- Bỏ `totalPosts` khỏi điều kiện `hasChanges`
- Bỏ `totalPosts` khỏi `saveCachedTopic()` call
- Bỏ `totalPosts` khỏi `store.updateSelectedTopic()` call
- Thêm comment giải thích lý do

`totalPosts` trong cache giờ chỉ được cập nhật khi user thực sự tóm tắt lại (incremental hoặc full), đảm bảo `evaluateFreshness()` so sánh đúng với live count.

## Verification
- `npx vue-tsc --noEmit` → pass ✅
