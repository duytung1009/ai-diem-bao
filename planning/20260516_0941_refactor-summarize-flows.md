# Refactor — Hợp nhất 5 flow Summarize bài viết

## Overview

5 flow tóm tắt (summarize-single-segment, summarize-multi-segment, update-summary-no-segments, update-summary-segment-transition, update-summary-with-segments) hiện tách thành 6 hàm lớn đan xen trong `useSummarize.ts` (1377 dòng). Bản chất chỉ là **2 primitive** (tóm tắt 1 segment; reduce N summary → 1) + **3 biến thể input** (fresh/resume/force). Refactor để: diệt code chết, diệt duplication, hợp nhất control flow thành 1 driver duy nhất, và thống nhất cơ chế build pipeline (StepTimeline) cho mọi flow.

**Quyết định đã chốt (review xong):**
- Decision 1 → **Phương án A**: xoá hẳn đường incremental dead code.
- Decision 2 → module pure tách vào `lib/`; phần reactive vào `composables/`.
- Decision 3 → **triển khai R7** (hợp nhất driver) sau khi R2–R6 ổn định.
- **Mới:** thêm **R8** — thống nhất `buildSummarizePipeline` dựa trên `runSummarizeJob`, build pipeline 1 chỗ duy nhất (fix StepTimeline hiển thị không nhất quán cho cùng 1 flow).

Đây là **pure refactor**: không đổi hành vi người dùng, không đổi schema `CachedTopic`, message types, prompt content.

## Goals

- Xoá 100% dead code đường incremental (`updateSummary`, `summarizeIncremental`, taskType `summarize_incremental`, `INCREMENTAL_UPDATE_PROMPT`); 3 e2e test viết lại drive orchestration thật.
- `useSummarize.ts` giảm còn < ~600 dòng; logic pure tách sang `lib/` test được độc lập.
- Khối "save segment + update store + promotion" chỉ còn **1 bản** (hiện 2 bản đã drift).
- Stale-guard chỉ còn **1 helper** (hiện copy-paste ≥6 lần).
- Budget tính **1 nơi** với `responseBuffer` nhất quán (sửa bug `computeResumeState` thiếu `maxTokens`).
- 5 flow gom về **1 driver `runSummarizeJob`** + 2 primitive; 5 entry point UI thành wrapper mỏng.
- Pipeline (StepTimeline) build **1 chỗ duy nhất** từ boundary đã biết; cùng 1 flow luôn hiển thị step nhất quán; loại hack progressive-append `segmentIndex===1` và 3 chỗ deep-clone `JSON.parse(JSON.stringify())`.
- `npm run compile` + `npm run test` (full) xanh sau **mỗi** bước; số LLM call (`mock.getCallCount()`) là invariant trước/sau.

## Requirements

### Component A — Xoá dead code incremental (R1, Decision 1-A)

- Xoá `updateSummary()` khỏi `lib/llm/summarizer.ts` (L234–285).
- Xoá `summarizeIncremental()` + export khỏi `entrypoints/sidepanel/composables/useLLM.ts` (L177–179, L228).
- Xoá nhánh `case 'summarize_incremental'` trong `entrypoints/background/index.ts` (L318–323) + nhánh `buildPipeline('summarize_incremental')` (L264–265).
- Xoá `INCREMENTAL_UPDATE_PROMPT` khỏi `lib/prompts.ts` + import liên quan.
- Xoá taskType `'summarize_incremental'` khỏi `LLMTaskRequest` type (`lib/types.ts`).
- Viết lại 3 e2e: `tests/e2e/update-summary-no-segments.test.ts`, `update-summary-segment-transition.test.ts`, `update-summary-with-segments.test.ts` — drive orchestration thật (mock provider + mock `sendMessage`), KHÔNG gọi `updateSummary` trực tiếp. Assert `mock.getCallCount()` đúng số segment + reduce.
- Verify không còn reference `summarize_incremental`/`updateSummary`/`summarizeIncremental` (grep sạch toàn repo, trừ docs lịch sử).

