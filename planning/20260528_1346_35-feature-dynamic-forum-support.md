# Feature 35: Dynamic Forum Support

## Overview

Thay thế toàn bộ static `content_scripts` + `host_permissions` bằng cơ chế dynamic: user tự thêm forum XenForo tùy ý thông qua `chrome.scripting.registerContentScripts()` sau khi chủ động cấp quyền. Không còn domain nào được hard-code trong manifest — manifest hoàn toàn sạch về host access, giúp Chrome Web Store review đơn giản hơn đáng kể.

voz.vn và otofun.net không còn là "forum mặc định" — chúng là forum user thêm đầu tiên thông qua shortcut button trong onboarding empty state. Quality với các forum khác không được đảm bảo (scraper đã tune đặc thù cho voz/otofun), nhưng XenForo detection và scrape bài viết cơ bản vẫn hoạt động.

## Goals

- Manifest không còn `content_scripts` hay `host_permissions` tĩnh cho bất kỳ forum nào
- Chrome Web Store review không bị flag host access
- User tự thêm forum (bao gồm voz.vn và otofun.net) qua Settings hoặc onboarding
- Onboarding empty state hướng dẫn user add forum ngay lần đầu mở extension
- Shortcut "Thêm voz.vn" / "Thêm otofun.net" giảm friction onboarding
- Extension inject đúng content script vào forum mới ngay sau khi thêm (không cần restart browser)
- Danh sách forum persist qua session và extension update

## Requirements

### Component A: `entrypoints/content/index.ts` — Xóa static matches

```typescript
export default defineContentScript({
  matches: [],   // Empty → WXT compile ra content-scripts/content.js nhưng không đăng ký tĩnh vào manifest
  main() {
    // ... giữ nguyên toàn bộ logic hiện tại
  },
});
```

WXT vẫn compile file này ra `content-scripts/content.js` trong output — đây là file mà `chrome.scripting.registerContentScripts` sẽ reference. Chỉ không có entry trong `content_scripts` của manifest.

### Component B: `wxt.config.ts` — Xóa host_permissions forum, thêm `scripting`

```typescript
permissions: isFirefox
  ? ['storage', 'activeTab', 'tabs']
  : ['storage', 'sidePanel', 'activeTab', 'scripting'],

host_permissions: [
  'https://api.openai.com/*',
  'https://api.anthropic.com/*',
  'https://generativelanguage.googleapis.com/*',
  'https://openrouter.ai/*',
  // voz.vn và otofun.net đã được xóa — user tự add qua dynamic registration
],
```

`scripting` bắt buộc để gọi `chrome.scripting.registerContentScripts()` và `unregisterContentScripts()`. Firefox MV2 không dùng API này nên không thêm.

`optional_host_permissions: ['https://*/*', 'http://*/*']` — giữ nguyên, đã có từ trước (cho custom LLM provider và cho forum mới).

### Component C: `lib/types.ts` — Thêm interface `UserForum`

```typescript
export interface UserForum {
  id: string;           // crypto.randomUUID() — dùng làm script ID cho registerContentScripts
  hostname: string;     // e.g. 'voz.vn', 'forum.example.com'
  matchPattern: string; // e.g. '*://voz.vn/*' — dùng cho registerContentScripts
  origins: string[];    // ['https://voz.vn/*', 'http://voz.vn/*'] — dùng cho permissions.request/remove
  addedAt: number;      // Date.now()
}
```

Cũng cần thêm `'GET_USER_FORUMS' | 'ADD_USER_FORUM' | 'REMOVE_USER_FORUM'` vào `Message` type nếu dùng discriminated union — xem cấu trúc `Message` trong file trước khi implement.

### Component D: `lib/constants.ts` — Thêm storage key

```typescript
export const STORAGE_KEYS = {
  // ... existing keys ...
  USER_FORUMS: 'user-forums',
} as const;
```

Dùng `chrome.storage.local` (không phải `sync`) vì permissions được grant per-device.

