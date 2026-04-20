# Bug Fix: Segment mode metadata mất khi quay lại topic

**Ngày:** 2026-03-21
**Planning:** `planning/20260321_0500_fix-segment-mode-metadata-lost-on-return.md`
**Status:** ✅ DONE

---

## Root Cause

`loadTopicData()` trong SummaryView fetch data mới từ IndexedDB (`GET_CACHED_TOPIC`) nhưng không sync về `store.selectedTopic`. `topicInfo` và `isSegmentMode` computed đọc từ store → vẫn dùng data cũ (sai) từ `allTopics`.

Nguyên nhân phụ: TopicHubView watch dùng strict `===` so sánh URL → không khớp normalized vs raw URL → store không cập nhật khi topic trong allTopics có URL dạng khác.

---

## Thay đổi

### 1. `entrypoints/sidepanel/views/SummaryView.vue`

Sau `cachedTopic.value = fresh` trong `loadTopicData()`, thêm:

```ts
store.updateSelectedTopic({
  totalPages: fresh.totalPages,
  totalPosts: fresh.totalPosts,
  version: fresh.version,
  title: fresh.title,
});
```

→ `topicInfo.pageCount` đọc đúng từ IndexedDB → `isSegmentMode` đúng → segment mode UI hiển thị đúng ngay khi chọn topic từ danh sách.

### 2. `entrypoints/sidepanel/views/TopicHubView.vue`

Watch `store.selectedTopic`, dòng 116:

```ts
// TRƯỚC:
const idx = allTopics.value.findIndex(t => t.url === updated.url);

// SAU:
const idx = allTopics.value.findIndex(t => isSameTopicUrl(t.url, updated.url));
```

→ URL normalize-aware comparison → watch cập nhật `allTopics` đúng kể cả khi URL raw vs normalized khác nhau.

---

## Verification

- `npx vue-tsc --noEmit` → pass ✅
- `npm run build` → pass (341.51 kB) ✅
