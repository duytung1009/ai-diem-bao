# Fix: Stale save mất metadata topic (version, totalPages, totalPosts)

Ngày: 2026-03-21

---

## Bug

Sau khi scrape + tóm tắt trang 1-20 của topic > 20 trang, nếu user chuyển sang topic khác rồi quay lại → topic ban đầu hiện:
- "0 bài viết", "1 trang", "unknown"
- Normal mode thay vì segment mode
- Nội dung tóm tắt biến mất (chỉ hiện nút "Tóm tắt")

Khi mở URL topic trên tab trình duyệt → detect cập nhật store → UI chuyển đúng về segment mode.

---

## Root Cause

Có **2 vấn đề** trong stale guard branches:

### Vấn đề 1: `handleSummarizeSegment()` stale branch thiếu metadata

Dòng 558-560:
```ts
if (thisId !== activeSummarizeId) {
  await sendMessage('SAVE_CACHED_TOPIC', {
    url: topic.url,
    segments: updated,
    // ← THIẾU: title, version, totalPages, totalPosts
  }).catch(() => {});
  return;
}
```

Background handler `SAVE_CACHED_TOPIC` khi `existing = null` (topic mới chưa cache):
```ts
title: partial.title ?? existing?.title ?? '',          // → ''
version: partial.version ?? existing?.version ?? 'unknown', // → 'unknown'
totalPosts: partial.totalPosts ?? existing?.totalPosts ?? 0, // → 0
totalPages: partial.totalPages ?? existing?.totalPages ?? 1, // → 1
```

→ Topic lưu với metadata sai → TopicHubView hiện "0 bài viết", "1 trang", "unknown".

### Vấn đề 2: `confirmSummarize()` stale branch dùng `topicInfo.value` (sai topic)

Dòng 460-473:
```ts
if (thisId !== activeSummarizeId) {
  await sendMessage('SAVE_CACHED_TOPIC', {
    url: topic.url,            // ✅ captured snapshot → topic A
    title: topicInfo.value!.title,   // ❌ computed từ store → đã là topic B!
    version: topicInfo.value!.version, // ❌ topic B
    totalPages: topicInfo.value!.pageCount, // ❌ topic B
    // ...
  }).catch(() => {});
```

`topicInfo` là computed từ `store.selectedTopic.value`. Khi stale, store đã chuyển sang topic B → `topicInfo` chứa data topic B → lưu metadata topic B vào cache topic A.

### Vấn đề 3: Non-stale branches cũng dùng `topicInfo.value`

Dòng 483-490 (confirmSummarize non-stale), 568-569 (handleSummarizeSegment non-stale):
```ts
title: topicInfo.value.title,
version: topicInfo.value.version,
totalPages: topicInfo.value.pageCount,
```

Nếu `thisId === activeSummarizeId` → store chưa bị chuyển → `topicInfo` đúng. **Nhưng** nếu chỉ dùng `topic` (captured snapshot) sẽ an toàn hơn và nhất quán. `topic` được capture ở đầu function, không phụ thuộc vào state hiện tại của store.

---

## Fix

**Nguyên tắc:** Mọi save vào cache phải dùng `topic` (captured snapshot), KHÔNG BAO GIỜ dùng `topicInfo.value` hay bất kỳ computed nào đọc từ store.

### File: `entrypoints/sidepanel/views/SummaryView.vue`

#### Fix 1: `handleSummarizeSegment()` — stale branch thêm metadata

Dòng 558-560, đổi thành:

```ts
if (thisId !== activeSummarizeId) {
  await sendMessage('SAVE_CACHED_TOPIC', {
    url: topic.url,
    title: topic.title,                // ← từ captured snapshot
    version: topic.version,             // ← từ captured snapshot
    totalPages: topic.totalPages,       // ← từ captured snapshot
    totalPosts: updated.reduce((s, seg) => s + (seg?.postCount ?? 0), 0),
    summarizedPostCount: updated.reduce((s, seg) => s + (seg?.postCount ?? 0), 0),
    segments: updated,
  }).catch(() => {});
  return;
}
```

#### Fix 2: `handleSummarizeSegment()` — non-stale branch dùng `topic` thay `topicInfo.value`

Dòng 566-575, đổi:

