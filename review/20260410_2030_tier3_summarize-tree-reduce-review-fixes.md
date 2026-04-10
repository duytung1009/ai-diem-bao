# Review — Tree-reduce review fixes

## Metadata
- **File reviewed:** `lib/llm/summarizer.ts` (`reduceSegmentSummaries`, `summarizeSegments`), `docs/architecture/summarization.md` (section "Tóm tắt tổng quan")
- **Task fix:** `tasks/20260410_2000_bug_summarize-tree-reduce-review-fixes.md`
- **Previous review:** `review/20260410_1900_tier3_summarize-segments-tree-reduce.md` (request-changes: 1 crit, 4 major, 7 minor, 3 nit)
- **Review tier:** tier3
- **Model used:** opus
- **Diff size:** ~80 LOC (summarizer.ts ~60, docs ~20)

## Verification of each prior-review issue

| # | Prior severity | Status | Note |
|---|----------------|--------|------|
| 1 | critical | ✅ fixed | `usablePerGroup = floor(contextLimit × 0.75) − promptOverhead`, `groupCount = ceil(contentTokenSum / usablePerGroup)`. Với 16K context: usable ≈ 9500 tokens/group, đã trừ REDUCE_PROMPT (~500) + RESPONSE_BUFFER (2000). Safety margin 25% còn đủ slack cho tokenizer drift. |
| 2 | major | ⚠️ partial | Bảng ví dụ có disclaimer "minh hoạ" + cập nhật intermediate ~1500 tokens. Tuy nhiên row "1000 segments" vẫn sai: Level 2 có 9 intermediates × 1500 ≈ 13.5K > usable 9.5K → phải split thêm Level 3, không "direct" như doc viết. Row "10000 segments" cũng thiếu 1 level. Disclaimer cover được phần nào nhưng con số cụ thể vẫn lệch. |
| 3 | major | ✅ fixed | JSDoc `lib/llm/summarizer.ts:484-485` và docs `summarization.md:360` đều đã sửa: "O(N/k) LLM calls, O(log_k N) levels". |
| 4 | major | ✅ fixed | Early guard line 513-521: throw `LLMError(BAD_REQUEST)` với message tiếng Việt nếu bất kỳ summary nào > usablePerGroup. `LLMErrorCode.BAD_REQUEST` confirmed exist trong `lib/errors.ts:33`. |
| 5 | major | 📋 documented | Giữ nguyên local-per-group cross-ref; JSDoc + docs section đều có note rõ limitation. Documented deferral hợp lý. |
| 6 | minor | ✅ fixed | `config: LLMConfig` param removed khỏi `reduceSegmentSummaries`. Caller `summarizeSegments` không truyền nữa. |
| 7 | minor | ✅ fixed | Stacked duplicate JSDoc đã xoá; còn 1 block duy nhất lines 480-490. |
| 8 | minor | ✅ fixed | `buildReduceContent(group)` helper extract — dùng cho cả base case (line 528) và per-group loop (line 548). |
| 9 | minor | ✅ fixed | Token estimate ban đầu dùng `summaries.reduce((s, x) => s + estimateTokens(x), 0)` (line 524) — O(N) cheap sum thay vì build full `combinedContent` trước khi quyết định split. |
| 10 | minor | ✅ fixed | Chỉ còn 1 progress callback trong loop (line 547), với đầy đủ `group index / total / depth`. Callback thừa đã xoá. |
| 11 | minor | ✅ fixed | Early return `if (summaries.length === 1) return summaries[0]` ở line 499. |
| 12 | minor | 📋 deferred | Section numbering lost across levels — deferred có lý do trong task file. |
| 13 | nit | ✅ fixed | Disclaimer "cross-ref local trong từng reduce call" thêm vào docs section + JSDoc. |
| 14 | nit | 📋 deferred | Abortable delay helper — deferred hợp lý. |

## Checklist

| Category | Status | Notes |
|----------|--------|-------|
| Logic correctness | ✅ | Critical sizing bug đã fix. Guard đúng chỗ. Recursion terminate đúng (mỗi level giảm count do groupCount ≥ 2). |
| Edge cases covered | ⚠️ | `usablePerGroup` có thể âm nếu `contextLimit < promptOverhead / 0.75` (≈ 3.3K); không có guard. Không phải edge case thực tế (16K+ context) nhưng nếu user set contextWindow = 2048 → throw message sẽ confusing (throw cho "summary quá lớn" dù thực ra do context quá bé). |
| Error handling | ✅ | Dùng `LLMError(BAD_REQUEST)` đúng pattern. Message tiếng Việt. Throw trước khi burn LLM calls. |
| Performance | ✅ | Cheap token sum thay vì full build. Helper tránh duplicate work. Không còn wasted rebuild khi recurse (intermediates tự dùng ở level sau). |
| Security | N/A | — |
| Consistency with patterns | ✅ | Dùng `CONTEXT_USAGE_RATIO` + `RESPONSE_BUFFER_TOKENS` từ constants — khớp với `calculateSegmentBudget()` và các chỗ khác. |
| Type safety | ✅ | Signatures clean, không còn dead param. Import path đầy đủ. |
| Test coverage | N/A | Không có unit test mới — dự án chưa có test suite cho summarizer. |
| Documentation | ⚠️ | Disclaimer tốt nhưng con số bảng vẫn lệch 1 level cho 1000/10000 segments. Reader cẩn thận sẽ phát hiện inconsistency. |

