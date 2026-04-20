# Bug fix: scrapeProgress loading bar không hoạt động + ETA chỉ tính theo segment

## Metadata
- **Type:** bug fix
- **Severity:** major (UX regression)
- **Tier:** tier2 (Standard)
- **Model used:** opus (planning + implement)
- **Files touched:** 2
- **LOC changed:** ~60 LOC
- **Regression from:** commit `8702bc9` "Implement Feature 22" (thực chất là Feature 23 — dynamic segments auto-summarize)

## Triệu chứng

Sau khi triển khai Feature 23 (dynamic segments auto-summarize), ở tab **Tóm tắt** khi chạy "Tóm tắt toàn bộ":

1. **Progress bar biến mất** — loading chỉ còn text, không còn thanh tiến độ.
2. **ETA sai ngữ cảnh** — thời gian ước tính hoàn thành chỉ phản ánh segment hiện tại (ví dụ "~4 phút 2s" cho riêng phần 47), không phải tổng thể task.

Screenshot từ user: topic 659 trang, đang tóm tắt phần 47 (trang 231–235), ETA hiển thị ~4 phút 2s (thời gian của 1 segment LLM call).

## Root cause

`autoSummarizeDynamic` trong `entrypoints/sidepanel/composables/useSummarize.ts` scrape **1 trang 1 lần** để phát hiện ranh giới segment chính xác theo token budget. Mỗi vòng lặp gọi:

```ts
scrapeRange(topicUrl, page, page, delayMs)
```

`scrapeRange` là wrapper quanh `scrapePageRange` và cài một progress callback nội bộ:

```ts
(current, _total, postsScraped) => {
  scrapeProgress.value = {
    currentPage: startPage + current - 1,
    totalPages: endPage,             // = page (vì startPage === endPage)
    postsScraped,
  };
}
```

Hệ quả:
- Với range 1 trang: `currentPage === totalPages === page` → `scrapeProgressPercent = 100%` ngay lập tức, vô nghĩa.
- Ngay sau `scrapeRange`, code gán `scrapeProgress.value = null` → progress bar biến mất hoàn toàn.
- Bước tiếp theo `summarizeAndSaveSegment` chỉ set `simpleLoadingText` + `llmTaskId`. `ProgressIndicator` rơi vào nhánh `llmProgressPercent` / `llmEta` → chỉ tính theo single-pass summarize của **segment hiện tại** (dùng `task.estimatedTotalMs`).

Trước F23, flow cũ scrape nguyên 1 đoạn nhiều trang một lần → `scrapeProgress` có range thật, progress bar hoạt động đúng. Regression đến từ việc F23 chuyển sang scrape-per-page nhưng vẫn dùng `scrapeRange` nguyên bản.

Ngoài ra, `ProgressIndicator.displayMessage` hiện tại ưu tiên `scrapeProgress` default message hơn `props.message`. Nếu ta giữ `scrapeProgress` sống xuyên suốt cả phase LLM, message "Đang đọc trang X/Y..." sẽ nuốt mất "Đang tóm tắt phần X..." → cần đổi thứ tự ưu tiên.

## Giải pháp

**Ý tưởng:** Giữ `scrapeProgress` phản ánh tiến độ **toàn topic** (`currentPage` = trang đang scrape trong tổng `totalPages` của topic, `postsScraped` = tích lũy) liên tục qua **cả scrape phase lẫn LLM phase** bên trong `autoSummarizeDynamic`. Progress bar và ETA sẽ bám vào metric này.

Khi đó:
- Bar hiển thị `page / totalTopicPages` (ví dụ 47/659 ≈ 7%).
- ETA từ `scrapeEta`: `remainingPages × (delayMs + PAGE_LOAD_MS)` — phản ánh remaining time cho toàn bộ scrape work còn lại (bao trùm cả task, vì scrape delay là dominant cost).
- Trong lúc LLM đang summarize một segment, `simpleLoadingText = "Đang tóm tắt phần X..."` vẫn hiển thị ở text area còn bar đứng yên ở trang gần nhất đã scrape — cho cảm giác đúng về scope toàn task.

