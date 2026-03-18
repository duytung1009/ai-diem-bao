# Task Summary: Fix Content Script Chưa Sẵn Sàng Khi Detect Sau Navigate

## Trạng thái: DONE ✓
- Type check: pass
- Source: `planning/fix-detect-race-condition.md`

## Vấn đề
`tabs.onUpdated` fire với `changeInfo.url` ngay khi navigate **bắt đầu** — content script trên trang mới chưa inject xong (WXT `run_at: document_idle`). `DETECT_XF` message bị miss → detect fail → TopicHub không hiển thị "Tab hiện tại" sau khi navigate.

## Thay đổi đã thực hiện

### `entrypoints/sidepanel/App.vue`

**Type annotation `tabUpdatedListener`:** Đổi `changeInfo: { url?: string }` → `changeInfo: { status?: string }`.

**Guard condition trong listener:** Đổi `if (!changeInfo.url) return` → `if (changeInfo.status !== 'complete') return`.

`status: 'complete'` fire **sau khi** trang đã load xong → content script đã inject và listener đã sẵn sàng nhận message. Cũng cover trường hợp reload trang.

**Bonus:** Xóa `console.log('Detect result:', result)` bị sót từ debug session.

## Không cần thay đổi
- Các file khác không liên quan đến race condition này.

## Invariant sau fix
Navigate tới topic XenForo → chờ `status: 'complete'` → gửi `DETECT_XF` → content script đã sẵn sàng → detect thành công → TopicHub hiển thị "Tab hiện tại" đúng.
