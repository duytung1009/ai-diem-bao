# Task ID: 120

**Title:** Thêm computed `newPostsMap` vào TopicHubView để track live post count

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Extract inline `v-if` logic (lines 355-360) thành computed `newPostsMap` để Vue reactivity tracking tường minh, fix bug indicator không cập nhật khi `activeTabDetect` thay đổi

**Details:**

**File:** `entrypoints/sidepanel/views/TopicHubView.vue`

**Root cause:** Inline `v-if` với function call `isSameTopicUrl(...)` trong `v-for` không trigger re-render đúng khi `store.activeTabDetect.value` thay đổi do Vue 3's block tree optimization.

**Implementation:**

1. Thêm computed `newPostsMap` sau `activeTabInList` (line 93):
```typescript
const newPostsMap = computed<Record<string, number>>(() => {
  if (!store.activeTabDetect.value || !store.activeTabUrl.value) return {};
  const liveCount = store.activeTabDetect.value.postCount;
  const activeUrl = normalizeUrl(store.activeTabUrl.value);
  const result: Record<string, number> = {};
  for (const topic of allTopics.value) {
    if (normalizeUrl(topic.url) === activeUrl) {
      const delta = liveCount - topic.totalPosts;
      if (delta > 0) result[topic.url] = delta;
      break;
    }
  }
  return result;
});
```

2. Replace template (lines 355-360):
```vue
<!-- Thay complex v-if condition -->
<span v-if="newPostsMap[topic.url]" class="text-(--color-accent-text) ml-0.5">
  (+{{ newPostsMap[topic.url] }} mới)
</span>
```

**Pseudo-code:**
```
COMPUTED newPostsMap:
  IF no activeTabDetect OR no activeTabUrl → return empty map
  liveCount = activeTabDetect.postCount
  activeUrl = normalize(activeTabUrl)
  FOR EACH topic IN allTopics:
    IF normalize(topic.url) === activeUrl:
      delta = liveCount - topic.totalPosts
      IF delta > 0: add { topic.url: delta } to result
      BREAK (only 1 topic matches)
  RETURN result

TEMPLATE:
  IF newPostsMap has entry for topic.url:
    SHOW "(+{delta} mới)"
```

**Edge cases:**
- `liveCount < totalPosts` (detect sai) → delta < 0 → không add entry → no indicator ✓
- Active tab không phải forum → `activeTabDetect = null` → map rỗng → no indicator ✓
- Topic không có trong `allTopics` → loop không tìm thấy → map rỗng ✓

**Test Strategy:**

1. **Setup:** Mở forum tab có 50 bài (cached topic có `totalPosts = 45`)
2. **Test reactive update:** Mở sidepanel → verify hub card hiện "(+5 mới)"
3. **Test hide:** Chuyển sang tab khác (không phải forum) → verify indicator ẩn
4. **Test show again:** Chuyển lại forum tab → verify indicator hiện lại
5. **Test không leak:** Check hub card của topic KHÁC không có indicator
6. **Test delta = 0:** Mock `activeTabDetect.postCount = 45` → verify không có indicator