### 3 edit

#### Edit 1 — `ProgressIndicator.vue`: đổi ưu tiên `displayMessage`

`props.message` (explicit) thắng `scrapeProgress` default:

```ts
const displayMessage = computed(() => {
  // Explicit message wins over scrape default.
  if (props.message) return props.message;
  if (props.scrapeProgress) {
    const p = props.scrapeProgress;
    return `Đang đọc trang ${p.currentPage}/${p.totalPages} (${p.postsScraped} bài)...`;
  }
  return task.value?.progress?.message || props.fallbackMessage || 'Đang xử lý...';
});
```

Lý do: để trong autoSummarizeDynamic khi LLM đang chạy, `simpleLoadingText = "Đang tóm tắt phần X..."` hiển thị đúng text mà bar vẫn dùng `scrapeProgress` (overall page progress).

#### Edit 2 — `useSummarize.ts::autoSummarizeDynamic`: quản lý overall `scrapeProgress`

- Gọi `scrapePageRange` trực tiếp (không qua wrapper `scrapeRange`) để progress callback nội bộ không clobber state.
- Maintain `scrapeProgress = {currentPage: page, totalPages: topicTotalPages, postsScraped: totalPostsScraped}` trước và sau mỗi lần scrape 1 page.
- **Không** clear `scrapeProgress` khi chuyển sang phase LLM → bar tiếp tục bám trang cuối cùng đã scrape.
- `totalPostsScraped` accumulator khởi tạo từ `resume.pendingPosts.length` + sum posts của các segment đã complete trước `segmentIndex` (cho trường hợp resume partial run).
- Tự quản lý `scrapeAbortCtrl` (vì không qua `scrapeRange`) để `handleCancel` vẫn abort được.
- Xoá line `simpleLoadingText = 'Đang đọc trang ${page} / ${totalPages}...'` cũ — default message của `scrapeProgress` chi tiết hơn.

```ts
async function autoSummarizeDynamic(
  topicUrl, totalPages, budgetTokens, thisId, resume?,
): Promise<void> {
  let segmentIndex = resume?.segmentIndex ?? 0;
  let pendingPosts = resume?.pendingPosts ? [...resume.pendingPosts] : [];
  let pendingTokens = resume?.pendingTokens ?? 0;
  let pendingStartPage = resume?.pendingStartPage ?? 1;
  const startPage = resume?.fromPage ?? 1;

  const version = topicInfo.value?.version;
  if (!version || version === 'unknown') throw new Error('Không xác định được phiên bản diễn đàn.');

  // Overall accumulator — drives a single topic-wide scrapeProgress that stays
  // set across both scrape and LLM phases so bar+ETA reflect whole task.
  let totalPostsScraped = pendingPosts.length;
  for (let i = 0; i < segmentIndex; i++) {
    const seg = segmentSummaries.value[i];
    if (seg?.posts) totalPostsScraped += seg.posts.length;
  }

  const delayMs = currentConfig.value?.scrapeDelayMs ?? 2000;

  for (let page = startPage; page <= totalPages; page++) {
    if (thisId !== activeSummarizeId) return;

    isScraping.value = true;
    scrapeProgress.value = { currentPage: page, totalPages, postsScraped: totalPostsScraped };

    // Call scrapePageRange directly so the per-range callback in scrapeRange()
    // can't clobber our overall scrapeProgress with a meaningless 1/1 each page.
    scrapeAbortCtrl = new AbortController();
    const signal = scrapeAbortCtrl.signal;
    let pagePosts: ScrapedPost[];
    let pageErrors: string[];
    try {
      const result = await scrapePageRange(
        version as XenForoVersion, topicUrl, page, page, undefined, signal, delayMs,
      );
      if (signal.aborted) throw new DOMException('Scraping cancelled', 'AbortError');
      pagePosts = result.posts;
      pageErrors = result.errors;
    } finally {
      scrapeAbortCtrl = null;
    }
    isScraping.value = false;

    if (pageErrors.length) scrapingWarnings.value.push(...pageErrors);
    if (thisId !== activeSummarizeId) return;

    // News enrichment for page 1 only (giữ nguyên như cũ)
    let enrichedPosts = pagePosts;
    if (page === 1) {
      enrichedPosts = await enrichWithNewsArticles(/* ... */);
      if (enrichedPosts.some(p => p.postNumber < 0) && cachedTopic.value) {
        cachedTopic.value = { ...cachedTopic.value, topicType: 'news' };
        store.updateSelectedTopic({ topicType: 'news' });
      }
      simpleLoadingText.value = '';
    }

    totalPostsScraped += enrichedPosts.length;
    scrapeProgress.value = { currentPage: page, totalPages, postsScraped: totalPostsScraped };

    const pageTokens = /* ... */;

    // Budget overflow → finalize segment. scrapeProgress không bị clear →
    // bar giữ nguyên overall progress trong suốt summarize phase.
    if (pendingTokens + pageTokens > budgetTokens && pendingPosts.length > 0) {
      await summarizeAndSaveSegment(segmentIndex, pendingStartPage, page - 1, pendingPosts, false, thisId);
      if (error.value || thisId !== activeSummarizeId) return;
      segmentIndex++;
      pendingPosts = [];
      pendingTokens = 0;
      pendingStartPage = page;
    }

    pendingPosts.push(...enrichedPosts);
    pendingTokens += pageTokens;
  }

  if (pendingPosts.length > 0 && thisId === activeSummarizeId) {
    const isIncomplete = pendingTokens < budgetTokens;
    await summarizeAndSaveSegment(segmentIndex, pendingStartPage, totalPages, pendingPosts, isIncomplete, thisId);
  }
}
```

