# Feature 31: Firefox Add-on Support

## Overview

Port extension sang Firefox. Hiện tại codebase dùng WXT 0.20 (đã có `dev:firefox` / `build:firefox` scripts) nhưng có 2 blocker cứng khiến extension crash hoặc không có UI trên Firefox. Scope: fix blockers, tạo Firefox sidebar entrypoint, conditional manifest, guard Chrome-only APIs — không thay đổi logic nghiệp vụ.

## Goals

- Extension load và chạy được trên Firefox 121+ mà không crash
- Sidebar mở đúng khi click icon extension (tương đương sidePanel trên Chrome)
- Toàn bộ tính năng hiện có (tóm tắt, knowledge, analysis, settings...) hoạt động như Chrome
- Build `wxt build -b firefox` ra file zip sẵn sàng submit AMO

## Requirements

### Component A: wxt.config.ts — Conditional manifest

- Chuyển `manifest` từ object sang function `(env) => ({...})` để branch theo `env.browser`
- Chrome: giữ nguyên `permissions: ['storage', 'sidePanel', 'activeTab']`
- Firefox: `permissions: ['storage', 'activeTab', 'tabs']` — bỏ `sidePanel`, thêm `tabs`
- Firefox cần `tabs` vì `browser.tabs.query` từ sidebar không guaranteed hoạt động với chỉ `activeTab`
- Firefox cần thêm `browser_specific_settings.gecko.id` (bắt buộc để submit AMO):
  ```json
  "browser_specific_settings": { "gecko": { "id": "loithothо@extension", "strict_min_version": "121.0" } }
  ```

### Component B: entrypoints/background/index.ts — Guard Chrome-only APIs

- `browser.sidePanel.setPanelBehavior(...)` ở line 14: wrap bằng optional chaining hoặc check `import.meta.env.BROWSER`
  ```ts
  if (import.meta.env.BROWSER === 'chrome') {
    browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true });
  }
  ```
- Keepalive `setInterval` (lines 44-47): guard tương tự — Firefox service worker không bị aggressive terminate như Chrome, trick này không cần thiết và tạo noise
  ```ts
  const keepalive = import.meta.env.BROWSER === 'chrome'
    ? setInterval(() => { void browser.storage.sync.get(''); }, KEEPALIVE_INTERVAL_MS)
    : null;
  ```

### Component C: entrypoints/sidebar/ — Firefox sidebar entrypoint

WXT dùng hai entrypoint type khác nhau:
- `entrypoints/sidepanel/` → Chrome `side_panel` manifest key
- `entrypoints/sidebar/` → Firefox `sidebar_action` manifest key

Cần tạo `entrypoints/sidebar/` cho Firefox, reuse toàn bộ code Vue từ `sidepanel/`:

**Approach:** Extract bootstrap logic ra `lib/create-app.ts`, import từ cả hai entrypoint:

```ts
// lib/create-app.ts  (NEW)
export function mountApp() {
  // nội dung hiện tại của entrypoints/sidepanel/main.ts
  // createApp(App).use(router).mount('#app')
}
```

```ts
// entrypoints/sidepanel/main.ts  (refactor)
import { mountApp } from '@/lib/create-app';
mountApp();
```

```ts
// entrypoints/sidebar/main.ts  (NEW)
import { mountApp } from '@/lib/create-app';
mountApp();
```

`entrypoints/sidebar/index.html` — copy từ `entrypoints/sidepanel/index.html`.

Lưu ý: `sidebar_action` trên Firefox mở sidebar khi click icon tự động (đây là default behavior) — không cần `setPanelBehavior` equivalent.

### Component D: App.vue — tabs permission verification

`App.vue` dùng:
- `browser.tabs.onActivated` / `browser.tabs.onUpdated` — event listeners, hoạt động với `tabs` permission
- `browser.tabs.query({ active: true, currentWindow: true })` — cần `tabs` permission trên Firefox
- `browser.tabs.sendMessage(tab.id, ...)` — hoạt động với `tabs` permission

Không cần thay đổi code App.vue nếu đã thêm `tabs` permission vào manifest Firefox (Component A). Chỉ cần verify runtime behavior.

## Technical Considerations

