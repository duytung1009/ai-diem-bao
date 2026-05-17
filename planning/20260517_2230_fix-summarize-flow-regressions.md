# Fix — 4 Major regression refactor summarize flows (C1–C4)

## Overview

Tier 3 review `review/20260517_2221_tier3_refactor-summarize-flows.md` (tasks 165–174) phát hiện **4 Major regression** thuộc đúng class bug đã từng fix & ghi MEMORY. `npm run compile`/`npm run test` xanh nhưng các vùng lỗi (UI progress, StepTimeline, edge cancel/resume, stale-save) **không được assert**. Cần fix + bổ sung test phủ các vùng này trước khi coi refactor là ổn định.

Scope: chỉ sửa regression, KHÔNG đổi kiến trúc driver/primitive đã refactor. Mỗi fix kèm test chứng minh regression (đỏ trước fix, xanh sau).

## Goals

- C1: dynamic auto-summarize giữ overall `scrapeProgress` xuyên suốt, không nhảy 100% mỗi trang.
- C2: `computeResumeState` & `computeResumeMode` dùng **cùng** predicate "segment đã summary" (truthy); segment early-save (`summary:''`) KHÔNG bị tính completed.
- C3: stale-guard save KHÔNG promote `summary`/`summaryJson` top-level → không ghi đè summary mới của topic khi run bị supersede.
- C4: StepTimeline nhất quán cho mọi dynamic flow — không còn step `summarize` placeholder thừa song song `summarize_N`; single-segment dynamic mark `overall` done.
- Mỗi C có regression test phủ đúng vùng (UI progress / resume edge / stale payload / pipeline steps). `npm run compile` + `npm run test` xanh.

## Requirements

### C1 — Khôi phục overall scrape progress trong autoSummarizeDynamic

- File: `entrypoints/sidepanel/composables/useSummarize.ts` (`autoSummarizeDynamic`, ~L1038).
- Vấn đề: gọi `scraper.scrapeRange(version, topicUrl, page, page, delayMs)` → `useTopicScraper.scrapeRange` cài progress callback set `scrapeProgress={currentPage:startPage+current-1, totalPages:endPage}`; với scrape 1 trang `(page,page)` → `totalPages=page` = 100% mỗi vòng, đè overall progress (L1027/L1086). Tái hiện bug `fix-scrape-progress-overall-task`.
- Yêu cầu: trong vòng lặp page-by-page của `autoSummarizeDynamic`, gọi `scrapePageRange(...)` **trực tiếp** (bypass `scraper.scrapeRange`), tự quản `AbortController` (đăng ký để `scraper.abortScrape()`/`handleCancel` vẫn hủy được), KHÔNG để callback nội bộ ghi đè overall `scrapeProgress`. Giữ nguyên accumulator `totalPostsScraped` + set `scrapeProgress={currentPage:page, totalPages, postsScraped}` như hiện có.
- Phương án thay thế chấp nhận được: thêm tham số `onProgress?` (hoặc cờ tắt callback nội bộ) vào `useTopicScraper.scrapeRange` để caller dynamic không bị callback clobber. Chọn phương án ít coupling hơn (xem Decision 1).

### C2 — Thống nhất predicate "segment completed"

- File: `lib/segment-planner.ts` (`computeResumeState`, L66).
- Vấn đề: filter `s?.summary != null` (bao gồm `summary:''` của segment early-save) khác bản gốc & khác `computeResumeMode` (`useSummarize.ts:653` dùng truthy `s => s?.summary`). 2 predicate lệch → cancel→"Cập nhật" với segment dở → `lastSeg` trỏ segment rỗng → `fromPage`/`segmentIndex` sai.
- Yêu cầu: đổi filter module thành truthy: `filter((s): s is TopicSegment => !!s?.summary)`. Rà soát mọi nơi lọc "completed segment" (`reduceOverall` L442, `summarizedCount` L98, `computeResumeMode` L653, `runSummarizeJob` L704/760) đảm bảo đồng nhất truthy.

### C3 — Stale-guard save không promote summary

- File: `entrypoints/sidepanel/composables/useSummarize.ts` (`summarizeOneSegment` stale path L391-401; `summarizeAndSaveSegment` stale path L905-917).
- Vấn đề: stale path gọi `buildSegmentSavePayload({ isSingleSegment:true })` → payload có `summary`/`summaryJson`. `mergePartialTopic` dùng `partial.summary ?? existing` → run bị supersede ghi đè summary mới của chính topic. Bản gốc stale-save cố tình bỏ `summary` (chỉ segments + counts). Class `fix-stale-save-missing-metadata` / F24 CRITICAL.
- Yêu cầu: stale path 2 chỗ gọi `buildSegmentSavePayload({ isSingleSegment:false, ... })` (giữ segments + totalPosts + summarizedPostCount + forumPostCount, KHÔNG summary/summaryJson), khớp hành vi bản gốc. Giữ `useMaxTotal` như hiện tại (dynamic stale = true). Non-stale path giữ nguyên (vẫn promote khi single/dynamic).

### C4 — Pipeline reconcile loại placeholder + mark overall done

