# Bug Fix: Tóm tắt lại chỉ dùng 20 bài viết (1 trang) thay vì toàn bộ

**Ngày:** 2026-03-26
**Symptom:**
- Lần 1 (tóm tắt lần đầu): `START_LLM_TASK` payload có đủ 64 bài / 4 trang ✓
- Lần 2 ("Tóm tắt lại"): `START_LLM_TASK` payload chỉ có **20 bài của trang hiện tại** ✗
- Kết quả: số bài viết hiển thị = 20 thay vì 64; chất lượng tóm tắt kém

---

## Root Cause

### Bước 1 — `store.selectedTopic.value.posts` trở thành `[]` sau lần tóm tắt đầu

**File:** `SummaryView.vue` line 156–161

```typescript
store.updateSelectedTopic({
  totalPages: fresh.totalPages,
  totalPosts: fresh.totalPosts,
  version: fresh.version,
  title: fresh.title,
  // ← THIẾU: posts: fresh.posts
});
```

`loadTopicData()` sync metadata từ IndexedDB về store, nhưng **không sync `posts`**. Khi user vào SummaryView qua "Tóm tắt chủ đề đang xem" (tạo `minimalTopic.posts = []`), store có `posts = []`.

**Tại sao `loadTopicData()` không reset posts về `[]`?** Vì nó KHÔNG được gọi khi URL không đổi (line 215):
```typescript
if (!isSameTopicUrl(url, loadedTopicUrl.value ?? '')) await loadTopicData();
```

Nếu user đang ở SummaryView của topic X → quay về TopicHub → click "Tóm tắt chủ đề đang xem" cho topic X → router push `/summary` → SummaryView `onActivated` thấy URL y hệt → **không gọi `loadTopicData()`** → `store.selectedTopic.value.posts` vẫn là `[]` từ `minimalTopic`.

### Bước 2 — "Tóm tắt lại" bỏ qua cached posts vì store.posts rỗng

**File:** `SummaryView.vue` line 326–330

```typescript
if (topic.posts?.length > 0 && !incremental) {
  pendingPosts.value = [...topic.posts];  // ← topic.posts = [] → condition false
  return;
}
// Falls through to SCRAPING path
```

`topic = store.selectedTopic.value`. `topic.posts = []` → condition false → đi vào scraping path.

### Bước 3 — Scraping path dùng `pageCount = 1` (detect fallback)

**File:** `SummaryView.vue` line 341–342

```typescript
const pageCount = (detectMatchesTopic ? store.activeTabDetect.value?.pageCount : null)
  ?? topic.totalPages ?? 1;
```

Khi `detectMatchesTopic = true` (user đang ở trang topic), dùng `detect.pageCount`. Nếu `detect.pageCount = 1` (XF1 pagination selector không match, hoặc XF2 fallback), chỉ scrape trang 1 → 20 bài.

**Hoặc:** `topic.totalPages` trong store = 1 vì `minimalTopic.totalPages = detect.pageCount = 1`.

---

## Objective & Scope

1. Fix ngay tại `handleSummarize()`: dùng `cachedTopic.value.posts` (đúng, từ IndexedDB) thay vì `topic.posts` (từ store, có thể stale)
2. Fix `loadTopicData()`: sync `posts` từ IndexedDB vào store
3. Fix `pageCount` logic: ưu tiên giá trị lớn hơn giữa detect và cache

---

## Affected Modules

- `entrypoints/sidepanel/views/SummaryView.vue`

---

## Implementation Steps

### Fix 1 (Critical) — Dùng `cachedTopic.value.posts` thay `topic.posts`

**Vấn đề:** `topic.posts` (từ store) có thể stale. `cachedTopic.value.posts` (từ IndexedDB, luôn được load trong `loadTopicData()`) đáng tin hơn.

**File:** `SummaryView.vue` — hàm `handleSummarize`, line 326–330

```typescript
// TRƯỚC:
if (topic.posts?.length > 0 && !incremental) {
  pendingPosts.value = [...topic.posts];
  pendingIncremental.value = false;
  return;
}

// SAU:
// Ưu tiên cachedTopic.value.posts (từ IndexedDB) vì store.selectedTopic.posts có thể stale
// khi user re-select topic qua minimalTopic (posts = [])
const cachedPosts = cachedTopic.value?.posts?.length
  ? cachedTopic.value.posts
  : topic.posts ?? [];
if (cachedPosts.length > 0 && !incremental) {
  pendingPosts.value = [...cachedPosts];
  pendingIncremental.value = false;
  return;
}
```

### Fix 2 (Important) — Sync `posts` từ IndexedDB vào store trong `loadTopicData()`

**File:** `SummaryView.vue` line 156–161

