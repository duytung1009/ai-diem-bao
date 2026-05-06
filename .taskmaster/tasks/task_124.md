# Task ID: 124

**Title:** Áp dụng formatNumber trong TopicMeta.vue

**Status:** done

**Dependencies:** 123 ✓

**Priority:** high

**Description:** Import và sử dụng formatNumber cho tất cả số hiển thị trong TopicMeta component (totalPosts, totalPages, summarizedPostCount, newPostCount)

**Details:**

1. Import formatNumber từ lib/format.ts trong `<script setup>`:
```typescript
import { formatNumber } from '@/lib/format';
```
2. Áp dụng format tại các vị trí:
   - Line 72: `{{ topic.totalPosts }}` → `{{ formatNumber(topic.totalPosts) }}`
   - Line 73: `{{ newPostCount }}` → `{{ formatNumber(newPostCount) }}`
   - Line 75: `{{ topic.totalPages }}` → `{{ formatNumber(topic.totalPages) }}`
   - Line 87: `{{ summarizedPostCount }}/{{ topic.totalPosts }}` → `{{ formatNumber(summarizedPostCount) }}/{{ formatNumber(topic.totalPosts) }}`
   - Line 91: `{{ summarizedPostCount }}` → `{{ formatNumber(summarizedPostCount) }}`
3. Không cần thay đổi logic, chỉ wrap số trong formatNumber()

**Test Strategy:**

1. Build và type check pass
2. Mở sidepanel với topic có > 999 bài viết
3. Verify tất cả số hiển thị đúng format với dấu phẩy
4. Kiểm tra UI không bị break (text truncation, alignment)
5. Test với topic nhỏ (< 1000 bài) xem format có làm ảnh hưởng không
