# Fix: SummaryView hiển thị nút "Tóm tắt" thay vì trạng thái đang tóm tắt khi user quay lại

## Vấn đề
Khi:
1. User đang tóm tắt Topic A (`confirmSummarize()` chạy async)
2. User quay lại danh sách (TopicHubView)
3. User click vào Topic A trong danh sách
→ SummaryView hiển thị nút "Tóm tắt" thay vì "Đang tóm tắt...", user có thể vô tình tóm tắt lại 1 lần nữa → double API call / race condition.

## Root Cause

`onActivated` guard so sánh `url !== loadedTopicUrl.value`, nhưng hai URL này có thể **có format khác nhau**:
- `loadedTopicUrl` được set từ `store.activeTabUrl.value` (raw browser URL, VD: `.../topic.123/page-5`)
- Khi user click topic card trong TopicHubView, `store.selectTopic(topic_from_cache)` được gọi với URL **đã normalize** từ IndexedDB (VD: `.../topic.123/`)

Kết quả: `url !== loadedTopicUrl.value` = true → `loadTopicData()` được gọi → **reset block** (từ bug fix trước) xóa `loadingText` → hiển thị nút "Tóm tắt".

## Fix áp dụng

**File:** `entrypoints/sidepanel/views/SummaryView.vue` — `onActivated` handler

Thêm guard: nếu `store.summarizingUrl.value` đang set cho topic hiện tại (khớp với `url` hoặc `loadedTopicUrl`), bỏ qua `loadTopicData()` và chỉ sync `loadedTopicUrl`:

```typescript
onActivated(async () => {
  browser.runtime?.onMessage.addListener(onRuntimeMessage);
  const url = store.selectedTopic.value?.url;
  if (!url) return;

  // If summarization is in progress for this topic (matched by either URL format),
  // preserve all view state — don't reset, just sync the URL tracker.
  const isSummarizingCurrentTopic =
    store.summarizingUrl.value !== null &&
    (store.summarizingUrl.value === url || store.summarizingUrl.value === loadedTopicUrl.value);

  if (isSummarizingCurrentTopic) {
    loadedTopicUrl.value = url;
    return;
  }

  if (url !== loadedTopicUrl.value) await loadTopicData();
});
```

### Tại sao cần check cả `loadedTopicUrl.value`?
- `summarizingUrl` được set từ `topic.url` lúc bắt đầu (raw URL format)
- `url` từ topic card trong list là normalized URL
- Check `summarizingUrl === loadedTopicUrl.value` bắt trường hợp URL format khác nhau

### `loadedTopicUrl.value = url` sau khi skip
Ensures lần `onActivated` tiếp theo (sau khi summarization xong) không re-trigger `loadTopicData()` với URL cũ.

## Verification
- `npx vue-tsc --noEmit` → pass
- `npm run build` → pass (308.87 kB)