### Component B — Run-guard helper (R3)

- Tạo `lib/run-guard.ts` (pure): `createRunGuard()` → `{ begin(): number; isStale(token: number): boolean }`. `begin()` bump counter nội bộ + trả token mới.
- `useSummarize.ts` thay `activeSummarizeId` bằng instance run-guard. `handleCancel` gọi `guard.begin()` để invalidate.
- `generateOverallSummary` **nhận token từ caller** (tham số), KHÔNG tự bump. Bỏ special-case clear `scrapeProgress`/`isScraping` trong `finally` của `handleAutoSummarizeAll`/`handleSegmentUpdate` (vốn workaround cho việc callee tự bump — xem comment L681–688).
- Đơn vị test: token tăng đơn điệu; `isStale` đúng với token cũ/mới.

### Component C — segmentPersistence pure module (R2, Decision 2)

- Tạo `lib/segment-persistence.ts` (pure, nhận deps qua tham số — KHÔNG import Vue/store):
  - `buildSegmentSavePayload(args): Partial<CachedTopic>` — **1 công thức `totalPosts` duy nhất** (chốt: dùng `Math.max(topic.totalPosts, segTotalPosts)` để không tụt khi forum có thêm post chưa scrape), 1 quy tắc single-segment promotion.
  - `makeDenseSegments(existing, segIndex, minLen)` — gộp `makeDenseBase`.
- `handleSummarizeSegment` (L466–575) và `summarizeAndSaveSegment` (L843–973) cùng gọi helper; xoá 2 bản code lặp. Field `complete` đưa vào payload thống nhất.
- Stale path: `if (guard.isStale(token)) { await save(buildSegmentSavePayload({...stale:true})); return; }` — dùng chung helper.
- Đơn vị test: snapshot payload cho 4 case (single fresh, single stale, multi fresh, multi stale) — byte-tương đương logic cũ.

### Component D — segmentPlanner pure module (R5, P8, Decision 2)

- Tạo `lib/segment-planner.ts` (pure):
  - `computeSegmentBudget(config): number` — chuẩn hoá `responseBuffer = Math.max(RESPONSE_BUFFER_TOKENS, config.maxTokens ?? 0)`. **Sửa bug:** `computeResumeState` cũ dùng `RESPONSE_BUFFER_TOKENS` trần (thiếu `maxTokens`).
  - `computeResumeState(segments, budget, config): DynamicResumeState | null` — chuyển từ `useSummarize` (L1003–1046), bỏ tính budget inline.
  - boundary math (segments fixed-mode L84–93) dùng chung.
- Dùng chung công thức với `summarizer.ts::calculateSegmentBudget` (không tái định nghĩa).
- Đơn vị test: budget nhất quán giữa `computeDynamicBudget`/`computeResumeState`; resume state đúng cho headroom >70% (segment mới) vs ≤70% (merge).

### Component E — useTopicScraper composable (R4)

- Tạo `entrypoints/sidepanel/composables/useTopicScraper.ts`: gói `scrapeRange`, vòng lặp page-by-page (lõi `autoSummarizeDynamic` phần scrape), news enrichment (`enrichWithNewsArticles`, `detectNewsThread`), xử lý `threadDeleted`/`threadLocked`, `scrapeAbortCtrl`, overall `scrapeProgress` accumulator.
- `useSummarize` tiêu thụ qua callback (onSegmentReady, onProgress). Giữ nguyên hành vi: 1 trang/scrape, jitter delay, accumulator seed từ resume.
- Giữ nguyên đảm bảo: không re-scrape nếu `existing.posts.length`, dedup re-scrape trang cuối (math L752–775) — thêm comment mức quyết định.

### Component F — usePipeline composable + thống nhất build (R6 + R8, yêu cầu mới)

