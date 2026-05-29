# Planning: Fix `reduce_knowledge_chunks` completion_tokens overflow

**Date:** 2026-05-29
**Type:** Bug fix
**Tier:** Tier 2

## Problem Statement

`taskType: "reduce_knowledge_chunks"` thường bị `completion_tokens` vượt `max_tokens` → LLM trả về `INCOMPLETE_RESPONSE` / `finish_reason: 'length'`.

**Root cause đã xác định:** Cách split pre-reduce và final reduce hiện tại KHÔNG kiểm soát được số lượng entries mỗi call phải xử lý, dẫn đến model bị ép output nhiều entries hơn khả năng của `max_tokens`.

### Chi tiết 2 vấn đề:

**A. `calcMaxOutputEntries` có floor `Math.max(10, ...)` gây cap quá lớn**

`useKnowledge.ts:212`:
```typescript
return Math.max(10, Math.floor(maxOutputTokens * 0.8 / TOKENS_PER_ENTRY_REDUCE));
```

Với `maxOutputTokens = 4096`: `Math.max(10, 4) = 10`. Model chỉ đủ token output ~4 entries (700 tokens/entry), nhưng cap=10 → model cố output gấp 2.5 lần khả năng → **chắc chắn tràn**.

**B. Pre-reduce split theo chunk count, không theo entry count**

`useKnowledge.ts:500-501`:
```typescript
const groupCount = Math.max(2, Math.ceil(totalTokens / usableTokens));
const groupSize = Math.ceil(allPartial.length / groupCount);
```

`allPartial` là array of `KnowledgeEntry[][]`, mỗi chunk có 0-20+ entries. Khi split theo số chunk, mỗi group có thể nhận 20-50 entries. + pre-reduce không truyền `entryCap` → default `cap=20` (`summarizer.ts:338`), càng làm trầm trọng.

## Fix Approach

Hai thay đổi chính trong `entrypoints/sidepanel/composables/useKnowledge.ts`:

### Fix A: Bỏ floor `Math.max(10, ...)` trong `calcMaxOutputEntries`

```typescript
// Before
function calcMaxOutputEntries(maxOutputTokens: number): number {
    return Math.max(10, Math.floor(maxOutputTokens * 0.8 / TOKENS_PER_ENTRY_REDUCE));
}

// After
function calcMaxOutputEntries(maxOutputTokens: number): number {
    // Floor at 2 to prevent empty caps, let multi-call split handle the rest
    return Math.max(2, Math.floor(maxOutputTokens * 0.8 / TOKENS_PER_ENTRY_REDUCE));
}
```

### Fix B: Split pre-reduce theo entry count thay vì chunk count

Flatten entries từ tất cả chunks thành 1 list, rồi split thành group dựa trên `maxPerCall` (số entries tối đa có thể output trong 1 call):

```typescript
// Before (pseudo-code)
const groupCount = Math.ceil(totalTokens / usableTokens);
const groupSize = Math.ceil(allPartial.length / groupCount);
// Thêm: reduceKnowledgeChunksTask(group) — NO entryCap

// After
const maxPerCall = calcMaxOutputEntries(maxOutputTokens);
const allFlatEntries = allPartial.flat();  // flatten all chunk entries

// Split all entries into flat groups of max 2×maxPerCall input entries
// (input > output: 2x ratio ensures actual reduction)
const entriesPerGroup = maxPerCall * 2;
const flatGroups: KnowledgeEntry[][] = [];
for (let i = 0; i < allFlatEntries.length; i += entriesPerGroup) {
    flatGroups.push(allFlatEntries.slice(i, i + entriesPerGroup));
}

// Call reduce on each group WITH entryCap = maxPerCall
for (const group of flatGroups) {
    const { result } = reduceKnowledgeChunksTask([group], maxPerCall);
    // ... collect results
}
```

### Fix C: Truyền `entryCap` cho pre-reduce calls

