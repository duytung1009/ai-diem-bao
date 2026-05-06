# Task ID: 128

**Title:** Bug fix: handleAutoSummarizeAll thêm option "Regenerate all"

**Status:** pending

**Dependencies:** None

**Priority:** medium

**Description:** Thêm tham số forceRegenerate vào handleAutoSummarizeAll để user có thể chọn scrape và summarize lại toàn bộ từ đầu thay vì resume từ kết quả cũ. Cập nhật UI confirm dialog trong SummaryView.vue để có 2 lựa chọn: "Tiếp tục từ nơi đã dừng" (mặc định) và "Tóm tắt lại từ đầu".

**Details:**

**Vấn đề:** Hiện tại khi user bấm "Tóm tắt toàn bộ" lần 2 trên cùng topic, code sẽ resume từ các segment đã summarize trước đó (qua computeResumeState) thay vì scrape và summarize lại từ đầu. User không có cách nào để regenerate toàn bộ.

**Giải pháp:**

1. **File: entrypoints/sidepanel/composables/useSummarize.ts** (line 954: handleAutoSummarizeAll)
   - Sửa signature: `async function handleAutoSummarizeAll(forceRegenerate: boolean = false)`
   - Khi forceRegenerate === true:
     - Luôn clear `dynamicSegmentBoundaries.value = []` và `segmentSummaries.value = []`
     - Bỏ qua `computeResumeState()`, gọi `autoSummarizeDynamic` với `resume = undefined`
   - Khi forceRegenerate === false (mặc định): giữ nguyên logic resume hiện tại
   - Áp dụng tương tự cho fixed mode (non-dynamic): nếu forceRegenerate thì clear segmentSummaries trước khi loop

2. **File: entrypoints/sidepanel/views/SummaryView.vue** (line ~393: confirm dialog)
   - Tìm confirm dialog hiện tại cho auto-summarize (confirmingAutoSummarize)
   - Thêm 2 lựa chọn trong dialog:
     a. "Tiếp tục từ nơi đã dừng" (resume, forceRegenerate=false) — mặc định
     b. "Tóm tắt lại từ đầu" (forceRegenerate=true)
   - Hoặc thêm checkbox toggle trong confirm dialog
   - Update @confirm handler để truyền tham số phù hợp vào handleAutoSummarizeAll

**Lưu ý:**
- Không thay đổi behavior mặc định (resume vẫn là default)
- Giữ nguyên stale guard pattern (activeSummarizeId)
- Tuân thủ STYLE_GUIDE.md cho UI (CSS variables, btn classes, rounded-lg)
- Verify bằng `npm run compile` (vue-tsc --noEmit)

**Test Strategy:**

1. Build pass: `npm run compile` không có lỗi
2. Test resume (mặc định):
   - Tóm tắt 1 topic với auto-summarize, dừng giữa chừng hoặc để hoàn thành
   - Bấm lại "Tóm tắt toàn bộ" → chọn "Tiếp tục từ nơi đã dừng"
   - Verify: chỉ scrape/summarize các trang chưa làm, không redo segment đã xong
3. Test regenerate:
   - Trên topic đã tóm tắt, bấm "Tóm tắt toàn bộ" → chọn "Tóm tắt lại từ đầu"
   - Verify: clear toàn bộ segmentSummaries, scrape từ trang 1, summarize lại tất cả
4. Test fixed mode (dynamicSegments = false):
   - Tương tự test resume và regenerate
5. Test stale guard:
   - Bắt đầu regenerate, cancel giữa chừng → verify không corrupt state
6. UI test:
   - Confirm dialog hiển thị đúng 2 lựa chọn
   - Default selection là "Tiếp tục từ nơi đã dừng"