### Component E: `entrypoints/background/index.ts` — Message handlers + startup re-registration

**3 message handlers mới:**

```typescript
case 'GET_USER_FORUMS': {
  const result = await browser.storage.local.get(STORAGE_KEYS.USER_FORUMS);
  sendResponse((result[STORAGE_KEYS.USER_FORUMS] as UserForum[]) || []);
  return true;
}

case 'ADD_USER_FORUM': {
  const forum = message.payload as UserForum;
  await chrome.scripting.registerContentScripts([{
    id: forum.id,
    matches: [forum.matchPattern],
    js: ['content-scripts/content.js'],
    runAt: 'document_idle',
    persistAcrossSessions: true,
  }]);
  const result = await browser.storage.local.get(STORAGE_KEYS.USER_FORUMS);
  const forums = (result[STORAGE_KEYS.USER_FORUMS] as UserForum[]) || [];
  if (!forums.find(f => f.hostname === forum.hostname)) {
    forums.push(forum);
    await browser.storage.local.set({ [STORAGE_KEYS.USER_FORUMS]: forums });
  }
  sendResponse({ success: true });
  return true;
}

case 'REMOVE_USER_FORUM': {
  const { id, origins } = message.payload as { id: string; origins: string[] };
  await chrome.scripting.unregisterContentScripts({ ids: [id] }).catch(() => {});
  await chrome.permissions.remove({ origins }).catch(() => {});
  const result = await browser.storage.local.get(STORAGE_KEYS.USER_FORUMS);
  const forums = (result[STORAGE_KEYS.USER_FORUMS] as UserForum[]) || [];
  await browser.storage.local.set({
    [STORAGE_KEYS.USER_FORUMS]: forums.filter(f => f.id !== id),
  });
  sendResponse({ success: true });
  return true;
}
```

**Startup re-registration** (thêm ngay sau `defineBackground(() => {`):

```typescript
reRegisterUserForums().catch(console.error);

async function reRegisterUserForums(): Promise<void> {
  if (!chrome.scripting?.registerContentScripts) return; // Firefox MV2

  const result = await browser.storage.local.get(STORAGE_KEYS.USER_FORUMS);
  const forums = (result[STORAGE_KEYS.USER_FORUMS] as UserForum[]) || [];
  if (forums.length === 0) return;

  const registered = await chrome.scripting.getRegisteredContentScripts();
  const registeredIds = new Set(registered.map(s => s.id));

  for (const forum of forums) {
    if (registeredIds.has(forum.id)) continue;
    await chrome.scripting.registerContentScripts([{
      id: forum.id,
      matches: [forum.matchPattern],
      js: ['content-scripts/content.js'],
      runAt: 'document_idle',
      persistAcrossSessions: true,
    }]).catch(err => console.warn(`[BG] Re-register ${forum.hostname} failed:`, err));
  }
}
```

### Component F: `entrypoints/sidepanel/views/SettingsView.vue` — Forum management section

**State:**

```typescript
const userForums = ref<UserForum[]>([]);
const newForumUrl = ref('');
const addingForum = ref(false);
const addForumError = ref('');
```

**Load khi mount:**

```typescript
// Trong onMounted hoặc onActivated
const forumsResult = await sendMessage<UserForum[]>('GET_USER_FORUMS');
userForums.value = forumsResult || [];
```

**Helper `addForumByHostname(hostname)` — dùng cho cả shortcut buttons và form input:**

```typescript
async function addForumByHostname(hostname: string): Promise<boolean> {
  const origins = [`https://${hostname}/*`, `http://${hostname}/*`];
  const matchPattern = `*://${hostname}/*`;

  const granted = await new Promise<boolean>((resolve) => {
    chrome.permissions.request({ origins }, (result) => {
      if (chrome.runtime.lastError) {
        console.error('[addForum]', chrome.runtime.lastError.message);
        resolve(false);
      } else {
        resolve(result);
      }
    });
  });

  if (!granted) return false;

  const forum: UserForum = {
    id: crypto.randomUUID(),
    hostname,
    matchPattern,
    origins,
    addedAt: Date.now(),
  };

  await sendMessage('ADD_USER_FORUM', forum);
  userForums.value.push(forum);
  return true;
}

