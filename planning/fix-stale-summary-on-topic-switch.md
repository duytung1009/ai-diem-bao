# Fix: SummaryView hiển thị tóm tắt cũ khi chọn topic chưa tóm tắt

## Mục tiêu
Khi user chọn 1 topic chưa có summary, SummaryView phải hiển thị trạng thái "chưa tóm tắt" (nút "Tóm tắt"), không được hiện nội dung summary của topic đã xem trước đó.

## Phân tích root cause

### Vấn đề
`loadTopicData()` (dòng 69-93) chỉ **gán** `summary.value` khi `topic.summary` tồn tại, nhưng **không reset** khi topic mới chưa có summary:

```typescript
// Dòng 74-77 — CHỈ gán, KHÔNG reset
if (topic.summary) {
  summary.value = topic.summary;        // ← set nếu có
  summarizedPostCount.value = topic.totalPosts;
}
// Nếu topic.summary = undefined → summary.value GIỮ NGUYÊN giá trị cũ
```

### Tại sao xảy ra
- App dùng `<keep-alive>` → SummaryView chỉ mount 1 lần, các `ref()` tồn tại xuyên suốt session
- Khi chọn topic A (có summary) → `summary.value = "nội dung A"`
- Sau đó chọn topic B (chưa summary) → `summary.value` vẫn = `"nội dung A"` → hiện sai

### Các ref bị ảnh hưởng
- `summary` — nội dung tóm tắt
- `summarizedPostCount` — số bài đã tóm tắt
- `cachedTopic` — topic cached (dùng cho CacheIndicator)
- `cacheFreshness` — trạng thái cache
- `error` — error message từ topic trước
- `pendingPosts` — pending confirmation từ topic trước
- `scrapingWarnings` — warnings từ topic trước

---

## Fix: Reset toàn bộ state ở đầu `loadTopicData()`

### File: `entrypoints/sidepanel/views/SummaryView.vue`

**Sửa function `loadTopicData()`** (dòng 69-93), thêm block reset state ngay đầu:

```typescript
async function loadTopicData() {
  const topic = store.selectedTopic.value;
  if (!topic) return;

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

  loadedTopicUrl.value = topic.url;
  cachedTopic.value = topic as CachedTopic;
  if (topic.summary) {
    summary.value = topic.summary;
    summarizedPostCount.value = topic.totalPosts;
  }
  try {
    const fresh = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', topic.url);
    if (fresh) {
      cachedTopic.value = fresh;
      if (fresh.summary) {
        summary.value = fresh.summary;
        summarizedPostCount.value = fresh.totalPosts;
      }
      if (store.activeTabDetect.value && isSameTopicUrl(store.activeTabUrl.value ?? '', topic.url)) {
        cacheFreshness.value = evaluateFreshness(fresh, store.activeTabDetect.value.postCount);
      } else {
        cacheFreshness.value = evaluateFreshness(fresh, fresh.totalPosts);
      }
    }
  } catch { /* cache miss is fine */ }
}
```

**Lưu ý:** Block reset đặt **trước** `loadedTopicUrl.value = topic.url` để đảm bảo mọi state cũ đều bị xóa trước khi load data topic mới.

---

## Verification

1. Mở topic A (đã có summary) → thấy nội dung tóm tắt
2. Quay lại danh sách → chọn topic B (chưa tóm tắt) → **phải thấy nút "Tóm tắt"**, KHÔNG thấy summary cũ của topic A
3. Quay lại topic A → vẫn thấy summary đúng (load từ cache)
4. `npx vue-tsc --noEmit` + `npm run build` → pass
