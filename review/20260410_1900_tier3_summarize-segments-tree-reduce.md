# Review — Tree-reduce `summarizeSegments` / `reduceSegmentSummaries`

## Metadata
- **File reviewed:**
  - `lib/llm/summarizer.ts` (hàm `reduceSegmentSummaries` + `summarizeSegments` refactor)
  - `docs/architecture/summarization.md` (section "Tóm tắt tổng quan")
- **Review tier:** tier3
- **Model used:** opus
- **Diff size:** ~90 LOC code + ~45 LOC docs (net, tính cả replacement của `summarizeSegments` cũ)
- **Scope:** refactor 2-level reduce cứng → tree-reduce đệ quy; không đụng caller hoặc các LLM task khác

## Checklist

| Category | Status | Notes |
|----------|--------|-------|
| Logic correctness | ⚠️ | Base-case và termination đúng, nhưng **group sizing bỏ qua per-group overhead** (prompt + buffer + crossRef) → group có thể tràn context ở boundary |
| Edge cases covered | ⚠️ | Single summary, empty array, summary đơn lẻ > context đều không có guard |
| Error handling | ⚠️ | Không có try/catch quanh LLM calls (nhất quán với pipeline hiện tại), nhưng không có defensive check cho trường hợp LLM trả rỗng/invalid trong `intermediates.push` |
| Performance concerns | ⚠️ | `combinedContent` + `crossRef` xây ở top mỗi lần đệ quy rồi **vứt đi** khi recurse. Cộng thêm re-parse summaries lần 2 ở vòng group |
| Security implications | ✅ | Không có |
| Consistency with patterns | ✅ | Theo đúng map-reduce pattern của `summaryChunks`, cùng `MAP_REDUCE_CHUNK_DELAY_MS`, cùng progress callback style |
| Type safety | ⚠️ | `provider: ReturnType<typeof createProvider>` fragile; `config: LLMConfig` parameter **dead** (chỉ forward vào đệ quy, không dùng) |
| Test coverage | N/A | Repo không có unit tests cho LLM layer; smoke test qua build |
| Docs correctness | ❌ | **Bảng ví dụ trong doc sai** (optimistic about intermediate size); complexity claim "O(log N) LLM calls" sai |

## Issues Found

