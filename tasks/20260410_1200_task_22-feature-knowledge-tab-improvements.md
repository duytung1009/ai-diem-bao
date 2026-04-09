# Task: Feature 22 — Knowledge Tab Improvements

## Summary

Cải tiến tab Kiến thức với 5 tính năng: collapse/expand entries, hiển thị ngày đăng, save/unsave entry, filter "Đã lưu", và re-extract incremental (chỉ extract posts mới, track deleted posts).

## Files Changed

| File | Thay đổi |
|------|----------|
| `lib/types.ts` | Thêm `saved?: boolean` vào `KnowledgeEntry`; `source.timestamp?: string`; thêm `lastKnowledgePostNumber?`, `excludedKnowledgePostNumbers?` vào `CachedTopic` |
| `entrypoints/background/index.ts` | Merge 2 fields mới với `!== undefined` check (thay `??`) trong SAVE_CACHED_TOPIC handler |
| `entrypoints/sidepanel/views/KnowledgeView.vue` | Toàn bộ UI + logic: collapse/expand, save/delete, saved filter, timestamp display, incremental re-extract, clear tracking |
| `entrypoints/sidepanel/views/TopicHubView.vue` | Thêm `excludedKnowledgePostNumbers` spread trong topic update watcher để tránh readonly type conflict |

## Implementation Details

### Collapse/expand (QD2)
- State: `expandedIds = ref<Set<string>>(new Set())` — mặc định tất cả collapsed.
- Animation CSS Grid (`grid-rows-[0fr]`/`grid-rows-[1fr]`, `transition-[grid-template-rows] duration-200`) — cùng pattern với `AccordionItem.vue`.
- Reset về `new Set()` khi load topic mới hoặc sau extract.

### Save/unsave
- `saved?: boolean` inline trong `KnowledgeEntry` (QD1).
- Click bookmark icon → toggle `saved` flag → persist qua `SAVE_CACHED_TOPIC`.
- Filter "Đã lưu (N)" pill chỉ hiện khi `savedCount > 0`.

### Delete + tracking
- Xóa entry khỏi `entries` và thêm `postNumber` vào `excludedKnowledgePostNumbers`.
- "Xóa tracking (N)" button chỉ hiện khi `excludedCount > 0`.
- `handleClearTracking` reset cả `excludedKnowledgePostNumbers: []` và `lastKnowledgePostNumber: 0` (QD5).

### Incremental re-extract (QD3, QD4)
- Filter posts: `p.postNumber > lastPostNum && !excludedNums.has(p.postNumber)`.
- Merge strategy theo `lastPostNum`:
  - `< 0` (chưa extract): replace với entries mới.
  - `> 0` (incremental): append mới vào sau cũ (giữ toàn bộ).
  - `=== 0` (sau clear tracking): giữ saved + append mới, dedup by postNumber.
- Persist `lastKnowledgePostNumber = Math.max(...allPosts.map(p => p.postNumber))` sau mỗi extract.

### Timestamp enrich (QD6)
- Sau khi nhận entries từ LLM, lookup `allPosts.find(p => p.postNumber === e.source.postNumber)?.timestamp`.
- Frontend-only, không đưa timestamp vào prompt LLM.
- `formatTimestamp(ts)`: `toLocaleDateString('vi-VN')`, fallback raw string nếu parse fail.

### Background merge (!== undefined)
- `lastKnowledgePostNumber` và `excludedKnowledgePostNumbers` dùng `!== undefined` thay `??` để clearing về `0` hoặc `[]` không bị bỏ qua.

## Self-review Results

- Issues found: 0
- Issues fixed: 0
- Remaining: không có

### Checklist
| Category | Status | Notes |
|----------|--------|-------|
| Logic correctness | ✅ | Merge strategy 3 nhánh đúng với từng state (first/incremental/post-clear) |
| Edge cases covered | ✅ | Empty postsToExtract → thông báo; news posts (postNumber < 0) bị filter tự nhiên; legacy entries (không có `saved`/`timestamp`) hoạt động graceful |
| Error handling | ✅ | `handleExtract` có try-catch; tất cả `sendMessage` side-effects có `.catch(() => {})` hoặc `.catch(() => null)` |
| Performance concerns | ✅ | Không có change |
| Security implications | N/A | |
| Consistency with patterns | ✅ | Follows existing composable/messaging pattern; CSS Grid animation từ AccordionItem.vue |
| Type safety | ✅ | Không dùng `any`; readonly cast issue ở `topic.knowledgeEntries` được fix bằng `as KnowledgeEntry[]` |
| Test coverage | N/A | Manual test plan trong planning file |
