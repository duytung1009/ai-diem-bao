# Chrome Extension Permission Policy

Extension hướng đến Chrome Web Store — mọi permission thêm vào đều phải được justify rõ ràng. Reviewer sẽ đọc manifest và hỏi tại sao cần permission này.

## Bộ permissions tối thiểu hiện tại

```
permissions: ['storage', 'sidePanel', 'activeTab']
host_permissions: []
```

## Nguyên tắc — theo thứ tự ưu tiên

**1. `scripting` permission — WXT tự động inject, không cần khai báo và không thể xóa**

WXT framework hard-code thêm `scripting` vào mọi MV3 extension tại `node_modules/wxt/dist/core/utils/manifest.mjs:264`:
```js
if (wxt.config.manifestVersion === 3) addPermission(manifest, "scripting");
```
- **Không khai báo `scripting` trong `wxt.config.ts`** — WXT tự thêm vào built manifest
- **Không gọi `executeScript` trong code** — `scripting` chỉ dùng bởi WXT framework nội bộ
- Khi giải thích với Chrome Web Store reviewer: *"The `scripting` permission is added by the WXT build framework for content script registration. Our extension code never calls `chrome.scripting.executeScript()` directly."*

**2. Không thêm `tabs` permission — dùng alternative**

| Nhu cầu | Sai (cần `tabs`) | Đúng (không cần) |
|---------|-----------------|-----------------|
| Lấy URL tab hiện tại | `tabs.query().url` | Content script `location.href` trong DETECT_XF response |
| Mở link trong tab mới | `tabs.create()` | `tabs.create()` — thực ra không cần permission! |
| Navigate tab hiện tại | `tabs.update(id, {url})` | Dùng `tabs.create()` thay (mở tab mới) |
| Nghe tab switch | `tabs.onActivated` | `tabs.onActivated` — không cần permission! |

`tabs` permission chỉ cần nếu muốn đọc `tab.url` từ `tabs.query`. Alternative: luôn lấy URL từ content script.

**3. Dùng `optional_host_permissions` + runtime request thay vì `host_permissions` cứng**

- `optional_host_permissions: ['https://*/*', 'http://*/*']` trong manifest cho phép xin quyền động
- Background `FETCH_HTML` / `FETCH_FORUM_LIST` kiểm tra `chrome.permissions.contains()` trước mỗi fetch; nếu chưa có, trả `needPermission` cho caller
- Sidepanel hiển thị prompt → user click "Cấp quyền" → `chrome.permissions.request()` (phải có user gesture)
- `lib/permissions.ts`: `hasOriginPermission()`, `requestOriginPermission()`, `requestOriginsPermission()`
- `useForumManager.ts`: dùng `requestOriginsPermission` khi thêm forum mới
- `useSummarize.ts` / `NewsFeedView.vue`: pre-flight check + prompt fallback khi fetch bị CORS

**Lưu ý:** Background service worker trong Chrome MV3 **cần** `host_permissions` để bypass CORS khi `fetch()` cross-origin. `optional_host_permissions` + `chrome.permissions.request()` là giải pháp thay thế an toàn cho Chrome Web Store.

**4. `activeTab` là quyền mạnh nhất cần thiết**

Khi user mở Side Panel, `activeTab` cấp quyền tạm thời để:
- `tabs.sendMessage` đến tab hiện tại
- Content script nhận và trả về `{version, url: location.href, postCount, ...}`

## Khi nào mới được thêm permission mới

Chỉ thêm permission mới khi **cả 3 điều kiện** thỏa mãn:
1. Có use case cụ thể không thể làm theo cách khác
2. Đã tìm kiếm alternative ít nhạy cảm hơn và không có
3. Ghi rõ vào Decision Log của planning file tại sao cần permission này

## Pattern `detectActiveTabTopic()` không cần `tabs` permission

Vấn đề: `tabs.query({ active, currentWindow })` không trả `url` nếu thiếu `tabs` permission.

Fix: lấy `tabId` từ `tabs.query` (tabId vẫn được trả), sau đó `tabs.sendMessage(tabId, DETECT_XF)` → content script trả về `{ url: location.href, ... }`.

```typescript
// ✅ Không cần tabs permission
const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
if (!tab?.id) return;  // Chỉ cần tabId, không cần tab.url

const result = await browser.tabs.sendMessage(tab.id, { type: 'DETECT_XF' });
// result.url = location.href từ content script
store.setActiveTab(result, result.url);

// ❌ Cần tabs permission (tránh)
if (!tab?.id || !tab.url) return;
store.setActiveTab(result, tab.url);
```