Việc clear `scrapeProgress` cuối cùng vẫn do `handleAutoSummarizeAll.finally` / catch / `handleCancel` đảm nhiệm (chưa đụng).

#### Edit 3 — `useSummarize.ts::handleSummarizeSegment`: xoá line `simpleLoadingText` thừa

Sau Edit 1, nếu single-segment flow vẫn set `simpleLoadingText = 'Đang đọc ${seg.label}...'`, text này sẽ thắng cái default chi tiết của scrapeProgress → UX kém hơn trước. Xoá line đó đi, để default message "Đang đọc trang X/Y (Z bài)..." hiển thị trong suốt scrape phase.

```ts
// Trước:
isScraping.value = true;
simpleLoadingText.value = `Đang đọc ${seg.label}...`;
const { posts: scraped, errors } = await scrapeRange(...);
isScraping.value = false;
scrapeProgress.value = null;
simpleLoadingText.value = '';

// Sau:
isScraping.value = true;
// Let scrapeProgress's default message drive the display during scrape.
const { posts: scraped, errors } = await scrapeRange(...);
isScraping.value = false;
scrapeProgress.value = null;
```

## Decision Log

### Quyết định 1: Overall scrapeProgress xuyên suốt scrape+LLM phase, không introduce state mới

- **Đã chọn:** Giữ `scrapeProgress` hiện tại, nạp overall metric vào nó, giữ set liên tục qua cả LLM phase.
- **Lý do:** `ProgressIndicator` + `SummaryView` đã bind `scrapeProgress`. Không phải thêm prop/ref mới, không đụng layer UI. Một metric duy nhất cho toàn task.
- **Đã cân nhắc nhưng loại:**
  - **Thêm ref `taskProgress` riêng** — loại vì phình state, ProgressIndicator phải thêm prop + merge logic phức tạp, không đem lại lợi ích so với reuse `scrapeProgress`.
  - **Mỗi iteration cho scrapeProgress chạy từ 0→100% trong range 1 trang** — loại vì visually flicker, không cho cảm giác overall.
  - **Chuyển hoàn toàn sang llmTaskId-based progress với map-reduce task API** — loại vì sẽ phải refactor `useLLM` task API để support multi-segment task với step count, quá scope cho 1 bug fix.
