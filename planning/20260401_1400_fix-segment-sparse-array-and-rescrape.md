# Fix: Segment Mode — Sparse Array + Re-scrape on Retry

## Objective & Scope

3 bugs liên quan khi tóm tắt segment ở topic lớn (> segmentSize trang), đặc biệt khi segment đầu tiên được tóm tắt có index cao (ví dụ: segment 122/124 của topic 1238 trang).

**Triệu chứng:**
- SAVE_CACHED_TOPIC nhận `segments` array với 122 phần tử `null` + 1 item thật ở cuối
- Khi tóm tắt thất bại (LLM error), UI không hiển thị trạng thái "đã scrape xong" → user không biết posts đã cache
- Retry → scrape lại từ đầu thay vì dùng posts đã cache

---

## Root Causes

### Bug 1: Sparse JavaScript array → 122 null items

**File:** `SummaryView.vue`, lines 551–565 và 584–585

```typescript
// Cả 2 chỗ đều dùng pattern này:
const tempUpdated = [...segmentSummaries.value]; // length = 0 nếu chưa có segment nào
tempUpdated[segmentIndex] = { ... };             // segmentIndex = 122 → tạo holes
```

JavaScript: `arr[122] = x` trên array rỗng tạo sparse array với 122 "holes". Khi spread `[...arr]`, holes giữ nguyên. Khi serialize JSON: `[null, null, ...(122 lần), {...}]`. Khi reload từ cache: `segmentSummaries.value = [null × 122, {posts, summary:''}]`.

### Bug 2: Không check posts đã cache → luôn re-scrape

**File:** `SummaryView.vue`, line 542

```typescript
// Luôn scrape, không check existing?.posts?.length:
const { posts: segPosts, errors } = await scrapeRange(...);
```

Feature 16 có comment "avoids re-scraping on failure" nhưng check thực tế bị bỏ sót. Posts đã cache (có trong `segmentSummaries.value[segmentIndex]`) không được dùng lại.

### Bug 3: UI state không update sau pre-LLM save

**File:** `SummaryView.vue`, lines 550–566

Pre-LLM save chỉ cập nhật cache (IndexedDB) mà **không** cập nhật `segmentSummaries.value`. Khi LLM lỗi, catch block chạy nhưng `segmentSummaries.value[segmentIndex]` vẫn là `null` (không phải segment vừa scrape). UI hiển thị segment vẫn "chưa làm" → user không biết posts đã được cache thành công.

---

## Affected Modules

| File | Action |
|------|--------|
| `entrypoints/sidepanel/views/SummaryView.vue` | **SỬA** — 3 fixes trong `handleSummarizeSegment` |

---

## Implementation Steps

### Fix 1: Prevent sparse array

Thay `[...segmentSummaries.value]` bằng `Array.from` có padding null ở cả **2 chỗ** trong `handleSummarizeSegment`:

```typescript
// Helper function (khai báo trước handleSummarizeSegment hoặc inline):
const makeDenseBase = (segIdx: number): (TopicSegment | null)[] =>
  Array.from(
    { length: Math.max(segmentSummaries.value.length, segIdx + 1, segments.value.length) },
    (_, i) => segmentSummaries.value[i] ?? null,
  );
```

**Chỗ 1 — pre-LLM save (line 551):**
```typescript
// Trước:
const tempUpdated = [...segmentSummaries.value];
// Sau:
const tempUpdated = makeDenseBase(segmentIndex);
```

**Chỗ 2 — post-LLM save (line 584):**
```typescript
// Trước:
const updated = [...segmentSummaries.value];
// Sau:
const updated = makeDenseBase(segmentIndex);
```

### Fix 2: Skip re-scraping nếu posts đã cache

Thêm check trước khi scrape trong `handleSummarizeSegment` (sau khi khởi tạo `thisId`, trước `isScraping.value = true`):

