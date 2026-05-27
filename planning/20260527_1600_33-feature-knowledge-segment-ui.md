# F33 — Knowledge Segment UI: Per-segment Extraction & Management

**Ngày:** 2026-05-27
**Feature số:** 33
**Tier:** Tier 3 (cross-module, đổi data model, refactor composable lớn)
**Model:** Opus planning; Sonnet implement
**Tham chiếu:** F24 (dynamic chunks), F27 (opt-in persist + notebook), F30 (resume on failure)

---

## Overview

Hiện tại tab Kiến thức xử lý toàn bộ thread trong 1 flow liên tiếp (~10–15 API call cho thread 1000 bài). Dù F24 đã persist từng chunk và F30 đã cho phép continue-on-truncation, user vẫn không có khả năng kiểm soát từng phần: không biết đoạn nào đã xong, không thể chỉ trích xuất 1 đoạn, không thể retry riêng lẻ nếu kết quả không vừa ý.

Feature này expose cấu trúc chunk-level hiện có qua UI segment-based, align với boundary của tab Tóm tắt, cho phép:

1. **Xem trạng thái từng segment** — đã extract, bao nhiêu entries thô, lần cuối chạy khi nào
2. **Trích xuất từng segment hoặc tất cả** — granular control, fail 1 segment không ảnh hưởng segment khác
3. **Xem trước entries thô** của từng segment (raw, chưa dedup cross-segment)
4. **Xóa / trích xuất lại** từng segment nếu kết quả không ưng
5. **Tổng hợp thủ công** (reduce phase) khi user muốn danh sách cuối cùng đã dedup

---

## Goals

- **G1:** Mỗi summary segment có 1 row trong segment grid của tab Kiến thức, hiển thị status + raw entry count + actions
- **G2:** User có thể trigger extract/re-extract cho từng segment độc lập, không ảnh hưởng segments khác
- **G3:** Per-segment raw entries hiển thị như "xem trước" ngay sau khi extract xong segment đó (không cần chờ reduce)
- **G4:** "Tổng hợp" là hành động thủ công, chỉ chạy reduce 1 lần trên tất cả chunks đã có; result là `knowledgeEntries` như hiện tại
- **G5:** "Trích xuất tất cả" = extract toàn bộ segments tuần tự → auto-run reduce → giữ nguyên UX cũ
- **G6:** Khi 1 segment bị re-extract sau khi đã reduce → banner "Kết quả tổng hợp đã lỗi thời" + nút "Tổng hợp lại"
- **G7:** Backward compat: topic đã có `knowledgeChunks` không có `segmentIndex` vẫn hoạt động bình thường

## Non-Goals

- Không thay đổi prompt hay output format của knowledge extraction
- Không auto-reduce sau mỗi per-segment extract (chỉ "Extract All" mới auto-reduce)
- Không virtual scroll trong preview panel — defer nếu cần
- Không per-segment cost guard riêng — dùng chung cost guard hiện tại (F26 pattern)
- Không thay đổi notebook, toggleSave, delete flow

---

## Requirements

### Phase A — Data Model

**A1. Thêm `segmentIndex?: number` vào `KnowledgeChunk`:**

```typescript
// lib/types.ts
export interface KnowledgeChunk {
  index: number;
  startPostNumber: number;
  endPostNumber: number;
  entries: KnowledgeEntry[];
  extractedAt: number;
  complete?: boolean;
  failed?: boolean;
  segmentIndex?: number;   // NEW: index vào cachedTopic.segments[], undefined = legacy chunk
}
```

Chunks không có `segmentIndex` (legacy từ F24/F30) được coi là "unaligned" — vẫn dùng được cho resume/reduce nhưng không hiển thị trong segment grid mới. UI fallback về behavior hiện tại khi không có segments hoặc không có segmentIndex.

**A2. Thêm `knowledgeReducedAt?: number` vào `CachedTopic`:**

```typescript
// lib/types.ts — CachedTopic
knowledgeReducedAt?: number;   // NEW: timestamp lần reduce cuối; dùng để detect staleness
```

Staleness check: `isReduceStale = knowledgeChunks.some(c => c.extractedAt > (knowledgeReducedAt ?? 0))`.

Không cần field version hay hash — timestamp comparison đủ vì mỗi lần extract/re-extract đều ghi `extractedAt: Date.now()`.

