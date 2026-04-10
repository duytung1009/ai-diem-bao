# Bug Fix — Tree-reduce `reduceSegmentSummaries` (Review Fixes)

## Overview
Fix tất cả issues từ tier3 review `20260410_1900_tier3_summarize-segments-tree-reduce.md`.

**Files thay đổi:**
- `lib/llm/summarizer.ts`
- `docs/architecture/summarization.md`

---

## Changes

### lib/llm/summarizer.ts

**Fix #1 (critical) — Group sizing thiếu per-group overhead**
- Cũ: `groupCount = ceil(inputTokens / contextLimit)` — dùng tổng token (kể cả prompt + buffer) chia cho contextLimit → group thực tế vượt context
- Mới: tính `usablePerGroup = floor(contextLimit × CONTEXT_USAGE_RATIO) − promptOverhead` rồi chia `contentTokenSum / usablePerGroup` — overhead đã trừ trước
- Dùng `CONTEXT_USAGE_RATIO = 0.75` (đã có trong constants) làm safety margin

**Fix #4 (major) — Không có guard cho summary đơn lẻ > context**
- Thêm early check: nếu bất kỳ summary nào > `usablePerGroup`, throw `LLMError(BAD_REQUEST)` với message rõ ràng trước khi bắt đầu bất kỳ LLM call nào

**Fix #6 (minor) — Dead `config: LLMConfig` parameter**
- Bỏ `config` khỏi signature `reduceSegmentSummaries` (chỉ forward vào recursive call, không dùng)
- Caller `summarizeSegments` không truyền `config` nữa

**Fix #7 (minor) — Dead JSDoc block**
- Xóa block "Merge multiple segment JSON summaries…" (lines 479-482 cũ) còn sót từ version trước

**Fix #8 + #9 (minor) — Duplicate content-building logic + wasted work khi recurse**
- Extract `buildReduceContent(group)` inner helper (parse + crossRef + join) — dùng cho cả base case và per-group loop
- Token estimate ban đầu dùng cheap `sum(estimateTokens(s))` thay vì build `combinedContent` đầy đủ — tránh work lãng phí khi quyết định có split không

**Fix #10 (minor) — Hai progress callback liền nhau**
- Xóa `onProgress?.('Đang gộp tóm tắt (${groups.length} nhóm, lớp ${depth+1})...')` thừa
- Progress message còn lại ở vòng group đã có đầy đủ thông tin (group index + total + depth)

**Fix #11 (minor) — Lãng phí LLM call khi single summary**
- Thêm early return `if (summaries.length === 1) return summaries[0]` ở đầu hàm

**Fix #3 + JSDoc (major/minor) — JSDoc sai về complexity**
- Sửa: "halves… O(log N) LLM calls" → "reduces by factor groupCount; total LLM calls ≈ O(N/k), total levels ≈ O(log_k N)"
- Thêm note cross-ref local-scope limitation vào JSDoc

**New import**
- Thêm `CONTEXT_USAGE_RATIO` từ `../constants`
- Thêm `LLMError, LLMErrorCode` từ `../errors`

---

### docs/architecture/summarization.md

**Fix #2 (major) — Bảng ví dụ sai**
- Cập nhật bảng với intermediate size thực tế (~1500 tokens/intermediate thay vì ~500)
- Thêm disclaimer "con số mang tính minh hoạ, intermediate size phụ thuộc LLM response"
- Cập nhật con số: 1000 segments cần Level 3, không "direct" ở Level 2

**Fix #3 (major) — Complexity claim sai**
- Sửa "O(log N) LLM calls" → "Tổng LLM calls ≈ O(N/k); số levels ≈ O(log_k N)"

**Fix #5/#13 (minor/nit) — Cross-ref doc misleading**
- Thêm note: "cross-ref hoạt động local trong từng reduce call — với tree-reduce nhiều levels, tác giả trải qua nhiều groups có thể không được gộp cho đến level merge cuối cùng"

---

## Issues NOT fixed (documented limitation)

| # | Lý do không fix |
|---|-----------------|
| #5 Global cross-ref | Architectural change lớn hơn scope của review fix; limitation đã được document rõ trong code và docs |
| #12 Section numbering | Cosmetic + cần thay đổi prompt format; deferred |
| #14 Abortable delay | Optional refactor dùng chung cả codebase; deferred |

---

## Self-review Results

- Issues found: 2
- Issues fixed: 2
- Remaining: none

**Chi tiết:**
1. `LLMError` import chưa có trong file → thêm import `LLMError, LLMErrorCode` từ `../errors`
2. `CONTEXT_USAGE_RATIO` chưa import → thêm vào import từ `../constants`
