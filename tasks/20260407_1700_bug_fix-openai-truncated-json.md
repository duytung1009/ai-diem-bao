# Bug Fix: OpenAI Local LLM Truncated JSON Detection

## Root Cause

Local LLM (qwen3.5-4b qua LM Studio) có context window 16384 tokens. Khi prompt chiếm 15950 tokens, chỉ còn 434 tokens cho output — JSON bị cắt ngắn giữa chừng.

**Dấu hiệu trong API response:**
```
prompt_tokens:    15950
completion_tokens:  434
total_tokens:     16384  ← = context window của model
finish_reason:   "stop"  ← SAI — nên là "length" nhưng LM Studio/llama.cpp báo sai
```

`finish_reason: "stop"` không đáng tin từ local LLM → `parseSummaryJSON` nhận text truncated → parse fail → summary hiển thị dưới dạng raw text bị cắt.

## Fix

**File:** `lib/llm/openai-adapter.ts`

Thêm helper `looksLikeTruncatedJson(text)`:
- Strip leading backticks/whitespace
- Nếu text bắt đầu bằng `{` nhưng không kết thúc bằng `}` → truncated JSON

Thêm 2 checks sau khi parse response:
1. `finish_reason === 'length'` (chuẩn OpenAI) → throw `INCOMPLETE_RESPONSE` với gợi ý tăng Max tokens
2. `finish_reason === 'stop'` + `looksLikeTruncatedJson(content)` (heuristic cho local LLM) → throw `INCOMPLETE_RESPONSE` với gợi ý giảm Segment size

Error propagate lên `handleSummarizeSegment` catch block → `error.value` set → user thấy thông báo rõ ràng. Posts đã được early-save (F16) nên retry không cần re-scrape.

## Commit

`b34cb2e`

## Self-review Results

- Issues found: 0
- Issues fixed: 0
- Build: ✅ pass
- Heuristic edge cases:
  - Text bắt đầu `{` nhưng là prose → false positive không thể xảy ra vì LLM được yêu cầu trả JSON
  - Valid JSON kết thúc `}` → không trigger
  - Backtick-wrapped JSON `` `{...}` `` → strip trailing backtick trước khi check endsWith `}` → không false positive (commit `894df83`)
