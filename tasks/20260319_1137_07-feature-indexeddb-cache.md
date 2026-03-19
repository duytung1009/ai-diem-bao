# Feature 07: Migration Cache Layer sang IndexedDB — Task Summary

## Mục tiêu
Thay thế `browser.storage.local` (giới hạn 10MB) bằng IndexedDB (hàng trăm MB) cho cache topics. Giữ nguyên tất cả function signatures và sidepanel interface.

## Files đã thay đổi

| File | Action | Mô tả |
|------|--------|--------|
| `lib/cache-db.ts` | TẠO MỚI | IndexedDB wrapper (zero-dependency) |
| `lib/cache-manager.ts` | REWRITE | Thay storage.local bằng cache-db functions |
| `entrypoints/background/index.ts` | SỬA | Thêm migration + rewrite migrateNormalizedUrls |
| `lib/constants.ts` | MINOR | Thêm comment Legacy cho CACHE_PREFIX |
| `entrypoints/sidepanel/views/SettingsView.vue` | MINOR | MAX_CACHE_BYTES 8MB → 50MB |

## Chi tiết từng task

### Task 1: `lib/cache-db.ts` (TẠO MỚI)
- DB name: `ai-diem-bao-cache`, version 1
- Object store: `topics` (keyPath: `url`)
- Index: `by-cachedAt` on `cachedAt`
- Module-level `let db: IDBDatabase | null = null` — lazy open, tự reconnect khi service worker restart (via `db.onclose = () => { db = null }`)
- Exports: `dbGet`, `dbPut`, `dbDelete`, `dbGetAll`, `dbClear`
- `dbPut` dùng `store.put()` = upsert by keyPath
- Transaction-based promises — resolve on `tx.oncomplete`, reject on `tx.onerror`

### Task 2: `lib/cache-manager.ts` (REWRITE)
**Xóa:**
- `cacheKey()` helper
- `import { STORAGE_KEYS }` từ constants
- Toàn bộ eviction loop trong `saveCachedTopic()` (while loop 8MB)
- Tất cả `browser.storage.local` calls

**Thêm:**
- `import { dbGet, dbPut, dbDelete, dbGetAll } from './cache-db'`
- `saveCachedTopic()` chỉ còn `await dbPut(topic)` — không còn eviction
- `getAllCachedTopics()` chỉ còn `return dbGetAll()` — không filter prefix
- `getCacheSize()` dùng `dbGetAll()` thay vì `storage.local.get(null)`

### Task 3+4: `entrypoints/background/index.ts`
**Thêm import:** `import { dbPut, dbGet, dbGetAll, dbDelete } from '@/lib/cache-db'`

**Thêm `migrateStorageLocalToIDB()`:**
- Check flag `idb-migration-done` trong storage.local — skip nếu đã done
- Loop qua tất cả entries starting với `STORAGE_KEYS.CACHE_PREFIX`
- Dedup: giữ entry có `cachedAt` mới hơn
- `dbPut` với normalized URL
- Xóa cache keys khỏi storage.local
- Set flag `idb-migration-done: true`
- Idempotent — safe nếu service worker restart giữa chừng

**Rewrite `migrateNormalizedUrls()`:**
- Dùng `dbGetAll()` thay vì `storage.local.get(null)`
- `dbDelete(topic.url)` + `dbPut({ ...topic, url: normalizedUrl })` thay vì storage ops
- Dedup: skip nếu normalized URL đã tồn tại và mới hơn

**Call site:** `migrateStorageLocalToIDB().then(() => migrateNormalizedUrls()).catch(console.error)`

### Task 5: `lib/constants.ts`
Thêm comment: `// Legacy — chỉ dùng bởi one-time migration từ storage.local sang IndexedDB`

### Task 6: `entrypoints/sidepanel/views/SettingsView.vue`
`MAX_CACHE_BYTES = 50 * 1024 * 1024` (50MB thay vì 8MB) — progress bar vẫn hoạt động, chỉ scale khác

## Verification kết quả
- `npx vue-tsc --noEmit` → pass (no errors)
- `npm run build` → pass, build size 308.64 kB (không tăng đáng kể)
- Type check clean, không có breaking changes cho sidepanel

## Kiến trúc sau migration
```
Sidepanel ←→ messaging ←→ background/index.ts
                                ↓
                         cache-manager.ts (public API, unchanged signatures)
                                ↓
                         cache-db.ts (IndexedDB wrapper)
                                ↓
                         IndexedDB (ai-diem-bao-cache, store: topics)
```

`browser.storage.local` chỉ còn dùng cho: settings, custom-prompts, theme-mode, và flag `idb-migration-done`.
