# Bug Fix: REDUCE_SUMMARY_PROMPT word cap động theo maxTokens

## Summary

`REDUCE_SUMMARY_PROMPT` hardcode "dưới 500 từ". Khi `config.maxTokens` nhỏ (500–1000), LLM bị cắt output trước khi hoàn thành JSON → `parseSummaryJSON` trả `null` → mất kết quả reduce.

## Changes

### `lib/prompts.ts`
- Thêm `buildReduceSummaryPrompt(wordCap: number): string` — template y hệt `REDUCE_SUMMARY_PROMPT` nhưng `wordCap` là parameter
- Đổi `REDUCE_SUMMARY_PROMPT = buildReduceSummaryPrompt(500)` — giữ backward compat cho import, default 500 từ

### `lib/llm/summarizer.ts`
- Thêm `computeReduceWordCap(maxTokens?)`: `clamp(100, 500, floor(maxTokens / 1.4))` — 1.4× factor cho Vietnamese + JSON overhead
- `summaryChunks`: đổi `reducePrompt` param từ `string = REDUCE_SUMMARY_PROMPT` → `string | undefined`; resolve `resolvedReducePrompt = reducePrompt ?? buildReduceSummaryPrompt(computeReduceWordCap(config.maxTokens))`
- `summaryChunks` line 570 (bug fix): dùng `resolvedReducePrompt` thay vì hardcode `REDUCE_SUMMARY_PROMPT` khi estimate context cho recursive reduce
- `reduceSegmentSummaries`: thêm `maxTokens?: number` param; tính `reduceSummaryPrompt` từ builder tại đầu hàm; dùng tại cả 3 call sites (estimate overhead, base case, group calls); truyền `maxTokens` vào recursive call
- `summarizeSegments`: truyền `config.maxTokens` xuống `reduceSegmentSummaries`
- Xóa import `REDUCE_SUMMARY_PROMPT` (không còn dùng trong summarizer)

## Self-review Results

- Issues found: 1 (unused import `REDUCE_SUMMARY_PROMPT` sau khi refactor — đã fix)
- Issues fixed: 1
- Remaining: none

## Test checklist

- [ ] `maxTokens=500` + topic lớn (map-reduce) → JSON parse thành công, không bị cắt
- [ ] `maxTokens=1000` → tóm tắt hoàn chỉnh
- [ ] `maxTokens=undefined` → behavior như cũ (500 từ)
- [ ] `summarizeSegments` nhiều segments → word cap áp dụng tại reduce step