- **Điều kiện thay đổi:** Nếu sau này LLM phase thực sự dài hơn scrape phase (ví dụ model local rất chậm) → ETA dựa trên page sẽ sai lệch; lúc đó nên introduce per-phase weight hoặc map-reduce task wrapper.

### Quyết định 2: Gọi `scrapePageRange` trực tiếp thay vì refactor `scrapeRange`

- **Đã chọn:** Inline `scrapePageRange` call trong `autoSummarizeDynamic` + tự quản lý `scrapeAbortCtrl`.
- **Lý do:** `scrapeRange` được share với `handleSummarizeSegment` (single segment, multi-page) — ở đó progress callback nội bộ là đúng. Không muốn thêm flag/param chỉ để turn off callback cho 1 call site.
- **Đã cân nhắc nhưng loại:**
  - **Thêm param `onProgress?` cho `scrapeRange`** — loại vì cả 2 call site hiện tại đều có logic riêng, API bloat không đáng.
  - **Duplicate `scrapeRange` thành `scrapeRangeNoProgress`** — loại vì duplicate code.
- **Điều kiện thay đổi:** Nếu có call site thứ 3 cũng cần tắt progress callback → refactor thành optional param.

### Quyết định 3: `props.message` thắng `scrapeProgress` default trong `ProgressIndicator.displayMessage`

- **Đã chọn:** Đổi thứ tự ưu tiên: explicit `props.message` trước scrape default.
- **Lý do:** Cần cơ chế cho caller override text khi scrape đã "đứng" (LLM phase) mà vẫn muốn giữ bar. Explicit override là pattern chuẩn.
- **Đã cân nhắc nhưng loại:**
  - **Thêm prop `messageOverride`** — loại vì semantics trùng `message`, tránh 2 prop cho cùng mục đích.
  - **Clear scrapeProgress trong LLM phase** — loại vì chính là cái gây bug ban đầu.
- **Side effect:** `handleSummarizeSegment` từng set `simpleLoadingText = 'Đang đọc ${seg.label}...'` trong scrape phase. Với priority mới, text đó sẽ thắng scrape default → mất "Đang đọc trang X/Y". → xử lý bằng Edit 3 (xoá line set).

### Quyết định 4: ETA công thức giữ nguyên `remainingPages × msPerPage`, không cộng thời gian LLM

- **Đã chọn:** Giữ `scrapeEta` hiện tại trong `ProgressIndicator`.
- **Lý do:** Scrape delay (2000ms + PAGE_LOAD_MS ≈ 2500ms/trang) là dominant cost cho topic dài. LLM time per segment ~30–120s, segment ~20–50 pages → LLM share chỉ ~10–20% tổng time. ETA approximate này vẫn hơn "per-segment ETA" hiện tại rất xa.
- **Đã cân nhắc nhưng loại:**
  - **Tracking avgSecPerSegmentLLM và cộng vào** — loại vì cần state + heuristic phức tạp cho mức cải thiện nhỏ.
- **Điều kiện thay đổi:** Nếu user complain ETA lệch nhiều với model chậm → thêm LLM time estimate.

## Implementation steps (ordered)

1. Sửa `ProgressIndicator.vue::displayMessage` — đổi ưu tiên `props.message` lên trước scrape default (Edit 1).
2. Sửa `useSummarize.ts::autoSummarizeDynamic` — inline `scrapePageRange`, maintain overall `scrapeProgress`, tự quản `scrapeAbortCtrl`, xoá `simpleLoadingText` cũ của scrape phase (Edit 2).
3. Sửa `useSummarize.ts::handleSummarizeSegment` — xoá `simpleLoadingText = 'Đang đọc ${seg.label}...'` trong scrape phase (Edit 3).
4. `npx vue-tsc --noEmit`.
5. `npm run build`.
6. Smoke test manually trong Chrome extension:
   - Topic dài (>100 trang), dynamic mode bật, click "Tóm tắt toàn bộ" → bar tăng từ 0 → 100%, text alternating giữa "Đang đọc trang X/Y (Z bài)" và "Đang tóm tắt phần N...", ETA giảm dần theo tổng pages.
   - Topic ngắn 1 segment, click "Tóm tắt" → bar vẫn hoạt động bình thường (không regression single-segment flow).
   - Click "Huỷ" giữa scrape → abort đúng.
   - Resume: chạy nửa chừng huỷ, click lại "Tóm tắt toàn bộ" → resume từ segment cũ, `totalPostsScraped` bắt đầu từ posts đã scrape.

