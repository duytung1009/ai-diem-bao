# Tier 3 Review — Refactor 5 summarize flows (tasks 165–174)

### Metadata
- **File reviewed:** 10 commits `0f353f0..9be852d` trên `main` (tasks 165–174)
- **Review tier:** tier3
- **Model used:** opus
- **Diff size:** +2277 / −1481 LOC, 22 files (cross-module, architecture)
- **Verify:** `npm run compile` ✅ sạch · `npm run test` ✅ 191/191 pass (13 files)

### Checklist
| Category | Status | Notes |
|----------|--------|-------|
| Logic correctness | ⚠️ | 2 Major regression logic (C2 resume filter, C4 stale save) |
| Edge cases covered | ⚠️ | Cancel/resume với segment early-save (summary='') sai |
| Error handling | ✅ | Guard + try/finally giữ nguyên cấu trúc |
| Performance concerns | ✅ | Không thay đổi số LLM call (test assert getCallCount) |
| Security implications | N/A | — |
| Consistency with patterns | ⚠️ | C5 StepTimeline trái mục tiêu R8 |
| Type safety | ✅ | vue-tsc clean; pure module typed tốt |
| Test coverage | ✅ | Characterization CHAR-1..19 drive orchestration thật (đúng mục tiêu R1) — nhưng không phủ UI progress/StepTimeline |

### Đánh giá tổng quan

Refactor đạt phần lớn mục tiêu: R1 xoá dead code sạch (compile clean, không còn ref `updateSummary`/`summarizeIncremental`/`summarize_incremental`); 3 e2e false-confidence đã thay bằng `characterization-orchestration.test.ts` (19 case drive `useSummarize` thật + assert payload `SAVE_CACHED_TOPIC` + stale guard) — chính xác điều PRD nhắm tới. Pure modules (`run-guard`, `segment-persistence`, `segment-planner`) sạch, có unit test, diệt được duplication & drift công thức. Driver `runSummarizeJob` + 2 primitive gom 5 flow hợp lý.

**Tuy nhiên có 4 Major regression** thuộc đúng class bug đã ghi trong MEMORY (scrape-progress, stale-save corruption, StepTimeline). Test xanh vì các vùng này (UI progress, StepTimeline, edge cancel/resume) **không được assert**. → **request-changes**.

### Issues Found