- Files: `entrypoints/sidepanel/composables/usePipeline.ts` (`reconcile`); `lib/pipeline-builder.ts` (`buildSummarizePipeline`); `entrypoints/sidepanel/composables/useSummarize.ts` (`reduceOverall` single-segment branch).
- Vấn đề: dynamic build `buildSummarizePipeline([{1,totalPages}])` → 1 segment → step id `summarize` (không `summarize_`). `reconcile` chỉ filter `!startsWith('summarize_')` → step `summarize` tồn tại vĩnh viễn + chèn thêm `summarize_0..N` → StepTimeline trùng/lệch. Single-segment dynamic: `reduceOverall` early-return → step `overall` không bao giờ done.
- Yêu cầu:
  - `reconcile` cũng loại step id chính xác `summarize` (placeholder) ngoài `summarize_*`; HOẶC `buildSummarizePipeline` khi dùng cho dynamic không phát step `summarize` (thêm biến thể/tham số). Chọn cách ít ảnh hưởng fixed-mode (xem Decision 2).
  - `reduceOverall` nhánh `completedSegments.length === 1`: mark step `overall` done (qua `pl.markDone('overall')` hoặc tương đương) trước khi return, để StepTimeline kết thúc đúng.
  - Đảm bảo fixed-mode (single & multi-segment, không dynamic) StepTimeline vẫn đúng (regression test).

## Technical Considerations

- **Affected files:** `useSummarize.ts`, `useTopicScraper.ts` (nếu chọn thêm onProgress), `lib/segment-planner.ts`, `lib/pipeline-builder.ts`, `usePipeline.ts`; tests `tests/unit/segment-planner*`, `tests/e2e/characterization-orchestration.test.ts` (mở rộng).
- **Thứ tự fix (rủi ro corruption cao nhất trước):** C3 → C2 → C1 → C4.
- **Không đụng:** kiến trúc driver `runSummarizeJob`/primitive; R1 dead-code removal; pure module API (chỉ sửa logic bên trong `computeResumeState`).
- **Invariant phải giữ:** `mock.getCallCount()` không đổi; single-segment promotion (non-stale) vẫn ghi top-level summary; legacy topic backward-compat; threadDeleted/threadLocked; news-enrichment page/segment 0.
- **Pre-existing (O1, KHÔNG fix ở đây):** fixed-mode multi-segment loop guard tự invalidate — có sẵn từ bản gốc, tách follow-up riêng.

## Implementation Notes

- Mỗi C: viết regression test TRƯỚC (đỏ), fix, test xanh. C1/C4 cần test phủ `scrapeProgress`/`pipeline.steps` (vùng characterization hiện bỏ trống). C3 assert payload stale KHÔNG có `summary`. C2 test segment `summary:''`.
- Verify `npm run compile` + `npm run test` full sau mỗi C; không gộp nhiều C vào 1 commit.
- Tham chiếu review file để hiểu root cause; gặp tình huống ngoài scope → tag `[DECISION_NEEDED]`, không tự đổi kiến trúc.

## Test Plan

- C1: test `autoSummarizeDynamic` nhiều trang → `scrapeProgress.totalPages` luôn = tổng số trang topic, `currentPage` tăng dần, không reset về `page/page`.
- C2: segmentSummaries gồm 1 segment thật + 1 segment `summary:''` → `computeResumeState` bỏ qua segment rỗng; `computeResumeMode` & module trả kết quả nhất quán.
- C3: stale run (guard bumped giữa chừng) → payload `SAVE_CACHED_TOPIC` KHÔNG chứa `summary`/`summaryJson`; summary cũ của topic không bị ghi đè.
- C4: dynamic 1 segment & nhiều segment → `pipeline.steps` không có đồng thời `summarize` + `summarize_0`; step `overall` đạt `done`. Fixed-mode single & multi vẫn đúng.
- Thủ công: chạy thật trên topic ~25 trang & ~234 trang — quan sát progress bar mượt, StepTimeline nhất quán, cancel→Cập nhật resume đúng vị trí.

## Decision Log

### Quyết định 1: C1 — bypass scrapeRange vs thêm onProgress vào scraper
- **Đã chọn:** gọi `scrapePageRange` **trực tiếp** trong `autoSummarizeDynamic` (giống bản gốc trước refactor), tự quản AbortController, đăng ký để `scraper.abortScrape()` vẫn hủy được.
- **Lý do:** đúng cách bản gốc đã fix bug `fix-scrape-progress-overall-task`; ít coupling; `useTopicScraper.scrapeRange` giữ nguyên cho range-scrape thường (handleSummarizeSegment fixed-mode).
- **Đã cân nhắc loại:** thêm `onProgress?`/cờ tắt callback vào `scraper.scrapeRange` — loại vì làm API scraper phức tạp, dễ dùng sai lại.
- **Điều kiện xem lại:** nếu cần share abort-coordination phức tạp giữa dynamic loop và scraper → tái cấu trúc abort ownership ở task riêng.

### Quyết định 2: C4 — reconcile lọc placeholder vs buildSummarizePipeline biến thể dynamic
- **Đã chọn:** `reconcile` loại cả step id chính xác `summarize` (placeholder) lẫn `summarize_*`, rồi chèn `summarize_0..N`. Không đổi `buildSummarizePipeline`.
- **Lý do:** `buildSummarizePipeline` dùng chung fixed-mode (cần step `summarize` cho single fixed-segment); đổi nó rủi ro lan fixed-mode. Sửa cục bộ trong `reconcile` an toàn hơn.
- **Đã cân nhắc loại:** thêm tham số `dynamic` cho `buildSummarizePipeline` để bỏ step `summarize` — loại vì tăng bề mặt API, dễ regress fixed-mode.
- **Điều kiện xem lại:** nếu reconcile trở nên phức tạp khó test → tách builder dynamic riêng.

### Quyết định 3: Phạm vi — chỉ fix regression, không đụng O1
- **Đã chọn:** chỉ C1–C4. O1 (fixed-mode loop guard tự invalidate) tách follow-up riêng vì là pre-existing, không phải regression refactor.
- **Lý do:** giữ scope fix nhỏ, dễ review; tránh trộn pure-refactor regression với pre-existing bug.
- **Điều kiện xem lại:** nếu user muốn dọn luôn O1 → tạo task riêng, không nhồi vào batch này.
