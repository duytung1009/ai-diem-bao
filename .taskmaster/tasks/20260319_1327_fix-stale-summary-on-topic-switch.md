# Fix: SummaryView hiển thị tóm tắt cũ khi chọn topic chưa tóm tắt

## Vấn đề
Khi user chọn topic B (chưa có summary) sau khi đã xem topic A (có summary), SummaryView vẫn hiển thị nội dung summary của topic A. Nguyên nhân: `<keep-alive>` giữ SummaryView tồn tại xuyên suốt session, các `ref()` không bị reset khi chuyển topic.

## Root Cause
`loadTopicData()` chỉ **gán** `summary.value` khi `topic.summary` tồn tại, nhưng **không reset** khi topic mới chưa có summary → giá trị cũ từ topic trước bị giữ nguyên.

## Fix áp dụng

**File:** `entrypoints/sidepanel/views/SummaryView.vue` — function `loadTopicData()` (dòng 69)

Thêm block reset toàn bộ view state ở đầu hàm, **trước** `loadedTopicUrl.value = topic.url`:

```typescript
// === RESET all view state for new topic ===
summary.value = '';
error.value = '';
loadingText.value = '';
summarizedPostCount.value = 0;
isScraping.value = false;
scrapingWarnings.value = [];
pendingPosts.value = null;
pendingIncremental.value = false;
cachedTopic.value = null;
cacheFreshness.value = null;
// === END RESET ===
```

Các ref được reset:
- `summary` — nội dung tóm tắt
- `error` — error message từ topic trước
- `loadingText` — trạng thái loading
- `summarizedPostCount` — số bài đã tóm tắt
- `isScraping` — trạng thái đang scrape
- `scrapingWarnings` — warnings từ topic trước
- `pendingPosts` — pending confirmation từ topic trước
- `pendingIncremental` — mode incremental pending
- `cachedTopic` — topic cached (dùng cho CacheIndicator)
- `cacheFreshness` — trạng thái cache

## Verification
- `npx vue-tsc --noEmit` → pass (no errors)
- `npm run build` → pass (308.75 kB)