```typescript
// TRƯỚC:
store.updateSelectedTopic({
  totalPages: fresh.totalPages,
  totalPosts: fresh.totalPosts,
  version: fresh.version,
  title: fresh.title,
});

// SAU:
store.updateSelectedTopic({
  totalPages: fresh.totalPages,
  totalPosts: fresh.totalPosts,
  summarizedPostCount: fresh.summarizedPostCount,
  version: fresh.version,
  title: fresh.title,
  posts: fresh.posts,    // ← thêm: đảm bảo store luôn có posts từ IndexedDB
});
```

**Note:** Việc này không gây vấn đề gì vì `fresh.posts` là array readonly (đã trải qua IndexedDB serialization). Spread trong `updateSelectedTopic` vẫn giữ đúng reference.

### Fix 3 (Safety net) — `pageCount` ưu tiên giá trị lớn hơn

**File:** `SummaryView.vue` line 341–342

```typescript
// TRƯỚC:
const pageCount = (detectMatchesTopic ? store.activeTabDetect.value?.pageCount : null)
  ?? topic.totalPages ?? 1;

// SAU:
const detectedPageCount = detectMatchesTopic ? (store.activeTabDetect.value?.pageCount ?? 1) : 1;
const cachedPageCount = topic.totalPages ?? 1;
// Dùng max: detect có thể fallback về 1, cache giữ giá trị từ lần scrape trước
const pageCount = Math.max(detectedPageCount, cachedPageCount);
```

**Giải thích:** Nếu detect đúng (4) và cache đúng (4) → max(4,4) = 4 ✓. Nếu detect fail (1) nhưng cache đúng (4) → max(1,4) = 4 ✓. Nếu topic mới (cache = 1) và detect đúng (4) → max(4,1) = 4 ✓.

---

## Edge Cases

| Scenario | Fix 1 | Fix 2 | Fix 3 | Kết quả |
|----------|-------|-------|-------|---------|
| Topic mới (chưa cache), detect = 4 | `cachedPosts = []` → scrape | N/A | max(4,1) = 4 | 64 posts ✓ |
| Topic cũ, user dùng minimalTopic | `cachedTopic.posts = [64]` → early return | posts synced | N/A | 64 posts ✓ |
| Topic cũ, detect fail = 1 | early return với 64 cached | posts synced | max(1,4) = 4 | 64 posts ✓ |
| Single-page topic | `cachedPosts = [20]` → early return | posts synced | max(1,1) = 1 | 20 posts ✓ |

---

## Test Plan

1. Tóm tắt topic lần đầu → kiểm tra LLM nhận đủ posts
2. Click "Tóm tắt lại" (không navigate) → kiểm tra LLM nhận đủ posts (không scrape lại)
3. TopicHub → click "Tóm tắt chủ đề đang xem" → vào SummaryView → click "Tóm tắt lại" → kiểm tra LLM nhận đủ posts từ cache (không chỉ 20 từ live page)
4. Tóm tắt với XF1 forum nhiều trang → kiểm tra đủ trang được scrape
5. Kiểm tra "số bài viết đã tóm tắt" hiển thị đúng sau khi tóm tắt

---

## Rollback Plan

Revert duy nhất `SummaryView.vue` (3 chỗ).

---

## Decision Log

### Quyết định 1: Dùng `cachedTopic.value.posts` thay vì `topic.posts`
- **Đã chọn:** `cachedPosts = cachedTopic.value?.posts?.length ? cachedTopic.value.posts : topic.posts ?? []`
- **Lý do:** `cachedTopic.value` luôn được load từ IndexedDB trong `loadTopicData()`. `store.selectedTopic.posts` có thể stale vì `loadTopicData()` không được gọi khi URL không đổi.
- **Đã cân nhắc nhưng loại:**
  - Chỉ fix `loadTopicData()` thêm `posts` sync: loại vì `loadTopicData()` KHÔNG được gọi khi URL không đổi (same topic re-selected) → không giải quyết root case của re-summarize
  - Gọi `loadTopicData()` khi URL giống nhau: loại vì phức tạp và có thể gây side effects (reset state không cần thiết)
- **Điều kiện thay đổi:** Nếu có scenario nào `cachedTopic.value.posts` không phản ánh đúng dữ liệu cần tóm tắt

### Quyết định 2: Fix 2 (sync posts vào store) là bổ sung, không thay thế Fix 1
- **Đã chọn:** Làm cả 2
- **Lý do:** Fix 1 giải quyết root cause trực tiếp. Fix 2 đảm bảo store luôn nhất quán với IndexedDB cho các code path khác có thể đọc `topic.posts` từ store
- **Điều kiện thay đổi:** Nếu `posts` array quá lớn gây performance issue khi spread qua `updateSelectedTopic`