**A3. `knowledgeReducedAt` được set khi nào:**
- Sau khi `runReducePhase` hoàn tất → set `knowledgeReducedAt = Date.now()` → persist vào cache
- Khi segment bị re-extract → `knowledgeReducedAt` KHÔNG bị reset (ta cần detect staleness qua compare, không manual reset)

---

### Phase B — useKnowledge Refactor

**B1. Derived: `knowledgeSegments` computed**

```typescript
// Mỗi element map 1-1 với cachedTopic.segments[]
interface KnowledgeSegmentView {
  segmentIndex: number;
  startPage: number;
  endPage: number;
  postCount: number;
  status: 'pending' | 'extracting' | 'done' | 'partial';
  chunks: KnowledgeChunk[];       // chunks với segmentIndex === this.segmentIndex
  rawEntryCount: number;           // tổng entries trong chunks (trước reduce)
  lastExtractedAt: number | null;
}
```

Computed từ `cachedTopic.value?.segments` × `cachedTopic.value?.knowledgeChunks`. Không persist — luôn derive từ source of truth.

Status logic:
- `pending`: không có chunks nào cho segment này
- `extracting`: composable đang chạy extract cho segment này (`activeSegmentIndex.value === i`)
- `partial`: có chunks nhưng ít nhất 1 chunk `failed: true`
- `done`: có chunks và không có `failed: true`

**B2. Derived: `isReduceStale` computed**

```typescript
const isReduceStale = computed(() => {
  const reducedAt = cachedTopic.value?.knowledgeReducedAt ?? 0;
  return (cachedTopic.value?.knowledgeChunks ?? []).some(c => c.extractedAt > reducedAt);
});
```

**B3. Derived: `hasAnyExtractedSegment` computed**

```typescript
const hasAnyExtractedSegment = computed(() =>
  (cachedTopic.value?.knowledgeChunks ?? []).some(c => c.segmentIndex !== undefined && !c.failed)
);
```

Dùng để enable nút "Tổng hợp" (ngay cả khi chưa extract hết tất cả segments).

**B4. Thêm `activeKnowledgeSegmentIndex` ref**

```typescript
const activeKnowledgeSegmentIndex = ref<number | null>(null);
// Dùng để track segment nào đang được extract (UI highlight, disable actions)
```

**B5. Hàm `extractSegment(segmentIdx: number)`**

```typescript
async function extractSegment(segmentIdx: number): Promise<void> {
  const topic = cachedTopic.value;
  if (!topic?.segments?.[segmentIdx]) return;

  const segment = topic.segments[segmentIdx];
  const segmentPosts = segment.posts;  // posts đã scrape trong segment này
  if (!segmentPosts?.length) return;

  activeKnowledgeSegmentIndex.value = segmentIdx;
  const guardId = knowledgeGuard.acquire();

  try {
    // Tìm chunks hiện có của segment này (cho resume trong-segment)
    const existingChunks = (topic.knowledgeChunks ?? []).filter(c => c.segmentIndex === segmentIdx);
    const otherChunks = (topic.knowledgeChunks ?? []).filter(c => c.segmentIndex !== segmentIdx);

    // Resume trong-segment: bắt đầu từ chunk cuối chưa complete
    const resume = computeSegmentResumeState(existingChunks, segmentPosts);
    const postsToExtract = segmentPosts.filter(p => p.postNumber >= resume.startFromPostNumber);

    if (!postsToExtract.length) return; // Đã extract hết

    // Extract chunks cho segment này (tái dùng logic từ handleExtract)
    const newSegmentChunks = await runChunkExtraction(
      postsToExtract,
      existingChunks,
      guardId,
      topic.url,
      topic.title,
      segmentIdx,   // ← NEW: truyền segmentIndex để ghi vào từng chunk
    );

    // Merge với chunks của các segment khác
    const allChunks = [...otherChunks, ...newSegmentChunks].sort((a, b) => a.startPostNumber - b.startPostNumber);
    await persistChunks(allChunks, guardId, topic.url);
    // KHÔNG chạy reduce — user phải bấm "Tổng hợp"
  } finally {
    activeKnowledgeSegmentIndex.value = null;
    knowledgeGuard.release(guardId);
  }
}
```

**B6. Hàm `clearSegment(segmentIdx: number)`**

