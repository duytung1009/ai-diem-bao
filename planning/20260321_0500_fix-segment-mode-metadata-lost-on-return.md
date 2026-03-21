# Fix: Segment mode metadata mất khi quay lại topic

Ngày: 2026-03-21

---

## Bug

Sau khi scrape + tóm tắt trang 1-20 của topic > 20 trang, nếu user chuyển sang topic khác rồi quay lại → topic ban đầu hiện:
- "0 bài viết", "1 trang", "unknown"
- Normal mode thay vì segment mode
- Nội dung tóm tắt biến mất (chỉ hiện nút "Tóm tắt")

Khi mở URL topic trên tab trình duyệt → detect cập nhật store → UI chuyển đúng về segment mode.

**Lưu ý:** Bug `fix-stale-save-missing-metadata` đã được fix (tất cả save branches dùng `topic` snapshot). Bug này là vấn đề KHÁC, xảy ra ở bước LOAD chứ không phải SAVE.

---

## Root Cause Analysis

### Vấn đề chính: `loadTopicData()` không sync metadata từ IndexedDB về store

`topicInfo` là computed từ `store.selectedTopic.value`:

```ts
const topicInfo = computed(() => {
  const topic = store.selectedTopic.value;
  return {
    version: topic.version,        // ← từ STORE
    title: topic.title,            // ← từ STORE
    postCount: topic.totalPosts,   // ← từ STORE
    pageCount: topic.totalPages,   // ← từ STORE
  };
});
```

`isSegmentMode` phụ thuộc `topicInfo.pageCount`:

```ts
const isSegmentMode = computed(() =>
  (topicInfo.value?.pageCount ?? 0) > segmentSize.value,
);
```

Khi user click topic từ TopicHubView:
1. `selectTopic(topicFromAllTopics)` → store có data từ `allTopics`
2. SummaryView `loadTopicData()` chạy
3. Dòng 142: `cachedTopic.value = topic` (local ref, data từ store)
4. Dòng 147: `fresh = await GET_CACHED_TOPIC(topic.url)` → data từ IndexedDB (ĐÚNG)
5. Dòng 149: `cachedTopic.value = fresh` → local ref được cập nhật
6. **NHƯNG `store.selectedTopic` KHÔNG ĐƯỢC CẬP NHẬT!**
7. → `topicInfo.pageCount` vẫn dùng giá trị cũ từ `allTopics`
8. → `isSegmentMode = false` nếu `allTopics` có `totalPages` sai

### Tại sao `allTopics` có data sai?

**Nguyên nhân phụ: TopicHubView watch dùng strict `===` so sánh URL**

TopicHubView dòng 116:
```ts
const idx = allTopics.value.findIndex(t => t.url === updated.url);
```

- `allTopics` URLs = normalized (từ IndexedDB, ví dụ `https://forum.com/threads/topic.123/`)
- `updated.url` có thể là raw URL (từ active tab card, ví dụ `https://forum.com/threads/topic.123/page-3`)
- Strict `===` KHÔNG khớp → watch không cập nhật `allTopics`
- Khi user quay lại TopicHubView, `onActivated` refresh từ IndexedDB → lúc này `allTopics` mới đúng
- **NHƯNG** nếu IndexedDB record chưa được save (timing), `allTopics` vẫn sai

### Flow gây bug

```
1. TopicHubView load allTopics từ IndexedDB
   allTopics = [topicA { totalPages: 1, version: 'unknown' }]  ← record cũ hoặc minimal
                                                                    (chưa được segment save cập nhật)

2. User click topicA → selectTopic(allTopics[0])
   store.selectedTopic = { totalPages: 1, version: 'unknown' }

3. SummaryView loadTopicData()
   cachedTopic.value = fresh   ← IndexedDB: { totalPages: 50, version: 'xf2', segments: [...] } ✅
   store.selectedTopic         ← vẫn { totalPages: 1 } ❌

4. isSegmentMode = topicInfo.pageCount > 20
                 = store.selectedTopic.totalPages > 20
                 = 1 > 20
                 = false ❌

5. UI hiện normal mode + "1 trang" + "unknown"
```

---

## Fix

### Task 1: `loadTopicData()` — sync fresh data từ IndexedDB về store

**File:** `entrypoints/sidepanel/views/SummaryView.vue`

Sau khi fetch từ `GET_CACHED_TOPIC`, sync metadata quan trọng về store:

```ts
// TRƯỚC (dòng 146-162):
try {
  const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', topic.url);
  if (fresh) {
    cachedTopic.value = fresh;
    if (fresh.summary) {
      summary.value = fresh.summary;
    }
    if (fresh.segments) {
      segmentSummaries.value = fresh.segments;
    }
    // ... evaluateFreshness ...
  }
} catch { /* cache miss is fine */ }

// SAU:
try {
  const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', topic.url);
  if (fresh) {
    cachedTopic.value = fresh;

    // Sync metadata từ cache về store để topicInfo computed đúng
    store.updateSelectedTopic({
      totalPages: fresh.totalPages,
      totalPosts: fresh.totalPosts,
      version: fresh.version,
      title: fresh.title,
    });

    if (fresh.summary) {
      summary.value = fresh.summary;
    }
    if (fresh.segments) {
      segmentSummaries.value = fresh.segments;
    }
    // ... evaluateFreshness (giữ nguyên) ...
  }
} catch { /* cache miss is fine */ }
```

**Tại sao an toàn:** `loadTopicData()` đã được gọi với `topic = store.selectedTopic.value` (captured ở đầu function). `updateSelectedTopic` chỉ merge thêm data chứ không thay đổi URL hay identity.

### Task 2: TopicHubView watch — dùng `isSameTopicUrl` thay strict `===`

**File:** `entrypoints/sidepanel/views/TopicHubView.vue`

Dòng 116, đổi:

```ts
// TRƯỚC:
const idx = allTopics.value.findIndex(t => t.url === updated.url);

// SAU:
const idx = allTopics.value.findIndex(t => isSameTopicUrl(t.url, updated.url));
```

`isSameTopicUrl` đã được import ở dòng 5 (dùng trong template). Hàm này normalize URL trước khi so sánh → khớp cả raw và normalized URLs.

**Lưu ý:** Cần kiểm tra `isSameTopicUrl` đã được import chưa. Nếu chưa, thêm import.

---

## Tóm tắt thay đổi

| File | Thay đổi |
|------|----------|
| `SummaryView.vue` | `loadTopicData()` thêm `store.updateSelectedTopic(...)` sau fetch cache |
| `TopicHubView.vue` | Watch `findIndex` dùng `isSameTopicUrl` thay strict `===` |

---

## Verification

1. `npx vue-tsc --noEmit` + `npm run build` → pass
2. **Kịch bản chính:** Mở topic 30+ trang → tóm tắt trang 1-20 → quay lại danh sách → xem topic khác → quay lại topic ban đầu → hiện đúng segment mode + version + totalPages + nội dung đã tóm tắt
3. **Không cần mở URL trên trình duyệt:** Topic info hiển thị đúng ngay khi chọn từ danh sách
4. **Active tab card:** Click "Tab hiện tại" card (raw URL) → tóm tắt segment → chuyển topic → quay lại → data đúng
5. **Normal mode không bị ảnh hưởng:** Topic < 20 trang vẫn hoạt động bình thường
6. **Cache indicator:** Freshness check vẫn đúng sau sync