Luôn truyền `entryCap = maxPerCall` để mỗi pre-reduce call output đúng số entries nằm trong budget.

## Affected Files

| File | Change |
|------|--------|
| `entrypoints/sidepanel/composables/useKnowledge.ts` | Sửa `calcMaxOutputEntries` (line 205-213) + `runReducePhase` (pre-reduce logic, line 499-525) |
| `tests/unit/reduce-knowledge-chunks.test.ts` | Cập nhật test cho `calcMaxOutputEntries` nếu có |

## Edge Cases

| Case | Handling |
|------|----------|
| `allFlatEntries.length === 0` | Pre-reduce skip, fall through to final reduce |
| `allPartial.length === 1` (1 chunk) | Fast path: return trực tiếp entries, không gọi reduce |
| `maxPerCall = 2` (maxOutputTokens = 2000) | Mỗi pre-reduce group có 4 input entries, output 2 — hợp lý |
| `maxPerCall >= allFlatEntries.length` | Chỉ 1 group, pre-reduce gọi 1 lần, vẫn có reduction nếu input > maxPerCall |
| `finalCap > maxPerCall` | Multi-call path đã hoạt động, không thay đổi |
| `finalCap <= maxPerCall` | Single-call path đã hoạt động, không thay đổi |

## Test Plan

- [ ] Test với model `maxOutputTokens = 2000` (cap=2): verify mỗi call xử lý tối đa 4 entries, output 2 entries
- [ ] Test với model `maxOutputTokens = 4096` (cap=4): verify split hoạt động với nhiều chunks
- [ ] Test với model `maxOutputTokens = 8192` (cap=9): verify single-call path vẫn đúng
- [ ] Test với threads 2 chunks, 6 chunks, 15 chunks — đảm bảo không regression
- [ ] `npm run compile` clean
- [ ] `npm run test` all pass

## Rollback Plan

Chỉ sửa `useKnowledge.ts` — revert 1 file nếu cần. Không đụng messaging layer, background, hoặc prompt templates.

## Decision Log

### Quyết định 1: Floor `Math.max(2, ...)` thay vì `Math.max(10, ...)`

- **Đã chọn:** Floor = 2
- **Lý do:** Với `maxOutputTokens = 2000`: `floor(1600/700) = 2`. Đây là cap tối thiểu hợp lý — 2 entries output cho model nhỏ. Nếu cap quá nhỏ (< 2): multi-call path sẽ tạo nhiều calls hơn để bù lại, nhưng mỗi call vẫn output ít nhất 2 entries.
- **Đã cân nhắc nhưng loại:**
  - Không floor (có thể cap=1) — loại vì cap=1 gây lãng phí LLM call (1 entry/call)
  - Floor = 5 — loại vì vẫn gây overflow cho model 2K tokens

### Quyết định 2: Pre-reduce split theo flat entry count (2×maxPerCall)

- **Đã chọn:** Input entries per pre-reduce group = 2 × `maxPerCall`, output cap = `maxPerCall`
- **Lý do:** Tỷ lệ 2:1 đảm bảo mỗi call thực sự giảm số lượng entries; model có room để merge mà không bị quá tải input. Dễ predict, không phụ thuộc token estimate (vốn không chính xác tuyệt đối).
- **Đã cân nhắc nhưng loại:**
  - Giữ split theo chunk count — loại vì mỗi chunk entries count khác nhau, gây mất cân bằng
  - Split theo token estimate — loại vì thêm phức tạp nhưng không cải thiện đáng kể so với entry-count-based

### Quyết định 3: Giữ nguyên multi-call final reduce path

- **Đã chọn:** Không thay đổi logic final reduce (lines 527-571)
- **Lý do:** Multi-call path đã xử lý đúng: split theo `finalCap / maxPerCall` và gọi `reduceKnowledgeChunksTask(group, maxPerCall)`. Vấn đề nằm ở pre-reduce — sau khi fix pre-reduce, final reduce sẽ nhận entries đã được nén đúng kích cỡ.
