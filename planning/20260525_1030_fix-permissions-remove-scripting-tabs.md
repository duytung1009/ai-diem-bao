# Refactor: Giảm permissions nhạy cảm — xóa `scripting` và `tabs`

## Overview

Extension hiện khai báo `scripting` và `tabs` trong `permissions[]` của manifest, nhưng qua audit kỹ code, cả hai đều có thể loại bỏ hoặc thay thế bằng approach ít nhạy cảm hơn. Mục tiêu: chỉ giữ `storage`, `sidePanel`, `activeTab` — bộ permissions tối thiểu, dễ được Chrome Web Store approve.

## Goals

- Xóa `scripting` permission (không được dùng ở bất kỳ đâu)
- Xóa `tabs` permission bằng cách lấy URL từ content script thay vì `tab.url`
- Không thay đổi UX nào đáng kể — chỉ `navigateToTopic` đổi từ navigate-in-place sang open-new-tab

## Requirements

### 1. Xóa `scripting` khỏi manifest

- Xóa `'scripting'` khỏi `permissions[]` trong `wxt.config.ts`
- Không có code nào gọi `browser.scripting.executeScript` — safe to remove ngay

### 2. Thêm `url` vào `DetectResult`

- Thêm field `url?: string` vào interface `DetectResult` trong `lib/types.ts`
- Content script (`entrypoints/content/index.ts`) trả về `url: location.href` trong response DETECT_XF
- Đây là cách duy nhất để sidepanel biết URL của tab mà không cần `tabs` permission

### 3. Refactor `App.vue` — không đọc `tab.url`

- `tabs.query({ active: true, currentWindow: true })` vẫn được gọi để lấy `tabId`
- Bỏ đọc `tab.url` — thay bằng `result.url` từ content script response
- `tabs.onActivated`, `tabs.onUpdated`, `tabs.sendMessage` không cần `tabs` permission — giữ nguyên logic

### 4. Refactor `TopicMeta.vue` — bỏ `tabs.update`

- `navigateToTopic()` hiện dùng `tabs.update(tab.id, { url })` để navigate tab hiện tại
- Thay bằng `tabs.create({ url })` — mở tab mới thay vì navigate in-place
- `tabs.create` không cần `tabs` permission
- Xóa `tabs.query` call trong hàm này (không cần tabId nữa)

### 5. Refactor `background/index.ts` — xóa `getActiveTabUrl()`

- `getActiveTabUrl()` dùng `browser.tabs.query` để lấy URL — cần `tabs` permission
- Hàm này chỉ được gọi khi `GET_CACHED_TOPIC` / `SAVE_CACHED_TOPIC` không có URL trong payload
- Fix: đảm bảo sidepanel luôn truyền URL trong payload (kiểm tra call sites)
- Sau khi verify, có thể xóa hoặc giữ hàm với note "không dùng nếu không có tabs permission"

### 6. Xóa `tabs` khỏi manifest

- Sau khi hoàn thành 3-5, xóa `'tabs'` khỏi `permissions[]` trong `wxt.config.ts`

### 7. Cập nhật AGENTS.md

- Thêm section về Chrome Extension Permission Policy
- Ghi rõ principles: minimal permissions, không dùng `scripting`/`tabs`/`<all_urls>` nếu có giải pháp thay thế

## Technical Considerations

- `tabs.query` không trả `url` nếu thiếu `tabs` permission — đây là điểm quan trọng nhất
- `tabs.onActivated`, `tabs.onUpdated` vẫn fire mà không cần permission
- `tabs.sendMessage`, `tabs.create` không cần permission
- Content script luôn biết URL của mình qua `location.href`
- `host_permissions: []` đã đúng — không cần thay đổi
- `content_scripts: ["*://*/*"]` vẫn cần thiết để detect XenForo trên mọi forum

## Implementation Notes

Thứ tự implement: types → content script → App.vue → TopicMeta.vue → background → wxt.config.ts → AGENTS.md

Không cần thay đổi: SummaryContent.vue, KnowledgeView.vue, NotebookView.vue — `tabs.create` đã không cần permission.

## Test Plan

- Mở extension trên voz.vn/threads/... → sidepanel detect đúng thread
- Switch tab sang tab khác → sidepanel reset về trạng thái không có topic
- Switch lại tab voz → sidepanel detect lại đúng
- Click link bài đăng trong summary → mở tab mới đúng URL
- Click "Đến thớt" trong TopicMeta → mở tab mới (không còn navigate in-place)
- Build extension: không có TypeScript errors

## Decision Log

### Quyết định 1: Lấy URL từ content script thay vì tabs.query
- **Đã chọn:** Thêm `url: location.href` vào DETECT_XF response từ content script
- **Lý do:** `tabs.query` cần `tabs` permission để trả về `url`. Content script luôn có `location.href` sẵn sàng.
- **Đã cân nhắc nhưng loại:**
  - Dùng `chrome.runtime.getURL` — không trả URL của page
  - Giữ `tabs` permission — mục tiêu là giảm permissions
- **Điều kiện thay đổi:** Nếu cần URL trước khi content script load (chrome://, về blank) — nhưng trong trường hợp đó detection sẽ fail anyway

### Quyết định 2: `navigateToTopic` dùng `tabs.create` thay vì `tabs.update`
- **Đã chọn:** Mở tab mới (`tabs.create`) thay vì navigate tab hiện tại (`tabs.update`)
- **Lý do:** `tabs.update` cần `tabs` permission. UX tradeoff nhỏ — user vẫn đến được thớt.
- **Đã cân nhắc nhưng loại:**
  - Dùng `<a href target="_blank">` — khó integrate với Vue click handler hiện tại
  - Giữ `tabs.update` — mục tiêu là xóa `tabs` permission
- **Điều kiện thay đổi:** Nếu user feedback mạnh muốn navigate in-place

### Quyết định 3: Xóa `scripting` không cần refactor gì
- **Đã chọn:** Xóa trực tiếp khỏi permissions
- **Lý do:** Không có `executeScript` call nào trong toàn bộ codebase. Permission là thừa từ đầu.
- **Điều kiện thay đổi:** Nếu sau này cần inject script dynamic — nhưng sẽ cân nhắc kỹ trước khi thêm lại
