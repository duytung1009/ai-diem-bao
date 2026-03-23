# Bug fix: Số bài viết hiển thị sai (20 thay vì 197) sau khi tóm tắt

**Ngày:** 2026-03-21

## Vấn đề

Sau khi tóm tắt topic 10 trang (~197 bài viết), TopicMeta hiển thị "20 bài viết" và `summarizedPostCount` cũng hiển thị 20, mặc dù LLM đã xử lý đủ 197 bài.

## Nguyên nhân

Trong `confirmSummarize()`, thứ tự thực hiện sai:

```
Line 488: summary.value = summaryText    ← kích hoạt Vue render → hiển thị summary section
Line 492: await sendMessage('SAVE_CACHED_TOPIC', ...)   ← async yield → Vue render frame
Line 503: store.updateSelectedTopic(...)  ← cập nhật totalPosts = 197
Line 506: cachedTopic.value = saved       ← cập nhật summarizedPostCount = 197
```

Khi `summary.value` được set ở line 488, Vue queue re-render. Trong lúc `await sendMessage(...)` ở line 492 yields, Vue render frame trung gian với:
- `topicInfo.postCount = topic.totalPosts = 20` (từ `detect.postCount`, chưa update)
- `summarizedPostCount = cachedTopic.value.summarizedPostCount ?? cachedTopic.value.totalPosts ?? 0 = undefined ?? 20 ?? 0 = 20`

## Fix

**File:** `entrypoints/sidepanel/views/SummaryView.vue`

Di chuyển `store.updateSelectedTopic()` và update `cachedTopic.value` lên **TRƯỚC** `summary.value = summaryText`:

```typescript
// Update store + cachedTopic TRƯỚC khi set summary.value
store.updateSelectedTopic({ summary, posts, totalPosts: realPostCount, totalPages });
if (cachedTopic.value) {
  cachedTopic.value = { ...cachedTopic.value, totalPosts: realPostCount, summarizedPostCount: realPostCount };
}

summary.value = summaryText;  // Khi Vue render, counts đã đúng

// Async save + refresh (eventual consistency)
await sendMessage('SAVE_CACHED_TOPIC', { ... });
const saved = await sendMessage('GET_CACHED_TOPIC', topic.url);
if (saved) cachedTopic.value = saved;
```

Kết quả: khi Vue render summary section, `topicInfo.postCount = 197` và `summarizedPostCount = 197` ngay lập tức.

## Verification

- `npx vue-tsc --noEmit` → pass
