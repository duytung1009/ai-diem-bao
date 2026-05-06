# Task ID: 126

**Title:** Áp dụng formatNumber trong SummaryView.vue

**Status:** done

**Dependencies:** 123 ✓

**Priority:** high

**Description:** Import và sử dụng formatNumber cho số bài viết hiển thị trong SummaryView (segment post counts)

**Details:**

1. Import formatNumber từ lib/format.ts trong `<script setup>`:
```typescript
import { formatNumber } from '@/lib/format';
```
2. Áp dụng format tại các vị trí:
   - Line ~343: `{{ segmentSummaries[0].postCount }}` → `{{ formatNumber(segmentSummaries[0].postCount) }}`
   - Line ~486: `{{ segmentSummaries[activeSegmentIndex].postCount }}` → `{{ formatNumber(segmentSummaries[activeSegmentIndex].postCount) }}`
3. Đảm bảo array index safety khi access segmentSummaries

**Test Strategy:**

1. Build và type check pass
2. Mở SummaryView với topic đã tóm tắt
3. Verify số bài viết trong single segment view được format
4. Verify số bài viết trong individual segment view được format
5. Test với topics có nhiều segments
6. Kiểm tra không có lỗi khi segmentSummaries chưa load hoặc empty
