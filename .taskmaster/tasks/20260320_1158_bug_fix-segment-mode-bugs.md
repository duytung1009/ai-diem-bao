# Bug Fix: 3 Lỗi Segment Mode

Ngày: 2026-03-20

---

## Tóm tắt

Đã fix 3 bug trong segment mode (topic dài > N trang) theo planning `planning/20260320_1148_fix-segment-mode-bugs.md`.

---

## Bug 1 — Topic version "unknown" sau khi tóm tắt segment đầu tiên

**File:** `entrypoints/sidepanel/views/SummaryView.vue`
**Function:** `handleSummarizeSegment()`

**Root cause:** `SAVE_CACHED_TOPIC` chỉ gửi `url` + `segments` → với topic mới chưa cache, `version/title/totalPages` không được lưu → fallback `'unknown'`.

**Fix:** Gửi đầy đủ metadata khi save:
```ts
await sendMessage('SAVE_CACHED_TOPIC', {
  url: topic.url,
  title: topicInfo.value!.title,
  version: topicInfo.value!.version,
  totalPages: topicInfo.value!.pageCount,
  totalPosts: updated.reduce((s, seg) => s + (seg?.postCount ?? 0), 0),
  segments: updated,
});
store.updateSelectedTopic({
  title: topicInfo.value!.title,
  version: topicInfo.value!.version,
  totalPages: topicInfo.value!.pageCount,
  segments: updated,
} as any);
```

---

## Bug 2 — Duplicate items trong TopicHubView khi đang tóm tắt segment

**File:** `entrypoints/sidepanel/views/TopicHubView.vue`
**Computed:** `summarizingTempTopic`

**Root cause:** So sánh `t.url === url` bằng strict equality, nhưng `SAVE_CACHED_TOPIC` normalize URL trước khi save → mismatch → `alreadyInList = false` → temp topic render song song với topic đã save vào IndexedDB.

**Fix:** Dùng `normalizeForCompare()` có sẵn trong file:
```ts
// Trước:
const alreadyInList = allTopics.value.some(t => t.url === url);
// Sau:
const alreadyInList = allTopics.value.some(t => normalizeForCompare(t.url) === normalizeForCompare(url));
```

---

## Bug 3 — CacheIndicator update re-scrape toàn bộ thay vì update segments

**File:** `entrypoints/sidepanel/views/SummaryView.vue`

**Root cause:** Template segment mode gọi `@update="handleSummarize(true)"` — đây là flow incremental dành cho normal mode, không biết segment boundaries → re-scrape toàn bộ.

**Fix:**
1. Thêm function `handleSegmentUpdate()` — xác định segments nào cần update (chưa tóm tắt hoặc segment cuối bị mở rộng), tóm tắt lần lượt, sau đó `generateOverallSummary()`.
2. Đổi template: `@update="handleSegmentUpdate"`.

Logic `handleSegmentUpdate()`:
- So sánh `coveredEndPage` (endPage của segment cuối hiện tại) vs `topicInfo.pageCount` (live).
- Nếu không có trang mới → chỉ re-generate overall.
- Nếu có: duyệt `segments.value`, tìm segment nào `!existing?.summary || existing.endPage < seg.end` → thêm vào queue.
- Gọi `handleSummarizeSegment(idx)` lần lượt, dừng nếu lỗi.
- Sau khi hoàn tất, `generateOverallSummary()` nếu >= 2 segments.

---

## Kết quả

- `npx vue-tsc --noEmit` → ✅ pass (no errors)
- `npm run build` → ✅ pass (321 kB)

## Files thay đổi

| File | Thay đổi |
|------|----------|
| `entrypoints/sidepanel/views/SummaryView.vue` | Bug 1: metadata đầy đủ khi save segment; Bug 3: thêm `handleSegmentUpdate()`, đổi `@update` handler |
| `entrypoints/sidepanel/views/TopicHubView.vue` | Bug 2: `normalizeForCompare` thay `===` trong `summarizingTempTopic` |
