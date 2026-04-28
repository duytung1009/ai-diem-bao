# Cơ chế Topic Hub

> Cập nhật: 2026-04-29

## Tổng quan

**TopicHubView** là trang chủ của sidepanel, hiển thị danh sách tất cả topics đã lưu trong cache. Cho phép user xem, tìm kiếm, sắp xếp, chọn và xóa topics.

## `useTopicStore` Composable

Module-level singleton (state chia sẻ giữa tất cả components):

```typescript
// State
const selectedTopic  = ref<CachedTopic | null>(null)     // Topic đang xem
const activeTabDetect = ref<DetectResult | null>(null)   // Kết quả detect tab hiện tại
const activeTabUrl   = ref<string | null>(null)          // URL tab hiện tại
const summarizingUrl = ref<string | null>(null)           // Topic đang được tóm tắt (realtime status)

// Actions
selectTopic(topic)              // Set selectedTopic
clearSelection()                // Clear selectedTopic
setActiveTab(detect, url)       // Set detect result + URL
updateSelectedTopic(partial)    // Merge partial fields vào selected topic
setSummarizing(url | null)      // Realtime summary status tracking
```

**Key points:**
- `selectedTopic` là `readonly` ref — chỉ có thể sửa qua `selectTopic()`, `updateSelectedTopic()`, `clearSelection()`
- `summarizingUrl` được set bởi `useSummarize` khi bắt đầu tóm tắt → TopicHub hiển thị badge realtime
- `activeTabDetect` được update bởi `App.vue` khi detect tab → dùng để so sánh "có phải topic đang mở không?"

## TopicHubView Component

### Load data

```typescript
async function loadTopics() {
  const topics = await sendMessage('GET_ALL_CACHED_TOPICS');
  // Sort by cachedAt descending → mới nhất ở đầu
  topics.sort((a, b) => b.cachedAt - a.cachedAt);
}
```

### Search & Filter

- **Search:** tìm trong `topic.title` (case-insensitive)
- **Bookmark filter:** `bookmarked === true`
- **Active state:** topic đang được selected (`isSameTopicUrl`)

### Sort

Mặc định sort theo `cachedAt` descending. Có thể đổi sort mode:
- `'newest'` — cachedAt mới nhất
- `'oldest'` — cachedAt cũ nhất
- `'title'` — alphabet

### Topic Card

Mỗi topic card hiển thị (qua `TopicMeta.vue`):

```
┌─────────────────────────────────────────┐
│ [News Badge] Tiêu đề topic              │
│ Tác giả • 120 bài • 6 trang             │
│ Trạng thái: Đã tóm tắt (95/120)         │
│ Cached: 2 giờ trước                    │
│ [Xóa]                                   │
└─────────────────────────────────────────┘
```

- **Trạng thái tóm tắt** (`topicSummaryStatus()` trong `lib/topic-utils.ts`):
  - `'none'` — chưa có summary
  - `'in-progress'` — `topic.url === summarizingUrl`
  - `'partial'` — `summarizedPostCount < totalPosts`
  - `'done'` — tóm tắt đầy đủ
- **News badge** — nếu `topic.topicType === 'news'`
- **Delete button** — confirm dialog trước khi xóa

### Delete Topic Flow

```typescript
async function handleDelete(url: string) {
  await sendMessage('DELETE_CACHED_TOPIC', url);
  // Nếu đang selected topic này → clear selection
  if (isSameTopicUrl(url, store.selectedTopic.value?.url)) {
    store.clearSelection();
  }
  loadTopics(); // reload
}
```

### Realtime Status (`summarizingUrl`)

Khi `useSummarize` bắt đầu tóm tắt, nó gọi `store.setSummarizing(topic.url)`. TopicHubView render card với badge "Đang tóm tắt..." và `animate-pulse`.

Khi LLM xong (hoặc cancel), `store.setSummarizing(null)` được gọi.

## Template Summary

- `useTopicStore` — quản lý state
- `TopicHubView.vue` — view chính (search, sort, list)
- `TopicMeta.vue` — hiển thị thông tin topic card
- `lib/topic-utils.ts` — `topicSummaryStatus()`, `formatTopicDate()`
- `cache-manager.ts` — `getAllCachedTopics()`, `deleteCachedTopic()`
