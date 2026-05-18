# Refactor Step Timeline — Tính toán toàn bộ step ngay từ đầu

## Overview

Hiện tại StepTimeline trong sidepanel **thêm step động** trong quá trình chạy job tóm tắt:
- **Fixed-size segment:** đã build full pipeline upfront (`buildSummarizePipeline(segments.value)`) — phần này về cơ bản đúng.
- **Dynamic segment:** khởi tạo 1 step scrape gộp `[{start:1,end:totalPages}]`, rồi trong `autoSummarizeDynamic` mỗi khi 1 segment chốt budget lại `.splice()` thêm step `scrape_N` và gọi `reconcile()` rebuild lại list. Timeline "mọc dần" → UX khó đoán, code có 2 hack (`.splice` tại `useSummarize.ts:1156-1165` + `usePipeline.reconcile()`).

Mục tiêu: với **mọi** chế độ, tính số step cần thiết **trước**, render timeline đầy đủ (tất cả step ở trạng thái `pending`) ngay khi bắt đầu, sau đó chỉ chuyển trạng thái `pending → running → done`, **không bao giờ thêm/bớt step động**.

Ràng buộc cốt lõi: với dynamic segment, số segment phụ thuộc token thực tế của post → chỉ biết chính xác **sau khi scrape xong**. Giải pháp đã chốt: **tách dynamic flow thành 2 phase tường minh** (scrape toàn bộ → plan segment deterministic → rebuild full timeline → summarize).

## Goals

- G1: Timeline hiển thị đầy đủ tất cả step ngay từ đầu cho cả fixed và dynamic mode; số step không đổi trong suốt run (trừ trường hợp resume/totalPages đổi — xem Edge cases).
- G2: Xóa hoàn toàn cơ chế thêm step động: bỏ `.splice()` trong `autoSummarizeDynamic` và bỏ/tái cấu trúc `reconcile()`.
- G3: Dynamic mode có 2 step pha rõ ràng đứng trước các step summarize: `Scraping` (scrape toàn bộ trang) → `Tạo segment động` (tính boundary từ post đã scrape).
- G4: Tách `planDynamicSegments()` thành **pure function** deterministic, có unit test (cùng input post → cùng boundary).
- G5: Không regression: resume (cancel giữa chừng → chạy lại), thread deleted/locked, abort, news enrichment page 1, overall summary, single-segment fast path, ETA/progress bar vẫn hoạt động đúng.

## Requirements

### Module A — `lib/segment-planner.ts` (pure planner)

