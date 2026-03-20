# Fix: autoUpdateCachedTopic ghi đè totalPosts khiến CacheIndicator hiện sai trạng thái

## Bug Report
1. Mở Topic A (đã tóm tắt, cache có 90 bài) — tab trình duyệt đang mở topic này (thực tế có 100 bài)
2. CacheIndicator hiện đúng: "Có 10 bài viết mới" (stale)
3. User KHÔNG cập nhật, quay lại danh sách → chọn Topic B → quay lại Topic A
4. CacheIndicator hiện SAI: "fresh" — mất thông báo bài mới, hiện "đã cập nhật mới nhất"

## Phân tích Root Cause

### Flow gây lỗi

```
autoUpdateCachedTopic(tabUrl, detect{postCount: 100})
  └→ cached = getCachedTopic(url)     // cached.totalPosts = 90
  └→ hasChanges = (90 !== 100)        // true
  └→ saveCachedTopic({
       ...cached,
       totalPosts: 100,               // ← GHI ĐÈ! Giờ cache nói "100 bài"
     })
  └→ store.updateSelectedTopic({ totalPosts: 100 })
```

Khi user quay lại Topic A:
```
loadTopicData()
  └→ GET_CACHED_TOPIC → fresh.totalPosts = 100  (đã bị autoUpdate ghi đè)
  └→ livePostCount = 100  (từ store.activeTabDetect)
  └→ evaluateFreshness(cached{100}, live{100})
  └→ 100 > 100 = false → 'fresh'     // ← SAI! Summary chỉ cover 90 bài
```

### Nguyên nhân gốc

`CachedTopic.totalPosts` có 2 ý nghĩa xung đột:
1. **"Số bài đã được tóm tắt/scrape"** — dùng bởi `evaluateFreshness()` để so với live count
2. **"Số bài thực tế trên forum"** — bị `autoUpdateCachedTopic()` ghi đè

`autoUpdateCachedTopic()` ghi `totalPosts = detect.postCount` phá vỡ ý nghĩa (1).

## Fix

### File: `entrypoints/sidepanel/App.vue`

**Sửa `autoUpdateCachedTopic()`** — bỏ `totalPosts` khỏi cache update:

```typescript
async function autoUpdateCachedTopic(tabUrl: string, detect: DetectResult) {
  try {
    const cached = await getCachedTopic(tabUrl);
    if (!cached) return;

    // Chỉ update title và totalPages — KHÔNG update totalPosts
    // totalPosts trong cache phải giữ nguyên giá trị lúc tóm tắt
    // để evaluateFreshness() so sánh đúng với live count
    const hasChanges =
      cached.totalPages !== detect.pageCount ||
      cached.title !== detect.title;

    if (!hasChanges) return;

    await saveCachedTopic({
      ...cached,
      totalPages: detect.pageCount,
      title: detect.title,
      // KHÔNG có totalPosts ở đây
    });

    const normalizedTabUrl = normalizeUrl(tabUrl);
    const selectedUrl = store.selectedTopic.value?.url;
    if (selectedUrl && normalizeUrl(selectedUrl) === normalizedTabUrl) {
      store.updateSelectedTopic({
        totalPages: detect.pageCount,
        title: detect.title,
        // KHÔNG update totalPosts trong store
      });
    }
  } catch {
    // IndexedDB error — silent fail
  }
}
```

### Tại sao không update `totalPosts` trong store?

`store.selectedTopic.value.totalPosts` được dùng bởi `topicInfo` computed trong SummaryView:
```typescript
const topicInfo = computed(() => ({
  postCount: topic.totalPosts,  // ← hiện trong TopicMeta
}));
```

Nếu update store → TopicMeta hiện 100 bài, nhưng summary chỉ cover 90 bài → gây confuse.

Live count đã hiển thị đúng qua `livePostCount` computed (từ `store.activeTabDetect.value.postCount`), và CacheIndicator hiện "+10 bài mới" khi detect bài mới. Không cần update `totalPosts` ở bất kỳ đâu.

## Verification

1. Mở topic đã tóm tắt (90 bài cache, 100 bài live) → CacheIndicator hiện "10 bài mới"
2. Quay lại list → chọn topic khác → quay lại topic ban đầu → **vẫn hiện "10 bài mới"**
3. Bấm "Cập nhật" (incremental summarize) → sau khi tóm tắt xong → `totalPosts` cập nhật đúng → CacheIndicator hiện "fresh"
4. `npx vue-tsc --noEmit` + `npm run build` → pass