```typescript
async function clearSegment(segmentIdx: number): Promise<void> {
  const topic = cachedTopic.value;
  if (!topic) return;
  const remaining = (topic.knowledgeChunks ?? []).filter(c => c.segmentIndex !== segmentIdx);
  await persistChunks(remaining, knowledgeGuard.acquire(), topic.url);
  // knowledgeReducedAt được giữ nguyên → isReduceStale tự tính lại
}
```

**B7. Hàm `reExtractSegment(segmentIdx: number)`**

```typescript
async function reExtractSegment(segmentIdx: number): Promise<void> {
  await clearSegment(segmentIdx);
  await extractSegment(segmentIdx);
}
```

**B8. Refactor `handleExtract` — "Extract All" flow:**

Extract All vẫn dùng flow hiện tại (đọc `computeKnowledgeResumeState` toàn bộ) NHƯNG:
- Mỗi chunk khi persist → ghi `segmentIndex` dựa trên post range (map `startPostNumber` → segment index qua `findSegmentForPost()`)
- Sau khi tất cả chunks xong → tự động chạy `runReducePhase` (giữ behavior hiện tại)
- Set `knowledgeReducedAt` sau reduce

Helper `findSegmentForPost(postNumber, segments)`:
```typescript
function findSegmentForPost(postNumber: number, segments: TopicSegment[]): number {
  // TopicSegment có posts[], mỗi post có postNumber
  return segments.findIndex(seg =>
    seg.posts.some(p => p.postNumber === postNumber)
  );
}
```

Nếu topic không có `segments` (flat mode không chia segment) → `segmentIndex = undefined` → UI fallback.

**B9. Expose thêm từ composable:**

```typescript
return {
  // ... existing exports
  knowledgeSegments,          // KnowledgeSegmentView[]
  isReduceStale,
  hasAnyExtractedSegment,
  activeKnowledgeSegmentIndex,
  extractSegment,
  clearSegment,
  reExtractSegment,
  runReducePhaseManual,       // wrapper gọi runReducePhase với chunks hiện có
};
```

`runReducePhaseManual`: gọi `runReducePhase` trên `cachedTopic.value?.knowledgeChunks ?? []`, cùng pattern với "Khôi phục danh sách" (F27 B5).

---

### Phase C — KnowledgeView UI

**C1. Segment grid — collapsible, tương tự SummaryView**

Hiển thị khi `cachedTopic.segments?.length > 0` (topic có segment mode). Ẩn khi topic chỉ có flat posts.

```
┌─ Các đoạn (5 đoạn)  ─────────────────── [Thu gọn ▲] ┐
│  S1  Trang 1–20    ✅ 12 entries  Vừa xong   [↺ Làm lại]  │
│  S2  Trang 21–40   ✅ 8 entries   2 phút trước [↺ Làm lại] │
│  S3  Trang 41–60   ⚠ 5 entries   Một phần    [↺ Làm lại]  │
│  S4  Trang 61–80   ○ Chưa trích xuất         [→ Trích xuất]│
│  S5  Trang 81–100  ○ Chưa trích xuất         [→ Trích xuất]│
└──────────────────────────────────────────────────────────┘
```

Mỗi segment row:
- Icon status: ✅ done, ⚠ partial (có failed chunk), ○ pending, 🔄 extracting (spinner)
- Label: "Trang X–Y" hoặc "Đoạn N" nếu không có page info
- Entry count: "N entries" (raw, từ chunks; chỉ hiện khi status = done/partial)
- Relative time: "2 phút trước" (từ `lastExtractedAt`)
- Action button:
  - Pending → `[→ Trích xuất]` → gọi `extractSegment(i)`
  - Done/Partial → `[↺ Làm lại]` → gọi `reExtractSegment(i)` (kèm confirm nếu segment đã có entries)
  - Extracting → disabled với spinner

Click vào row → expand "xem trước" panel bên dưới.

**C2. Per-segment preview panel**

Khi click vào segment row → toggle `expandedSegmentIndex`. Hiện entries thô của segment đó:

```
▼ S1 — 12 entries (xem trước, chưa tổng hợp)
  ┌──────────────────────────────────────┐
  │ 🔖 Tiêu đề entry 1                   │
  │ Nội dung...  [tag1] [tag2]           │
  │ Nguồn: @username — bài #42           │
  │                              [Lưu ↑] │
  ├──────────────────────────────────────┤
  │ 🔖 Tiêu đề entry 2                   │
  │ ...                                  │
  └──────────────────────────────────────┘
```