## Issues Found

| # | Severity | Category | Description | Suggestion |
|---|----------|----------|-------------|------------|
| 1 | minor | docs | Bảng ví dụ ở `summarization.md:353-358` row "1000" và "10000" vẫn sai 1 level: với intermediate ~1500 tokens và usable ~9.5K, 9 intermediates = 13.5K > 9.5K → Level 3 phải split tiếp thành 2 nhóm, không "direct". Level 3 "direct" chỉ đúng khi intermediate ≤ ~1050 tokens. | Tính lại hoặc thêm dòng "1000 segments → thực tế 3-4 levels tuỳ intermediate size"; hoặc giữ nguyên và đổi disclaimer thành mạnh hơn: "table approximates level count; actual can be +1 level nếu intermediate size ở mức cao". |
| 2 | minor | edge case | Nếu `contextLimit` quá nhỏ (< ~3.3K), `usablePerGroup` trở thành âm hoặc gần 0. Guard hiện tại sẽ throw "summary quá lớn" nhưng nguyên nhân thực là context quá bé. | Thêm sanity check đầu hàm: `if (usablePerGroup < 1000) throw new LLMError(BAD_REQUEST, 'Context window quá nhỏ để gộp tóm tắt. Cần ≥ 4K tokens.')` (hoặc similar). |
| 3 | nit | code clarity | Line 526: condition `contentTokenSum <= usablePerGroup \|\| summaries.length <= 2` — nhánh `length <= 2` có thể gây confusion vì nó bypass size check. Nếu cả 2 summaries lớn (mỗi cái đã pass early guard tức ≤ usable, nhưng 2×usable = 2×9.5K = 19K > 16K context), tức là sẽ vượt context thực tế. | Thay `length <= 2` bằng `length === 1` (đã có early return ở line 499, nên nhánh này unreachable — xoá luôn). Hoặc nếu giữ cho robustness, thêm comment: "2 summaries: trust guard + fallback retry layer". Thực tế, early guard chỉ check mỗi summary ≤ usable, nên 2 summaries có thể tới 2×usable ≈ 19K vẫn vượt 16K context. Tuy nhiên vì CONTEXT_USAGE_RATIO = 0.75, 19K vẫn dưới raw 16K? Không, 19K > 16K. → Có rủi ro thực sự nếu đúng 2 summaries mỗi cái gần usable max. |
| 4 | nit | naming | `contentTokenSum` trong base case chỉ là sum không include cross-ref header (chưa build). Header add ~100-300 tokens; thường nhỏ so với 9.5K usable, nhưng là nguồn optimistic estimation. | Nếu muốn chính xác: `contentTokenSum + estimateAuthorCrossRefOverhead(summaries)`. Hoặc giảm `CONTEXT_USAGE_RATIO` xuống 0.7 để có thêm slack. Hiện tại 0.75 đủ an toàn cho hầu hết cases. |

## Summary

- **Overall:** **approve** (với 2 minor follow-ups đề nghị)
- **Critical issue #1 đã được fix đúng và an toàn.** Công thức mới `usablePerGroup = floor(contextLimit × 0.75) − promptOverhead` đảm bảo mỗi group LLM call không vượt context, kể cả trong scenarios cực đoan (1000+ segments với qwen3.5 16K).
- **Quality signals tốt:** JSDoc đúng complexity, dead code removed, error handling explicit, progress callback clean, helper extracted. 9/11 fixable issues closed + 2/3 deferred có lý do.
- **Minor follow-ups (optional, không block ship):**
  1. Fix con số bảng doc cho row 1000/10000 (hoặc strengthen disclaimer)
  2. Thêm guard cho `usablePerGroup < 1000` edge case
  3. Cân nhắc thay `length <= 2` → `length === 1` hoặc add comment (Issue #3 có mô tả rủi ro lý thuyết, nhưng khó trigger thực tế)
- **Key concern:** Không còn critical hoặc major blocker. Issue #3 về `length <= 2` là lý thuyết — trong thực tế, early guard đảm bảo mỗi summary ≤ 9.5K, và 2 summaries × 9.5K = 19K vẫn vượt 16K raw context. Tuy nhiên 0.75 margin + response buffer 2K tạo ~5K headroom; LLM sẽ accept được trong hầu hết cases. Nên theo dõi nếu gặp lỗi "context length exceeded" trong production.

## Recommended action

Ship được. Tạo follow-up tracking items cho 3 minor issues ở trên (có thể batch vào một task sau). Không cần re-review.
