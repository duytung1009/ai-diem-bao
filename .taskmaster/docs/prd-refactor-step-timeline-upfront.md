<context>
# Overview

Refactor StepTimeline để tính toán toàn bộ step ngay từ đầu, thay vì thêm step động trong quá trình chạy. Hiện tại StepTimeline trong sidepanel thêm step động khi chạy job tóm tắt — dynamic mode khởi tạo 1 step scrape gộp rồi `.splice()` thêm step khi chốt budget, gọi `reconcile()` rebuild list. Mục tiêu: với mọi chế độ, tính số step cần thiết trước, render timeline đầy đủ ngay khi bắt đầu, sau đó chỉ chuyển trạng thái `pending → running → done`, không bao giờ thêm/bớt step động.

Với dynamic segment, số segment phụ thuộc token thực tế của post → chỉ biết chính xác sau khi scrape xong. Giải pháp: tách dynamic flow thành 2 phase tường minh (scrape toàn bộ → plan segment deterministic → rebuild full timeline → summarize).

# Core Features

- Module A — `lib/segment-planner.ts`: Pure function `planDynamicSegments(posts, budgetTokens)` deterministic, có unit test. Group post theo page, cộng dồn token, chốt segment khi vượt budget. Bất biến: cùng output như thuật toán online hiện tại trên cùng input.
- Module B — `lib/pipeline-builder.ts` + `usePipeline.ts`: Builder cho dynamic flow trước khi biết segment (`buildDynamicScrapePipeline`), hàm `rebuildWithSegments` thay `reconcile`, xóa `.splice()` và `reconcile()`.
- Module C — `useSummarize.ts`: Tách `autoSummarizeDynamic` thành 2 phase rõ ràng: scrapeAllPages → planDynamicSegments → rebuildWithSegments → loop summarize. Persist post khi scrape cho resume an toàn.
- Module D — Tests: Unit test planner (deterministic, bất biến), E2E test dynamic flow, test resume.

# User Experience

- Timeline hiển thị đầy đủ tất cả step ngay từ đầu cho cả fixed và dynamic mode
- Dynamic mode có 2 step pha rõ ràng: Scraping → Tạo segment động, đứng trước các step summarize
- Sau khi plan xong, timeline rebuild đầy đủ N step summarize trong vài chục ms
- Không bao giờ có step "mọc dần" khi đang summarize
</context>
<PRD>
# Technical Architecture

## Module A — `lib/segment-planner.ts` (pure planner)