| # | Severity | Category | Description | Suggestion |
|---|----------|----------|-------------|------------|
| 1 | **critical** | Logic | `groupCount = ceil(inputTokens / contextLimit)` **không trừ per-group overhead**. Với 1000 summaries × 500 tokens, contextLimit 16K: groupCount=32, groupSize=32, per-group content ≈ 16K + REDUCE_PROMPT (~500) + RESPONSE_BUFFER (2K) = **18.5K → vượt 16K context**. Mỗi group sẽ fail/truncate ở LLM call. Bug chỉ không lộ ở test nhỏ vì overhead nhỏ so với contextLimit; ở high-segment-count (exactly the case motivating this fix) thì trigger. | Trừ overhead trước khi chia: <br>`usable = contextLimit - estimateTokens(REDUCE_PROMPT) - RESPONSE_BUFFER_TOKENS`<br>`groupCount = ceil(contentOnlyTokens / usable)`<br>Nên dùng thêm safety margin (e.g. `* CONTEXT_USAGE_RATIO = 0.75`) để phòng cross-ref header |
| 2 | major | Docs | Bảng `Segments / Level 1 / Level 2 / Level 3` **giả định intermediate = 500 tokens** (bằng input). Thực tế REDUCE của 32 summaries ≈ 16K input → output thường 1000-2000 tokens. Với 1000 segments, Level 1 output 32 intermediates × 1500 ≈ 48K → **phải có Level 3**, không "direct" như doc nói. 10000 segments case còn sai nhiều hơn. | Sửa bảng với giả định intermediate ≈ 1.5K tokens, hoặc thêm disclaimer "con số minh hoạ, thực tế intermediate size phụ thuộc LLM response length" |
| 3 | major | Docs/Comment | JSDoc của `reduceSegmentSummaries` ghi "**halves** the number of summaries ... thousands of segments in **O(log N) LLM calls**". Cả hai sai: (a) không halve — giảm theo branching factor k = groupCount >> 2; (b) tổng số LLM calls ≈ O(N/(k−1)) ≈ **O(N/k)** (geometric series), không phải O(log N). Chỉ **số levels** là O(log_k N). Với 1000 segments, k=32 → ~34 calls, không phải log₂(1000)≈10. | Sửa JSDoc: "Each recursion level reduces the number of summaries by factor `groupCount`; total LLM calls ≈ `O(N/k)`, total levels ≈ `O(log_k N)`." |
| 4 | major | Logic | **Không có guard cho summary đơn lẻ > context.** Nếu 1 segment summary riêng nó đã vượt contextLimit, `groupSize` sẽ = 1, per group = 1 summary vẫn > context → recurse với 1 element → `summaries.length <= 2` trigger base case → LLM call với content quá lớn → fail hoặc truncate. Không có early error với message rõ ràng. | Thêm check sớm: nếu có summary nào > usableContext, throw `LLMError` với message "Segment summary quá lớn, cần giảm chi tiết" hoặc fallback bằng cách tạo cheaper sub-summary trước |
| 5 | major | Logic (pre-existing, amplified) | Cross-reference authors **local-per-group** ở level 1: tác giả xuất hiện ở segment #3 và #35 (khác group) sẽ không được phát hiện. Level 2 chạy trên intermediates đã mất hoàn toàn thông tin này. Bug có từ code cũ nhưng **tree-reduce làm trầm trọng hơn** vì số groups nhiều hơn và thêm nhiều levels. Doc không warn user. | Option 1: build cross-reference **global** một lần ở `summarizeSegments`, prepend vào mọi group call. Option 2: track supporter dedup at the model level với explicit mapping. Option 3: tối thiểu: ghi chú giới hạn này trong doc |
| 6 | minor | Code | `config: LLMConfig` parameter trong `reduceSegmentSummaries` **không dùng** (chỉ forward vào recursive call). `provider` và `contextLimit` đã đủ. | Drop `config` parameter hoặc drop `provider`+`contextLimit` và gọi `createProvider(config)`/`getContextLimit(...)` bên trong |
| 7 | minor | Code | Hai JSDoc block chồng nhau (line 479-482 block cũ "Merge multiple segment JSON summaries" + line 483-490 block mới). Block cũ là dead comment. | Xóa block cũ (lines 479-482) |
| 8 | minor | Code | **Duplicate content-building logic**: `parse + crossRef + combinedText + combinedContent` được build ở top (lines 500-503) và lặp lại y hệt trong vòng group (lines 529-532). | Extract helper `buildReduceContent(summaries: string[]): { content: string; tokens: number }` dùng cho cả base case và per-group |
| 9 | minor | Code | **Wasted work khi recurse**: lines 500-503 build `combinedContent` + `crossRef` cho TOÀN BỘ summaries, compute `inputTokens`, rồi nếu recurse thì **vứt hết** và rebuild per-group. Với 10000 summaries, đây là work đáng kể. | Compute `inputTokens` bằng cheap sum (e.g. cache token count per summary) trước khi quyết định base case; chỉ build `combinedContent` đầy đủ khi chắc chắn dùng |
| 10 | minor | UX | 2 progress callback liền nhau, cái sau ghi đè cái đầu: <br>`onProgress?.('Đang gộp tóm tắt (${groups.length} nhóm, lớp ${depth+1})...')` rồi ngay sau là `onProgress?.('Đang gộp nhóm ${g+1}/${groups.length}...', ...)`. Line đầu không bao giờ nhìn thấy. | Xóa line đầu hoặc delay line thứ hai; tốt hơn: dùng một message duy nhất có đầy đủ thông tin |
| 11 | minor | Logic | Khi `summaries.length === 1`, hàm vẫn wrap vào `PARTIAL_SUMMARIES` và gọi LLM với `REDUCE_SUMMARY_PROMPT` — lãng phí 1 LLM call để "reduce" 1 thứ. | Early return: `if (summaries.length === 1) return summaries[0];` (với caveat là không qua dedup, nhưng caller có safety net `deduplicateSupporters`) |
| 12 | minor | Semantics | `--- Phần ${i+1} ---` numbering **restart ở mỗi recursion level**. Level 2 có "Phần 1" referring to intermediate từ group 1, nhưng LLM không biết intermediate 1 gộp từ segments 1-32 gốc. Supporter attribution "Phần 2" ở level 2 không đối chiếu được với UI segment index. | Truyền mapping (ranges gốc) qua recursion, hoặc ghi chú trong prompt metadata |
| 13 | nit | Docs | Section "Cross-reference authors" trong doc mô tả feature như là cross-all-segments nhưng thực tế chỉ local-per-group. Đọc doc dễ hiểu lầm là feature work end-to-end. | Thêm 1 câu disclaimer: "**Lưu ý:** cross-ref hoạt động local trong 1 reduce call — với tree-reduce nhiều levels, tác giả trải qua nhiều groups có thể không được gộp hoàn toàn" |
| 14 | nit | Code | `await new Promise(r => setTimeout(r, MAP_REDUCE_CHUNK_DELAY_MS))` — naked setTimeout không abortable. Nhất quán với codebase hiện tại nên chấp nhận được. | (optional) Refactor toàn bộ delay thành helper `delay(ms, abortSignal?)` dùng chung |

## Summary

- **Overall:** request-changes
- **Key concern:** **Issue #1 (critical)** — group sizing thiếu per-group overhead gây tràn context đúng ở kịch bản mà refactor này sinh ra để giải quyết. Cần fix trước khi ship. Issues #2, #3 là doc sai, cần sửa cùng lúc để tài liệu không lừa dev sau. Issues #4, #5 là limitations cần được hoặc fix hoặc document rõ ràng.

### Priority để fix
1. **Fix ngay (blocker):** #1
2. **Sửa doc/comment cùng commit:** #2, #3
3. **Nên fix sớm:** #4 (guard), #7 (dead JSDoc), #11 (single-summary fast path)
4. **Nice to have:** #5 (cross-ref global), #6, #8, #9, #10
5. **Tuỳ chọn:** #12, #13, #14

### Điểm tích cực
- Ý tưởng tree-reduce đúng hướng, giải quyết được limitation 2-level cứng của code cũ
- Termination guarantee `summaries.length <= 2` đơn giản và đủ an toàn cho infinite recursion
- Progress callback có `depth` context, dễ debug
- Refactor giữ nguyên interface của `summarizeSegments` — caller không phải đổi gì
- Post-processing `deduplicateSupporters` vẫn giữ nguyên làm safety net