Entries trong preview là raw (từ `knowledgeSegments[i].chunks[].entries.flat()`), không qua reduce. Có thể có duplicate với segment khác — **hiện badge nhỏ "Chưa tổng hợp"** để user biết.

Nút "Lưu" trong preview: gọi `toggleSave` như bình thường → entry được lưu vào notebook kể cả trước khi reduce. Đây là feature thực sự có giá trị — user có thể harvest entries từ từng segment mà không cần chờ toàn bộ flow.

**C3. Stale banner + nút Tổng hợp**

Khi `isReduceStale && entries.value.length > 0` (đã có kết quả cũ nhưng stale):

```
┌────────────────────────────────────────────────────┐
│ ⚠ Danh sách tổng hợp đã lỗi thời — một số đoạn    │
│   vừa được trích xuất lại.                         │
│   [Tổng hợp lại — ~2 API calls]                   │
└────────────────────────────────────────────────────┘
```

Khi `hasAnyExtractedSegment && entries.value.length === 0` (chưa từng reduce):

```
┌────────────────────────────────────────────────────┐
│ 💡 Đã trích xuất X đoạn. Bấm "Tổng hợp" để tạo   │
│    danh sách kiến thức hoàn chỉnh (loại trùng lặp │
│    và xếp hạng theo tầm quan trọng).               │
│   [Tổng hợp — ~2 API calls]                       │
└────────────────────────────────────────────────────┘
```

Nút "Tổng hợp" → `onReduceClick()` → cost guard (F26 pattern) → `runReducePhaseManual()`.

**C4. Action bar — dropdown "Trích xuất"**

Thay vì 1 nút "Trích xuất", dùng button + dropdown:

```
[Trích xuất tất cả ▼]
  └─ Trích xuất đoạn chưa xong   (chỉ pending/partial)
  └─ Trích xuất lại tất cả       (clear all + re-extract)
```

Khi không có segments → button đơn như hiện tại (backward compat).

**C5. Fallback khi không có segments**

Nếu `cachedTopic.segments?.length === 0` hoặc `undefined` (topic flat hoặc chưa summarize) → ẩn segment grid, hiện UI hiện tại như cũ. Không breaking change.

---

### Phase D — Background & Persist

**D1. `runReducePhase` sau reduce → set `knowledgeReducedAt`**

Trong `useKnowledge.ts`, sau khi `runReducePhase` hoàn tất và `SAVE_CACHED_TOPIC` được gọi:

```typescript
await optimisticUpdate({
  knowledgeEntries: reducedEntries.filter(e => e.saved),
  knowledgeReducedAt: Date.now(),   // NEW
});
```

**D2. `persistChunks` giữ nguyên** — không cần sửa, chunks đã có `segmentIndex` field.

**D3. Background handlers** — không cần thay đổi; `knowledgeReducedAt` là field thêm vào `CachedTopic`, `SAVE_CACHED_TOPIC` handler đã merge tất cả fields.

---

## Technical Considerations

### Affected Files

**`lib/types.ts`**
- Thêm `segmentIndex?: number` vào `KnowledgeChunk`
- Thêm `knowledgeReducedAt?: number` vào `CachedTopic`

**`entrypoints/sidepanel/composables/useKnowledge.ts`** ← bulk changes
- Thêm `knowledgeSegments`, `isReduceStale`, `hasAnyExtractedSegment`, `activeKnowledgeSegmentIndex`
- Thêm `extractSegment`, `clearSegment`, `reExtractSegment`, `runReducePhaseManual`
- Refactor `handleExtract` ghi `segmentIndex` vào chunks
- Refactor `runReducePhase` persist `knowledgeReducedAt`
- Tách helper `runChunkExtraction` (đoạn code lặp lại giữa handleExtract và extractSegment)

**`entrypoints/sidepanel/views/KnowledgeView.vue`** ← UI changes
- Thêm segment grid (C1)
- Thêm per-segment preview panel (C2)
- Thêm stale banner + nút Tổng hợp (C3)
- Đổi action bar dropdown (C4)

### findSegmentForPost — Mapping Post → Segment

