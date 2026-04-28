# Cơ chế Cache (IndexedDB + Freshness)

> Cập nhật: 2026-04-29

## Tổng quan

Extension lưu topic cache vào **IndexedDB** (thay vì `chrome.storage.local` như phiên bản đầu). Việc này cho phép lưu lượng dữ liệu lớn (topic nhiều trang, segments, knowledge entries) mà không bị giới hạn dung lượng của `storage.local` (~10MB).

Cache được truy xuất qua **background service worker** — sidepanel gửi message `GET_CACHED_TOPIC` / `SAVE_CACHED_TOPIC` / `DELETE_CACHED_TOPIC` để tương tác.

## IndexedDB Schema

**DB:** `ai-diem-bao-cache`, version 2

**Object store:** `topics` (keyPath: `url`)

| Index | Key | Unique |
|-------|-----|--------|
| `by-cachedAt` | `cachedAt` | No |
| `by-bookmarked` | `bookmarked` | No |

### Lazy singleton (`cache-db.ts`)

```typescript
// Module-level biến, init lần đầu khi gọi getDB()
let db: IDBDatabase | null = null;
let openingPromise: Promise<IDBDatabase> | null = null;
```

- `getDB()` trả về DB instance (reuse nếu đã mở)
- `db.onclose` / `db.onversionchange` → tự động reset để reconnect
- `openingPromise` tránh race condition khi nhiều component gọi đồng thời

## Cache CRUD (`cache-manager.ts`)

| Hàm | Gọi | Mục đích |
|-----|-----|----------|
| `getCachedTopic(url)` | `dbGet(normalizeUrl(url))` | Lấy topic từ cache |
| `saveCachedTopic(topic)` | `dbPut(topic)` | Lưu/ghi đè topic |
| `deleteCachedTopic(url)` | `dbDelete(normalizeUrl(url))` | Xóa topic |
| `getAllCachedTopics()` | `dbGetAll()` | Lấy tất cả topics (cho TopicHub) |
| `getCacheSize()` | `JSON.stringify + *2` | Ước lượng dung lượng (UTF-16 bytes) |

## URL Normalization

```typescript
normalizeUrl(url: string): string
```

Xử lý URL để đảm bảo cache key nhất quán:
1. Parse URL
2. Xóa `/page-N` suffix (nếu có) — tất cả pages dùng chung 1 cache key
3. Đảm bảo kết thúc bằng `/`
4. Xóa search params và hash

`isSameTopicUrl(url1, url2)` dùng `normalizeUrl` để so sánh.

## Message Flow

```
Sidepanel                          Background (service worker)
    │                                     │
    │  GET_CACHED_TOPIC {url?}            │
    │ ────────────────────────────────→   │
    │  ←──────────────────────────────── │ CachedTopic | null
    │                                     │
    │  SAVE_CACHED_TOPIC {partial}        │
    │ ────────────────────────────────→   │  ← merge với existing
    │  ←──────────────────────────────── │ {success: true}
    │                                     │
    │  DELETE_CACHED_TOPIC {url}          │
    │ ────────────────────────────────→   │
    │  ←──────────────────────────────── │ {success: true}
```

### Partial Update Pattern

`SAVE_CACHED_TOPIC` gửi `Partial<CachedTopic>`. Background merge với existing topic trước khi persist:

```typescript
const existing = await getCachedTopic(url);
const topic: CachedTopic = {
  url: normalizeUrl(url),
  title: partial.title ?? existing?.title ?? '',
  posts: partial.posts ?? existing?.posts ?? [],
  summary: partial.summary ?? existing?.summary ?? '',
  opinions: partial.opinions ?? existing?.opinions,
  knowledgeEntries: partial.knowledgeEntries ?? existing?.knowledgeEntries,
  // ... các fields khác
};
await saveCachedTopic(topic);
```

Điều này cho phép:
- Component chỉ gửi field thay đổi (VD: gửi `{ opinions }` sau khi phân tích xong)
- Các field khác được giữ nguyên
- Giảm dữ liệu truyền qua message channel

## Freshness Evaluation

`CacheFreshness` type: `'fresh' | 'stale' | 'outdated'`

Không có logic freshness cố định trong lib — mỗi component tự tính dựa trên:
- `cachedAt` timestamp
- `totalPages` hiện tại vs cached
- `summarizedPostCount` vs `totalPosts`

**Constants liên quan:**
- `FRESHNESS_ONE_DAY_MS = 24h`
- `FRESHNESS_ONE_WEEK_MS = 7 ngày`

## CacheIndicator Component

`CacheIndicator.vue` hiển thị trạng thái cache:
- **Freshness badge:** "Mới đây" / "Hôm qua" / "Tuần trước"
- **Post count:** "N bài / T tổng" (`summarizedPostCount` / `totalPosts`)
- **Partial indicator:** Khi `summarizedPostCount < totalPosts`

## One-time Migration (từ `storage.local` → IndexedDB)

Chạy khi background worker khởi động:

```typescript
migrateStorageLocalToIDB()
  .then(() => migrateNormalizedUrls())
  .catch(console.error);
```

### `migrateStorageLocalToIDB()`
1. Check flag `idb-migration-done` — skip nếu đã chạy
2. Đọc tất cả keys từ `storage.local`
3. Lọc keys có prefix `cache:`
4. Parse từng item, `dbPut()` vào IndexedDB
5. Set flag `idb-migration-done`

### `migrateNormalizedUrls()`
- Đọc tất cả topics từ IndexedDB
- Với mỗi topic, `normalizeUrl(topic.url)` và lưu lại
- Xóa các entries trùng (giữ bản có `cachedAt` mới nhất)

## Edge Cases

| Tình huống | Xử lý |
|-----------|-------|
| IndexedDB không support (truncated incognito) | `getDB()` catch → fallback | 
| DB close đột ngột | `db.onclose` set `db = null` → tự động reconnect |
| Partial update thiếu field | Merge với existing, field undefined → giữ lại |
| URL có/page-N | `normalizeUrl` strip → cache key nhất quán |
| Nhiều component cùng SAVE | IndexedDB transaction serialized — an toàn |
