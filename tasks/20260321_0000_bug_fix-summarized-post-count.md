# Bug Fix: Lưu và hiển thị đúng số bài viết đã tóm tắt

Ngày: 2026-03-21
Planning: `planning/20260320_2323_fix-summarized-post-count.md`

---

## Vấn đề

`summarizedPostCount` là `ref` volatile, bị reset khi chuyển topic và được load lại từ `totalPosts`. Tuy nhiên `totalPosts` dùng chung cho 2 mục đích (hiển thị + freshness check), và bao gồm cả article posts (postNumber < 0) nên count hiển thị sai.

---

## Thay đổi đã thực hiện

### `lib/types.ts`
- Thêm `summarizedPostCount?: number` vào `CachedTopic` interface (sau `totalPosts`)

### `entrypoints/background/index.ts`
- Trong handler `SAVE_CACHED_TOPIC`: thêm merge `summarizedPostCount` với fallback backward-compatible:
  ```ts
  summarizedPostCount: partial.summarizedPostCount ?? existing?.summarizedPostCount ?? partial.totalPosts ?? existing?.totalPosts ?? 0,
  ```

### `entrypoints/sidepanel/views/SummaryView.vue`

**Bỏ `ref`, dùng `computed`:**
```ts
// Trước:
const summarizedPostCount = ref(0);

// Sau:
const summarizedPostCount = computed(() => {
  if (!cachedTopic.value) return 0;
  return cachedTopic.value.summarizedPostCount ?? cachedTopic.value.totalPosts ?? 0;
});
```

**Xóa tất cả manual assignments** (reset block, loadTopicData, confirmSummarize, generateOverallSummary):
- `summarizedPostCount.value = 0;` — XÓA (computed tự reset khi `cachedTopic` = null)
- `summarizedPostCount.value = topic.totalPosts;` — XÓA
- `summarizedPostCount.value = fresh.totalPosts;` — XÓA
- `summarizedPostCount.value = posts.length;` — XÓA
- `summarizedPostCount.value = segmentSummaries...` — XÓA

**`confirmSummarize()` — lọc article posts:**
- Tính `realPostCount = posts.filter(p => p.postNumber > 0).length`
- Dùng cho cả `totalPosts` và `summarizedPostCount` trong `SAVE_CACHED_TOPIC` (cả stale guard và normal path)
- `store.updateSelectedTopic(...)` dùng `totalPosts: realPostCount`

**`handleSummarizeSegment()` — thêm field:**
- Thêm `summarizedPostCount: updated.reduce(...)` vào `SAVE_CACHED_TOPIC`

**`generateOverallSummary()` — hoàn chỉnh save + re-fetch:**
- Tính `totalSummarized = segmentSummaries.reduce(postCount)` trước khi save
- Cả stale guard lẫn normal path đều lưu `summarizedPostCount: totalSummarized`
- Sau save: re-fetch từ IndexedDB (`GET_CACHED_TOPIC`) → `cachedTopic.value = saved` để computed cập nhật ngay

---

## Kết quả

- `npx vue-tsc --noEmit` ✅ pass
- `npm run build` ✅ pass (7.68 MB)
- `summarizedPostCount` giờ là computed đọc từ cache — không volatile, không bị reset sai
- Số bài đã tóm tắt hiển thị đúng: không đếm article posts (postNumber < 0)
- Backward compatible: topic cũ chưa có `summarizedPostCount` fallback về `totalPosts`