`TopicSegment.posts[]` đã chứa `ScrapedPost` với `postNumber`. Trong Extract All flow, mỗi chunk biết `startPostNumber` và `endPostNumber` — ta tìm segment chứa `startPostNumber`:

```typescript
function findSegmentForPost(postNumber: number, segments: TopicSegment[]): number {
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].posts.some(p => p.postNumber === postNumber)) return i;
  }
  return -1; // không tìm được → legacy
}
```

Worst case O(N×M) nhưng N (segments) × M (posts per segment) thường nhỏ (~100 posts/segment). Đủ nhanh, không cần index.

### Resume trong-segment (`computeSegmentResumeState`)

Tương tự `computeKnowledgeResumeState` nhưng scoped:

```typescript
function computeSegmentResumeState(
  existingChunks: KnowledgeChunk[],
  segmentPosts: ScrapedPost[],
): { startFromPostNumber: number } {
  if (!existingChunks.length) return { startFromPostNumber: segmentPosts[0]?.postNumber ?? 0 };

  const firstFailed = existingChunks.find(c => c.failed);
  if (firstFailed) return { startFromPostNumber: firstFailed.startPostNumber };

  const lastChunk = existingChunks[existingChunks.length - 1];
  if (!lastChunk.complete) return { startFromPostNumber: lastChunk.startPostNumber };

  // Tất cả chunks complete → không còn gì để extract trong segment này
  return { startFromPostNumber: Infinity };
}
```

### Backward Compat — Legacy Chunks

Chunks không có `segmentIndex` (từ topic đã extract trước F33) vẫn tham gia vào `knowledgeEntries` qua reduce. Chỉ không hiển thị trong segment grid. Nếu topic có cả legacy chunks và mới → segment grid chỉ hiện segments có chunks mới; phần còn lại vẫn trong `knowledgeEntries` khi reduce.

Không cần migration — legacy chunks chạy qua reduce bình thường.

### Edge Cases

1. **Topic không có summary segments (flat mode):** `cachedTopic.segments` rỗng hoặc undefined → toàn bộ Phase C bị ẩn, UI giữ nguyên như F30. `segmentIndex` không được ghi vào chunks trong Extract All (fallback `segmentIndex = undefined`).

2. **Segment chưa được scrape (posts rỗng):** `extractSegment(i)` check `segment.posts?.length === 0` → noop + hiện tooltip "Đoạn này chưa được scrape — hãy scrape tab Tóm tắt trước".

3. **Re-extract segment khi đang có người extract all:** `activeKnowledgeSegmentIndex` check + global `isLoading` guard → disable nút, tránh concurrent extraction.

4. **Per-segment preview sau clearSegment:** `knowledgeSegments[i].chunks = []` → preview panel hiện empty state "Chưa có entries — bấm Trích xuất".

5. **"Tổng hợp" khi tất cả chunks là legacy (no segmentIndex):** `hasAnyExtractedSegment` check `segmentIndex !== undefined` → false → nút "Tổng hợp" ẩn, nhưng `canRestore` vẫn đúng → nút "Khôi phục danh sách" hiện như F27. Không conflict.

6. **Reduce sau re-extract: double-running:** `runReducePhaseManual` dùng cùng `knowledgeGuard` → concurrent reduce bị block.

7. **Entries trong preview có thể trùng với entry đã save trong knowledgeEntries:** `id` là uuid stable từ khi extract → nếu user lưu entry từ preview trước reduce, và entry đó vẫn xuất hiện sau reduce với cùng id → `toggleSave` idempotent (overwrite). Không conflict.

8. **Segment mới xuất hiện sau topic refresh (thêm bài mới):** Khi topic được scrape thêm trang mới → `segments` có thể tăng số lượng. Segment grid re-render với segment mới ở cuối (status = pending). Chunks cũ của segments cũ không bị ảnh hưởng.

---

## Implementation Notes

### Thứ tự implement

**Phase A (30 min):** Chỉ sửa types. Không breaking.

**Phase B (2–3 ngày):** Refactor `useKnowledge.ts` — tách `runChunkExtraction` ra helper trước để dễ reuse, sau đó thêm `extractSegment`/`clearSegment`/`reExtractSegment`. Test với console trước khi có UI.

**Phase C (2 ngày):** UI — bắt đầu với segment grid (C1), sau đó preview panel (C2), cuối cùng stale banner + action bar (C3, C4). Reuse icon/style từ SummaryView segment grid.

