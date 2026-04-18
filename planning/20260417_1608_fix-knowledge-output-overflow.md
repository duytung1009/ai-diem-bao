# Planning: Knowledge Reduce — Output Overflow Prevention

**Date:** 2026-04-17  
**Type:** Bug fix / improvement  
**Tier:** Tier 2

## Objective & Scope

Hiện tại `runReducePhase` (KnowledgeView.vue) tính `finalCap = min(150, max(20, chunks×3))` nhưng không kiểm tra xem output có vượt context window không. Với model 16K context và finalCap = 81 entries × ~100 tokens/entry = ~8.1K tokens output — cộng với prompt + input có thể dễ tràn.

**Mục tiêu:** Nếu `finalCap` quá lớn cho 1 call, chia thành nhiều call nhỏ hơn dựa trên output budget, rồi client-side dedup để gộp kết quả.

## Affected Modules

- `entrypoints/sidepanel/views/KnowledgeView.vue` — hàm `runReducePhase` (thay đổi chính)
- `lib/constants.ts` — thêm 2 constants mới
- `lib/prompts.ts` — không cần đổi (đã có `buildKnowledgeReducePrompt(cap)`)

## Implementation Steps

### Bước 1: Thêm constants vào `lib/constants.ts`

```ts
// Average tokens per knowledge entry (title ~15 + content ~60 + tags ~10 + source ~15)
export const TOKENS_PER_KNOWLEDGE_ENTRY = 100;

// Max fraction of context window reserved for LLM output in reduce calls
export const REDUCE_OUTPUT_FRACTION = 0.35;
```

### Bước 2: Thêm helper `calcMaxOutputEntries` vào `KnowledgeView.vue`

Đặt trước `runReducePhase`. Tính số entries tối đa có thể output trong 1 reduce call mà không tràn context:

```ts
function calcMaxOutputEntries(
  contextLimit: number,
  promptTokens: number,
  inputTokens: number,
): number {
  const outputBudget = contextLimit * REDUCE_OUTPUT_FRACTION;
  return Math.max(10, Math.floor(outputBudget / TOKENS_PER_KNOWLEDGE_ENTRY));
}
```

> `REDUCE_OUTPUT_FRACTION = 0.35` → với 16K context: 5600 tokens output ÷ 100 = 56 entries/call  
> Với 32K: 112 entries/call — không cần split.

### Bước 3: Thêm helper `clientSideDedup` vào `KnowledgeView.vue`

Dedup sau khi concat kết quả từ nhiều call (cross-group trùng title):

```ts
function clientSideDedup(entries: KnowledgeEntry[]): KnowledgeEntry[] {
  const seen = new Set<string>();
  return entries.filter(e => {
    const key = e.title.toLowerCase().replace(/[^\p{L}\d]/gu, '').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
```

### Bước 4: Sửa `runReducePhase` — thêm split-output logic

Sau phần tree-reduce hiện có (sau khi `entriesToReduce` đã sẵn sàng), **thay** đoạn "Final (or only) reduce call" bằng logic sau:

```ts
// --- Hiện tại (xóa đi) ---
// Final (or only) reduce call — use dynamic cap
const { taskId, result } = reduceKnowledgeChunksTask(entriesToReduce, finalCap);
...
finalEntries = enrichEntries(...);

// --- Thay bằng ---
const model = currentConfig.value?.model ?? 'gpt-4o-mini';
const contextLimit = getContextLimit(model, currentConfig.value?.contextWindow);
const promptTokens = estimateTokens(buildKnowledgeReducePrompt(finalCap));
const inputTokens = estimateTokens(JSON.stringify(entriesToReduce)) * 1.4;
const maxPerCall = calcMaxOutputEntries(contextLimit, promptTokens, inputTokens);

let rawFinalEntries: KnowledgeEntry[];
if (finalCap <= maxPerCall) {
  // Fit in one call — existing path
  const { taskId, result } = reduceKnowledgeChunksTask(entriesToReduce, finalCap);
  llmTaskId.value = taskId;
  const reduceResult = await result;
  if (guardId !== activeExtractId) return;
  rawFinalEntries = ((reduceResult.data as { entries?: KnowledgeEntry[] })?.entries) ?? [];
} else {
  // Split output: multiple calls, each produces maxPerCall entries
  const numCalls = Math.ceil(finalCap / maxPerCall);
  const groupSize = Math.ceil(entriesToReduce.length / numCalls);
  const allRaw: KnowledgeEntry[] = [];

  for (let g = 0; g < entriesToReduce.length; g += groupSize) {
    if (guardId !== activeExtractId) return;
    const group = entriesToReduce.slice(g, g + groupSize);
    const { taskId, result } = reduceKnowledgeChunksTask(group, maxPerCall);
    llmTaskId.value = taskId;
    const groupResult = await result;
    if (guardId !== activeExtractId) return;
    allRaw.push(
      ...((groupResult.data as { entries?: KnowledgeEntry[] })?.entries ?? []),
    );
    if (g + groupSize < entriesToReduce.length) {
      await new Promise(r => setTimeout(r, MAP_REDUCE_CHUNK_DELAY_MS));
    }
  }
  rawFinalEntries = clientSideDedup(allRaw);
}

finalEntries = enrichEntries(rawFinalEntries);
```