| # | Severity | Category | Description | Suggestion |
|---|----------|----------|-------------|------------|
| C1 | **major** | logic/UI regression | `autoSummarizeDynamic` (useSummarize.ts:1038) gọi `scraper.scrapeRange(...page,page...)`. `useTopicScraper.scrapeRange` cài progress callback set `scrapeProgress={currentPage:startPage+current-1, totalPages:endPage}` → với scrape 1 trang `(page,page)` → `totalPages=page` = 100% mỗi vòng lặp, đè lên overall progress L1027/L1086. **Tái hiện đúng bug `fix-scrape-progress-overall-task`** (MEMORY) mà bản gốc đã fix bằng cách gọi `scrapePageRange` TRỰC TIẾP, bypass wrapper. Test không bắt (UI-only). | Trong `autoSummarizeDynamic` gọi thẳng `scrapePageRange(...)` (không qua `scraper.scrapeRange`), tự quản `scrapeAbortCtrl` như bản gốc; hoặc thêm tham số `onProgress?` vào `scraper.scrapeRange` để caller tắt callback nội bộ |
| C2 | **major** | logic regression | `segment-planner.computeResumeState` filter `s?.summary != null` (L66) khác bản gốc truthy `s => s?.summary`. Segment early-save có `summary:''` (`'' != null` → true) bị tính là *completed*. Đồng thời `computeResumeMode` (useSummarize.ts:653) vẫn dùng truthy → **2 predicate lệch nhau** → cancel rồi "Cập nhật" với segment dở (posts nhưng chưa summary) → `lastSeg` trỏ segment rỗng → `fromPage`/`segmentIndex` sai → mất nội dung hoặc re-scrape sai vị trí | Đổi filter module thành truthy: `filter((s): s is TopicSegment => !!s?.summary)`. Thêm unit test segment `summary:''` |
| C3 | **major** | data corruption | Stale-guard save trong `summarizeOneSegment` (L391-401) & `summarizeAndSaveSegment` (L905-917) gọi `buildSegmentSavePayload({ isSingleSegment:true })` → payload **có** `summary`/`summaryJson`. Bản gốc stale-save **cố tình bỏ** `summary` (chỉ lưu segments/counts). `mergePartialTopic` dùng `partial.summary ?? existing` → run cũ bị supersede sẽ **ghi đè summary mới** của chính topic đó bằng summary segment cũ. Đúng class `fix-stale-save-missing-metadata` / F24 CRITICAL | Stale path KHÔNG promote: gọi `buildSegmentSavePayload({ isSingleSegment:false })` cho cả 2 chỗ stale (giữ segments + counts, bỏ summary), giống bản gốc |
| C4 | **major** | UI/consistency (trái mục tiêu R8) | `runSummarizeJob` dynamic build `pl.buildSummarizePipeline([{start:1,end:totalPages}])` → 1 segment → steps `[scrape, summarize, overall]` (id `summarize`, KHÔNG `summarize_`). `usePipeline.reconcile` chỉ filter `!startsWith('summarize_')` → step `summarize` **tồn tại vĩnh viễn** + chèn thêm `summarize_0..N` → StepTimeline trùng/lệch cho mọi dynamic flow. Single-segment dynamic: `reduceOverall` early-return (completed===1) → step `overall` **không bao giờ done**. Đây chính là vấn đề R8 định sửa, giờ tái xuất hiện ở dạng khác | `reconcile` cũng loại step id `summarize` (placeholder), hoặc `buildSummarizePipeline` cho dynamic không phát step `summarize`. Mark `overall` done ở nhánh single-segment của `reduceOverall` |
| C5 | minor | dead code | useSummarize.ts import `PipelineStep`, `PipelineDefinition` không còn dùng (logic pipeline đã sang `usePipeline`). Compile pass nhưng rác | Xoá import thừa |
| C6 | minor | redundancy | `pl.pipeline.value = pl.markNextRunning(id)` (L360, 639, 872) — `markNextRunning` đã tự set `pl.pipeline.value` rồi return; gán lại thừa | Bỏ gán, gọi `pl.markNextRunning(id)` |
| C7 | nit | doc/Decision mismatch | PRD Decision (R2) chốt "1 công thức `totalPosts` duy nhất = `Math.max`". Thực tế `buildSegmentSavePayload` tham số hoá `useMaxTotal` (giữ cả 2 hành vi). Đúng cho behavior-preservation nhưng lệch lời văn Decision | Cập nhật Decision Log hoặc thống nhất `Math.max` toàn bộ ở task follow-up |
| O1 | observation | pre-existing | Fixed-mode multi-segment: `runSummarizeJob` fixed (L695) `begin()` rồi loop gọi `handleSummarizeSegment` (L542 cũng `begin()`) → vòng 2 `isStale(thisId)` true → chỉ tóm tắt 1 segment + bỏ overall. **Có sẵn ở bản gốc** (`++activeSummarizeId`), fixed mode hiếm dùng (dynamic default). Không phải regression nhưng refactor giữ nguyên bug | Cân nhắc fix riêng: fixed-mode dùng token bền hoặc không re-begin trong handleSummarizeSegment khi được driver gọi |

### Điểm tốt (giữ lại)
- R1 hoàn tất triệt để: dead code xoá sạch, taskType/prompt/type đều gỡ; không còn reference.
- `characterization-orchestration.test.ts` (CHAR-1..19) + `characterization-summarize-segments.test.ts`: drive `useSummarize` thật, assert `getCallCount` + payload `SAVE_CACHED_TOPIC` + stale guard + early-save — đúng lưới an toàn PRD yêu cầu, thay được 3 test sai tầng.
- `run-guard` / `segment-persistence` / `segment-planner`: pure, typed, unit-tested; diệt duplication & drift công thức `totalPosts`.
- Backward-compat legacy topic (L284-294), single-segment promotion, threadDeleted/threadLocked, news-enrichment-page-0 giữ nguyên.

### Summary
- **Overall:** **request-changes**
- **Key concern:** 4 Major regression đều thuộc class bug đã từng fix & ghi MEMORY (C1 scrape-progress, C3 stale-save corruption, C4 StepTimeline trái mục tiêu R8) + C2 predicate lệch gây sai resume. Test xanh do không assert vùng UI/StepTimeline/edge cancel-resume. Cần fix C1–C4 trước khi merge ổn định; C5–C7/O1 cleanup/ghi nhận.
- **Fix order đề xuất:** C3 (corruption, cao nhất) → C2 (resume sai) → C1 (progress) → C4 (StepTimeline) → C5/C6 cleanup → C7 doc → O1 follow-up riêng.
