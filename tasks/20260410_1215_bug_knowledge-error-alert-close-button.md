# Bug: Knowledge View — Alert "Không có bài mới" có nút Thử lại không hoạt động

## Root Cause

`KnowledgeView.vue` dùng `<ErrorDisplay action="retry" @retry="handleExtract">` để hiển thị lỗi "Không có bài viết mới...". Nút "Thử lại" gọi lại `handleExtract`, nhưng state không thay đổi nên kết quả vẫn là "không có bài mới" — infinite loop vô ích. Ngoài ra không có cách để dismiss alert.

## Fix

Thay thế `ErrorDisplay` component bằng alert inline trong template với nút X để đóng (`error = ''`).

## Files Changed

| File | Thay đổi |
|------|----------|
| `entrypoints/sidepanel/views/KnowledgeView.vue` | Thay `<ErrorDisplay>` bằng alert inline có close button; xóa import `ErrorDisplay` |

## Self-review Results

- Issues found: 0
- Issues fixed: 0
- Remaining: không có

### Checklist
| Category | Status | Notes |
|----------|--------|-------|
| Logic correctness | ✅ | `@click="error = ''"` dismiss sạch state |
| Edge cases covered | ✅ | Alert chỉ hiện khi `error` có nội dung — không ảnh hưởng các error path khác |
| Error handling | N/A | |
| Performance concerns | N/A | |
| Security implications | N/A | |
| Consistency with patterns | ✅ | Style alert giữ nguyên `alert alert-error`, icon giống `ErrorDisplay.vue` |
| Type safety | ✅ | Không thay đổi logic/types |