- **WXT version:** 0.20.18 — hỗ trợ cả `sidepanel` và `sidebar` entrypoint natively
- **`import.meta.env.BROWSER`:** WXT inject sẵn, type-safe, tree-shaken lúc build
- **Shared router:** Vue Router `createWebHashHistory` hoạt động giống nhau trên cả hai entrypoint
- **IndexedDB, fetch, storage:** Tất cả hoạt động bình thường trên Firefox — không cần thay đổi
- **`browser.tabs.create`:** Không cần `tabs` permission (đúng với cả Chrome lẫn Firefox)
- **AMO submission:** Firefox Add-ons Marketplace yêu cầu `gecko.id` trong manifest. Extension cần pass AMO review — không có remote code execution, không có eval, fetch chỉ đến user-configured LLM endpoints (pass review)
- **Firefox MV3 min version:** 121.0 (service workers trong MV3 ổn định từ bản này)

## Implementation Notes

Thứ tự implement:
1. `wxt.config.ts` trước — unblock build
2. Guard `background/index.ts` — unblock load
3. Tạo `sidebar/` entrypoint — unblock UI
4. Verify `tabs` permission với `dev:firefox`
5. Manual smoke test trên Firefox

Files cần sửa/tạo:
- `wxt.config.ts` — sửa
- `entrypoints/background/index.ts` — sửa (2 chỗ)
- `lib/create-app.ts` — TẠO MỚI
- `entrypoints/sidepanel/main.ts` — refactor nhỏ
- `entrypoints/sidebar/main.ts` — TẠO MỚI
- `entrypoints/sidebar/index.html` — TẠO MỚI (copy từ sidepanel)

## Test Plan

1. `npm run build:firefox` — phải build thành công không có lỗi
2. Load unpacked trên Firefox: `about:debugging` → Load Temporary Add-on → chọn `manifest.json` trong `.output/firefox-mv3/`
3. Verify sidebar mở khi click icon
4. Điều hướng đến thread VOZ/OtoFun, kiểm tra detect + summarize
5. Verify settings lưu/đọc đúng
6. Chrome build (`npm run build`) vẫn pass — không regression

## Decision Log

### Quyết định 1: Extract `mountApp()` vs duplicate `main.ts`

- **Đã chọn:** Extract `lib/create-app.ts` shared bootstrap
- **Lý do:** Tránh hai file `main.ts` diverge khi thêm route mới sau này. DRY nguyên tắc cơ bản.
- **Đã cân nhắc nhưng loại:**
  - Duplicate `main.ts` — loại vì dễ quên sync khi thêm route
  - Symlink — loại vì Windows không reliable với symlink trong git
- **Điều kiện thay đổi:** Nếu sidebar Firefox cần behavior khác (ví dụ: route khác nhau, init logic riêng) thì split lại

### Quyết định 2: `tabs` permission cho Firefox

- **Đã chọn:** Thêm `tabs` vào Firefox manifest, giữ nguyên Chrome manifest (Chrome không cần)
- **Lý do:** Firefox stricter về `tabs.query` từ sidebar context. Thêm `tabs` là safe nhất, không ảnh hưởng UX vì không show permission prompt (không phải sensitive permission trên Firefox)
- **Đã cân nhắc nhưng loại:**
  - Không thêm và test xem có pass không — loại vì rủi ro bị lỗi silent (query trả về empty array thay vì throw)
- **Điều kiện thay đổi:** Nếu Firefox tương lai relax permission requirement cho sidebar context

### Quyết định 3: Guard bằng `import.meta.env.BROWSER` vs runtime check

- **Đã chọn:** `import.meta.env.BROWSER` compile-time check
- **Lý do:** Tree-shaken hoàn toàn — Firefox build sẽ không có dead code của `sidePanel` API call. Runtime check (`if (browser.sidePanel)`) hoạt động nhưng để lại dead code trong bundle.
- **Đã cân nhắc nhưng loại:**
  - `if (browser.sidePanel?.setPanelBehavior)` — hoạt động nhưng không tree-shake
- **Điều kiện thay đổi:** Nếu cần support browser khác (Edge, Safari) thì có thể cần runtime check thay thế
