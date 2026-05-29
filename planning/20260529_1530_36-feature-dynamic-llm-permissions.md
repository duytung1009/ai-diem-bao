# Feature 36: Dynamic LLM Provider Permissions

## Overview

Chuyển toàn bộ `host_permissions` tĩnh của các LLM provider (OpenAI, Anthropic, Gemini, OpenRouter) sang dynamic permissions thông qua `chrome.permissions.request()`. Sau khi hoàn thành, manifest sẽ không còn bất kỳ `host_permissions` nào liên quan đến LLM — chỉ còn `optional_host_permissions: ['https://*/*', 'http://*/*']` đóng vai trò whitelist pattern. Quyền được cấp khi user save hoặc test connection lần đầu với một provider.

Mục tiêu: loại bỏ toàn bộ `host_permissions` khỏi manifest để extension không bị Chrome Web Store gắn cờ "host permission warning" ngay khi cài đặt.

## Goals

- Manifest zero `host_permissions` (kể cả 4 provider đã biết)
- Dynamic permissions request xảy ra tại thời điểm user gesture (save / test)
- UX mượt: dialog permission của Chrome chỉ hiện một lần per provider; lần sau không hỏi lại
- Backward compatible: user đang dùng extension vẫn hoạt động bình thường sau update

## Requirements

### Component A — wxt.config.ts

- Xóa toàn bộ mảng `host_permissions` (4 provider URLs)
- Giữ `optional_host_permissions: ['https://*/*', 'http://*/*']` — pattern này bao phủ tất cả provider lẫn custom endpoint
- Giữ các permissions hiện có (storage, sidePanel, activeTab, scripting)

### Component B — Utility `lib/permissions.ts` (file mới)

Tạo module dùng chung để xử lý permission request cho LLM provider:

```typescript
// Trả về origin pattern từ baseUrl, ví dụ: 'https://api.openai.com/*'
export function originFromUrl(url: string): string | null

// Request permission cho một origin. Trả về true nếu granted.
// Trong DEV mode (import.meta.env.DEV): luôn trả về true (WXT dev manifest bỏ optional_host_permissions).
export async function requestOriginPermission(origin: string): Promise<boolean>

// Check xem một origin đã được grant chưa (dùng chrome.permissions.contains).
export async function hasOriginPermission(origin: string): Promise<boolean>
```

Dùng native `chrome.permissions.request` callback API (không dùng `browser.permissions.request` — polyfill không đáng tin trong side panel context, đã xác nhận ở Feature trước).

### Component C — Provider base URL map `lib/llm/provider-origins.ts` (file mới)

```typescript
// Map từ LLMProvider sang base URL tương ứng để tính origin
export const PROVIDER_BASE_URLS: Record<LLMProvider, string> = {
  openai:      'https://api.openai.com/v1',
  claude:      'https://api.anthropic.com',
  gemini:      'https://generativelanguage.googleapis.com',
  'gemini-free': 'https://generativelanguage.googleapis.com',
  openrouter:  'https://openrouter.ai/api/v1',
  custom:      '', // custom dùng config.baseUrl trực tiếp
};

// Trả về origin string cần request cho provider
export function getProviderOrigin(provider: LLMProvider, baseUrl: string): string | null
```

### Component D — SettingsView.vue: refactor `requestCustomOriginPermission`

Hàm hiện tại chỉ xử lý `custom` provider. Cần generalize:

- Rename → `requestProviderPermission(provider: LLMProvider, baseUrl: string): Promise<boolean>`
- Với provider đã biết: lấy origin từ `PROVIDER_BASE_URLS[provider]`
- Với `custom`: lấy origin từ `baseUrl` (logic cũ)
- Gọi `hasOriginPermission(origin)` trước — nếu đã granted thì skip dialog (tránh hỏi lại)
- Nếu chưa granted → gọi `requestOriginPermission(origin)`

Cập nhật hai nơi gọi:
- `save()`: thay điều kiện `if (provider === 'custom')` → `await requestProviderPermission(provider, baseUrl)`
- `testConnection()`: tương tự

### Component E — Background: xử lý fetch sau khi permission đã granted

Background service worker (`entrypoints/background/index.ts`) thực hiện LLM fetch. Dynamic permissions propagate tự động sang service worker — không cần thay đổi code fetch. Tuy nhiên cần verify: nếu permission chưa được grant (ví dụ user bypass bước save), fetch sẽ fail với "Failed to fetch". Đây là edge case chấp nhận được vì permission luôn được request trước khi fetch trong normal flow.

### Component F — Migration: user hiện tại

User đang dùng extension với static `host_permissions` được granted ngầm định. Sau update lên version mới (bỏ static host_permissions), Chrome sẽ thu hồi các quyền đó. Lần đầu user dùng sau update:
- Nếu họ mở Settings và Save → permission request sẽ hiện
- Nếu họ thử phân tích thread ngay mà không vào Settings → LLM fetch sẽ fail

Cần thêm **migration handler** trong background `onInstalled` listener:
```typescript
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'update') {
    // Auto-request permissions cho provider hiện tại trong storage
    // Không thể dùng chrome.permissions.request ở đây (không phải user gesture)
    // → Chỉ có thể set flag "needs_permission_reauth" trong storage
    // → Side panel đọc flag này khi mở và hiển thị banner
  }
});
```

