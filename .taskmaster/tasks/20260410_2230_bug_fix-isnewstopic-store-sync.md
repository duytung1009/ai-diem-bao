# Bug Fix — `isNewsTopic` không phản ánh khi App.vue đọc từ store

## Root Cause

Refactor `20260410_2210_task_refactor-topic-meta-to-app.md` đã lift `<TopicMeta>` lên App.vue. App.vue tính `isNewsTopic` từ `store.selectedTopic.value?.topicType === 'news'`.

Tuy nhiên `useSummarize` set `cachedTopic.value.topicType` ở 3 chỗ mà **không gọi `store.updateSelectedTopic({ topicType })`**:

| Chỗ | Trigger |
|-----|---------|
| `detectAndCacheTopicType()` | Fire-and-forget khi load topic lần đầu |
| Segment summarization (line ~386) | Khi phát hiện article posts (`postNumber < 0`) trong segment |
| Old-style summarization (line ~836) | Khi enriched posts chứa article posts |

Trước refactor: `isNewsTopic` trong SummaryView đọc trực tiếp từ `cachedTopic` local của `useSummarize` → reactive, đúng.  
Sau refactor: App.vue đọc từ `store.selectedTopic.value?.topicType` → không được cập nhật → luôn `undefined` → badge "Tin tức" không hiện.

## Fix

`entrypoints/sidepanel/composables/useSummarize.ts` — thêm `store.updateSelectedTopic({ topicType })` sau mỗi chỗ update `cachedTopic.value.topicType`:

```typescript
// detectAndCacheTopicType()
cachedTopic.value = { ...cachedTopic.value, topicType };
store.updateSelectedTopic({ topicType });           // ← thêm

// Segment summarization
cachedTopic.value = { ...cachedTopic.value, topicType: 'news' };
store.updateSelectedTopic({ topicType: 'news' });   // ← thêm

// Old-style summarization
cachedTopic.value = { ...cachedTopic.value, topicType: 'news' };
store.updateSelectedTopic({ topicType: 'news' });   // ← thêm
```

## Self-review Results
- Issues found: 0
- Issues fixed: 0 (fix đơn giản, không phát sinh issue mới)
- Remaining: none
