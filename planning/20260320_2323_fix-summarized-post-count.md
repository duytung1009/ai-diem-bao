# Fix: Lưu và hiển thị đúng số bài viết đã tóm tắt

Ngày: 2026-03-20

---

## Vấn đề

`summarizedPostCount` trong SummaryView là ref volatile — bị reset khi chuyển topic, và được load lại từ `CachedTopic.totalPosts`. Tuy nhiên `totalPosts` đang dùng chung cho 2 mục đích:

1. **Hiển thị:** "Đã tóm tắt 150 bài viết"
2. **Freshness:** `evaluateFreshness()` so sánh `cached.totalPosts` vs `livePostCount` → quyết định cache có stale không

Khi `totalPosts` bị cập nhật không đúng lúc (ví dụ segment mode tính tổng khác, hoặc incremental merge), giá trị hiển thị sai so với thực tế. Cần field riêng, chỉ lưu 1 lần khi LLM trả kết quả.

---

## Phân tích hiện trạng

### Các chỗ GHI `totalPosts`:

| Vị trí | Giá trị ghi | Đúng? |
|--------|-------------|-------|
| `confirmSummarize()` dòng 482, 499 | `posts.length` (bao gồm cả article posts âm) | ⚠️ Bao gồm bài báo gốc (postNumber < 0) |
| `handleSummarizeSegment()` dòng 581 | `segments.reduce(postCount)` | ✅ Nhưng tăng dần khi tóm tắt từng segment |
| `generateOverallSummary()` dòng 633 | `segments.reduce(postCount)` (set `summarizedPostCount` ref) | ✅ Nhưng chỉ set ref, không lưu cache |

### Các chỗ ĐỌC `totalPosts`:

| Vị trí | Mục đích |
|--------|----------|
| `loadTopicData()` dòng 142, 150 | Set `summarizedPostCount` ref |
| `evaluateFreshness()` dòng 233 | So sánh vs `livePostCount` → stale/fresh |
| `CacheIndicator` prop `:cached-posts` dòng 852, 932 | Hiện "N bài mới" |
| Template dòng 925 | "Đã tóm tắt {{ summarizedPostCount }} bài viết" |

---

## Thiết kế

### Thêm field `summarizedPostCount` vào `CachedTopic`

```ts
interface CachedTopic {
  // ... existing fields ...
  totalPosts: number;             // giữ nguyên — dùng cho freshness
  summarizedPostCount?: number;   // MỚI — số bài thực sự gửi cho LLM (không đếm article posts)
}
```

**Ý nghĩa:**
- `totalPosts` = tổng số bài viết của topic tại thời điểm tóm tắt (dùng cho freshness evaluation)
- `summarizedPostCount` = số bài viết thực tế đã gửi cho LLM (KHÔNG đếm article posts postNumber < 0)

---

## Task 1: Thêm field vào type

### File: `lib/types.ts`

Thêm `summarizedPostCount?: number` vào `CachedTopic` interface (sau `totalPosts`):

```ts
interface CachedTopic {
  // ...
  totalPosts: number;
  summarizedPostCount?: number;  // TẠO MỚI
  totalPages: number;
  // ...
}
```

---

## Task 2: Lưu `summarizedPostCount` khi save cache

### File: `entrypoints/sidepanel/views/SummaryView.vue`

#### 2a. `confirmSummarize()` — normal mode

Tính số bài thực tế (bỏ article posts):

```ts
// Trước (dòng 482):
totalPosts: posts.length,

// Sau:
totalPosts: posts.filter(p => p.postNumber > 0).length,
summarizedPostCount: posts.filter(p => p.postNumber > 0).length,
```

Lưu ý: `totalPosts` vẫn nên là số bài viết thực tế (không đếm article) để freshness check đúng. Article posts (postNumber < 0) không thuộc forum.

#### 2b. `handleSummarizeSegment()` — segment mode

Khi save segment:

```ts
// Dòng 581 — đã đúng (segment posts không có article)
totalPosts: updated.reduce((s, seg) => s + (seg?.postCount ?? 0), 0),
summarizedPostCount: updated.reduce((s, seg) => s + (seg?.postCount ?? 0), 0),
```

