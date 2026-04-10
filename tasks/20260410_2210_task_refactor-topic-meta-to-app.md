# Refactor — Lift `<TopicMeta>` lên App.vue (một instance chung cho 3 tab)

## Objective
Thay vì mỗi tab (Tóm tắt / Kiến thức / Tra cứu) tự import và render `<TopicMeta>` riêng với data source riêng, lift component lên `App.vue` để chỉ có **một instance duy nhất** với nguồn dữ liệu và UI thống nhất.

## Files thay đổi
- `entrypoints/sidepanel/App.vue`
- `entrypoints/sidepanel/views/SummaryView.vue`
- `entrypoints/sidepanel/views/KnowledgeView.vue`
- `entrypoints/sidepanel/views/ResearchView.vue`

---

## Changes

### App.vue

Thêm `import TopicMeta` và 3 computeds mới:

```typescript
const isTopicDetailRoute = computed(() =>
  ['summary', 'knowledge', 'research'].includes(route.name as string),
);
const topicInfo = computed<DetectResult | null>(() => {
  const t = store.selectedTopic.value;
  if (!t) return null;
  return { version: t.version, title: t.title, postCount: t.totalPosts, pageCount: t.totalPages };
});
const isNewsTopic = computed(() => store.selectedTopic.value?.topicType === 'news');
```

Thêm vào `<main>` trước `<router-view>`:

```vue
<div v-if="topicInfo && isTopicDetailRoute" class="px-4 pt-4">
  <TopicMeta :info="topicInfo" :url="store.selectedTopic.value?.url" :is-news="isNewsTopic" />
</div>
```

### SummaryView.vue
- Xóa `import TopicMeta`
- Xóa `isNewsTopic` khỏi destructure `useSummarize(store)` (chỉ dùng cho TopicMeta)
- Xóa `<TopicMeta ...>` khỏi template
- Giữ `topicInfo` — vẫn cần cho empty state guard (`v-if="!topicInfo"`) và `topicInfo!.pageCount` ở dòng hiển thị cảnh báo topic dài

### KnowledgeView.vue
- Xóa `import TopicMeta`
- Đổi `const { topicInfo, isNewsTopic } = useSummarize(store)` → `const { topicInfo } = useSummarize(store)`
- Xóa `<TopicMeta ...>` khỏi template
- Giữ `topicInfo` — vẫn cần cho empty state guard

### ResearchView.vue
- Xóa `import TopicMeta`
- Xóa `DetectResult` khỏi type imports (không còn dùng)
- Xóa local `topicInfo` computed (~11 dòng duplicate của logic đã có trong `useSummarize`)
- Xóa `<TopicMeta v-if="topicInfo" ...>` khỏi template

---

## Bugs fixed as side-effect

| Bug | Mô tả |
|-----|-------|
| ResearchView thiếu `:is-news` | ResearchView cũ không truyền prop `isNews` vào `<TopicMeta>` → badge "Tin tức" không hiển thị ở tab Tra cứu. Sau refactor: App.vue truyền đầy đủ cho cả 3 tab. |
| ResearchView dùng sai field | Khi thêm `isNewsTopic` vào App.vue, phát hiện ResearchView sẽ dùng `isNewsTopic` không tồn tại trên type. Field đúng là `topicType === 'news'` (khớp với `useSummarize.ts:113`). |

---

## Self-review Results
- Issues found: 1
- Issues fixed: 1
- Remaining: none

**Chi tiết:**
1. Type error: `store.selectedTopic.value?.isNewsTopic` không tồn tại trên `CachedTopic` → đổi thành `store.selectedTopic.value?.topicType === 'news'` (khớp với cách `useSummarize` tính `isNewsTopic`). Caught bởi `vue-tsc --noEmit`.