- Thêm hàm pure `planDynamicSegments(posts: ScrapedPost[], budgetTokens: number): { start: number; end: number }[]`
  - Group post theo `post.page` (field `page?: number` đã có trong `lib/types.ts:8`; post enrichment/article post `postNumber < 0` gán theo page của post gốc)
  - Duyệt page tăng dần, cộng dồn token mỗi page bằng đúng công thức hiện tại trong `autoSummarizeDynamic`: `estimateTokens(`[${author}] (#${postNumber}):\n${content}`)`
  - Khi `pendingTokens + pageTokens > budgetTokens && pendingPosts.length > 0` → chốt segment `{start: pendingStartPage, end: page-1}`, reset pending, `pendingStartPage = page`
  - Page cuối: flush segment còn lại `{start: pendingStartPage, end: lastPage}`
  - Bất biến: thuật toán phải cho ra cùng tập boundary như thuật toán online hiện tại khi chạy trên cùng tập post → đảm bảo tương thích với segment summary đã cache
- Đảm bảo deterministic — không phụ thuộc thứ tự scrape, chỉ phụ thuộc `posts` đã sort theo page + budget

## Module B — `lib/pipeline-builder.ts` + `usePipeline.ts` (timeline upfront)

- Thêm builder cho dynamic flow trước khi biết segment: `buildDynamicScrapePipeline(totalPages)` → steps: `[scrape (Scraping trang 1–totalPages), plan (Tạo segment động), overall (placeholder, pending)]`
- Thêm hàm `rebuildWithSegments(boundaries)` trong `usePipeline` (thay cho `reconcile`): sau khi plan xong, thay toàn bộ pipeline thành: `[scrape:done, plan:done, summarize_0:pending, ..., summarize_{N-1}:pending, overall:pending]`. Đây là lần duy nhất pipeline đổi cấu trúc, xảy ra trước khi bất kỳ step summarize nào chạy
- Xóa `reconcile()` và mọi nơi gọi nó. Xóa block `.splice()` tại `useSummarize.ts:1156-1165`
- `buildSummarizePipeline` (fixed mode) giữ nguyên hành vi — đã build upfront đúng. Không thêm step `plan` cho fixed mode
- Single-segment fast path: nếu sau plan chỉ có 1 segment → pipeline `[scrape:done, plan:done, summarize:pending, overall:pending]`

## Module C — `useSummarize.ts` (tách `autoSummarizeDynamic` thành 2 phase)

- Tách `autoSummarizeDynamic` thành:
  - `scrapeAllPages(topicUrl, totalPages, fromPage, thisId): Promise<ScrapedPost[]>` — vòng lặp scrape page 1→totalPages (hoặc fromPage→totalPages khi resume), giữ nguyên: news enrichment page 1, scrapeProgress overall (bảo toàn fix C1), abort linking, thread deleted/locked handling, delay+jitter, persist post tăng dần
  - Sau scrape: `pl.markDone('scrape')`, `pl.markRunning('plan')`
  - `const boundaries = planDynamicSegments(allPosts, budget)` → `dynamicSegmentBoundaries.value = boundaries`
  - `pl.rebuildWithSegments(boundaries)`; `pl.markDone('plan')`
  - Loop `for i in boundaries`: `markRunning(summarize_i)` → `summarizeAndSaveSegment(i, start, end, postsOfSegment, false, thisId)` → `markDone(summarize_i)`
  - Sau loop: `markRunning('overall')` → `generateOverallSummary()` → `markDone('overall')`
- `runSummarizeJob`: nhánh dynamic gọi `buildDynamicScrapePipeline(totalPages)` thay cho `buildSummarizePipeline([{start:1,end:totalPages}])`. Nhánh fixed giữ nguyên
- Persist post khi scrape (cho resume an toàn): trong `scrapeAllPages`, sau mỗi page (hoặc mỗi N page) lưu post tích lũy + `lastScrapedPage` vào cache (tái dùng cơ chế early-save F15/F16). Khi resume: load post đã cache + `lastScrapedPage`, chỉ scrape `lastScrapedPage+1 → totalPages`, gộp lại rồi `planDynamicSegments` trên toàn bộ post
- Resume re-plan: vì `planDynamicSegments` deterministic trên full post set, boundary tính lại sẽ ổn định. Segment summary đã cache chỉ tái dùng nếu `(startPage,endPage)` trùng khít boundary mới; segment nào lệch boundary → re-summarize
- `handleSegmentUpdate` (dynamic, khi totalPages tăng): đi qua cùng driver — scrape các trang mới, gộp post cũ (từ cache) + mới, re-plan, rebuild timeline, summarize segment thiếu

## Module D — Tests

- Unit test `planDynamicSegments` (`tests/unit/`): cùng input → cùng boundary; budget nhỏ → nhiều segment; 1 trang → 1 segment; post `postNumber<0` (article) gán đúng page; bất biến "trùng output thuật toán online" (so sánh với reference impl)
- E2e/orchestration test (`tests/e2e/`): dynamic flow build đúng pipeline `[scrape, plan, summarize_0..N, overall]`; pipeline KHÔNG đổi số step sau khi `rebuildWithSegments` (ngoài lần rebuild đó); fixed flow không có step `plan`
- Test resume: scrape dở → chạy lại → chỉ scrape trang còn thiếu, boundary tái lập đúng, không re-summarize segment đã đủ

# Development Roadmap

## Phase 1 — Module A: Pure segment planner (no UI dependency)
- Create `lib/segment-planner.ts` with `planDynamicSegments()` pure function
- Extract algorithm from current `autoSummarizeDynamic:1137-1166` as reference
- Unit tests for planner: deterministic, same boundary as online algorithm, edge cases

## Phase 2 — Module B: Pipeline builder + usePipeline refactor
- Add `buildDynamicScrapePipeline(totalPages)` to `lib/pipeline-builder.ts`
- Add `rebuildWithSegments(boundaries)` to `usePipeline.ts`
- Delete `reconcile()` and all call sites
- Delete `.splice()` block at `useSummarize.ts:1156-1165`
- Ensure fixed mode unchanged, single-segment fast path works

## Phase 3 — Module C: Refactor autoSummarizeDynamic into 2-phase flow
- Extract `scrapeAllPages()` function
- Wire up: scrapeAllPages → planDynamicSegments → rebuildWithSegments → loop summarize
- Update `runSummarizeJob` dynamic branch
- Implement post persistence during scrape for resume safety
- Implement resume re-plan logic with boundary compatibility
- Update `handleSegmentUpdate` for new flow
- Verify: resume, abort, thread deleted/locked, news enrichment, overall summary, ETA/progress bar

## Phase 4 — Module D: E2E + resume tests
- E2E test: dynamic flow pipeline structure, no step count change after rebuild
- Resume test: partial scrape → resume → correct boundaries, no re-summarize
- Manual verification on real extension

# Logical Dependency Chain

1. **Module A first** (pure, easy to test, no UI dependency): `planDynamicSegments` + unit tests. Extract current algorithm from `autoSummarizeDynamic:1137-1166` as reference implementation.
2. **Module B next** (pipeline infrastructure): `buildDynamicScrapePipeline` + `rebuildWithSegments`, delete `reconcile`.
3. **Module C last and riskiest** (main refactor): Split `autoSummarizeDynamic` → `scrapeAllPages` + use planner + rebuild + loop. Do after A and B have tests.
4. **Module D**: E2E + resume tests. Validate the whole system.

# Risks and Mitigations

- **Cache compatibility**: Segment summary cached by `(startPage,endPage)` — planner must produce same boundary on same posts. Mitigated by R-A1 invariant + unit test comparing with reference algorithm.
- **Memory**: scrape-all holds all posts in RAM before summarize. Acceptable since posts are persisted to cache and old pipeline also held pendingPosts. No significant memory ceiling change.
- **Wall-clock**: Old flow was already sequential (await summarizeAndSaveSegment blocks scrape loop), so splitting into 2 phases doesn't slow down. Total time ≈ scrape + summarize as before.
- **Resume stability**: Deterministic planner means re-plan produces stable boundaries. Only tail segments may shift when new pages added.
- **Progress bar regression**: Must preserve `scrapeProgress {currentPage, totalPages, postsScraped}` throughout scrape phase. Phase plan is instantaneous; phase summarize uses existing ETA system.

# Appendix

## Files Affected
- `lib/segment-planner.ts` (new)
- `lib/pipeline-builder.ts` (modify)
- `entrypoints/sidepanel/composables/usePipeline.ts` (modify)
- `entrypoints/sidepanel/composables/useSummarize.ts` (major refactor — split `autoSummarizeDynamic`)
- `entrypoints/sidepanel/components/StepTimeline.vue` (minor — only if step `plan` label needed)
- `lib/types.ts` (if adding `lastScrapedPage` cache field)

## Code References
- `autoSummarizeDynamic` (`useSummarize.ts:1017-1181`)
- `runSummarizeJob` (`useSummarize.ts:688-783`)
- `segments` computed (`useSummarize.ts:78-95`)
- `usePipeline.reconcile` (`usePipeline.ts:24-82`)
- `buildSummarizePipeline` (`pipeline-builder.ts:19-40`)
- `computeResumeState` (`segment-planner.ts:63-118`)

## Decision Log
1. **Dynamic segment timeline approach**: 2-phase explicit (scrape all → plan deterministic → rebuild → summarize). Eliminates `.splice`/`reconcile` hacks entirely.
2. **Resume with 2-phase**: Persist posts + lastScrapedPage during scrape; resume = load cache + scrape missing pages + re-plan deterministic on full posts; only re-summarize segments with shifted boundaries.
3. **Fixed-mode scope**: Keep `buildSummarizePipeline` unchanged for fixed mode — no `plan` step needed. Don't unify builders artificially.
