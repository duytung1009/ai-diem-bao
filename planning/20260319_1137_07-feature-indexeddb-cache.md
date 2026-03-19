# Feature: Migration Cache Layer sang IndexedDB

## Context
Hiện tại cache dùng `browser.storage.local` (giới hạn 10MB, soft limit 8MB). Mỗi `CachedTopic` chứa `posts[]` đầy đủ → 200KB–1MB/topic. Với 50+ topics sẽ vượt quota. `getAllCachedTopics()` và `getCacheSize()` gọi `get(null)` load toàn bộ storage → chậm dần.

IndexedDB cho phép hàng trăm MB, query theo index, không cần load all. Migration chỉ ảnh hưởng 2 file backend — sidepanel hoàn toàn không thay đổi (đã dùng messaging).

## Phạm vi thay đổi

| File | Action |
|------|--------|
| `lib/cache-db.ts` | **TẠO MỚI** — IndexedDB wrapper |
| `lib/cache-manager.ts` | **REWRITE** — thay storage.local bằng cache-db |
| `entrypoints/background/index.ts` | **SỬA** — thêm migration + update normalize fn |
| `lib/constants.ts` | **MINOR** — comment CACHE_PREFIX |
| `entrypoints/sidepanel/views/SettingsView.vue` | **MINOR** — tăng MAX_CACHE_BYTES |

**KHÔNG thay đổi:** types.ts, messaging.ts, tất cả sidepanel views/composables (trừ SettingsView constant), wxt.config.ts, manifest.

---

## Task 1: Tạo `lib/cache-db.ts` — IndexedDB wrapper

File mới, zero-dependency, async/await wrapper cho IndexedDB.

### Database schema:
- DB name: `ai-diem-bao-cache`
- Version: `1`
- Object store: `topics` (keyPath: `url`)
- Index: `by-cachedAt` trên field `cachedAt` (cho eviction/sorting)

### Exports:
```typescript
function getDB(): Promise<IDBDatabase>
function dbGet(url: string): Promise<CachedTopic | null>
function dbPut(topic: CachedTopic): Promise<void>
function dbDelete(url: string): Promise<void>
function dbGetAll(): Promise<CachedTopic[]>
function dbClear(): Promise<void>
```

### Chi tiết implementation:
- Module-level `let db: IDBDatabase | null = null` — lazy open, tự reconnect khi service worker restart
- `getDB()`: nếu `db` null hoặc đã close → gọi `indexedDB.open('ai-diem-bao-cache', 1)`, xử lý `onupgradeneeded` tạo object store + index
- Tất cả CRUD fn gọi `getDB()` trước, tạo transaction, wrap `IDBRequest` trong Promise
- `dbPut()` dùng `store.put()` (upsert by keyPath `url`)
- `dbGetAll()` dùng `store.getAll()` (Chrome 48+, an toàn cho MV3)

### Template code:

```typescript
import type { CachedTopic } from './types';

const DB_NAME = 'ai-diem-bao-cache';
const DB_VERSION = 1;
const STORE_NAME = 'topics';

let db: IDBDatabase | null = null;

function getDB(): Promise<IDBDatabase> {
  if (db) return Promise.resolve(db);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'url' });
        store.createIndex('by-cachedAt', 'cachedAt', { unique: false });
      }
    };
    request.onsuccess = () => {
      db = request.result;
      db.onclose = () => { db = null; };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function dbGet(url: string): Promise<CachedTopic | null> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(url);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function dbPut(topic: CachedTopic): Promise<void> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(topic);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbDelete(url: string): Promise<void> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(url);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbGetAll(): Promise<CachedTopic[]> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error);
  });
}

export async function dbClear(): Promise<void> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
```

---

## Task 2: Rewrite `lib/cache-manager.ts`

Thay toàn bộ `browser.storage.local` bằng `cache-db` functions. **Giữ nguyên function signatures.**

### Mapping:

| Function | Trước | Sau |
|----------|-------|-----|
| `normalizeUrl(url)` | Không đổi | Không đổi (pure function) |
| `getCachedTopic(url)` | `storage.local.get(cacheKey(url))` | `dbGet(normalizeUrl(url))` |
| `saveCachedTopic(topic)` | Eviction loop + `storage.local.set(...)` | `dbPut(topic)` — **bỏ eviction 8MB** |
| `deleteCachedTopic(url)` | `storage.local.remove(cacheKey(url))` | `dbDelete(normalizeUrl(url))` |
| `getAllCachedTopics()` | `storage.local.get(null)` + filter CACHE_PREFIX | `dbGetAll()` |
| `getCacheSize()` | `storage.local.get(null)` + sum JSON.stringify | `dbGetAll()` + sum JSON.stringify |

### Cụ thể:

**Xóa:**
- `cacheKey()` helper function (dòng 4-6)
- Import `STORAGE_KEYS` từ `./constants`
- Toàn bộ eviction logic trong `saveCachedTopic()` (dòng 30-39, vòng while loop)

**Thêm:**
- `import { dbGet, dbPut, dbDelete, dbGetAll } from './cache-db';`