```ts
// TRƯỚC:
await sendMessage('SAVE_CACHED_TOPIC', {
  url: topic.url,
  title: topicInfo.value!.title,
  version: topicInfo.value!.version,
  totalPages: topicInfo.value!.pageCount,
  totalPosts: updated.reduce((s, seg) => s + (seg?.postCount ?? 0), 0),
  summarizedPostCount: updated.reduce((s, seg) => s + (seg?.postCount ?? 0), 0),
  segments: updated,
});
store.updateSelectedTopic({
  title: topicInfo.value!.title,
  version: topicInfo.value!.version,
  totalPages: topicInfo.value!.pageCount,
  segments: updated,
} as any);

// SAU:
const segTotalPosts = updated.reduce((s, seg) => s + (seg?.postCount ?? 0), 0);
await sendMessage('SAVE_CACHED_TOPIC', {
  url: topic.url,
  title: topic.title,
  version: topic.version,
  totalPages: topic.totalPages,
  totalPosts: segTotalPosts,
  summarizedPostCount: segTotalPosts,
  segments: updated,
});
store.updateSelectedTopic({
  title: topic.title,
  version: topic.version,
  totalPages: topic.totalPages,
  segments: updated,
} as any);
```

#### Fix 3: `confirmSummarize()` — stale branch dùng `topic` thay `topicInfo.value`

Dòng 460-473, đổi:

```ts
if (thisId !== activeSummarizeId) {
  const lastPost = posts[posts.length - 1];
  const realPostCount = posts.filter(p => p.postNumber > 0).length;
  await sendMessage('SAVE_CACHED_TOPIC', {
    url: topic.url,
    title: topic.title,              // ← FIX: topic snapshot, không phải topicInfo
    version: topic.version,           // ← FIX
    posts,
    summary: summaryText,
    lastPostNumber: lastPost?.postNumber ?? 0,
    totalPosts: realPostCount,
    summarizedPostCount: realPostCount,
    totalPages: topic.totalPages,     // ← FIX
  }).catch(() => {});
  return;
}
```

#### Fix 4: `confirmSummarize()` — non-stale branch dùng `topic` thay `topicInfo.value`

Dòng 481-492, đổi:

```ts
// TRƯỚC:
await sendMessage('SAVE_CACHED_TOPIC', {
  url: topic.url,
  title: topicInfo.value.title,
  version: topicInfo.value.version,
  // ...
  totalPages: topicInfo.value.pageCount,
});
store.updateSelectedTopic({ ..., totalPages: topicInfo.value.pageCount });

// SAU:
await sendMessage('SAVE_CACHED_TOPIC', {
  url: topic.url,
  title: topic.title,
  version: topic.version,
  posts,
  summary: summaryText,
  lastPostNumber: lastPost?.postNumber ?? 0,
  totalPosts: realPostCount,
  summarizedPostCount: realPostCount,
  totalPages: topic.totalPages,
});
store.updateSelectedTopic({ summary: summaryText, posts, totalPosts: realPostCount, totalPages: topic.totalPages });
```

#### Fix 5: `generateOverallSummary()` — stale branch thêm metadata

Dòng 618-624 (stale branch, nếu có):

```ts
if (thisId !== activeSummarizeId) {
  const totalSummarized = segmentSummaries.value.reduce((s, seg) => s + (seg?.postCount ?? 0), 0);
  await sendMessage('SAVE_CACHED_TOPIC', {
    url: topic.url,
    title: topic.title,
    version: topic.version,
    totalPages: topic.totalPages,
    summary: result.summary,
    summarizedPostCount: totalSummarized,
  }).catch(() => {});
  return;
}
```

---

## Tóm tắt nguyên tắc

| | Trước (lỗi) | Sau (fix) |
|---|---|---|
| Nguồn metadata khi save | `topicInfo.value` (computed từ store) | `topic` (captured snapshot ở đầu function) |
| Stale branch metadata | Thiếu hoặc sai (từ topic khác) | Đầy đủ + đúng topic |
| Nhất quán | Non-stale dùng `topicInfo`, stale thiếu | Cả hai dùng `topic` snapshot |

Chỉ sửa 1 file: `entrypoints/sidepanel/views/SummaryView.vue`

---

## Verification

1. `npx vue-tsc --noEmit` + `npm run build` → pass
2. **Kịch bản chính:** Mở topic 30 trang → tóm tắt trang 1-20 → quay lại danh sách → xem topic khác → quay lại topic ban đầu → hiện đúng version, totalPages, totalPosts, segment mode + nội dung đã tóm tắt
3. **Không cần mở URL trên trình duyệt:** Topic info hiển thị đúng ngay khi chọn từ danh sách
4. **confirmSummarize stale:** Tóm tắt topic A → chuyển sang topic B khi LLM đang chạy → quay lại A → metadata đúng (không lẫn data topic B)
5. **Normal mode:** Tóm tắt topic nhỏ → chuyển topic → quay lại → metadata đúng