#### 2c. `generateOverallSummary()` — overall summary

Dòng 636 — thêm save `summarizedPostCount` vào cache:

```ts
// Trước:
await sendMessage('SAVE_CACHED_TOPIC', { url: topic.url, summary: result.summary });

// Sau:
const totalSummarized = segmentSummaries.value.reduce((s, seg) => s + (seg?.postCount ?? 0), 0);
await sendMessage('SAVE_CACHED_TOPIC', {
  url: topic.url,
  summary: result.summary,
  summarizedPostCount: totalSummarized,
});
```

---

## Task 3: Bỏ ref `summarizedPostCount`, đọc trực tiếp từ cache

### File: `entrypoints/sidepanel/views/SummaryView.vue`

Thay ref bằng computed đọc từ `cachedTopic`:

```ts
// BỎ:
const summarizedPostCount = ref(0);

// THAY BẰNG:
const summarizedPostCount = computed(() => {
  if (!cachedTopic.value) return 0;
  return cachedTopic.value.summarizedPostCount ?? cachedTopic.value.totalPosts ?? 0;
});
```

**Xoá tất cả assignment thủ công:**

| Dòng | Code cũ | Hành động |
|------|---------|-----------|
| 126 | `summarizedPostCount.value = 0;` | XOÁ (không cần reset computed) |
| 142 | `summarizedPostCount.value = topic.totalPosts;` | XOÁ |
| 150 | `summarizedPostCount.value = fresh.totalPosts;` | XOÁ |
| 489 | `summarizedPostCount.value = posts.length;` | XOÁ |
| 633 | `summarizedPostCount.value = segmentSummaries...` | XOÁ |

Computed tự cập nhật khi `cachedTopic.value` thay đổi (sau `sendMessage('SAVE_CACHED_TOPIC')` + re-fetch).

**Lưu ý:** Sau khi save cache, `confirmSummarize()` đã re-fetch từ IndexedDB (dòng 504: `const saved = await sendMessage('GET_CACHED_TOPIC', topic.url)`). Cần đảm bảo `generateOverallSummary()` cũng re-fetch:

```ts
// Thêm vào cuối generateOverallSummary(), sau save:
const saved = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC', topic.url);
if (saved) cachedTopic.value = saved;
cacheFreshness.value = 'fresh';
```

---

## Task 4: Backward compatibility trong background

### File: `entrypoints/background/index.ts`

Trong handler `SAVE_CACHED_TOPIC`, merge `summarizedPostCount` giống các field khác:

```ts
// Trong đoạn merge partial → topic:
summarizedPostCount: partial.summarizedPostCount ?? existing?.summarizedPostCount ?? partial.totalPosts ?? existing?.totalPosts ?? 0,
```

Nếu topic cũ chưa có `summarizedPostCount` → fallback về `totalPosts` (backward compatible).

---

## Tóm tắt thay đổi

| File | Thay đổi |
|------|----------|
| `lib/types.ts` | Thêm `summarizedPostCount?: number` vào `CachedTopic` |
| `entrypoints/background/index.ts` | Merge `summarizedPostCount` trong `SAVE_CACHED_TOPIC` handler |
| `SummaryView.vue` | Bỏ ref → computed từ cache; lưu `summarizedPostCount` khi save; bỏ article posts khỏi count; re-fetch cache sau overall summary |

## Verification

1. `npx vue-tsc --noEmit` + `npm run build` → pass
2. Topic mới → tóm tắt → "Đã tóm tắt N bài viết" hiện đúng (N không đếm article posts)
3. Reload extension → mở lại topic → N vẫn hiện đúng (đọc từ cache)
4. Segment mode → tóm tắt 2 segments → overall → N = tổng bài 2 segments
5. Incremental update → N cập nhật thành tổng mới
6. CacheIndicator `:cached-posts` vẫn hoạt động (dùng `totalPosts`)
7. Freshness check vẫn đúng (so sánh `totalPosts` vs `livePostCount`)
