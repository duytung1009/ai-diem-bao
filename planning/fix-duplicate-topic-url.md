# Fix Bug: Duplicate Topics Due to URL Normalization

## Bug Description
Cùng 1 chủ đề nhưng xuất hiện 2 lần trong Topic Hub do URL normalization không nhất quán:
- `https://voz.vn/t/slug.1219089/` → normalized = `https://voz.vn/t/slug.1219089/` (trailing slash giữ nguyên)
- `https://voz.vn/t/slug.1219089/page-3` → normalized = `https://voz.vn/t/slug.1219089` (trailing slash bị mất)

Kết quả: 2 cache key khác nhau → 2 entry riêng biệt trong `browser.storage.local`.

## Root Cause
`normalizeUrl()` trong `lib/cache-manager.ts` dòng 11:
```typescript
u.pathname = u.pathname.replace(/\/page-\d+$/, '');
```
Regex chỉ strip `/page-\d+` ở cuối pathname. Khi URL gốc có trailing slash (`/slug.1219089/`), regex không match nên slash giữ nguyên. Khi URL có page suffix (`/slug.1219089/page-3`), regex strip `/page-3` nhưng không thêm lại trailing slash → kết quả khác nhau.

Ngoài ra, `normalizeForCompare()` trong `TopicHubView.vue` có cùng regex → cùng bug.

## Scope of Impact
- `lib/cache-manager.ts`: `normalizeUrl()` → ảnh hưởng `cacheKey()`, `getCachedTopic()`, `saveCachedTopic()`, `deleteCachedTopic()`
- `entrypoints/sidepanel/views/TopicHubView.vue`: `normalizeForCompare()` → ảnh hưởng `activeTabInList` computed
- `entrypoints/background/index.ts`: `SAVE_CACHED_TOPIC` handler lưu raw URL vào field `topic.url` → field URL trong CachedTopic không consistent

---

## Task 1: Fix `normalizeUrl()` trong `cache-manager.ts`

### File: `lib/cache-manager.ts`, dòng 8-18

**Sửa function `normalizeUrl`:** Sau khi strip `/page-\d+`, đảm bảo pathname luôn kết thúc bằng `/`:

```typescript
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.pathname = u.pathname.replace(/\/page-\d+\/?$/, '');
    // Ensure trailing slash for consistency
    if (!u.pathname.endsWith('/')) u.pathname += '/';
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}
```

**Chi tiết thay đổi:**
1. Sửa regex từ `/\/page-\d+$/` thành `/\/page-\d+\/?$/` — handle cả trường hợp `/page-3` và `/page-3/`
2. Thêm `if (!u.pathname.endsWith('/')) u.pathname += '/';` — đảm bảo trailing slash nhất quán

**Verify:** `normalizeUrl('https://voz.vn/t/slug.1219089/')` === `normalizeUrl('https://voz.vn/t/slug.1219089/page-3')`

---

## Task 2: Fix `normalizeForCompare()` trong `TopicHubView.vue`

### File: `entrypoints/sidepanel/views/TopicHubView.vue`, dòng 42-50

Cùng bug, cùng fix:

```typescript
function normalizeForCompare(url: string): string {
  try {
    const u = new URL(url);
    u.pathname = u.pathname.replace(/\/page-\d+\/?$/, '');
    if (!u.pathname.endsWith('/')) u.pathname += '/';
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch { return url; }
}
```

**Lưu ý:** Hàm này duplicate logic với `normalizeUrl` trong cache-manager. Có thể xem xét export `normalizeUrl` từ cache-manager để reuse, nhưng đó là optional refactor — fix bug trước.

---

## Task 3: Normalize URL khi lưu vào `CachedTopic.url`

### File: `entrypoints/background/index.ts`, handler `SAVE_CACHED_TOPIC` (dòng 101-128)

**Vấn đề:** Dòng 111 lưu raw URL vào `topic.url`:
```typescript
url,  // raw URL, chưa normalized
```

Điều này gây ra `CachedTopic.url` không nhất quán — lúc có trailing slash, lúc không. Khi `getAllCachedTopics()` trả về danh sách, TopicHub hiển thị URL gốc khác nhau cho cùng 1 topic.

**Fix:** Normalize URL trước khi lưu vào CachedTopic:

Cần export `normalizeUrl` từ `cache-manager.ts` hoặc tạo utility riêng.