async function addForum() {
  addForumError.value = '';
  const urlInput = newForumUrl.value.trim();
  if (!urlInput) return;

  let hostname: string;
  try {
    const parsed = new URL(urlInput.startsWith('http') ? urlInput : `https://${urlInput}`);
    hostname = parsed.hostname;
  } catch {
    addForumError.value = 'URL không hợp lệ.';
    return;
  }

  if (userForums.value.find(f => f.hostname === hostname)) {
    addForumError.value = 'Forum này đã được thêm.';
    return;
  }

  addingForum.value = true;
  try {
    const ok = await addForumByHostname(hostname);
    if (!ok) {
      addForumError.value = 'Chưa cấp quyền truy cập forum.';
    } else {
      newForumUrl.value = '';
    }
  } catch (err) {
    addForumError.value = `Lỗi: ${String(err)}`;
  } finally {
    addingForum.value = false;
  }
}

async function removeForum(forum: UserForum) {
  await sendMessage('REMOVE_USER_FORUM', { id: forum.id, origins: forum.origins });
  userForums.value = userForums.value.filter(f => f.id !== forum.id);
}
```

**Template section trong Settings:**

```html
<section class="settings-section">
  <h3>Forum hỗ trợ</h3>

  <!-- Danh sách forum đã thêm -->
  <div v-if="userForums.length > 0" class="forum-list">
    <div v-for="forum in userForums" :key="forum.id" class="forum-item">
      <span>{{ forum.hostname }}</span>
      <button @click="removeForum(forum)" class="btn-remove">Xóa</button>
    </div>
  </div>

  <!-- Quick-add shortcuts -->
  <div v-if="!userForums.find(f => f.hostname === 'voz.vn') || !userForums.find(f => f.hostname === 'otofun.net')"
       class="forum-shortcuts">
    <span class="label-muted">Thêm nhanh:</span>
    <button v-if="!userForums.find(f => f.hostname === 'voz.vn')"
            @click="addForumByHostname('voz.vn')"
            class="btn-shortcut">+ voz.vn</button>
    <button v-if="!userForums.find(f => f.hostname === 'otofun.net')"
            @click="addForumByHostname('otofun.net')"
            class="btn-shortcut">+ otofun.net</button>
  </div>

  <!-- Manual input -->
  <div class="forum-add">
    <input
      v-model="newForumUrl"
      placeholder="https://forum.example.com"
      @keydown.enter="addForum"
    />
    <button @click="addForum" :disabled="addingForum">
      {{ addingForum ? 'Đang thêm...' : 'Thêm' }}
    </button>
  </div>
  <p v-if="addForumError" class="error-text">{{ addForumError }}</p>

  <p class="disclaimer">
    ⚠️ Chỉ hoạt động với forum XenForo. Khi thêm, Chrome sẽ yêu cầu xác nhận cấp quyền
    cho domain đó. Chất lượng phân tích không được đảm bảo với forum ngoài voz.vn/otofun.net.
  </p>