- Tạo `entrypoints/sidepanel/composables/usePipeline.ts`: encapsulate build + sync→taskState (1 helper thay 3 chỗ deep-clone L501, L506, L884, L889).
- **R8 — build pipeline 1 chỗ duy nhất, lái bởi `runSummarizeJob`:**
  - `buildSummarizePipeline` nhận đầy đủ boundary đã biết tại thời điểm `runSummarizeJob` khởi động → build **toàn bộ step up-front**, không append từng cái.
  - Loại bỏ: inline pipeline build trong `handleSegmentUpdate` dynamic (L730–746), progressive-append + hack `if (segmentIndex === 1)` trong `summarizeAndSaveSegment` (L947–971).
  - Dynamic mode chưa biết số segment cuối: build placeholder theo budget ước lượng, rồi `pipeline.reconcile(actualSegments)` **1 lần** khi `autoSummarizeDynamic` chốt boundary — không mutate rải rác.
  - Mục tiêu: cùng 1 flow (vd update-summary-with-segments) luôn hiển thị StepTimeline step giống nhau bất kể đi qua nhánh nào.
- Đơn vị test: pipeline steps cho 5 flow ổn định, idempotent; reconcile không tạo step trùng/mất.

### Component G — Hợp nhất driver runSummarizeJob (R7, Decision 3)

- Định nghĩa 2 primitive trong `useSummarize`:
  - `summarizeOneSegment(index, posts, token)` — lõi `handleSummarizeSegment` phần LLM + persist (qua Component C).
  - `reduceOverall(token)` — lõi `generateOverallSummary` (short-circuit copy cho single-segment giữ nguyên — invariant `fix-single-segment-hub-status`).
- `runSummarizeJob({ mode: 'fresh'|'resume'|'force', range, resume? })` — driver duy nhất: build pipeline (Component F) → scrape (Component E) → `summarizeOneSegment` ×N → `reduceOverall`. Quản 1 token từ run-guard xuyên suốt.
- `computeResumeMode()` trả `{ mode, resume }` thay 5 nhánh lồng trong `handleSegmentUpdate` (L713–836).
- `handleAutoSummarizeAll`, `handleSegmentUpdate`, `handleSummarizeSegment`, `handleRetry` trở thành wrapper mỏng gọi `runSummarizeJob`. Backward-compat legacy topic (`loadTopicData` L313–324) giữ nguyên.

## Technical Considerations

- **Affected files:** `lib/llm/summarizer.ts`, `lib/prompts.ts`, `lib/types.ts`, `entrypoints/background/index.ts`, `entrypoints/sidepanel/composables/{useSummarize,useLLM}.ts`, `lib/pipeline-builder.ts`; mới: `lib/{run-guard,segment-persistence,segment-planner}.ts`, `composables/{useTopicScraper,usePipeline}.ts`; tests `tests/e2e/update-summary-*.test.ts`.
- **Dependency order:** R1 → R3 → R2 → R5 (R5 độc lập, có thể song song R2/R3) → R4 (cần R3,R5) → R6/R8 (cần R4) → R7 (cần tất cả).
- **Edge cases giữ nguyên:** legacy topic synthesize `segmentSummaries[0]`; single-segment promotion top-level `summary`; threadDeleted/threadLocked persist; resume dedup re-scrape trang cuối; news enrichment chỉ page/segment 0.
- **Constraints:** giữ fire-and-forget LLM (MV3 worker có thể bị kill); không đổi `SAVE_CACHED_TOPIC` payload (snapshot test bảo chứng); pure module trong `lib/` KHÔNG import Vue.
- **Risk cao:** R4 (nhiều side-effect scrape), R7 (đụng control flow 5 flow). R6/R8 trung. R1/R2/R3/R5 thấp–trung.

## Implementation Notes