**Approach:** Thêm banner thông báo trong SettingsView khi phát hiện provider đang config chưa có permission. Banner có nút "Cấp quyền" để trigger permission request từ user gesture.

## Technical Considerations

- `chrome.permissions.request()` chỉ hoạt động từ user gesture context — side panel button click là hợp lệ
- `chrome.permissions.contains()` có thể gọi ở bất kỳ đâu (không cần user gesture) — dùng để check trước
- Permission granted tồn tại qua browser restart nhưng bị thu hồi khi extension update xóa pattern khỏi `optional_host_permissions` — pattern hiện tại giữ nguyên nên không bị thu hồi
- `gemini` và `gemini-free` có cùng origin → request một lần là đủ cho cả hai
- DEV mode: WXT không inject `optional_host_permissions` vào dev manifest → dùng `import.meta.env.DEV` bypass như đã làm với custom provider

## Implementation Notes

Thứ tự triển khai:
1. Tạo `lib/permissions.ts` và `lib/llm/provider-origins.ts`
2. Sửa `wxt.config.ts` — xóa `host_permissions`
3. Refactor `SettingsView.vue` — `requestProviderPermission()`
4. Thêm permission check + banner trong SettingsView `onMounted`
5. Test từng provider: save → dialog hiện → granted → test connection OK

Files cần sửa:
- `wxt.config.ts`
- `entrypoints/sidepanel/views/SettingsView.vue`
- `lib/permissions.ts` (tạo mới)
- `lib/llm/provider-origins.ts` (tạo mới)

## Test Plan

- [ ] Build production (`pnpm build`), load unpacked → manifest không có `host_permissions`
- [ ] Chọn OpenAI, Save → Chrome permission dialog hiện với `api.openai.com` → grant → test connection thành công
- [ ] Save lại lần 2 → dialog KHÔNG hiện (permission đã cached)
- [ ] Chọn Gemini, Save → dialog hiện với `generativelanguage.googleapis.com`
- [ ] Chọn Custom với URL local → dialog hiện với origin đúng
- [ ] Simulate update (reload extension) → banner "cần cấp lại quyền" hiện nếu chưa grant
- [ ] DEV mode: `pnpm dev` → không có dialog, kết nối bình thường

## Decision Log

### Quyết định 1: Khi nào trigger permission request

- **Đã chọn:** Tại thời điểm Save hoặc Test Connection trong SettingsView
- **Lý do:** Đây là user gesture rõ ràng; người dùng đang chủ động configure provider nên việc dialog permission xuất hiện là expected. Không trigger ở background fetch vì background không phải user gesture context.
- **Đã cân nhắc nhưng loại:**
  - Trigger khi chuyển provider dropdown — loại vì user chưa confirm, có thể chỉ đang xem options
  - Trigger khi mở SettingsView — loại vì onMounted không phải direct user gesture, Chrome có thể block
- **Điều kiện thay đổi:** Nếu Chrome cho phép permissions.request từ non-gesture context trong tương lai

### Quyết định 2: Có check `hasOriginPermission` trước không

- **Đã chọn:** Có — gọi `chrome.permissions.contains()` trước, skip dialog nếu đã granted
- **Lý do:** Tránh dialog spam mỗi lần user Save. UX tệ nếu dialog hiện liên tục dù đã granted.
- **Đã cân nhắc nhưng loại:**
  - Không check, luôn request — Chrome tự suppress dialog nếu đã granted (chưa verify behavior này, không nên phụ thuộc vào undocumented behavior)
- **Điều kiện thay đổi:** Nếu verify được Chrome suppress duplicate dialogs tự động

### Quyết định 3: Migration cho user hiện tại

- **Đã chọn:** Banner thông báo trong SettingsView với nút "Cấp quyền"
- **Lý do:** Không thể auto-request từ `onInstalled` vì không phải user gesture. Banner là UX rõ ràng, user hiểu tại sao cần thêm bước.
- **Đã cân nhắc nhưng loại:**
  - Silent fail rồi hiện lỗi khi phân tích thread — loại vì confusing, user không biết nguyên nhân
  - Force user vào Settings khi mở side panel lần đầu sau update — loại vì quá disruptive
- **Điều kiện thay đổi:** Nếu tìm được cách request permission từ background context

### Quyết định 4: Cấu trúc code — module riêng vs inline

- **Đã chọn:** Tạo `lib/permissions.ts` riêng dùng chung cho cả LLM provider lẫn forum (Feature 35 có `useForumManager` cũng dùng permissions.request)
- **Lý do:** DRY — logic DEV bypass, callback-to-promise wrap, error handling đã duplicate ở hai chỗ. Module chung dễ test và maintain.
- **Đã cân nhắc nhưng loại:**
  - Inline trong SettingsView — loại vì đã có code tương tự ở useForumManager, không nên duplicate thêm
- **Điều kiện thay đổi:** Nếu logic phân kỳ nhiều giữa LLM và forum use case