**Phase D (30 min):** Persist `knowledgeReducedAt` sau reduce — gắn vào `runReducePhase` cuối cùng.

### Patterns cần tái sử dụng

- **Segment grid UI:** SummaryView `segmentGridExpanded` + rows → copy structure, adapt cho knowledge
- **Cost guard:** `onReduceClick` tái dùng `CostConfirmModal` + pattern của `onExtractClick` (F26/F27)
- **Relative time:** `formatRelativeTime` nếu có, hoặc viết inline đơn giản
- **Guard pattern:** `knowledgeGuard.acquire()` / `isStale()` / `release()` — giữ nguyên

### Anti-patterns cần tránh

- **KHÔNG** auto-run reduce sau `extractSegment` — user phải chủ động bấm "Tổng hợp"
- **KHÔNG** clear `knowledgeReducedAt` khi re-extract segment — để `isReduceStale` tự detect qua timestamp compare
- **KHÔNG** store derived `KnowledgeSegmentView` vào cache — luôn compute từ `segments` + `knowledgeChunks`
- **KHÔNG** break flow khi topic không có segments — guard tất cả segment-related logic bằng `if (!segments?.length)`

---

## Test Plan

### Phase A — Types
- [ ] Compile clean sau khi thêm 2 fields mới

### Phase B — Composable
- [ ] Extract segment 2 của topic 5 segments: chỉ chunks với `segmentIndex=2` được tạo, segments khác không đổi
- [ ] Resume trong-segment: extract segment 2 bị cancel giữa chừng → retry → tiếp tục từ chunk bị dở
- [ ] `clearSegment(2)` → `knowledgeChunks` không còn chunk nào với `segmentIndex=2`, chunks khác nguyên vẹn
- [ ] `reExtractSegment(2)` = clear + extract → chunks mới có `extractedAt` mới hơn
- [ ] `isReduceStale` = true sau `reExtractSegment`, false sau `runReducePhaseManual`
- [ ] `handleExtract` (Extract All): tất cả chunks được ghi `segmentIndex` đúng; sau reduce `knowledgeReducedAt` được set
- [ ] Legacy chunks (segmentIndex=undefined) không ảnh hưởng bởi `extractSegment`/`clearSegment`
- [ ] `knowledgeSegments` derive đúng status: pending/done/partial/extracting

### Phase C — UI
- [ ] Topic có segments → segment grid hiện, collapsed by default
- [ ] Topic không có segments → segment grid ẩn hoàn toàn
- [ ] Click "Trích xuất" trên segment pending → spinner + status chuyển extracting
- [ ] Click segment row → preview panel mở, hiển thị raw entries
- [ ] Preview panel badge "Chưa tổng hợp" hiển thị
- [ ] Nút "Lưu" trong preview → entry được save vào notebook (không cần reduce)
- [ ] Stale banner hiện sau re-extract, ẩn sau tổng hợp
- [ ] "Tổng hợp" button → cost modal → confirm → reduce chạy → `knowledgeEntries` cập nhật
- [ ] "Trích xuất tất cả" → auto-reduce → stale banner ẩn
- [ ] Disabled state khi đang extracting segment khác

### Integration
- [ ] Compile: `npm run compile`
- [ ] Test suite: `npm run test`
- [ ] Manual: topic 500+ bài → extract segment 2 → xem preview → save 2 entries → tổng hợp → kiểm tra entries đã save vẫn còn → re-extract segment 2 → stale banner → tổng hợp lại

---

## Decision Log

### Quyết định 1: Align knowledge segments với summary segments (Option A)
- **Đã chọn:** 1 summary segment = 1 knowledge segment trong UI. 1 summary segment có thể map sang N knowledge chunks (vì knowledge chunk size nhỏ hơn).
- **Lý do:** Mental model nhất quán — user thấy "Đoạn 3" ở tab Tóm tắt và "Đoạn 3" ở tab Kiến thức là cùng một phần nội dung. Reuse boundary đã tính, không tính lại.
- **Đã cân nhắc nhưng loại:**
  - Knowledge segment độc lập với summary segment → loại vì số lượng segment khác nhau gây confusing, và không có lợi ích rõ ràng
- **Điều kiện thay đổi:** Nếu knowledge cần chunk size khác summary đáng kể → có thể thêm config "knowledge chunk budget" riêng, nhưng segment boundary vẫn align với summary.

