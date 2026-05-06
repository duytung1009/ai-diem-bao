# Task ID: 119

**Title:** Bug Fix: Reactive post count indicator không tự cập nhật khi phát hiện bài mới

**Status:** done

**Dependencies:** 118 ✓

**Priority:** low

**Description:** Fix reactive indicator '(+X mới)' trong TopicHubView.vue để tự động cập nhật khi store.activeTabDetect.value.postCount thay đổi. Hiện tại indicator đã được thêm nhưng không reactive — cần đảm bảo computed properties hoặc watch triggers khi activeTabDetect updates.

**Details:**

## Vấn đề hiện tại

File `entrypoints/sidepanel/views/TopicHubView.vue` đã có inline reactive indicator `(+X mới)` ở lines 355-360:

```vue
<span
  v-if="store.activeTabDetect.value && store.activeTabUrl.value &&
        isSameTopicUrl(store.activeTabUrl.value, topic.url) &&
        store.activeTabDetect.value.postCount > topic.totalPosts"
  class="text-(--color-accent-text) ml-0.5"
>(+{{ store.activeTabDetect.value.postCount - topic.totalPosts }} mới)</span>
```

**Bug:** Khi `store.activeTabDetect.value.postCount` thay đổi (phát hiện bài mới), UI không tự cập nhật vì:
- `store.activeTabDetect` là `readonly(ref)` từ `useTopicStore.ts`
- Vue 3 readonly refs có thể không trigger reactivity khi nested properties thay đổi
- Template trực tiếp access `.value.postCount` có thể không được track properly

## Root cause analysis

Cần verify reactivity chain:
1. `useTopicStore.ts` line 6: `activeTabDetect = ref<DetectResult | null>(null)`
2. Line 38: exported as `readonly(activeTabDetect)` 
3. `TopicHubView.vue` line 176: `store.activeTabDetect.value` — readonly ref value access
4. Template line 358: `store.activeTabDetect.value.postCount` — deep property access

Potential issues:
- Readonly wrapper might block reactivity signals
- Deep property access không được tracked nếu không có computed wrapper
- Object replacement vs mutation — nếu `setActiveTab()` thay thế entire object thì ok, nếu mutate `postCount` property thì ko reactive

## Implementation plan

### Option A: Computed property cho new post count (recommended)
Tạo computed để track delta explicitly:

```typescript
const newPostCounts = computed(() => {
  const result = new Map<string, number>();
  if (!store.activeTabDetect.value || !store.activeTabUrl.value) return result;
  
  const liveCount = store.activeTabDetect.value.postCount;
  const activeUrl = store.activeTabUrl.value;
  
  for (const topic of allTopics.value) {
    if (isSameTopicUrl(topic.url, activeUrl)) {
      const delta = liveCount - topic.totalPosts;
      if (delta > 0) result.set(topic.url, delta);
      break;
    }
  }
  return result;
});
```

Template:
```vue
<span v-if="newPostCounts.get(topic.url)" class="text-(--color-accent-text) ml-0.5">
  (+{{ newPostCounts.get(topic.url) }} mới)
</span>
```

### Option B: Per-topic computed (alternative)
Nếu Option A không work, wrap logic trong method:

```typescript
function getNewPostCount(topic: CachedTopic): number | null {
  if (!store.activeTabDetect.value || !store.activeTabUrl.value) return null;
  if (!isSameTopicUrl(store.activeTabUrl.value, topic.url)) return null;
  const delta = store.activeTabDetect.value.postCount - topic.totalPosts;
  return delta > 0 ? delta : null;
}
```

Template:
```vue
<span v-if="getNewPostCount(topic)" class="text-(--color-accent-text) ml-0.5">
  (+{{ getNewPostCount(topic) }} mới)
</span>
```

### Option C: Fix readonly ref (nếu A & B fail)
Nếu readonly wrapper block reactivity, expose writable ref thay readonly trong `useTopicStore.ts`:

```typescript
// Thay
activeTabDetect: readonly(activeTabDetect),
// Thành
activeTabDetect,
```

**Trade-off:** Mất encapsulation nhưng đảm bảo reactivity.

## Files affected
- `entrypoints/sidepanel/views/TopicHubView.vue` — thêm computed hoặc method helper
- `entrypoints/sidepanel/composables/useTopicStore.ts` — (chỉ nếu Option C)

## Edge cases
- `activeTabDetect.value` null — handled bởi v-if guard
- `postCount` giảm (user xóa bài) — delta <= 0, không hiển thị indicator
- Multiple topics từ cùng URL — `isSameTopicUrl` chỉ match đầu tiên
- Cached topic có `totalPosts` outdated — indicator hiển thị chính xác delta based on stale data (expected behavior)

**Test Strategy:**

## Verification steps

### 1. Manual testing — reproduce bug
- Mở topic trong tab (ví dụ: 10 bài)
- Extension detect và cache topic
- Verify trong TopicHubView thấy "10 bài"
- **Trigger update:** Mở DevTools → manually call `store.setActiveTab({ postCount: 12, ... }, url)` để simulate phát hiện bài mới
- **Expected:** Indicator tự động hiện "(+2 mới)"
- **Current bug:** Indicator không xuất hiện hoặc không update

### 2. Verify reactivity fix
- Sau khi implement computed/method helper
- Repeat test ở step 1
- **Pass:** Indicator xuất hiện ngay khi `activeTabDetect.value.postCount` thay đổi
- Check console không có reactivity warnings

### 3. Test edge cases
- `postCount` giảm (12 → 8): indicator phải biến mất
- `activeTabUrl` null: indicator không hiển thị
- Switch sang tab khác topic: indicator chỉ hiển thị trên card đúng URL
- Topic có `totalPosts = 0`: indicator hiển thị "(+12 mới)" nếu `postCount = 12`

### 4. Performance check
- Hub view với 20+ topics
- Update `activeTabDetect` 5 lần liên tiếp
- **Pass:** Không có lag, computed re-run minimal (chỉ affected topics)

### 5. Regression test — active tab topic card (lines 262-286)
- Verify card "Tab hiện tại" vẫn hiển thị `{{ store.activeTabDetect.value.postCount }} bài viết` correctly
- Không bị ảnh hưởng bởi refactor
