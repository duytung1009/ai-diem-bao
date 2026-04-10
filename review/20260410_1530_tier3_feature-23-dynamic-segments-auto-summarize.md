# Review: Feature 23 — Dynamic Segments + Auto Summarize All

## Metadata
- **Files reviewed:** `lib/token-estimator.ts`, `lib/types.ts`, `lib/constants.ts`, `entrypoints/sidepanel/composables/useSummarize.ts`, `entrypoints/sidepanel/views/SummaryView.vue`, `entrypoints/sidepanel/views/SettingsView.vue`
- **Review tier:** tier3
- **Model used:** opus (upgraded from sonnet draft)
- **Diff size:** ~330 LOC across 6 files

## Checklist
| Category | Status | Notes |
|----------|--------|-------|
| Logic correctness | ❌ | `handleSegmentUpdate` broken trong dynamic mode; `handleCancel` không đủ cho auto-summarize |
| Edge cases covered | ❌ | Incomplete segment + new posts không xử lý; single-page overflow không xử lý; cancel mid-LLM mất segment |
| Error handling | ⚠️ | try/catch + stale guard tốt, nhưng LLM error giữa auto-summarize mất toàn bộ partial results |
| Performance concerns | ⚠️ | Scrape 1 trang/lần có concern nhỏ (xem #7) |
| Security implications | N/A | |
| Consistency with patterns | ✅ | `activeSummarizeId`, `saveTopic`, `makeDenseBase` pattern đúng |
| Type safety | ✅ | `complete?: boolean` backward-compatible, types chính xác |
| Test coverage | N/A | Không có test |

## Issues Found

| # | Severity | Category | Description | Suggestion |
|---|----------|----------|-------------|------------|
| 1 | **critical** | Logic | **`handleSegmentUpdate` không xử lý new pages trong dynamic mode.** Khi last segment `complete: false` và topic tăng pages (50→60), `segments.value` vẫn là cached dynamic boundaries `[{1-30},{31-50}]`. Loop so sánh `existing.endPage < seg.end` → cả hai bằng → `segmentsToProcess = []` → nhảy `generateOverallSummary()`. Pages 51-60 không bao giờ được scrape. **Đây là core use case của Decision 4 (append bài mới vào incomplete segment) nhưng hoàn toàn không được implement.** | Thêm logic đầu `handleSegmentUpdate` cho dynamic mode: nếu `newTotalPages > coveredEndPage`, scrape `coveredEndPage+1..newTotalPages`, append posts vào last segment, re-check budget (nếu vượt → tách segment mới), re-summarize affected segments. Không nên gọi `handleAutoSummarizeAll()` vì nó reset toàn bộ. |
| 2 | **major** | Logic | **`handleCancel` chỉ abort scrape, không cancel LLM task và không đặt `activeSummarizeId++` để invalidate auto-summarize.** Khi user click Cancel giữa `autoSummarizeDynamic`, nếu đang ở bước LLM (summarize segment N), `scrapeAbortCtrl` là `null` (đã cleanup), abort không có tác dụng. Flow sẽ chờ LLM xong rồi mới check `thisId !== activeSummarizeId` — nhưng `activeSummarizeId` chưa được tăng bởi `handleCancel`. Kết quả: **Cancel bị ignore khi đang chờ LLM.** | `handleCancel` cần `activeSummarizeId++` để invalidate current flow. Cân nhắc thêm `useLLM().cancelTask(llmTaskId)` nếu API hỗ trợ, hoặc ít nhất set `error.value` để `autoSummarizeDynamic` break sớm. |
| 3 | **major** | Architecture | **Reset `dynamicSegmentBoundaries = []` và `segmentSummaries = []` tại line 791-792 phá hủy partial results.** Scenario: auto-summarize chạy 3 segments, segment 4 bị LLM error → user sửa config → click "Tóm tắt toàn bộ" lại → segments 1-3 đã persisted trong IDB nhưng **UI state bị xóa sạch**, flow chạy lại toàn bộ từ trang 1 (re-scrape, re-LLM). **Tốn thời gian và token không cần thiết.** | Có 2 cách: (A) Không reset, bắt đầu dynamic từ `coveredEndPage + 1` (resume); (B) Sau reset, load lại từ IDB trước khi bắt đầu (`GET_CACHED_TOPIC`). Approach A tốt hơn vì tránh redundant LLM calls. Cần thêm tham số `resume: boolean` hoặc detect tự động. |
| 4 | **major** | Logic | **`loadTopicData` luôn restore `dynamicSegmentBoundaries` từ cache dù user có thể đang dùng fixed mode.** Line 250-254: nếu `fresh.segments` tồn tại → luôn populate `dynamicSegmentBoundaries`. Khi user chuyển từ dynamic → fixed mode, `segments` computed vẫn ưu tiên dynamic boundaries (vì `dynamicSegmentBoundaries.length > 0`). **Toggle dynamic off trong Settings không có hiệu lực nếu đã có cached dynamic segments.** | Chỉ restore `dynamicSegmentBoundaries` nếu `currentConfig.value?.dynamicSegments === true`. Tuy nhiên, tại thời điểm `loadTopicData` chạy, `currentConfig` có thể chưa loaded. Giải pháp: kiểm tra trong `segments` computed — nếu `dynamicSegments === false`, luôn dùng fixed logic bất kể `dynamicSegmentBoundaries`. Thực tế condition tại line 81 đã check `currentConfig.value?.dynamicSegments` nhưng tại line 250-254 vẫn nên guard. |
| 5 | minor | Logic | **`summarizeAndSaveSegment` không update `store.updateSelectedTopic` và `activeSegmentIndex`.** So sánh với `handleSummarizeSegment` (line 429-447), `summarizeAndSaveSegment` thiếu `store.updateSelectedTopic(...)` → topic store stale. Và `activeSegmentIndex` không set → UI không tự navigate đến segment vừa xong. | Thêm `store.updateSelectedTopic({ segments: updated })` sau save thành công. Set `activeSegmentIndex.value = segmentIndex` để UI hiển thị segment mới nhất. |
| 6 | minor | UX | **Nút "⚡ Tóm tắt toàn bộ" hiển thị segment count không chính xác khi dynamic mode bật nhưng chưa chạy.** `segments.value` fallback về fixed count. User thấy "5 phần" nhưng dynamic có thể tạo ra 3 hoặc 8. | Khi dynamic mode + chưa có boundaries: hiển thị `⚡ Tóm tắt toàn bộ` (không kèm count), hoặc thêm `~` prefix. |
| 7 | minor | Performance | **Scrape 1 trang/lần tạo overhead cho `scrapeRange`.** Mỗi lần gọi `scrapeRange(url, page, page)` tạo mới `AbortController` + set/clear `scrapeAbortCtrl` + emit `scrapeProgress` + clear nó. Đối với topic 500 trang, đó là 500 lần setup/teardown. Delay giữa mỗi trang vẫn dominate, nhưng state churn trên reactive refs (`isScraping`, `scrapeProgress`, `simpleLoadingText`) gây unnecessary re-renders. | Cân nhắc batch 5-10 trang/lần trong `autoSummarizeDynamic`, rồi iterate posts trong batch để detect boundary. `scrapePageRange` đã trả về tất cả posts sorted, chỉ cần estimate tokens per-post và cut khi vượt budget. Nếu boundary nằm giữa batch → tách posts, không cần page-level precision. |
| 8 | minor | UX | **Không có UI indicator cho segment `complete: false`.** Planning yêu cầu badge "chưa hoàn thiện" nhưng chưa implement. Tất cả segments đã summarize đều hiện dot xanh giống nhau. | Thêm dot khác (e.g. `bg-amber-400`) hoặc half-circle icon cho incomplete segment, kèm tooltip "Có thể có bài mới — sẽ cập nhật khi có thêm bài viết". |
| 9 | minor | Logic | **`customPromptsData?.summary` (line 786) — field tên `summary`, không phải `summaryPrompt`.** Nhìn `CustomPrompts` interface: field là `summary?: string`. Đúng rồi — nhưng cần verify rằng đây thực sự là prompt text, không phải tên/ID. | Verified OK. `CustomPrompts.summary` chứa prompt text. Không cần fix, nhưng naming hơi ambiguous. |
| 10 | nit | Code | **`[DECISION_NEEDED]` tag ở line 690-692** gây ấn tượng decision chưa finalize dù comment đã giải thích rõ lý do. | Đổi thành comment thường hoặc `[DECISION: ...]`. |

## Architecture Analysis (Opus-specific)

### 1. Dynamic boundaries là mutable state trùng lắp với segments trong IDB

`dynamicSegmentBoundaries` (UI ref) và `CachedTopic.segments[].startPage/endPage` (IDB) lưu cùng thông tin. Khi restore từ cache (line 250-254), chúng được sync. Nhưng khi flow chạy (auto-summarize), chỉ `dynamicSegmentBoundaries` được update reactively (line 625-628), còn IDB chỉ update sau khi LLM xong. Nếu browser crash giữa chừng, `dynamicSegmentBoundaries` mất nhưng IDB có partial data → trạng thái inconsistent.

**Không cần fix ngay** — hiện tại `loadTopicData` đã restore từ IDB. Nhưng cần lưu ý khi thêm resume logic (#3).

### 2. `handleSegmentUpdate` cần refactor cho dynamic mode

`handleSegmentUpdate` hiện tại assume fixed segments (boundaries update khi `pageCount` thay đổi vì `segments` computed recalculates). Với dynamic mode, boundaries là frozen sau auto-summarize. Cần một chiến lược rõ ràng:

**Đề xuất:** Tách `handleSegmentUpdate` thành 2 path:
- **Fixed mode:** giữ nguyên logic hiện tại (segments computed tự mở rộng khi `pageCount` tăng)
- **Dynamic mode:** detect new pages qua `lastSeg.endPage < newTotalPages`, scrape new pages, append vào last segment (nếu `complete === false` && budget cho phép) hoặc tạo segment mới, re-summarize affected, rồi regenerate overall

### 3. Cancel flow cần state machine hoặc `isAutoSummarizing` flag

Hiện tại không phân biệt "cancel single segment" vs "cancel auto-summarize all". `handleCancel` chỉ abort HTTP requests, không invalidate orchestration loop. Cần ít nhất:
- `activeSummarizeId++` trong `handleCancel` (invalidate mọi running flow)
- Hoặc `isAutoSummarizing` ref để phân biệt context

## Summary
- **Overall:** request-changes
- **Key concerns:**
  1. `handleSegmentUpdate` hoàn toàn broken trong dynamic mode — core feature (Decision 4: append new posts) chưa được implement
  2. Cancel không hoạt động khi đang chờ LLM call
  3. Re-run auto-summarize phá hủy partial results đã cached

## Fix Priority
1. **#1 (critical)** — `handleSegmentUpdate` cho dynamic mode
2. **#2 (major)** — `handleCancel` invalidation
3. **#3 (major)** — Resume thay vì re-run
4. **#4 (major)** — Dynamic boundaries restoration khi toggle off
5. **#5-8 (minor)** — UX polish