</section>
```

### Component G: Onboarding empty state — main side panel view

**Tìm file view hiện tại đang hiển thị trạng thái "không nhận ra forum"** (có thể là `TopicsView.vue`, `MainView.vue`, hoặc component chứa logic detect forum). Xem phần nào hiển thị khi `detectResult === undefined` hoặc `version === 'unknown'`.

**Thêm computed check:**

```typescript
// Trong composable hoặc view xử lý forum detection
const hasNoForums = computed(() => userForums.value.length === 0);
```

**Empty state template** (hiển thị khi `hasNoForums` hoặc khi forum chưa được add):

```html
<div v-if="hasNoForums" class="onboarding-empty">
  <p class="onboarding-title">Chưa có forum nào được thêm</p>
  <p class="onboarding-desc">
    Extension cần quyền truy cập forum trước khi hoạt động.
    Thêm forum bên dưới hoặc vào <strong>Cài đặt → Forum hỗ trợ</strong> để quản lý.
  </p>
  <div class="onboarding-shortcuts">
    <button @click="addForumByHostname('voz.vn')" class="btn-primary">
      Thêm voz.vn
    </button>
    <button @click="addForumByHostname('otofun.net')" class="btn-secondary">
      Thêm otofun.net
    </button>
  </div>
  <p class="onboarding-note">
    Forum khác? Vào <strong>Cài đặt → Forum hỗ trợ</strong> để thêm thủ công.
  </p>
</div>
```

`addForumByHostname` ở đây là hàm dùng chung — nên extract ra composable `useForumManager.ts` để dùng ở cả Settings lẫn empty state mà không duplicate logic.

**Gợi ý extract composable `useForumManager.ts`:**

```typescript
// entrypoints/sidepanel/composables/useForumManager.ts
export function useForumManager() {
  const userForums = ref<UserForum[]>([]);

  async function loadForums() {
    userForums.value = (await sendMessage<UserForum[]>('GET_USER_FORUMS')) || [];
  }

  async function addForumByHostname(hostname: string): Promise<boolean> {
    // ... logic như trên
  }

  async function addForumFromUrl(url: string): Promise<{ ok: boolean; error?: string }> {
    // parse URL, dedup check, gọi addForumByHostname
  }

  async function removeForum(forum: UserForum): Promise<void> {
    // ...
  }

  return { userForums, loadForums, addForumByHostname, addForumFromUrl, removeForum };
}
```

Import và dùng ở cả `SettingsView.vue` lẫn view chứa empty state.

## Technical Considerations

- **`matches: []` trong WXT:** WXT sẽ compile `entrypoints/content/index.ts` ra `content-scripts/content.js` nhưng không thêm entry vào `content_scripts` manifest. File vẫn accessible bằng `chrome.scripting.registerContentScripts`.
- **`scripting` permission và Firefox:** Firefox MV2 không có API này. Guard bằng `if (!chrome.scripting?.registerContentScripts) return`. UI có thể hiển thị trên Firefox nhưng nên disable nút Thêm forum với tooltip giải thích.
- **`persistAcrossSessions: true`** (default): scripts tự persist qua browser restart. Startup re-registration là safety net cho extension update.
- **Dynamic granted permissions áp dụng cho background fetch:** Khi user grant `https://voz.vn/*`, service worker có thể fetch từ voz.vn (cho multi-page scraping) — không cần thêm host_permissions tĩnh.
- **`chrome.permissions.remove` khi xóa:** best-effort, không throw nếu fail.
- **Shortcut `addForumByHostname` phải từ user gesture:** button click đáp ứng yêu cầu này của Chrome `permissions.request`.

## Implementation Notes

Thứ tự implement:
1. `lib/types.ts` — thêm `UserForum` + update `Message` type
2. `lib/constants.ts` — thêm `USER_FORUMS` key
3. `entrypoints/content/index.ts` — đổi `matches` thành `[]`
4. `wxt.config.ts` — thêm `scripting`, xóa forum URLs khỏi `host_permissions`
5. `entrypoints/background/index.ts` — 3 handlers + startup re-registration
6. `entrypoints/sidepanel/composables/useForumManager.ts` — extract composable dùng chung
7. `entrypoints/sidepanel/views/SettingsView.vue` — forum management section
8. View chứa empty state — tìm đúng file, thêm onboarding UI

Trước bước 7-8: đọc kỹ cấu trúc sidepanel app để xác định đúng file cần sửa, đặc biệt là:
- File nào handle "không nhận ra forum" / `version === 'unknown'` hiện tại
- Pattern `onMounted`/`onActivated` trong SettingsView để biết nơi gọi `loadForums()`

