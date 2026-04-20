# Task: Confirmation Dialog Before "Tóm tắt toàn bộ"

## Summary
Thêm bước xác nhận inline trước khi thực hiện "Tóm tắt toàn bộ" vì thao tác này tốn nhiều thời gian và không thể hủy giữa chừng.

## Files Changed
- `entrypoints/sidepanel/views/SummaryView.vue`

## Changes
- Thêm `confirmingAutoSummarize` ref (boolean)
- Nút "⚡ Tóm tắt toàn bộ" không gọi `handleAutoSummarizeAll()` trực tiếp nữa — thay vào đó set `confirmingAutoSummarize = true`
- Khi `confirmingAutoSummarize = true`, hiển thị inline: message cảnh báo + nút **Xác nhận** + nút **Hủy**
- **Xác nhận**: reset flag → gọi `handleAutoSummarizeAll()`
- **Hủy**: reset flag, không làm gì

## Design Notes
- Dùng inline confirmation thay vì `window.confirm()` — sidepanel extension có thể bị block native dialog
- Message: `"Tóm tắt N phần, không thể hủy. Tiếp tục?"`

## Self-review Results
- Issues found: 0
- Issues fixed: 0
- Remaining: none