```typescript
// Check nếu posts đã được cache
const existing = segmentSummaries.value[segmentIndex];
let segPosts: ScrapedPost[];
if (existing?.posts?.length) {
  // Dùng lại posts đã cache, bỏ qua scraping
  segPosts = existing.posts;
  scrapingInfo.value = `Dùng ${segPosts.length} bài viết đã lưu (scrape trước đó).`;
} else {
  // Scrape fresh
  isScraping.value = true;
  simpleLoadingText.value = `Đang đọc ${seg.label}...`;
  const result = await scrapeRange(topic.url, seg.start, seg.end, currentConfig.value?.scrapeDelayMs ?? 2000);
  isScraping.value = false;
  scrapeProgress.value = null;
  simpleLoadingText.value = '';
  segPosts = result.posts;
  if (!segPosts.length) throw new Error('Không tìm thấy bài viết nào.');
  if (result.errors.length) scrapingWarnings.value = result.errors;
}
```

**Lưu ý:** `isScraping.value = false` trong catch block (line 621) vẫn giữ nguyên — đảm bảo cleanup đúng nếu scrape path xảy ra lỗi.

### Fix 3: Update UI state sau pre-LLM save

Sau dòng `await sendMessage('SAVE_CACHED_TOPIC', {...}).catch(() => {})` (line 566), thêm:

```typescript
// Update UI state ngay để segment hiện trạng "đã scrape, chờ tóm tắt"
segmentSummaries.value = tempUpdated;
```

Điều này đảm bảo:
- UI segment tab hiển thị đúng trạng thái "có posts, chưa có summary"
- Khi retry, Fix 2 sẽ detect `existing.posts.length > 0` → skip scraping
- Nếu user đóng/mở lại, data đã có trong cache (từ Fix 1 array dense)

---

## Edge Cases

1. **Segment 0 (pages 1–10)**: `segmentIndex = 0`, `makeDenseBase(0)` → `length = max(0, 1, totalSegs) = totalSegs` → OK
2. **Segment index = totalSegs - 1**: Array length = totalSegs → dense array đầy đủ
3. **Stale guard path (line 588)**: Sau khi LLM xong nhưng user đã navigate → `updated = makeDenseBase(segmentIndex)` → dense array được save vào cache
4. **Existing segment với summary đã có**: `existing?.posts?.length > 0` = true → dùng cached posts → LLM sẽ tóm tắt lại nếu user click (correct: user explicitly muốn re-summarize)
5. **scrapeRange returns empty với error**: `segPosts = []` → `throw new Error(...)` → catch block → error.value set → UI hiện error

---

## Test Plan

1. **Topic lớn, segment index cao (ví dụ: segment 120+ của topic 1200+ trang):**
   - Tóm tắt segment → scrape thành công → SAVE_CACHED_TOPIC không còn null items
   - LLM chủ động fail (tắt mạng) → UI segment hiện trạng "đã scrape" (posts available)
   - Retry segment → không scrape lại, đi thẳng vào LLM → thành công
2. **Segment 0 (pages 1–10):** Tóm tắt bình thường → array length = totalSegs
3. **Segment đã có summary:** Click lại → dùng cached posts → LLM re-summarize → OK
4. `npx vue-tsc --noEmit` — no new errors
5. `npm run build` — pass

---

## Rollback Plan

Revert 1 file (`SummaryView.vue`). Không ảnh hưởng background hay cache schema.

---

## Decision Log

### QD1: `makeDenseBase` helper function thay vì inline
- **Đã chọn:** Extract helper function nhỏ
- **Lý do:** Dùng 2 lần trong cùng hàm, giữ code DRY
- **Đã cân nhắc nhưng loại:** Inline 2 lần — duplicate logic

### QD2: Check `existing?.posts?.length` để skip scraping
- **Đã chọn:** Check trực tiếp trên `segmentSummaries.value[segmentIndex]`
- **Lý do:** Posts được cache sau Fix 3 (UI state update) → available trên re-load
- **Điều kiện thay đổi:** Nếu cần force re-scrape (posts stale) → thêm UI button "Cập nhật bài viết"

### QD3: Update `segmentSummaries.value` SAU pre-LLM save, TRƯỚC khi start LLM
- **Đã chọn:** Update ngay sau `await sendMessage(pre-LLM save).catch(() => {})`
- **Lý do:** Đảm bảo UI phản ánh đúng trạng thái "scraped" kể cả khi LLM fail sau đó
- **Đã cân nhắc nhưng loại:** Chỉ update sau LLM success — mất thông tin trạng thái intermediate