## Edge cases

- **Resume partial run:** `totalPostsScraped` phải cộng dồn từ các segment đã complete + `resume.pendingPosts`. Đã xử lý trong Edit 2.
- **Abort giữa scrape:** `scrapeAbortCtrl` tự quản trong try/finally, `handleCancel` vẫn gọi `scrapeAbortCtrl?.abort()` như cũ.
- **Single-page topic:** vòng lặp chạy 1 lần, bar nhảy 0→100 rồi chuyển sang LLM phase với bar ở 100%. OK.
- **News enrichment page 1:** `simpleLoadingText` được set tạm bởi `enrichWithNewsArticles` callback — với priority mới, text này thắng scrape default trong lúc enrich, xong thì được clear → trở lại scrape default. Đúng ý.
- **Sau khi autoSummarizeDynamic return, generateOverallSummary chạy:** `scrapeProgress` còn ở `{currentPage: totalPages, totalPages, ...}` → bar 100%, `scrapeEta` return null (remainingPages ≤ 0), `simpleLoadingText = 'Đang tạo tóm tắt tổng quan...'` hiển thị, không có ETA. OK (reducer thường nhanh).
- **`handleSegmentUpdate` dynamic branch** cũng gọi `autoSummarizeDynamic` → tự động hưởng fix.

## Test plan

- [x] `npx vue-tsc --noEmit` pass
- [x] `npm run build` pass
- [ ] Manual smoke test (Chrome extension) — giao cho user

## Rollback plan

`git revert` commit này. 3 edit đều ở 2 file duy nhất, không đụng schema/cache/messaging — rollback an toàn.

## Self-review Results

- **Issues found:** 1 (regression risk cho single-segment flow do Edit 1)
- **Issues fixed:** 1 (Edit 3 xoá `simpleLoadingText` thừa trong `handleSummarizeSegment` để giữ UX "Đang đọc trang X/Y")
- **Remaining:** 0

### Checklist nội bộ
- Logic correctness: ✅ overall progress formula đúng, resume accumulator đúng
- Edge cases: ✅ resume, abort, single-page, news enrichment, overall summary phase
- Error handling: ✅ abort controller tự quản trong try/finally, throw version error giữ nguyên
- Consistency: ✅ dùng cùng signature `scrapePageRange` như chỗ khác trong codebase
- Type safety: ✅ type-check pass
- Scope: ✅ chỉ touch 2 file, không đụng phần không liên quan

## Files changed

- `entrypoints/sidepanel/components/ProgressIndicator.vue` — đổi priority `displayMessage`.
- `entrypoints/sidepanel/composables/useSummarize.ts` — refactor `autoSummarizeDynamic` + xoá `simpleLoadingText` thừa trong `handleSummarizeSegment` + Follow-up Edit 4 (xem dưới).

## Follow-up: stuck loading sau khi tóm tắt xong (multi-segment)

### Triệu chứng
Sau khi "Tóm tắt toàn bộ" hoàn thành (multi-segment), màn hình Tóm tắt kẹt ở trạng thái loading. Phải switch tab rồi quay lại mới thấy kết quả.

### Root cause
Latent bug trước đây bị che bởi việc `autoSummarizeDynamic` cũ clear `scrapeProgress` inline sau mỗi trang. Sau Edit 2 (giữ `scrapeProgress` xuyên suốt), bug lộ ra.

`generateOverallSummary` tại line 516 làm `const thisId = ++activeSummarizeId;` — **bump counter**. Khi `handleAutoSummarizeAll` chain:

