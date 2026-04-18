# Bug Fix: Summarize Token Overflow When maxTokens > RESPONSE_BUFFER_TOKENS

## Summary
`willExceedContext` và `chunkPosts` dùng buffer cố định `2000` tokens để tính kích thước chunk, nhưng không tính đến `config.maxTokens`. Khi user set `maxTokens = 8192` với `contextWindow = 24567`, chunk được size để fit `24567 - 2000 = 22567` tokens → prompt thực tế 23144 tokens, LLM chỉ còn 1423 tokens cho output thay vì 8192.

## Root Cause

`lib/llm/summarizer.ts` — 4 hàm (`summarizeTopic`, `updateSummary`, `analyzeOpinions`, `researchTopic`) gọi `willExceedContext(..., 2000, ...)` với hardcoded `2000`. `chunkPosts` cũng dùng `RESPONSE_BUFFER_TOKENS = 2000` khi tính `bufferTokens`.

Khi `maxTokens > 2000`, model thực tế cần nhiều output space hơn, dẫn đến context overflow.

## Fix

**`lib/llm/summarizer.ts`:**
- 4 call sites `willExceedContext`: thay `2000` → `Math.max(2000, config.maxTokens ?? 0)`
- `chunkPosts`: thêm param `maxTokensReserve?: number`, dùng `Math.max(RESPONSE_BUFFER_TOKENS, maxTokensReserve ?? 0)` trong `bufferTokens`
- Call site `chunkPosts(...)` trong `summarizeWithMapReduce`: truyền thêm `config.maxTokens`

## Self-review Results
- Issues found: 0
- Issues fixed: 0
- Remaining: none

## Test Case
- model: qwen3.5-4b, maxTokens: 8192, contextWindow: 24567
- Trước: prompt_tokens 23144 → completion chỉ 1432 (bị chặn bởi context limit)
- Sau: chunk được size nhỏ hơn, đảm bảo `prompt_tokens + 8192 ≤ 24567`
