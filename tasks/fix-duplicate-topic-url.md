# Task Summary: Fix Duplicate Topics Due to URL Normalization

## Trạng thái: DONE ✓
- Type check: pass
- Build: pass (288.88 kB)

## Vấn đề
Cùng 1 topic XenForo xuất hiện 2 lần trong Topic Hub vì URL normalization không nhất quán:
- `https://voz.vn/t/slug.1219089/` → giữ trailing slash
- `https://voz.vn/t/slug.1219089/page-3` → sau khi strip `/page-3` thì mất trailing slash

→ 2 cache key khác nhau → 2 entry riêng biệt trong storage.

## Thay đổi đã thực hiện

### 1. `lib/cache-manager.ts`
- Đổi `function normalizeUrl` → `export function normalizeUrl` (để các module khác import)
- Sửa regex từ `/\/page-\d+$/` → `/\/page-\d+\/?$/` (handle cả `/page-3` và `/page-3/`)
- Thêm: `if (!u.pathname.endsWith('/')) u.pathname += '/';` — đảm bảo trailing slash nhất quán

### 2. `entrypoints/sidepanel/views/TopicHubView.vue`
- Sửa `normalizeForCompare()` với cùng regex + trailing slash fix
- (Hàm này dùng để check `activeTabInList` computed)

### 3. `entrypoints/background/index.ts`
- Import `normalizeUrl` từ `cache-manager`
- Sửa `SAVE_CACHED_TOPIC` handler: lưu `url: normalizeUrl(url)` thay vì `url` raw
- Thêm function `migrateNormalizedUrls()` chạy 1 lần khi background khởi động:
  - Scan toàn bộ storage, re-key các entry có key không đúng format mới
  - Merge nếu 2 entry cùng normalized key (giữ cái mới hơn)
  - Normalize field `url` trong các CachedTopic cũ

## Không cần thay đổi
- `GET_CACHED_TOPIC` handler: `getCachedTopic()` đã normalize key nên OK
- Các call site khác: đều đi qua `getCachedTopic`/`saveCachedTopic` đã normalize

## Invariant sau fix
`normalizeUrl('https://voz.vn/t/slug.1219089/')` === `normalizeUrl('https://voz.vn/t/slug.1219089/page-3')`
→ `'https://voz.vn/t/slug.1219089/'`