### Quyết định 2: Reduce là hành động thủ công (Option B)
- **Đã chọn:** Extract từng segment = chỉ map phase, lưu raw entries. "Tổng hợp" = 1 nút thủ công, chạy reduce 1 lần. "Trích xuất tất cả" = extract all + auto-reduce (giữ UX cũ).
- **Lý do:** User cần thấy entries từng segment ngay sau extract (preview), không cần chờ reduce. Reduce chỉ cần thiết cho danh sách cuối cùng. Per-segment auto-reduce sẽ chạy N lần reduce thay vì 1 lần → lãng phí token và tạo intermediate states confusing.
- **Đã cân nhắc nhưng loại:**
  - Auto-reduce sau mỗi segment → N × reduce_cost, không cần thiết
  - Global reduce thủ công không có preview → user không thấy gì trong khi extract từng segment → UX tệ
- **Điều kiện thay đổi:** Nếu user thấy "phải bấm thêm 1 nút Tổng hợp" là friction quá lớn → thêm option "Auto tổng hợp sau khi extract xong" trong Settings.

### Quyết định 3: Staleness detection bằng timestamp compare
- **Đã chọn:** `isReduceStale = chunks.some(c => c.extractedAt > knowledgeReducedAt)`. Không dùng version counter hay hash.
- **Lý do:** Đơn giản, không cần thêm logic update. Timestamp monotonic tăng mỗi lần extract → so sánh là đủ. Edge case: 2 extract trong cùng 1ms (không thực tế) vẫn safe vì `>` không phải `>=`.
- **Điều kiện thay đổi:** Nếu clock skew trở thành issue (unlikely với local IDB) → đổi sang version counter.

### Quyết định 4: `segmentIndex = undefined` cho legacy chunks thay vì `-1`
- **Đã chọn:** `undefined` = legacy, không có segment binding. `-1` là magic number dễ gây bug khi dùng làm array index.
- **Lý do:** TypeScript optional field rõ ràng hơn sentinel value. Filter legacy = `c.segmentIndex === undefined`. Không có conflict với valid indices (0, 1, 2...).
- **Điều kiện thay đổi:** Nếu cần serialize legacy status sang JSON field → đổi sang `segmentIndex: -1` (vì JSON không có `undefined`). Nhưng IDB serialize `undefined` thành omitted field → OK.

### Quyết định 5: Không migrate legacy chunks
- **Đã chọn:** Chunks không có `segmentIndex` không được retro-assign segment. UI segment grid chỉ hiện segments có chunks mới.
- **Lý do:** Migration cần scan tất cả posts để map `postNumber` → segment — expensive và dễ sai nếu posts đã bị filter/exclude. User trong internal phase có thể clear cache nếu muốn segment UI đầy đủ.
- **Điều kiện thay đổi:** Khi public release → thêm lazy migration: lần extract tiếp theo tự ghi `segmentIndex` vào chunks mới; không cần retro-assign cũ.

### Quyết định 6: Per-segment preview entries có thể duplicate
- **Đã chọn:** Preview hiển thị raw entries từ chunk của segment đó, không dedup cross-segment. Badge "Chưa tổng hợp" cảnh báo user.
- **Lý do:** Dedup trong preview cần chạy reduce cross-segment → thêm LLM call → mất ý nghĩa "preview nhanh không cần LLM". Duplicate trong preview là acceptable trade-off, user hiểu đây là "draft".
- **Điều kiện thay đổi:** Nếu user confused về duplicates → thêm client-side simple dedup (title exact match) trong preview mà không cần LLM.

### Quyết định 7: Save entries từ preview trước reduce
- **Đã chọn:** Nút "Lưu" trong preview panel hoạt động bình thường (gọi `toggleSave`), entry vào notebook ngay kể cả trước reduce.
- **Lý do:** User thấy entry valuable trong segment → không nên ép chờ reduce toàn bộ. Entry ID stable nên sau reduce entry cùng ID vẫn giữ `saved=true`. Đây là core value của feature — harvest kiến thức ngay mà không cần chờ flow đầy đủ.
- **Điều kiện thay đổi:** Nếu entry bị drop trong reduce (do LLM xếp là low quality) → entry vẫn trong notebook (đã save). Acceptable — user explicit save thì ta respect.
