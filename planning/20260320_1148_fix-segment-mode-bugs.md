# Fix: 3 Bug trong Segment Mode

Ngày: 2026-03-20

---

## Context

Segment mode chia topic dài (> N trang) thành nhiều phần, tóm tắt từng phần rồi tạo tóm tắt tổng quan. Hiện có 3 bug ảnh hưởng luồng hoạt động chính.

---

## Bug 1: Topic version chuyển thành "unknown" khi tóm tắt từng phần

### Triệu chứng
Sau khi tóm tắt segment đầu tiên của topic mới (chưa từng cache), quay lại rồi vào lại → `topicInfo.version = 'unknown'`.

### Root Cause
`handleSummarizeSegment()` trong `SummaryView.vue` dòng 516 chỉ gửi `url` + `segments`:

```ts
await sendMessage('SAVE_CACHED_TOPIC', { url: topic.url, segments: updated });
```

Trong `SAVE_CACHED_TOPIC` handler (background/index.ts dòng 126):
```ts
version: partial.version ?? existing?.version ?? 'unknown',
```

Với topic mới chưa cache: `partial.version = undefined`, `existing = null` → fallback `'unknown'`.

### Fix
File: `entrypoints/sidepanel/views/SummaryView.vue`, function `handleSummarizeSegment()` dòng 516.

Gửi đầy đủ metadata khi save segment:

```ts
await sendMessage('SAVE_CACHED_TOPIC', {
  url: topic.url,
  title: topicInfo.value!.title,
  version: topicInfo.value!.version,
  totalPages: topicInfo.value!.pageCount,
  totalPosts: segPosts.length + segmentSummaries.value.reduce((s, seg) => s + (seg?.postCount ?? 0), 0),
  segments: updated,
});
```

Tương tự, cập nhật `store.updateSelectedTopic` ngay bên dưới (dòng 517) để bao gồm cùng metadata:

```ts
store.updateSelectedTopic({
  title: topicInfo.value!.title,
  version: topicInfo.value!.version,
  totalPages: topicInfo.value!.pageCount,
  segments: updated,
} as any);
```

---

## Bug 2: Duplicate items trong TopicHubView khi đang tóm tắt segment

### Triệu chứng
Khi đang scraping + tóm tắt từng phần, quay lại tab Chủ đề → thấy 2 item trùng lặp của cùng topic, cả 2 hiện "Chưa tóm tắt".

### Root Cause
Hai cơ chế tạo ra 2 items:

1. **`onActivated`** fetch `GET_ALL_CACHED_TOPICS` → topic segment đã save vào IndexedDB (dù chưa có overall `summary`) → xuất hiện trong `allTopics`.

2. **`summarizingTempTopic`** computed (dòng 18-25) check:
   ```ts
   const alreadyInList = allTopics.value.some(t => t.url === url);
   ```
   Dùng strict `===`, nhưng `SAVE_CACHED_TOPIC` handler normalize URL trước khi save (`normalizeUrl(url)`). Nếu `store.summarizingUrl` (URL gốc) ≠ normalized URL trong `allTopics` → `alreadyInList = false` → temp topic vẫn render → **duplicate**.

Cả 2 items hiện "Chưa tóm tắt" vì segment mode chưa set overall `summary` (chỉ lưu `segments`).

### Fix
File: `entrypoints/sidepanel/views/TopicHubView.vue`, computed `summarizingTempTopic` dòng 21.

Thay strict `===` bằng `normalizeForCompare()` (đã có sẵn trong file):

```ts
// Trước:
const alreadyInList = allTopics.value.some(t => t.url === url);

// Sau:
const alreadyInList = allTopics.value.some(t => normalizeForCompare(t.url) === normalizeForCompare(url));
```

---

## Bug 3: Cơ chế cập nhật re-scrape toàn bộ thay vì cập nhật segments

### Triệu chứng
Khi topic segment mode có overall summary và có bài viết mới, click nút cập nhật → scrape lại toàn bộ topic từ đầu thay vì chỉ cập nhật segment cuối + re-generate overall summary.

### Root Cause
Trong template segment mode (dòng 730), CacheIndicator gọi:
```html
@update="handleSummarize(true)"
```

`handleSummarize(true)` là flow **incremental dành cho normal mode**: scrape từ `cachedPages + 1`, merge tất cả posts, gửi cho LLM summarize/incremental — không biết segment boundaries.

### Fix
File: `entrypoints/sidepanel/views/SummaryView.vue`

**Bước 1:** Tạo function `handleSegmentUpdate()`:

```ts
async function handleSegmentUpdate() {
  if (!topicInfo.value || !store.selectedTopic.value) return;
  const topic = store.selectedTopic.value;

  // Tính xem segments hiện tại cover đến page nào
  const currentSegments = segmentSummaries.value;
  const lastSeg = currentSegments[currentSegments.length - 1];
  const coveredEndPage = lastSeg?.endPage ?? 0;
  const newTotalPages = topicInfo.value.pageCount;

  if (newTotalPages <= coveredEndPage) {
    // Không có trang mới — chỉ re-generate overall
    await generateOverallSummary();
    return;
  }

  // Xác định segments cần update
  // Segment cuối cùng có thể chưa đầy đủ (endPage < segment boundary) → re-summarize nó
  // Và tạo segments mới cho các trang vượt quá
  const size = segmentSize.value;
  const segmentsToProcess: number[] = [];

  // Duyệt qua danh sách segments mới (dựa trên totalPages mới)
  const newSegments = segments.value; // computed sẽ tự tính lại vì topicInfo.pageCount đã update

  for (let i = 0; i < newSegments.length; i++) {
    const seg = newSegments[i];
    const existing = currentSegments[i];
    // Segment chưa tóm tắt, hoặc segment cuối cũ bị mở rộng
    if (!existing?.summary || (existing.endPage < seg.end)) {
      segmentsToProcess.push(i);
    }
  }

  if (segmentsToProcess.length === 0) {
    await generateOverallSummary();
    return;
  }

  // Tóm tắt lần lượt các segments cần update
  for (const idx of segmentsToProcess) {
    await handleSummarizeSegment(idx);
    if (error.value) return; // dừng nếu có lỗi
  }

  // Sau khi tất cả segments mới đã tóm tắt xong → generate overall
  const completedCount = segmentSummaries.value.filter(s => s?.summary).length;
  if (completedCount >= 2) {
    await generateOverallSummary();
  }
}
```

**Bước 2:** Đổi event handler trong template segment mode (dòng 730):

```html
<!-- Trước: -->
@update="handleSummarize(true)"

<!-- Sau: -->
@update="handleSegmentUpdate"
```

---

## Verification

1. `npx vue-tsc --noEmit` + `npm run build` → pass
2. **Bug 1:** Mở topic dài chưa cache → tóm tắt segment 1 → quay lại danh sách → vào lại topic → verify `version` không phải "unknown"
3. **Bug 2:** Mở topic dài → bắt đầu tóm tắt segment → quay lại tab Chủ đề → verify chỉ có 1 item (không duplicate)
4. **Bug 3:** Mở topic dài đã có overall summary → chờ có bài mới (hoặc mock) → click cập nhật → verify chỉ segment cuối được scrape + tóm tắt lại, rồi overall summary tự generate

---

## Tóm tắt thay đổi

| File | Thay đổi |
|------|----------|
| `SummaryView.vue` | Bug 1: Thêm metadata khi save segment; Bug 3: Thêm `handleSegmentUpdate()`, đổi event handler |
| `TopicHubView.vue` | Bug 2: `summarizingTempTopic` dùng `normalizeForCompare()` thay `===` |
