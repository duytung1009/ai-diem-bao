# Task ID: 121

**Title:** Cập nhật `topicSummaryStatus` để nhận optional `livePostCount` và fix status badge

**Status:** done

**Dependencies:** 120 ✓

**Priority:** high

**Description:** Thêm param `livePostCount?: number` vào function `topicSummaryStatus` để badge phản ánh đúng trạng thái khi có bài mới chưa tóm tắt (partial), và cập nhật TopicHubView để truyền live count từ `newPostsMap`

**Details:**

**Files:** `lib/topic-utils.ts`, `entrypoints/sidepanel/views/TopicHubView.vue`

**Root cause:** `topicSummaryStatus` so sánh `summarizedPostCount < totalPosts` (cả hai đều cached), không biết về live count → khi có 5 bài mới, function trả `'done'` → badge hiện "✓ Đã tóm tắt" (sai).

**Implementation:**

1. **Update `lib/topic-utils.ts`** (function signature line 5):
```typescript
export function topicSummaryStatus(
  topic: CachedTopic,
  isSummarizing: boolean,
  livePostCount?: number,
): TopicSummaryStatus {
  if (isSummarizing) return 'in-progress';
  const hasSummary = !!(topic.summary || topic.segments?.some(s => s?.summary));
  if (!hasSummary) return 'none';
  const summarized = topic.summarizedPostCount ?? topic.totalPosts ?? 0;
  // Use livePostCount if available and > cached totalPosts
  const effectiveTotalPosts = (livePostCount != null && livePostCount > (topic.totalPosts ?? 0))
    ? livePostCount
    : (topic.totalPosts ?? 0);
  if (summarized < effectiveTotalPosts) return 'partial';
  return 'done';
}
```

2. **Update `TopicHubView.vue`** template (lines 324, 330):
```vue
<!-- Thay: topicSummaryStatus(topic, false) -->
<!-- Thành: -->
<span
  v-else-if="topicSummaryStatus(topic, false, topic.totalPosts + (newPostsMap[topic.url] ?? 0)) === 'done'"
  class="badge badge-success"
>
  ✓ Đã tóm tắt
</span>
<span
  v-else-if="topicSummaryStatus(topic, false, topic.totalPosts + (newPostsMap[topic.url] ?? 0)) === 'partial'"
  class="badge bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
>
  ~ Một phần
</span>
```

**Pseudo-code:**
```
FUNCTION topicSummaryStatus(topic, isSummarizing, livePostCount?):
  IF isSummarizing → 'in-progress'
  hasSummary = topic has summary OR segments with summary
  IF NOT hasSummary → 'none'
  summarized = topic.summarizedPostCount ?? topic.totalPosts
  effectiveTotal = MAX(livePostCount ?? 0, topic.totalPosts)
  IF summarized < effectiveTotal → 'partial'
  ELSE → 'done'

CALLER (TopicHubView template):
  effectiveLiveCount = topic.totalPosts + (newPostsMap[topic.url] ?? 0)
  status = topicSummaryStatus(topic, isSummarizing, effectiveLiveCount)
```

**Edge cases:**
- `livePostCount` undefined → dùng `topic.totalPosts` → backward compatible ✓
- `livePostCount < totalPosts` → dùng `totalPosts` → không xử lý detect sai ✓
- `livePostCount == totalPosts` → `summarized < effectiveTotal` false → 'done' ✓
- Topic không match active tab → `newPostsMap[topic.url]` undefined → truyền `totalPosts + 0` ✓

**Test Strategy:**

1. **Test badge partial:** Topic cached 45 bài, live 50 bài, summarized 45 → verify badge "~ Một phần"
2. **Test badge done:** Live 50, summarized 50 → verify badge "✓ Đã tóm tắt"
3. **Test badge none:** Topic chưa có summary → verify badge "○ Chưa tóm tắt"
4. **Test backward compat:** Topic không phải active tab → `livePostCount = undefined` → verify badge theo cached data
5. **Test in-progress:** `isSummarizing = true` → verify badge "⟳ Đang tóm tắt..." (priority cao hơn livePostCount)
6. **Integration test:** Mở topic 50 bài (cached 45), summarize 45 bài → verify indicator "(+5 mới)" + badge "~ Một phần"