```ts
const thisId = ++activeSummarizeId;            // say 5
await autoSummarizeDynamic(..., thisId);        // activeSummarizeId vẫn 5
await generateOverallSummary();                 // bump → 6
// ...
} finally {
  if (thisId === activeSummarizeId) {           // 5 !== 6 → FALSE
    scrapeProgress.value = null;                // NEVER RUNS
    isScraping.value = false;                   // NEVER RUNS
    // ...
  }
}
```

→ `scrapeProgress` không được clear → `isProcessing = true` → `ProgressIndicator` kẹt hiển thị.

`generateOverallSummary.finally` của chính nó chỉ clear `simpleLoadingText` + `llmTaskId`, không đụng `scrapeProgress`/`isScraping`, nên state `scrapeProgress` bị kẹt.

Khi user switch sang topic khác và quay lại, `loadTopicData()` reset toàn bộ state → hết kẹt.

### Fix — Edit 4: clear `scrapeProgress`/`isScraping` trong `generateOverallSummary.finally`

```ts
} finally {
  store.setSummarizing(null);
  if (thisId === activeSummarizeId) {
    simpleLoadingText.value = '';
    llmTaskId.value = null;
    // Also clear scrapeProgress/isScraping in case we were called from
    // handleAutoSummarizeAll, where autoSummarizeDynamic keeps scrapeProgress
    // set across phases. handleAutoSummarizeAll's own finally can't clear it
    // because generateOverallSummary bumps activeSummarizeId (stale guard).
    isScraping.value = false;
    scrapeProgress.value = null;
  }
}
```

### Lý do không sửa theo hướng khác

- **Truyền `thisId` vào `generateOverallSummary` thay vì bump counter mới:** thay đổi contract của function, ảnh hưởng cả nhánh `handleSegmentUpdate` và call trực tiếp từ button "Tạo lại tóm tắt tổng quan". Phức tạp hơn, dễ sót case.
- **Bỏ stale guard trong handleAutoSummarizeAll's finally:** rủi ro race với user cancel + start lại.
- **Clear ở nơi gọi (handleAutoSummarizeAll sau `await generateOverallSummary`):** cleanup bị scatter, dễ quên trong `handleSegmentUpdate`.

Clear trong `generateOverallSummary.finally` là nơi duy nhất đảm bảo mọi entry point (multi-segment LLM path) đều sạch state. Single-segment path (early return ở line 513) không bump counter nên `handleAutoSummarizeAll.finally` vẫn match → tự clear được, không cần đụng.

### Edge case check
- **Cancel giữa overall summary:** `handleCancel` bump counter → `generateOverallSummary.finally` stale guard fail → cleanup skipped, nhưng `handleCancel` tự clear `scrapeProgress`. OK.
- **`generateOverallSummary` gọi trực tiếp từ button:** lúc đó `scrapeProgress` đã null rồi, clear lại cũng không hại.
- **`handleSegmentUpdate` dynamic branch:** cùng pattern `autoSummarizeDynamic` → `generateOverallSummary`, fix này cũng chữa luôn.
- **Single-segment path** (completedSegments.length === 1, return ở line 513): không vào try/finally → scrapeProgress không clear ở đây. Nhưng counter cũng không bump → `handleAutoSummarizeAll.finally` vẫn match và clear được. OK.
- **autoSummarizeDynamic throw:** không vào generateOverallSummary → `handleAutoSummarizeAll.catch` clear `scrapeProgress` + `isScraping`. OK.

### Test plan follow-up
- [x] `vue-tsc --noEmit` pass
- [ ] Manual: chạy "Tóm tắt toàn bộ" multi-segment đến hết → màn hình tự refresh sang state đã tóm tắt, không cần switch tab.
- [ ] Manual: chạy "Tóm tắt toàn bộ" single-segment → vẫn hoạt động đúng.
- [ ] Manual: chạy "Cập nhật" (handleSegmentUpdate) dynamic branch → không kẹt loading.
- [ ] Manual: cancel giữa overall summary → state sạch.
