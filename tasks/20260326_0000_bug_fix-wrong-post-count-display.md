# Bug Fix: Wrong Post Count Display (20 thay vì số bài thực tế)

**Ngày:** 2026-03-26
**Planning file:** `planning/20260325_2143_fix-wrong-post-count-display.md`

## Summary

Khi user click "Tóm tắt lại" sau khi đã tóm tắt 1 lần, `START_LLM_TASK` payload chỉ có 20 bài (trang hiện tại) thay vì 64+ bài đã cache. Kết quả: số bài viết hiển thị sai + chất lượng tóm tắt kém.

## Root Cause

1. `loadTopicData()` không sync `posts` vào store → `store.selectedTopic.value.posts = []` khi topic được re-select qua `minimalTopic`
2. `loadTopicData()` không được gọi khi URL không đổi → store giữ `posts = []`
3. `handleSummarize()` check `topic.posts?.length > 0` → false → scraping path
4. `detect.pageCount = 1` (XF1 fallback) → chỉ scrape 1 trang → 20 bài

## Changes

**File:** `entrypoints/sidepanel/views/SummaryView.vue` — 3 chỗ

### Fix 1 (Critical) — Dùng `cachedTopic.value.posts` thay `topic.posts`

```typescript
// Trong handleSummarize(), trước scraping path
const cachedPosts = cachedTopic.value?.posts?.length
  ? cachedTopic.value.posts
  : topic.posts ?? [];
if (cachedPosts.length > 0 && !incremental) {
  pendingPosts.value = [...cachedPosts];
  pendingIncremental.value = false;
  return;
}
```

### Fix 2 (Important) — Sync `posts` từ IndexedDB vào store

```typescript
store.updateSelectedTopic({
  totalPages: fresh.totalPages,
  totalPosts: fresh.totalPosts,
  summarizedPostCount: fresh.summarizedPostCount,
  version: fresh.version,
  title: fresh.title,
  posts: fresh.posts,    // ← thêm
});
```

### Fix 3 (Safety net) — `pageCount = Math.max(detected, cached)`

```typescript
const detectedPageCount = detectMatchesTopic ? (store.activeTabDetect.value?.pageCount ?? 1) : 1;
const cachedPageCount = topic.totalPages ?? 1;
const pageCount = Math.max(detectedPageCount, cachedPageCount);
```

## Self-review Results

- Issues found: 0
- Issues fixed: 0
- Remaining: none

Type check: `npx vue-tsc --noEmit` → PASS
