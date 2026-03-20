# Bug Fix: Stale save mất metadata topic

Ngày: 2026-03-21
Planning: `planning/20260321_0337_fix-stale-save-missing-metadata.md`

---

## Vấn đề đã fix

Sau khi tóm tắt segment và user chuyển sang topic khác rồi quay lại → topic hiện "0 bài viết", "1 trang", "unknown", normal mode thay vì segment mode, nội dung biến mất.

Root cause: stale guard branches trong `SummaryView.vue` thiếu metadata khi save, và các nhánh non-stale dùng `topicInfo.value` (computed từ store) thay vì `topic` (captured snapshot).

---

## File đã sửa

### `entrypoints/sidepanel/views/SummaryView.vue`

**Fix 1 — `handleSummarizeSegment()` stale branch:** thêm `title`, `version`, `totalPages`, `totalPosts`, `summarizedPostCount` vào SAVE_CACHED_TOPIC (trước chỉ gửi `url + segments`).

**Fix 2 — `handleSummarizeSegment()` non-stale branch:** thay `topicInfo.value!.title/version/pageCount` → `topic.title/version/totalPages` (captured snapshot). Extract `segTotalPosts` để tránh lặp reduce.

**Fix 3 — `confirmSummarize()` stale branch:** thay `topicInfo.value!.title/version/pageCount` → `topic.title/version/totalPages`.

**Fix 4 — `confirmSummarize()` non-stale branch:** thay `topicInfo.value.title/version/pageCount` → `topic.title/version/totalPages` trong cả SAVE_CACHED_TOPIC và `store.updateSelectedTopic()`.

**Fix 5 — `generateOverallSummary()` stale branch:** thêm `title`, `version`, `totalPages` vào SAVE_CACHED_TOPIC (trước chỉ gửi `url + summary + summarizedPostCount`).

---

## Nguyên tắc áp dụng

Mọi save vào cache phải dùng `topic` (captured snapshot ở đầu function), KHÔNG BAO GIỜ dùng `topicInfo.value` hay bất kỳ computed nào đọc từ store — vì khi stale, store đã chuyển sang topic khác.

---

## Verification

- `npx vue-tsc --noEmit` → pass (0 errors)
- `npm run build` → pass (341.35 kB, 8.6s)