- Mỗi Component (R) là 1 task; verify `npm run compile` + `npm run test` full sau mỗi task; KHÔNG gộp nhiều R vào 1 commit.
- **Trước R1:** viết characterization test cho 5 flow ở mức orchestration thật (lưới an toàn — test hiện tại test sai tầng).
- Invariant assert mỗi bước: `mock.getCallCount()` không đổi; snapshot `SAVE_CACHED_TOPIC` payload không đổi (trừ R2 chốt công thức `totalPosts` — ghi rõ delta dự kiến).
- R7/R8 chỉ làm sau khi R2–R6 review xanh; nếu interface 2 primitive chưa sạch sau R6 → dừng, báo `[DECISION_NEEDED]`.
- Tham chiếu Decision Log để hiểu lý do; gặp tình huống ngoài log → tag `[DECISION_NEEDED]` kèm reasoning, không tự đổi behavior.

## Test Plan

- Characterization test 5 flow (drive `handleSegmentUpdate`/`handleAutoSummarizeAll` qua mock provider + mock `sendMessage`) — viết trước R1, phải xanh trước và sau toàn bộ refactor.
- 3 e2e `update-summary-*.test.ts` viết lại: drive orchestration thật, assert số LLM call = số segment + (reduce nếu multi).
- Unit test mới: `run-guard` (token đơn điệu), `segment-persistence` (4 snapshot payload), `segment-planner` (budget nhất quán, resume headroom 70%).
- Pipeline test: 5 flow → StepTimeline steps ổn định/idempotent; reconcile không trùng/mất step.
- Thủ công: chạy thật 5 flow trên topic thật (1 trang, ~25 trang, ~234 trang) — quan sát StepTimeline nhất quán, post count đúng, "Đã tóm tắt" hiện đúng ở TopicHubView.

## Decision Log

### Quyết định 1: Số phận đường "incremental update"
- **Đã chọn:** **Phương án A** — xoá hẳn `updateSummary`/`summarizeIncremental`/`summarize_incremental`/`INCREMENTAL_UPDATE_PROMPT`, viết lại 3 e2e drive orchestration thật.
- **Lý do:** yêu cầu là pure refactor dễ maintain, không đổi behavior. Loại false-confidence test (test code người dùng không chạy). Giảm ~120 dòng, 1 cơ chế update duy nhất.
- **Đã cân nhắc loại:** Phương án B (wire incremental thật, chỉ scrape post mới) — loại vì là feature change trá hình (đổi behavior: không còn refresh segment cũ), rủi ro cao.
- **Điều kiện xem lại:** nếu update flow thành bottleneck tốc độ (topic lớn re-scrape mỗi lần "Cập nhật") → đưa B vào backlog feature riêng.

### Quyết định 2: Vị trí module
- **Đã chọn:** `run-guard`, `segment-persistence`, `segment-planner` → `lib/` (pure, deps qua tham số, test không cần Vue). `useTopicScraper`, `usePipeline` → `composables/` (giữ reactive ref).
- **Lý do:** pure logic test rẻ + ổn định; reactive scrape/pipeline cần ref.
- **Đã cân nhắc loại:** để tất cả trong composable — loại vì không test tầng pure độc lập, vẫn god-object.
- **Điều kiện thay đổi:** nếu `segment-planner` cần đọc reactive config trực tiếp → composable mỏng bọc lib pure.

### Quyết định 3: Triển khai R7 + R8
- **Đã chọn:** **Triển khai R7** (hợp nhất driver `runSummarizeJob`) + **R8** (thống nhất build pipeline qua driver).
- **Lý do:** lợi ích maintain lớn nhất — 5 flow về 1 driver, StepTimeline nhất quán. Pipeline rải rác hiện gây hiển thị không nhất quán cho cùng 1 flow.
- **Điều kiện làm R7/R8:** chỉ sau R2–R6 review xanh và interface 2 primitive sạch (5 wrapper chỉ khác resume input). Nếu chưa sạch → dừng, `[DECISION_NEEDED]`.
- **Đã cân nhắc loại:** dừng ở R6 — loại vì Tùng đã chốt làm R7 + thêm R8.
