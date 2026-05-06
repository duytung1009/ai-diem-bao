# Task ID: 125

**Title:** Áp dụng formatNumber trong TopicHubView.vue

**Status:** done

**Dependencies:** 123 ✓

**Priority:** high

**Description:** Import và sử dụng formatNumber cho số bài viết hiển thị trong TopicHubView (active tab detect, topic list)

**Details:**

1. Import formatNumber từ lib/format.ts trong `<script setup>`:
```typescript
import { formatNumber } from '@/lib/format';
```
2. Áp dụng format tại các vị trí:
   - Line ~299: `{{ store.activeTabDetect.value.postCount }}` → `{{ formatNumber(store.activeTabDetect.value.postCount) }}`
   - Line ~368: `{{ topic.summarizedPostCount ?? topic.totalPosts }}/{{ topic.totalPosts }}` → `{{ formatNumber(topic.summarizedPostCount ?? topic.totalPosts) }}/{{ formatNumber(topic.totalPosts) }}`
   - Line ~370: `{{ topic.totalPosts }}` → `{{ formatNumber(topic.totalPosts) }}`
   - Line ~373-374: `{{ newPostsMap[topic.url] }}` → `{{ formatNumber(newPostsMap[topic.url]) }}`
3. Cẩn thận với null/undefined checks, đảm bảo chỉ format khi có giá trị

**Test Strategy:**

1. Build và type check pass
2. Mở TopicHubView với danh sách topics
3. Verify số bài viết ở active tab detect được format đúng
4. Verify số bài viết trong topic cards được format đúng
5. Test với topics có new posts để verify format của newPostsMap
6. Kiểm tra responsive layout không bị break
