# Task ID: 127

**Title:** Áp dụng formatNumber trong ProgressIndicator.vue computed message

**Status:** done

**Dependencies:** 123 ✓

**Priority:** medium

**Description:** Import và sử dụng formatNumber cho số bài viết trong string template của computed message trong ProgressIndicator component

**Details:**

1. Import formatNumber từ lib/format.ts trong `<script setup>`:
```typescript
import { formatNumber } from '@/lib/format';
```
2. Tìm computed `displayMessage` (line ~90-100)
3. Tại line ~97, update string template:
   - Từ: `Đang đọc trang ${p.currentPage}/${p.totalPages} (${p.postsScraped} bài)...`
   - Thành: `Đang đọc trang ${p.currentPage}/${p.totalPages} (${formatNumber(p.postsScraped)} bài)...`
4. Chỉ format `postsScraped`, không format `currentPage` và `totalPages` vì đây là số trang (thường nhỏ)
5. Lưu ý: đây là string template trong TypeScript computed, không phải Vue template

**Test Strategy:**

1. Build và type check pass
2. Trigger scraping process để hiện ProgressIndicator
3. Verify message hiển thị số bài viết với format đúng trong quá trình scrape
4. Test với scraping nhiều trang để verify số lớn được format
5. Kiểm tra không có lỗi runtime khi postsScraped undefined/null