## Test Plan

1. **Build clean:** `npm run compile` pass không có type error
2. **Manifest check:** `.output/chrome-mv3/manifest.json` không có `content_scripts` hay `host_permissions` cho voz/otofun
3. **Onboarding:** mở extension lần đầu (chưa có forum nào) → hiện empty state với 2 nút shortcut
4. **Shortcut voz.vn:** click "Thêm voz.vn" → Chrome dialog → approve → navigate voz.vn → mở side panel → extension detect XenForo bình thường
5. **Shortcut otofun.net:** tương tự
6. **Manual add:** nhập `https://someotherforum.com` → thêm thành công
7. **Non-XenForo forum:** thêm domain không phải XF → không crash, hiện "Không nhận ra forum"
8. **Duplicate guard:** thêm voz.vn lần 2 → hiện lỗi "Forum này đã được thêm"
9. **Remove forum:** xóa voz.vn → navigate voz.vn → side panel không hoạt động
10. **Persist qua restart:** thêm forum → đóng/mở Chrome → forum vẫn trong list, inject đúng
11. **Permission denied:** Chrome dialog → Cancel → không thêm vào list, hiện thông báo

## Decision Log

### Quyết định 1: Xóa hoàn toàn static content_scripts

- **Đã chọn:** `matches: []` trong `defineContentScript`, không còn host_permissions cho forum nào
- **Lý do:** Manifest không có static host access → CWS review đơn giản hơn đáng kể. UX trade-off duy nhất là onboarding thêm 1 bước, được giải quyết bằng shortcut buttons. Dynamic granted permissions đủ cho cả content script injection lẫn background fetch — không mất tính năng.
- **Đã cân nhắc nhưng loại:**
  - Giữ voz.vn + otofun.net trong static matches — loại vì đây chính là lý do CWS flag
- **Điều kiện thay đổi:** Nếu CWS cũng xét kỹ `scripting` + `optional_host_permissions` và vẫn reject thì không còn lý do để xóa static matches

### Quyết định 2: Extract `useForumManager` composable

- **Đã chọn:** Composable dùng chung cho cả Settings lẫn empty state onboarding
- **Lý do:** `addForumByHostname` cần dùng ở 2 nơi (SettingsView và empty state view). Không duplicate logic.
- **Điều kiện thay đổi:** Nếu chỉ dùng ở 1 nơi thì không cần extract

### Quyết định 3: Shortcut buttons trong empty state (không phải chỉ trong Settings)

- **Đã chọn:** Hiện shortcut "Thêm voz.vn" / "Thêm otofun.net" ngay trong main panel khi chưa có forum
- **Lý do:** User lần đầu mở extension sẽ thấy empty state trước Settings. Đưa action vào đúng context giảm friction tối đa — không cần biết Settings ở đâu.
- **Đã cân nhắc nhưng loại:**
  - Chỉ có shortcut trong Settings — loại vì user mới không biết phải vào Settings
- **Điều kiện thay đổi:** Nếu onboarding flow phức tạp hơn (multi-step wizard) thì tách ra screen riêng

### Quyết định 4: `chrome.storage.local` thay vì `sync`

- **Đã chọn:** `local`
- **Lý do:** Permissions được grant per-device. Sync list sang device khác tạo inconsistency.
- **Điều kiện thay đổi:** Nếu có auto re-request permission khi load list thì có thể dùng `sync`

### Quyết định 5: Side panel gọi `permissions.request`, background gọi `registerContentScripts`

- **Đã chọn:** Split giữa side panel (user gesture context) và background (scripting API)
- **Lý do:** `permissions.request` bắt buộc từ user gesture. `registerContentScripts` không cần. Phân tách rõ trách nhiệm.
- **Điều kiện thay đổi:** Nếu background không accessible có thể gọi cả hai từ side panel