- R-A1: Thêm hàm pure `planDynamicSegments(posts: ScrapedPost[], budgetTokens: number): { start: number; end: number }[]`.
  - Group post theo `post.page` (field `page?: number` đã có trong `lib/types.ts:8`; post enrichment/article post `postNumber < 0` gán theo page của post gốc — xem Technical Considerations).
  - Duyệt page tăng dần, cộng dồn token mỗi page bằng đúng công thức hiện tại trong `autoSummarizeDynamic`: `estimateTokens(`[${author}] (#${postNumber}):\n${content}`)`.
  - Khi `pendingTokens + pageTokens > budgetTokens && pendingPosts.length > 0` → chốt segment `{start: pendingStartPage, end: page-1}`, reset pending, `pendingStartPage = page`.
  - Page cuối: flush segment còn lại `{start: pendingStartPage, end: lastPage}`.
  - **Bất biến:** thuật toán phải cho ra **cùng tập boundary** như thuật toán online hiện tại khi chạy trên cùng tập post → đảm bảo tương thích với segment summary đã cache.
- R-A2: Đảm bảo deterministic — không phụ thuộc thứ tự scrape, chỉ phụ thuộc `posts` đã sort theo page + budget.

### Module B — `lib/pipeline-builder.ts` + `usePipeline.ts` (timeline upfront)

- R-B1: Thêm builder cho dynamic flow trước khi biết segment: `buildDynamicScrapePipeline(totalPages)` → steps:
  `[ scrape (Scraping trang 1–totalPages), plan (Tạo segment động), overall (placeholder, pending) ]`.
  Đây là timeline hiển thị ngay khi bấm tóm tắt (chưa biết số segment).
- R-B2: Thêm hàm `rebuildWithSegments(boundaries)` trong `usePipeline` (thay cho `reconcile`): sau khi plan xong, **thay toàn bộ** pipeline thành deterministic:
  `[ scrape:done, plan:done, summarize_0:pending, ..., summarize_{N-1}:pending, overall:pending ]`.
  Đây là lần **duy nhất** pipeline đổi cấu trúc, và xảy ra **trước khi** bất kỳ step summarize nào chạy → người dùng thấy timeline đầy đủ ngay sau bước plan (vài chục ms).
- R-B3: Xóa `reconcile()` và mọi nơi gọi nó. Xóa block `.splice()` tại `useSummarize.ts:1156-1165`.
- R-B4: `buildSummarizePipeline` (fixed mode) giữ nguyên hành vi — đã build upfront đúng. Cân nhắc gộp label "Tạo segment động" CHỈ cho dynamic; fixed mode không có step `plan`.
- R-B5: Single-segment fast path: nếu sau plan chỉ có 1 segment → pipeline `[scrape:done, plan:done, summarize:pending, overall:pending]` (giữ nhánh `segments.length <= 1` của builder hiện tại).

### Module C — `useSummarize.ts` (tách `autoSummarizeDynamic` thành 2 phase)

- R-C1: Tách `autoSummarizeDynamic` thành các đơn vị rõ ràng:
  - `scrapeAllPages(topicUrl, totalPages, fromPage, thisId): Promise<ScrapedPost[]>` — vòng lặp scrape page 1→totalPages (hoặc fromPage→totalPages khi resume), giữ nguyên: news enrichment page 1, `scrapeProgress` overall (currentPage/totalPages/postsScraped — bảo toàn fix C1), abort linking, thread deleted/locked handling, delay+jitter, persist post tăng dần (xem R-C3). Trả về toàn bộ post đã scrape (gồm post resume từ cache).
  - Sau scrape: `pl.markDone('scrape')`, `pl.markRunning('plan')`.
  - `const boundaries = planDynamicSegments(allPosts, budget)` → `dynamicSegmentBoundaries.value = boundaries`.
  - `pl.rebuildWithSegments(boundaries)`; `pl.markDone('plan')`.
  - Loop `for i in boundaries`: `markRunning(summarize_i)` → `summarizeAndSaveSegment(i, start, end, postsOfSegment, false, thisId)` → `markDone(summarize_i)`.
  - Sau loop: `markRunning('overall')` → `generateOverallSummary()` → `markDone('overall')` (giữ logic `completed >= 1` hiện có ở `runSummarizeJob`).
- R-C2: `runSummarizeJob`: nhánh dynamic gọi `buildDynamicScrapePipeline(totalPages)` thay cho `buildSummarizePipeline([{start:1,end:totalPages}])`. Nhánh fixed giữ nguyên.
- R-C3: **Persist post khi scrape** (cho resume an toàn): trong `scrapeAllPages`, sau mỗi page (hoặc mỗi N page) lưu post tích lũy + `lastScrapedPage` vào cache (tái dùng cơ chế early-save F15/F16). Khi resume: load post đã cache + `lastScrapedPage`, chỉ scrape `lastScrapedPage+1 → totalPages`, gộp lại rồi `planDynamicSegments` trên **toàn bộ** post.
- R-C4: Resume re-plan: vì `planDynamicSegments` deterministic trên full post set, boundary tính lại sẽ ổn định. Segment summary đã cache **chỉ tái dùng** nếu `(startPage,endPage)` trùng khít boundary mới; segment nào lệch boundary → re-summarize. (Trong thực tế nếu chỉ scrape thêm trang mới ở cuối thì các boundary đầu giữ nguyên → tái dùng được; chỉ segment cuối/đuôi có thể đổi.)
- R-C5: `handleSegmentUpdate` (dynamic, khi totalPages tăng): đi qua cùng driver — scrape các trang mới, gộp post cũ (từ cache) + mới, re-plan, rebuild timeline, summarize segment thiếu.

### Module D — Tests

- R-D1: Unit test `planDynamicSegments` (`tests/unit/`): cùng input → cùng boundary; budget nhỏ → nhiều segment; 1 trang → 1 segment; post `postNumber<0` (article) gán đúng page; bất biến "trùng output thuật toán online" (so sánh với reference impl).
- R-D2: E2e/orchestration test (`tests/e2e/`): dynamic flow build đúng pipeline `[scrape, plan, summarize_0..N, overall]`; pipeline KHÔNG đổi số step sau khi `rebuildWithSegments` (ngoài lần rebuild đó); fixed flow không có step `plan`.
- R-D3: Test resume: scrape dở → chạy lại → chỉ scrape trang còn thiếu, boundary tái lập đúng, không re-summarize segment đã đủ.

## Technical Considerations

- **Files ảnh hưởng:** `lib/segment-planner.ts`, `lib/pipeline-builder.ts`, `entrypoints/sidepanel/composables/usePipeline.ts`, `entrypoints/sidepanel/composables/useSummarize.ts` (lớn nhất — tách `autoSummarizeDynamic`), có thể `entrypoints/sidepanel/components/StepTimeline.vue` (chỉ nếu cần label step `plan`), `lib/types.ts` (nếu thêm field cache `lastScrapedPage`).
- **`post.page`:** field `page?: number` đã có (`lib/types.ts:8`, set bởi `page-loader.ts`). Article/enriched post (`postNumber < 0`) cần gán `page` = page của post gốc đang xử lý (hiện news enrichment chỉ chạy page 1 → gán `page=1`). Cần verify enriched post có `page` set; nếu chưa, gán trong `scrapeAllPages` trước khi đưa vào planner.
- **Bảo toàn fix C1 (scrape progress overall):** `scrapeProgress` phải duy trì `{currentPage, totalPages, postsScraped}` xuyên suốt phase scrape; phase plan tức thời; phase summarize dùng `simpleLoadingText`/`llmTaskId` ETA như hiện tại. Không lặp lại regression "progress bar biến mất" (bug `fix-scrape-progress-overall-task`).
- **Tương thích cache cũ:** segment summary đã cache theo `(startPage,endPage)`; planner mới phải sinh cùng boundary trên cùng post → reuse được. Đây là lý do R-A1 yêu cầu "bất biến trùng thuật toán online".
- **Memory:** scrape-all giữ toàn bộ post trong RAM trước khi summarize. Thread rất lớn (200+ trang) — chấp nhận được vì post đã được persist xuống cache (R-C3) và pipeline cũ cũng giữ pendingPosts + cache per-segment. Không thay đổi đáng kể memory ceiling.
- **Wall-clock:** flow cũ đã interleave **tuần tự** (`await summarizeAndSaveSegment` block vòng scrape), không thực sự song song → tách 2 phase không làm chậm thêm đáng kể; tổng thời gian ≈ scrape + summarize như cũ.
- **Run guard / stale:** giữ `summarizeGuard.isStale(thisId)` check ở mọi điểm await trong `scrapeAllPages` và loop summarize (như code hiện tại).
- **Abort:** abort trong phase scrape → throw AbortError, đã có handler ở `runSummarizeJob` catch. Abort trong phase summarize giữ nguyên.

## Implementation Notes

Thứ tự ưu tiên đề xuất:
1. **Module A** trước (pure, dễ test, không phụ thuộc UI): viết `planDynamicSegments` + unit test (R-A1, R-A2, R-D1). Trích thuật toán hiện tại từ `autoSummarizeDynamic:1137-1166` làm reference.
2. **Module B**: `buildDynamicScrapePipeline` + `rebuildWithSegments`, xóa `reconcile` (R-B1..R-B5, R-B3).
3. **Module C**: tách `autoSummarizeDynamic` → `scrapeAllPages` + dùng planner + rebuild + loop (R-C1..R-C5). Đây là phần rủi ro nhất — làm sau khi A,B đã có test.
4. **Module D**: e2e + resume test (R-D2, R-D3).
5. Verify: `npm run compile` + `npm run test`.

Tham chiếu code: `autoSummarizeDynamic` (`useSummarize.ts:1017-1181`), `runSummarizeJob` (`:688-783`), `segments` computed (`:78-95`), `usePipeline.reconcile` (`usePipeline.ts:24-82`), `buildSummarizePipeline` (`pipeline-builder.ts:19-40`), `computeResumeState` (`segment-planner.ts:63-118`).

Nếu gặp tình huống ngoài Decision Log → tag `[DECISION_NEEDED]` kèm reasoning, tiếp tục.

## Test Plan

- Unit: `npm run test -- tests/unit/segment-planner` — planner deterministic + bất biến.
- Compile: `npm run compile` sạch.
- Thủ công (extension thật):
  - Dynamic mode, thread ~50 trang: timeline hiện ngay `[Scraping, Tạo segment động, Tóm tắt tổng quan]`; sau scrape → timeline rebuild đầy đủ N step summarize; không có step "mọc dần" khi đang summarize.
  - Fixed mode: timeline đầy đủ ngay từ đầu, không có step `plan`.
  - Cancel giữa scrape → mở lại → resume chỉ scrape trang còn thiếu, boundary đúng, segment đã xong không bị re-summarize.
  - Thread 1 trang: pipeline `[scrape, plan, summarize, overall]` (hoặc fast path tương đương), không lỗi.
  - News thread (page 1 có article): article post được tính vào segment đúng, không mất post.
  - Thread bị xóa/khóa giữa scrape: dừng đúng, message đúng, không crash timeline.

## Decision Log

### Quyết định 1: Hướng xử lý dynamic segment timeline

- **Đã chọn:** Tách 2 phase tường minh — scrape toàn bộ → `planDynamicSegments` deterministic → rebuild full timeline 1 lần → summarize. (User confirm 2026-05-18.)
- **Lý do:** Khớp đúng mô tả user ("scraping + tạo dynamic segment từ đầu"); timeline hoàn toàn deterministic, xóa hẳn 2 hack `.splice`/`reconcile`; flow cũ vốn đã tuần tự nên không mất hiệu năng pipelining thực sự; planner pure → test được.
- **Đã cân nhắc nhưng loại:**
  - *Ước lượng số segment upfront (`estimateAutoSummarizeCalls`) + reconcile sai số* — loại vì vẫn còn điều chỉnh động, label trang lệch ước lượng, không deterministic, vẫn giữ code phức tạp.
- **Điều kiện thay đổi:** Nếu sau này muốn scrape & summarize **song song thật** (web worker / không block) để tăng tốc thread cực lớn → cân nhắc lại mô hình streaming, nhưng vẫn có thể giữ timeline upfront bằng ước lượng + lock số step.

### Quyết định 2: Resume khi đã tách 2 phase

- **Đã chọn:** Persist post tích lũy + `lastScrapedPage` khi scrape; resume = load cache + scrape trang thiếu + re-plan deterministic trên full post; chỉ re-summarize segment có boundary lệch.
- **Lý do:** Planner deterministic nên re-plan ổn định; thêm trang cuối thường không đổi boundary đầu → tái dùng segment summary đã cache; tránh mất tiến độ scrape khi crash/cancel.
- **Đã cân nhắc nhưng loại:**
  - *Không persist post, scrape lại từ đầu mỗi lần resume* — loại vì lãng phí thời gian scrape (rate-limited ~2s/trang) và quota.
  - *Tái dùng `computeResumeState` per-segment như cũ* — loại vì gắn chặt với mô hình online cũ (resume giữa segment); mô hình mới resume ở mức "trang đã scrape" đơn giản và an toàn hơn.
- **Điều kiện thay đổi:** Nếu boundary thường xuyên đổi khi thêm trang (thread sửa post cũ) gây re-summarize nhiều → cân nhắc neo boundary segment đã hoàn tất (không re-plan các segment đầu đã `complete`).

### Quyết định 3: Phạm vi fixed-size mode

- **Đã chọn:** Giữ nguyên `buildSummarizePipeline` cho fixed mode (đã upfront đúng), KHÔNG thêm step `plan` cho fixed.
- **Lý do:** Fixed mode boundary tính từ config trước scrape — không cần phase plan; thêm step thừa gây nhiễu UX.
- **Đã cân nhắc nhưng loại:** *Thống nhất tuyệt đối 1 builder cho cả 2 mode* — loại vì fixed không có khái niệm "tạo segment động", ép chung làm code khó đọc hơn lợi ích.
- **Điều kiện thay đổi:** Nếu sau này fixed mode cũng cần 1 bước chuẩn bị hiển thị → thêm step generic "Chuẩn bị" dùng chung.
