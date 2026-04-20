# Bug Fix: parseSummaryJSON không parse được output single-backtick của local LLM

**Ngày:** 2026-03-30
**Severity:** major
**Commit:** `764b3e8`

---

### BUG-20260330-01: parseSummaryJSON fallback sang Markdown khi LLM wrap JSON trong single-backtick

- **Severity:** major
- **Affected module:** `lib/llm/summarizer.ts` → `parseSummaryJSON()`
- **Steps to reproduce:**
  1. Dùng local LLM (LM Studio / Qwen3.5 9B)
  2. Tóm tắt bất kỳ topic
  3. LLM trả về output dạng `` `{...json...}` `` (JSON được bọc trong single backtick)
  4. `parseSummaryJSON` không strip được wrapper → `JSON.parse` fail
  5. `SummaryContent` render toàn bộ raw string dưới dạng Markdown (fallback mode)
- **Expected:** JSON được parse thành `SummaryJSON`, render đúng với sections Tóm tắt / Quan điểm nổi bật / Kết luận + blockquotes
- **Actual:** Toàn bộ raw string (bao gồm JSON syntax) hiển thị dưới dạng Markdown thô, không có cấu trúc

---

## Root Cause

`parseSummaryJSON` chỉ handle 2 format:
1. Plain JSON: `{...}`
2. Triple-backtick fence: ` ```json\n{...}\n``` `

Local LLM (Qwen3.5 9B) đôi khi output format thứ 3 — single-backtick wrapping: `` `{...}` ``

`JSON.parse` fail trên input `` `{...}` `` → hàm return `null` → `SummaryView` giữ raw string → `SummaryContent` dùng Markdown fallback.

---

## Fix

**File:** `lib/llm/summarizer.ts` — `parseSummaryJSON()`

Thêm `else` branch strip single-backtick sau khi check triple-fence:

```typescript
const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/s);
if (fenceMatch) {
  text = fenceMatch[1].trim();
} else {
  // Strip single-backtick wrapping: `{...}`
  const singleBacktickMatch = text.match(/^`([\s\S]*?)`$/s);
  if (singleBacktickMatch) text = singleBacktickMatch[1].trim();
}
```

Dùng `else` (không `else if` riêng) để tránh double-strip khi output có cả hai loại wrapper.

---

## Self-review Results

- Issues found: 0
- Issues fixed: 0
- Remaining: none

Type check: `npx vue-tsc --noEmit` → **PASS** ✅
