<context>
# Overview

Thay thế toàn bộ static `content_scripts` + `host_permissions` bằng cơ chế dynamic: user tự thêm forum XenForo tùy ý thông qua `chrome.scripting.registerContentScripts()` sau khi chủ động cấp quyền. Không còn domain nào được hard-code trong manifest — manifest hoàn toàn sạch về host access, giúp Chrome Web Store review đơn giản hơn đáng kể.

voz.vn và otofun.net không còn là "forum mặc định" — chúng là forum user thêm đầu tiên thông qua shortcut button trong onboarding empty state.

# Core Features

- **Dynamic content script registration**: User adds forums via Settings/onboarding, extension injects content scripts dynamically via `chrome.scripting.registerContentScripts()`
- **Clean manifest**: No `content_scripts` or `host_permissions` for any forum in manifest.json
- **Onboarding empty state**: First-time user sees shortcut buttons to add voz.vn / otofun.net
- **Settings forum management**: Add/remove forums with permission request flow
- **Persist across sessions**: Forum list survives browser restart and extension update

# User Experience

- User installs extension → opens side panel → sees onboarding empty state with "Thêm voz.vn" / "Thêm otofun.net" buttons
- User clicks shortcut → Chrome permission dialog → approve → forum added immediately, content script injected
- User can also go to Settings → "Forum hỗ trợ" section → add any XenForo forum manually
- Existing forums are listed with remove button
- On Firefox MV2, add forum functionality is disabled (no `chrome.scripting` API)
</context>
<PRD>
# Technical Architecture

## Component A: `entrypoints/content/index.ts` — Remove static matches

```typescript
export default defineContentScript({
  matches: [],   // Empty → WXT compiles content-scripts/content.js but no static manifest entry
  main() {
    // ... keep existing logic
  },
});
```

## Component B: `wxt.config.ts` — Add `scripting`, remove forum host_permissions

- Add `'scripting'` to permissions (Chrome MV3 only, not Firefox)
- Remove voz.vn and otofun.net from host_permissions
- Keep `optional_host_permissions` for custom LLM providers and new forums

## Component C: `lib/types.ts` — UserForum interface

```typescript
export interface UserForum {
  id: string;           // crypto.randomUUID() — used as script ID for registerContentScripts
  hostname: string;     // e.g. 'voz.vn', 'forum.example.com'
  matchPattern: string; // e.g. '*://voz.vn/*'
  origins: string[];    // ['https://voz.vn/*', 'http://voz.vn/*']
  addedAt: number;      // Date.now()
}
```

- Add `'GET_USER_FORUMS' | 'ADD_USER_FORUM' | 'REMOVE_USER_FORUM'` to Message type

## Component D: `lib/constants.ts` — Storage key

```typescript
export const STORAGE_KEYS = {
  // ... existing keys ...
  USER_FORUMS: 'user-forums',
} as const;
```

Uses `chrome.storage.local` (not sync) because permissions are granted per-device.

## Component E: `entrypoints/background/index.ts` — Message handlers + startup re-registration

- **Handler `GET_USER_FORUMS`**: Read from `chrome.storage.local`, return array
- **Handler `ADD_USER_FORUM`**: Call `chrome.scripting.registerContentScripts()`, save to storage
- **Handler `REMOVE_USER_FORUM`**: Call `chrome.scripting.unregisterContentScripts()`, call `chrome.permissions.remove()`, remove from storage
- **Startup re-registration**: On background worker start, re-register all saved forums as safety net

## Component F: `entrypoints/sidepanel/composables/useForumManager.ts` — Shared composable

- `userForums`: reactive ref of UserForum[]
- `loadForums()`: fetch from background via GET_USER_FORUMS
- `addForumByHostname(hostname)`: request permissions → send ADD_USER_FORUM → update local ref
- `addForumFromUrl(url)`: parse URL, dedup check, delegate to addForumByHostname
- `removeForum(forum)`: send REMOVE_USER_FORUM → update local ref

## Component G: `entrypoints/sidepanel/views/SettingsView.vue` — Forum management UI

- List of added forums with remove buttons
- Quick-add shortcut buttons for voz.vn and otofun.net
- Manual URL input for arbitrary XenForo forums
- Error states: duplicate forum, permission denied, invalid URL

## Component H: Empty state — Main side panel view (onboarding)

- Detect `userForums.length === 0` → show onboarding UI
- Shortcut buttons "Thêm voz.vn" / "Thêm otofun.net" (same composable)
- Link to Settings for manual add

# Development Roadmap

Implementation order following dependency chain:

## Phase 1: Foundation (no dependencies)
- [ ] Component A: `entrypoints/content/index.ts` — Change matches to `[]`
- [ ] Component B: `wxt.config.ts` — Add `scripting`, remove forum host_permissions
- [ ] Component C: `lib/types.ts` — Add `UserForum` interface + update Message type
- [ ] Component D: `lib/constants.ts` — Add `USER_FORUMS` storage key

## Phase 2: Background + Composable (depends on Phase 1)
- [ ] Component E: `entrypoints/background/index.ts` — Message handlers + startup re-registration (depends on: C, D)
- [ ] Component F: `entrypoints/sidepanel/composables/useForumManager.ts` — Shared composable (depends on: C, D, E)

## Phase 3: UI (depends on Phase 2)
- [ ] Component G: `entrypoints/sidepanel/views/SettingsView.vue` — Forum management section (depends on: F)
- [ ] Component H: Empty state — main side panel view onboarding (depends on: F)

## Phase 4: Verification
- [ ] Build check: `npm run compile` pass
- [ ] Manifest check: No `content_scripts` or `host_permissions` for forums
- [ ] Manual QA via test plan

# Test Plan

1. **Build clean:** `npm run compile` pass không có type error
2. **Manifest check:** `.output/chrome-mv3/manifest.json` không có `content_scripts` hay `host_permissions` cho voz/otofun
3. **Onboarding:** mở extension lần đầu (chưa có forum nào) → hiện empty state với 2 nút shortcut
4. **Shortcut voz.vn:** click "Thêm voz.vn" → Chrome dialog → approve → navigate voz.vn → mở side panel → detect XenForo bình thường
5. **Manual add:** nhập `https://someotherforum.com` → thêm thành công
6. **Non-XenForo forum:** thêm domain không phải XF → không crash, hiện "Không nhận ra forum"
7. **Duplicate guard:** thêm voz.vn lần 2 → hiện lỗi "Forum này đã được thêm"
8. **Remove forum:** xóa voz.vn → navigate voz.vn → side panel không hoạt động
9. **Persist qua restart:** thêm forum → đóng/mở Chrome → forum vẫn trong list, inject đúng
10. **Permission denied:** Chrome dialog → Cancel → không thêm vào list, hiện thông báo
</PRD>