### 3a. Export `normalizeUrl` từ `lib/cache-manager.ts`
Đổi từ `function normalizeUrl` thành `export function normalizeUrl`.

### 3b. Sửa background handler
```typescript
import { getCachedTopic, saveCachedTopic, deleteCachedTopic, getCacheSize, getAllCachedTopics, normalizeUrl } from '@/lib/cache-manager';

// Trong SAVE_CACHED_TOPIC handler:
const topic: CachedTopic = {
  url: normalizeUrl(url),  // ← normalized thay vì raw
  // ... rest unchanged
};
```

### 3c. Sửa handler `GET_CACHED_TOPIC` (dòng 91-98)
URL từ `getActiveTabUrl()` cũng chưa normalized. `getCachedTopic()` đã normalize khi tạo key, nhưng để nhất quán:
```typescript
case 'GET_CACHED_TOPIC': {
  const payloadUrl = message.payload as string | undefined;
  const urlPromise = payloadUrl ? Promise.resolve(payloadUrl) : getActiveTabUrl();
  urlPromise
    .then((url) => (url ? getCachedTopic(url) : null))  // getCachedTopic đã normalize key nên OK
    .then(sendResponse)
    .catch(() => sendResponse(null));
  return true;
}
```
Handler này OK vì `getCachedTopic` normalize khi tạo key. Không cần sửa.

---

## Task 4: Migrate dữ liệu cache cũ bị duplicate

### File: `entrypoints/background/index.ts`

**Vấn đề:** User có thể đã có 2 cache entries cho cùng 1 topic (1 có trailing slash, 1 không). Sau khi fix normalization, entry mới sẽ luôn có trailing slash, nhưng entry cũ không trailing slash vẫn tồn tại.

**Fix:** Thêm one-time migration khi background khởi động:

```typescript
// Trong defineBackground(), sau setPanelBehavior:
async function migrateNormalizedUrls() {
  const all = await browser.storage.local.get(null);
  const toDelete: string[] = [];
  const toSave: Record<string, CachedTopic> = {};

  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(STORAGE_KEYS.CACHE_PREFIX)) continue;
    if (!value || typeof value !== 'object' || !('url' in value)) continue;

    const topic = value as CachedTopic;
    const normalizedKey = `${STORAGE_KEYS.CACHE_PREFIX}${normalizeUrl(topic.url)}`;

    if (normalizedKey !== key) {
      // Key needs migration
      toDelete.push(key);
      // Merge with existing normalized entry if it exists
      const existing = toSave[normalizedKey] || (all[normalizedKey] as CachedTopic | undefined);
      if (existing && existing.cachedAt > topic.cachedAt) {
        // Keep newer entry, just delete old key
      } else {
        toSave[normalizedKey] = { ...topic, url: normalizeUrl(topic.url) };
      }
    } else if (topic.url !== normalizeUrl(topic.url)) {
      // Key is correct but stored url field is not normalized
      toSave[key] = { ...topic, url: normalizeUrl(topic.url) };
    }
  }

  if (toDelete.length > 0) await browser.storage.local.remove(toDelete);
  if (Object.keys(toSave).length > 0) await browser.storage.local.set(toSave);
}

// Gọi 1 lần khi background khởi động
migrateNormalizedUrls().catch(console.error);
```

**Lưu ý:** Migration chỉ cần chạy 1 lần. Có thể thêm flag `migrated-v1` trong storage để skip nếu đã chạy, nhưng migration nhẹ nên chạy lại cũng không sao.

---

## Thứ tự triển khai

1. **Task 1** — Fix `normalizeUrl()` trong cache-manager (root cause)
2. **Task 2** — Fix `normalizeForCompare()` trong TopicHubView
3. **Task 3** — Export normalizeUrl + normalize URL khi save CachedTopic
4. **Task 4** — Migration one-time cho dữ liệu cũ

Task 1-3 là fix chính. Task 4 là cleanup cho data cũ.

## Verification

1. `npx vue-tsc --noEmit` → pass
2. `npm run build` → pass
3. Mở topic ở trang 1 (`/slug.1219089/`) → tóm tắt → 1 entry trong Hub
4. Mở cùng topic ở trang 3 (`/slug.1219089/page-3`) → tóm tắt → vẫn chỉ 1 entry trong Hub (overwrite)
5. Kiểm tra `CachedTopic.url` trong storage → luôn có trailing slash nhất quán