**File sau khi rewrite:**
```typescript
import { dbGet, dbPut, dbDelete, dbGetAll } from './cache-db';
import type { CachedTopic } from './types';

export function normalizeUrl(url: string): string {
  // giữ nguyên
}

export async function getCachedTopic(url: string): Promise<CachedTopic | null> {
  return dbGet(normalizeUrl(url));
}

export async function saveCachedTopic(topic: CachedTopic): Promise<void> {
  await dbPut(topic);
}

export async function deleteCachedTopic(url: string): Promise<void> {
  await dbDelete(normalizeUrl(url));
}

export async function getAllCachedTopics(): Promise<CachedTopic[]> {
  return dbGetAll();
}

export async function getCacheSize(): Promise<number> {
  const all = await dbGetAll();
  let size = 0;
  for (const topic of all) {
    size += JSON.stringify(topic).length * 2; // rough byte estimate (UTF-16)
  }
  return size;
}
```

---

## Task 3: One-time migration `storage.local` → IndexedDB

### File: `entrypoints/background/index.ts`

Thêm function `migrateStorageLocalToIDB()`:

```typescript
import { dbPut, dbGet } from '@/lib/cache-db';

async function migrateStorageLocalToIDB(): Promise<void> {
  // Check migration flag
  const flag = await browser.storage.local.get('idb-migration-done');
  if (flag['idb-migration-done']) return;

  // Read all cache entries from storage.local
  const all = await browser.storage.local.get(null);
  const cacheKeys: string[] = [];

  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(STORAGE_KEYS.CACHE_PREFIX)) continue;
    if (!value || typeof value !== 'object' || !('url' in value)) continue;

    const topic = value as CachedTopic;
    const normalizedUrl = normalizeUrl(topic.url);

    // Check for duplicates — keep newer entry
    const existing = await dbGet(normalizedUrl);
    if (existing && existing.cachedAt > topic.cachedAt) {
      cacheKeys.push(key);
      continue;
    }

    await dbPut({ ...topic, url: normalizedUrl });
    cacheKeys.push(key);
  }

  // Cleanup storage.local
  if (cacheKeys.length > 0) await browser.storage.local.remove(cacheKeys);
  await browser.storage.local.set({ 'idb-migration-done': true });
}
```

### Call site trong `defineBackground()`:

Thay dòng `migrateNormalizedUrls().catch(console.error);` bằng:

```typescript
migrateStorageLocalToIDB()
  .then(() => migrateNormalizedUrls())
  .catch(console.error);
```

Migration idempotent — nếu service worker restart giữa chừng, chạy lại an toàn vì `dbPut` là upsert.

---

## Task 4: Update `migrateNormalizedUrls()` dùng IndexedDB

### File: `entrypoints/background/index.ts`

Function `migrateNormalizedUrls()` hiện tại dùng `browser.storage.local.get(null)`. Sửa thành dùng IndexedDB:

```typescript
import { dbGetAll, dbDelete, dbPut, dbGet } from '@/lib/cache-db';

async function migrateNormalizedUrls(): Promise<void> {
  const topics = await dbGetAll();

  for (const topic of topics) {
    const normalizedUrl = normalizeUrl(topic.url);
    if (normalizedUrl === topic.url) continue;

    // URL cần normalize — xóa entry cũ, thêm entry mới
    await dbDelete(topic.url);

    // Check nếu normalized URL đã tồn tại (dedup)
    const existing = await dbGet(normalizedUrl);
    if (existing && existing.cachedAt > topic.cachedAt) continue; // giữ entry mới hơn

    await dbPut({ ...topic, url: normalizedUrl });
  }
}
```

**Xóa:** import `browser.storage.local` references trong function cũ (dòng 192-219).

---

## Task 5: Cleanup constants

### File: `lib/constants.ts`

Thêm comment cho `CACHE_PREFIX`:
```typescript
export const STORAGE_KEYS = {
  SETTINGS: 'llm-settings',
  CACHE_PREFIX: 'cache:',  // Legacy — chỉ dùng bởi one-time migration từ storage.local sang IndexedDB
  CUSTOM_PROMPTS: 'custom-prompts',
  THEME: 'theme-mode',
} as const;
```

---

## Task 6: Tăng `MAX_CACHE_BYTES` trong SettingsView

### File: `entrypoints/sidepanel/views/SettingsView.vue`

Dòng 16, thay:
```typescript
const MAX_CACHE_BYTES = 8 * 1024 * 1024; // 8MB soft limit
```
thành:
```typescript
const MAX_CACHE_BYTES = 50 * 1024 * 1024; // 50MB — IndexedDB cho phép nhiều hơn
```

Progress bar vẫn hoạt động bình thường, chỉ scale khác.

---

## Thứ tự triển khai

```
Task 1 (cache-db.ts) — tạo trước, các task khác phụ thuộc
  ├─→ Task 2 (rewrite cache-manager.ts)
  ├─→ Task 3 (one-time migration)
  └─→ Task 4 (update migrateNormalizedUrls)
Task 5 (cleanup constants) — sau Task 3
Task 6 (tăng MAX_CACHE_BYTES) — độc lập
```

---

## Verification

1. `npx vue-tsc --noEmit` + `npm run build` → pass
2. **Fresh install:** Mở extension → summarize topic → check Topic Hub hiện topic → check Settings cache size > 0
3. **Migration:** Dùng DevTools tạo entry `cache:https://...` trong `browser.storage.local` → reload extension → verify topic xuất hiện từ IndexedDB, `storage.local` đã xóa cache entries, flag `idb-migration-done` = true
4. **Service worker restart:** Stop worker từ `chrome://serviceworker-internals` → mở Topic Hub → topics vẫn load
5. **CRUD:** Delete topic, clear all cache → verify
6. **Build size:** Không tăng đáng kể (~50 dòng thêm)