> **Lưu ý quan trọng:** `entriesToReduce` lúc này có thể là `allPartial` (array of arrays) hoặc `groupResults` từ tree-reduce (cũng array of arrays). Khi slice để chia group, mỗi phần tử vẫn là `KnowledgeEntry[]` — đúng type cho `reduceKnowledgeChunksTask`.

### Bước 5: Thêm imports mới vào KnowledgeView.vue

```ts
import { ..., TOKENS_PER_KNOWLEDGE_ENTRY, REDUCE_OUTPUT_FRACTION } from '@/lib/constants';
```

(`buildKnowledgeReducePrompt` đã được import từ bước trước.)

## Edge Cases

| Case | Xử lý |
|------|--------|
| `allPartial.length === 1` | Skip reduce, return trực tiếp (unchanged) |
| `finalCap <= maxPerCall` (model lớn) | Single call như cũ |
| `numCalls > entriesToReduce.length` | `groupSize = 1`, mỗi group 1 entry-array — không xảy ra vì `finalCap ≤ 150` và `maxPerCall ≥ 10` |
| `guardId !== activeExtractId` trong loop | Return sớm (topic switch) — đã xử lý |
| `allRaw.length === 0` sau split | Guard hiện tại `if finalEntries.length === 0 → throw` vẫn hoạt động |
| Client-side dedup xóa hết entries | Sẽ bị catch bởi guard `finalEntries.length === 0` |

## Test Plan

- [ ] Thread nhỏ (< 5 chunks): single call, không split — kiểm tra không regression
- [ ] Thread vừa (10-20 chunks) với model 16K: kiểm tra `maxPerCall` được tính đúng
- [ ] Thread lớn (27+ chunks) với local LLM 16K: kiểm tra split thành nhiều call, entries không bị mất
- [ ] Topic switch mid-reduce: kiểm tra `guardId` cancel đúng
- [ ] Type check: `npx vue-tsc --noEmit` clean

## Rollback Plan

Chỉ sửa `KnowledgeView.vue` và `lib/constants.ts` — revert 2 file nếu cần. Không đụng đến messaging layer hay background.

## Decision Log

### Quyết định 1: Client-side dedup thay vì final LLM dedup

- **Đã chọn:** Client-side dedup bằng normalized title match sau khi concat kết quả split
- **Lý do:** Thêm 1 LLM call chỉ để dedup là quá tốn; title collision thực tế rất thấp vì mỗi group xử lý chunk riêng biệt
- **Đã cân nhắc nhưng loại:**
  - Final LLM dedup call — loại vì thêm latency + cost; output của nó cũng có thể overflow
  - Levenshtein similarity — loại vì overkill, thêm complexity O(N²)
- **Điều kiện thay đổi:** Nếu test thực tế thấy tỷ lệ duplicate cross-group cao → xem xét lại

### Quyết định 2: `REDUCE_OUTPUT_FRACTION = 0.35`

- **Đã chọn:** Dành 35% context cho output
- **Lý do:** Prompt (~200 tokens) + input entries (biến) chiếm phần còn lại; 35% output là conservative buffer cho entry-rich topics
- **Đã cân nhắc nhưng loại:**
  - Tính output budget chính xác `= contextLimit - promptTokens - inputTokens` — loại vì `inputTokens` thay đổi theo group, phức tạp hơn không cần thiết
- **Điều kiện thay đổi:** Nếu LLM thường bị truncate output → giảm input fraction (tăng output fraction)

### Quyết định 3: Chia groups theo `entriesToReduce` index, không theo tags

- **Đã chọn:** Chia đều theo index (chunk groups liền nhau)
- **Lý do:** Simple, predictable; đảm bảo temporal locality (bài cùng thời điểm ở cùng group, ít duplicate hơn)
- **Đã cân nhắc nhưng loại:**
  - Tag-based partitioning — loại vì entries từ mỗi chunk có nhiều tags khác nhau, khó phân nhóm clean
