# Bug Fix — Tree-reduce minor issues (re-review follow-ups)

## Overview
Fix 4 minor issues được tìm ra trong re-review `review/20260410_2030_tier3_summarize-tree-reduce-review-fixes.md`.

**Files thay đổi:**
- `lib/llm/summarizer.ts`
- `docs/architecture/summarization.md`

---

## Changes

### lib/llm/summarizer.ts

**Fix Issue #2 — Guard `usablePerGroup < 1000`**
- Thêm check ngay sau khi tính `usablePerGroup`:
  ```typescript
  if (usablePerGroup < 1000) {
    throw new LLMError(BAD_REQUEST, 'Context window quá nhỏ để gộp tóm tắt. Cần ít nhất ~4000 tokens context window.');
  }
  ```
- Đảm bảo throw message đúng nguyên nhân khi user set contextWindow quá nhỏ (cũ sẽ throw nhầm "summary quá lớn")

**Fix Issue #3 — Remove `|| summaries.length <= 2` bypass**
- Cũ: `if (contentTokenSum <= usablePerGroup || summaries.length <= 2)` — nhánh `<= 2` bypass size check, có thể gửi 2 × 9.5K = 19K content vào 16K raw context
- Mới: `if (contentTokenSum <= usablePerGroup)` — split vẫn diễn ra khi 2 summaries lớn; recursion terminate đúng vì mỗi group 1 summary → early return `length === 1`

**Fix Issue #4 — Document cross-ref overhead slack**
- Thêm comment giải thích: "cross-reference header adds ~100-300 tokens per call but is covered by the 25% safety margin"

### docs/architecture/summarization.md

**Fix Issue #1 — Tính lại bảng ví dụ**
- Mở rộng bảng từ 3 columns → 5 columns (Level 1–5) để phản ánh đúng số levels thực tế:
  - 1000 segments → 4 levels (cũ viết "direct" ở Level 3, thực tế Level 3 vẫn split → direct ở Level 4)
  - 10000 segments → 5 levels (cũ viết "direct" ở Level 3, thực tế Level 5)
- Cập nhật disclaimer: bỏ "minh hoạ" vague → ghi rõ "con số dùng giá trị ước tính ~1500 tokens/intermediate"

---

## Self-review Results

- Issues found: 0
- Issues fixed: 4 (từ re-review)
- Remaining: none
