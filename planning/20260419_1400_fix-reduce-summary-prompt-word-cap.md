# Fix: REDUCE_SUMMARY_PROMPT word cap động theo maxTokens

## Objective & scope

`REDUCE_SUMMARY_PROMPT` hardcode "dưới 500 từ" trong output instruction. Khi `config.maxTokens` nhỏ (ví dụ 500–1000), LLM bị cắt output trước khi hoàn thành JSON → `parseSummaryJSON` trả `null` → mất kết quả reduce.

Pattern fix giống `buildKnowledgeReducePrompt(cap)`: chuyển constant thành builder function nhận `wordCap` tính từ `maxTokens`.

**Scope:** `lib/prompts.ts` + `lib/llm/summarizer.ts`

## Affected modules

- `lib/prompts.ts` — thêm `buildReduceSummaryPrompt(wordCap: number): string`
- `lib/llm/summarizer.ts`:
  - `summaryChunks()` — tính wordCap từ `config.maxTokens`, dùng builder làm default cho `reducePrompt`; fix line 570 đang hardcode `REDUCE_SUMMARY_PROMPT` thay vì biến `reducePrompt`
  - `reduceSegmentSummaries()` — thêm param `maxTokens?: number`, dùng builder tại 3 call sites (line 683 estimate, line 712 map call, line 730 group call)
  - `summarizeSegments()` — truyền `config.maxTokens` xuống `reduceSegmentSummaries`

## Implementation steps

### 1. `lib/prompts.ts` — thêm builder function

Tương tự `buildKnowledgeReducePrompt`, thêm:

```typescript
export function buildReduceSummaryPrompt(wordCap: number): string {
  return `Bạn là trợ lý AI gộp nhiều bản tóm tắt JSON thành một tóm tắt cuối cùng.
  ... (nội dung y hệt REDUCE_SUMMARY_PROMPT) ...
  - Giữ bản tóm tắt cuối dưới ${wordCap} từ
  ...`;
}
```

Giữ `REDUCE_SUMMARY_PROMPT` constant cho backward compat (dùng trong token estimation tĩnh nếu cần, và các caller không có config). Hoặc đổi thành `buildReduceSummaryPrompt(500)`.

### 2. Công thức tính `wordCap`

Vietnamese JSON output: ~1.3–1.5 tokens/word (accounting for JSON keys, punctuation overhead).

```typescript
function computeReduceWordCap(maxTokens: number | undefined): number {
  // 1.4× correction factor cho Vietnamese + JSON overhead
  return Math.max(100, Math.min(500, Math.floor((maxTokens ?? 2000) / 1.4)));
}
```

Kết quả:
| maxTokens | wordCap |
|-----------|---------|
| 500       | 357     |
| 1000      | 500 (clamped) |
| 2000+     | 500 (clamped) |
| undefined | 500 (clamped) |

### 3. `summaryChunks()` — fix 2 bugs

**Bug 1 (line 570):** hardcode `REDUCE_SUMMARY_PROMPT` thay vì biến `reducePrompt`:
```typescript
// Before:
const combinedTokens = estimateTokens(combinedText) + estimateTokens(REDUCE_SUMMARY_PROMPT) + 2000;
// After:
const combinedTokens = estimateTokens(combinedText) + estimateTokens(reducePrompt) + 2000;
```

**Bug 2:** Default param `reducePrompt: string = REDUCE_SUMMARY_PROMPT` → cần compute từ config. Vì default param không thể tham chiếu `config`, dùng pattern:

```typescript
async function summaryChunks(
  posts,
  config,
  onProgress?,
  suggestedChunks?,
  mapPrompt = CHUNK_SUMMARY_PROMPT,
  reducePrompt?: string,  // optional, computed from config if undefined
  signal?,
): Promise<string> {
  const wordCap = computeReduceWordCap(config.maxTokens);
  const resolvedReducePrompt = reducePrompt ?? buildReduceSummaryPrompt(wordCap);
  // ... dùng resolvedReducePrompt thay vì reducePrompt
```

> **Lưu ý:** Caller `summarizeWithMapReduce` truyền `finalPrompt` vào vị trí `reducePrompt`. Cần kiểm tra tất cả call sites của `summaryChunks`.

**Call sites của `summaryChunks`:**
- `summarizeWithMapReduce` (line 773): `summaryChunks(posts, config, ..., undefined, finalPrompt, signal)` — `finalPrompt` là custom prompt, giữ nguyên
- `analyzeOpinions` (line 220): `summaryChunks(posts, config, ..., OPINION_CHUNK_PROMPT, undefined, signal)` — `undefined` cho reduce sẽ được resolved từ config ✓
- `researchTopic` (line 261): `summaryChunks(posts, config, ..., CHUNK_SUMMARY_PROMPT, undefined, signal)` — tương tự ✓
- Recursive call trong `summaryChunks` (line 581): `summaryChunks(partials, config, ..., reducePrompt, reducePrompt, signal)` — truyền `resolvedReducePrompt` vào cả hai ✓

### 4. `reduceSegmentSummaries()` — thêm maxTokens param

```typescript
async function reduceSegmentSummaries(
  summaries: string[],
  provider,
  contextLimit: number,
  onProgress?,
  depth = 0,
  signal?,
  maxTokens?: number,  // NEW
): Promise<string> {
  const reduceSummaryPrompt = buildReduceSummaryPrompt(computeReduceWordCap(maxTokens));
  
  // Line 683: dùng reduceSummaryPrompt thay vì REDUCE_SUMMARY_PROMPT
  const promptOverhead = estimateTokens(reduceSummaryPrompt) + RESPONSE_BUFFER_TOKENS;
  
  // Line 712: base case call
  const response = await provider.summarize(post, reduceSummaryPrompt, signal);
  
  // Line 730: group call
  const response = await provider.summarize(groupPost, reduceSummaryPrompt, signal);
  
  // Recursive call (line 737): truyền maxTokens
  return reduceSegmentSummaries(intermediates, provider, contextLimit, onProgress, depth + 1, signal, maxTokens);
}
```

### 5. `summarizeSegments()` — truyền maxTokens

```typescript
// Before:
const resultText = await reduceSegmentSummaries(segmentSummaries, provider, contextLimit, onProgress, 0, signal);
// After:
const resultText = await reduceSegmentSummaries(segmentSummaries, provider, contextLimit, onProgress, 0, signal, config.maxTokens);
```

## Edge cases

- `maxTokens = undefined`: `computeReduceWordCap` default về 500 từ (behavior cũ, an toàn)
- `maxTokens = 0` hoặc âm: clamp về 100 từ (minimum viable output)
- Custom `reducePrompt` được truyền vào `summaryChunks`: giữ nguyên, không override bằng wordCap — chỉ apply cho default prompt path

## Test plan

1. Set `maxTokens=500` trong Settings → tóm tắt topic lớn (cần map-reduce) → verify JSON parse thành công
2. Set `maxTokens=1000` → verify tóm tắt không bị cắt
3. Set `maxTokens=undefined`/default → behavior như cũ (500 từ)
4. `summarizeSegments` với nhiều segments → verify word cap được áp dụng tại reduce step

## Rollback plan

Revert `lib/prompts.ts` và `lib/llm/summarizer.ts`. Không có schema/DB changes, không cần migration.

## Decision Log

### Quyết định 1: Giữ `REDUCE_SUMMARY_PROMPT` constant hay xóa

- **Đã chọn:** Giữ constant, đổi value thành `buildReduceSummaryPrompt(500)` (callable once at module level)
- **Lý do:** Tránh breaking change nếu có caller import trực tiếp; token estimation tĩnh vẫn có thể dùng
- **Đã cân nhắc nhưng loại:**
  - Xóa hoàn toàn — loại vì có thể break import ở nơi khác
- **Điều kiện thay đổi:** Nếu confirm không có caller nào import `REDUCE_SUMMARY_PROMPT` trực tiếp ngoài summarizer.ts → có thể xóa

### Quyết định 2: Truyền wordCap hay maxTokens xuống `reduceSegmentSummaries`

- **Đã chọn:** Truyền `maxTokens?: number`, tính `wordCap` bên trong hàm
- **Lý do:** Consistent với pattern — hàm tự biết cách compute, caller không cần lo
- **Đã cân nhắc nhưng loại:**
  - Truyền `wordCap` trực tiếp — loại vì caller phải tự tính, rải logic ra ngoài

### Quyết định 3: Hệ số chia tính wordCap (1.4)

- **Đã chọn:** `Math.floor(maxTokens / 1.4)`
- **Lý do:** Vietnamese text ≈ 1.3 tokens/word; JSON structure overhead ≈ 10% → 1.4× là conservative estimate. Thà output ngắn hơn còn hơn bị cắt
- **Đã cân nhắc nhưng loại:**
  - Hệ số 1.0 (1 token/word) — loại vì underestimate, vẫn có thể bị cắt
  - Hệ số 2.0 — loại vì quá conservative, output quá ngắn khi maxTokens nhỏ
- **Điều kiện thay đổi:** Nếu test cho thấy output vẫn bị cắt (tăng lên 1.5×) hoặc quá ngắn (giảm xuống 1.3×)
