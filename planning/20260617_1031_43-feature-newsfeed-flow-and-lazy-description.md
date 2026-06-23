# F43 — Cải thiện Tab Điểm báo: flow chọn thớt + mô tả LLM lazy

## Overview

Tab **Điểm báo** (`/newsfeed`, `NewsFeedView.vue`) lấy danh sách thớt từ một forum, lọc 24h,
chấm điểm (`lib/hot-threads.ts`) và hiển thị top 10 thớt nóng (🔥/⚡). Đây là điểm khám phá nội dung
chính của extension, nhưng hiện đang **dead-end vào việc mở tab forum** thay vì dẫn tới giá trị cốt lõi
là *tóm tắt LLM*.

**Vấn đề flow hiện tại** ([`openThread()`](entrypoints/sidepanel/views/NewsFeedView.vue:24)):
click 1 thớt → mở tab trình duyệt mới **và** đẩy sidepanel về `/` (Hub). Tại Hub, `App.vue`
detect tab vừa mở → hiện card "Tab hiện tại" → user phải **click lần nữa** vào card mới sang
`/summary`, rồi bấm tóm tắt. Tổng cộng 4–5 bước + 2 lần nhảy ngữ cảnh, và việc nhảy khỏi Điểm báo
làm mất danh sách thớt đang xem.

F43 gồm 2 phần:

- **Phần A — Redesign flow chọn thớt:** giữ hành vi mở tab forum nhưng **đồng thời** chọn topic và
  vào thẳng `/summary` trong 1 lần click, bỏ bước nhảy về Hub + click card lần 2.
- **Phần B — Mô tả LLM lazy:** thêm affordance mở rộng (expand) trên card thớt; khi user mở 1 thớt,
  fetch bài #1 và sinh mô tả ngắn 1–2 câu bằng LLM, **cache lại**. Không tạo hàng loạt (eager) cho cả
  top-10 để tôn trọng cost-guard (F26).

## Goals

- Rút flow "thấy thớt nóng → tóm tắt" từ 4–5 bước xuống còn **1 click** dẫn thẳng vào `/summary`.
- Không phá live-detection: vẫn mở tab forum để `App.vue` backfill version/postCount/title chính xác.
- Cho user xem mô tả ngắn để quyết định trước khi tóm tắt, **mà không tốn LLM cho thớt không quan tâm**.
- Mô tả LLM chỉ chạy khi user chủ động mở 1 thớt; có cache để lần mở sau không gọi lại.
- Degrade an toàn: không có provider / fetch lỗi / LLM lỗi đều không chặn flow A.
- Không đổi thuật toán chấm điểm `scoreThreads`, không đổi cost-bound các luồng hiện có.

## Non-Goals

- Không sinh mô tả eager cho cả top-10 (đã loại ở Decision Log).
- Không auto-start LLM tóm tắt khi vừa land `/summary` (giữ cost-guard — user vẫn bấm "Tóm tắt").
- Không đổi `DEFAULT_WEIGHTS`/`DEFAULT_THRESHOLDS`/logic lọc 24h.
- Không thêm auto-refresh Điểm báo.

## Requirements

### Phần A — Flow chọn thớt (`NewsFeedView.vue`)

- Thay [`openThread(url)`](entrypoints/sidepanel/views/NewsFeedView.vue:24) bằng `selectAndSummarize(item: HotThreadScore)`:
  1. Mở tab forum: `browser.tabs.create({ url, active: true })` (giữ active để App.vue detect được).
  2. Dựng **minimal `CachedTopic`** từ `item.thread` (mượn pattern
     [`handleActiveTabTopic`](entrypoints/sidepanel/views/TopicHubView.vue:234)):
     `{ url, title, version, posts: [], summary: '', llmConfig: { provider:'', model:'' }, cachedAt: 0,
     lastPostNumber: 0, totalPosts: thread.replyCount + 1, totalPages: thread.pageCount }`.
  3. `store.selectTopic(minimalTopic)` rồi `router.push('/summary')`.
- **Không** còn `router.push('/')`. Danh sách Điểm báo được `keep-alive` nên khi user back lại tab
  Điểm báo, danh sách vẫn còn.
- `SummaryView.loadTopicData()` sẽ scrape theo `selectedTopic.url` qua `scrapePageRange` (đường fetch
  theo URL, không cần tab active — F18). App.vue `detectActiveTabTopic` đồng thời backfill metadata
  chính xác từ tab vừa mở.
- Giữ một action **phụ** "Mở trên forum" nếu cần (không bắt buộc — tab đã được mở ở bước 1).

### Phần A — Version cho minimal topic

- `scrapeForumList` đã phân biệt XF2 (`.structItem--thread`) vs XF1 (`.discussionListItem`) ở cấp
  document. Cần truyền version này xuống từng thread để dựng minimal topic ngay (tránh cửa sổ
  `version` rỗng trước khi App.vue detect xong).
- Cách làm: thêm field optional `version?: XenForoVersion` vào `ForumThreadSummary`
  ([`lib/types.ts:49`](lib/types.ts:49)) và gán trong `scrapeXf1`/`scrapeXf2`. NewsFeedView dùng
  `item.thread.version ?? 'unknown'` khi dựng minimal topic; App.vue sẽ sửa lại nếu lệch.

### Phần B — Mô tả LLM lazy

**UI (`NewsFeedView.vue`):**
- Mỗi card thớt thêm nút mở rộng (chevron). Click expand:
  - Nếu đã có mô tả cache → hiện ngay.
  - Nếu chưa → hiện spinner + gọi `FETCH_THREAD_DESCRIPTION`, render kết quả 1–2 câu.
- State per-thread: `descState: Record<url, { loading, text?, error? }>` (hoặc map riêng).
- Expand **không** trigger flow A (mở tab/summary). Hai action tách bạch: click thân card = tóm tắt;
  click chevron = xem mô tả.
- Lỗi LLM/fetch → inline message + nút "Thử lại"; không chặn các card khác.
- Nếu chưa cấu hình provider LLM → hiện hint "Cấu hình LLM trong Cài đặt" thay vì gọi.

**Orchestration ở sidepanel (KHÔNG nhồi scrape/parse vào background):**
- Mô tả được điều phối từ `NewsFeedView` (expand 1 thớt):
  1. `GET_THREAD_DESCRIPTION` (message) → check cache; hit & còn hạn → hiện ngay (`cached: true`).
  2. Miss → `scrapePageRange(version, url, 1, 1)` ở **sidepanel** lấy bài đầu (post có `postNumber`
     nhỏ nhất, bỏ article post `postNumber < 0`). `scrapePageRange` đã gửi `FETCH_HTML` xuống
     background để fetch, rồi parse `DOMParser` ở sidepanel — tái dùng, **không** tự gọi FETCH_HTML +
     parse thủ công.
  3. `describeThreadTask(firstPost)` → **đi qua `START_LLM_TASK`** (xem dưới). Chỉ truyền **đúng 1 post**
     để tiết kiệm token.
  4. `SAVE_THREAD_DESCRIPTION` (message) → lưu cache.

**LLM qua pipeline `START_LLM_TASK` (nhất quán log/stats/cancel):**
- `lib/types.ts`: thêm `'describe_thread'` vào union `LLMTaskRequest['taskType']`.
- `useLLM.ts`: wrapper `describeThreadTask(post)` = `createTask('describe_thread', { post })`; UI `await result`
  (đọc như request/response). Optional: nhánh `estimateETA` cho payload `{ post }`.
- `entrypoints/background/index.ts`:
  - `buildPipeline`: thêm case `describe_thread` → pipeline 1 step ("Tạo mô tả").
  - `processLLMTask` switch: case `describe_thread` → `estimateTokens(post.content)` + gọi
    `describeThread(post, config, onProgress, prompts, signal)` → `{ description }`.
- Lưu ý: pipeline thuần LLM-only nên **cache + scrape nằm ngoài** (ở sidepanel, mục trên). Chỉ LLM call
  đi qua pipeline.

**Cache messages (`lib/types.ts`, `lib/messaging.ts`, `entrypoints/background/index.ts`):**
- `GET_THREAD_DESCRIPTION` (`{ url }` → `{ description?, cached }`) và `SAVE_THREAD_DESCRIPTION`
  (`{ url, description, version }`). Handler đọc/ghi store `thread_descriptions` (xem dưới).
- Đã có origin permission (cùng forum đang fetch list) nên không cần xin quyền thêm.

**LLM (`lib/llm/summarizer.ts`, `lib/prompts.ts`):**
- `describeThread(post, config, onProgress, prompts, signal?)`: 1 LLM call, dùng `THREAD_DESCRIPTION_PROMPT`
  mới (output ngắn gọn, không markdown, không lặp lại tiêu đề). Dùng `withRetry`. `maxTokens` nhỏ (~120).

**Cache mô tả (`lib/thread-desc-cache.ts` — mới, dựa trên `cache-db.ts`):**
- IndexedDB store riêng `thread_descriptions`: key = `normalizeUrl(url)`, value
  `{ description, generatedAt, version }`. TTL ~7 ngày; quá hạn coi như miss.
- API: `getThreadDescription(url)`, `saveThreadDescription(url, value)`.

## Technical Considerations

- **Affected files:**
  - Phần A: `entrypoints/sidepanel/views/NewsFeedView.vue`, `lib/scrapers/forum-lister.ts`,
    `lib/types.ts` (field `version`).
  - Phần B: `lib/types.ts` (taskType `describe_thread` + 2 MessageType cache), `lib/messaging.ts`,
    `entrypoints/sidepanel/composables/useLLM.ts` (`describeThreadTask`),
    `entrypoints/background/index.ts` (`buildPipeline` + `processLLMTask` case + 2 cache handler),
    `lib/llm/summarizer.ts` (`describeThread`), `lib/prompts.ts` (`THREAD_DESCRIPTION_PROMPT`),
    `lib/thread-desc-cache.ts` (mới), `entrypoints/sidepanel/views/NewsFeedView.vue` (UI expand + orchestrate).
- **Cost-bound:** mô tả là **1 call/thớt, user-initiated**, có cache → rủi ro thấp. Theo ngưỡng
  `onAutoSummarizeClick` (≤3 apiCalls, $0 local → skip modal), description **không** bật cost modal.
- **Parse phải ở sidepanel:** MV3 service worker không có `DOMParser` → scrape bài #1 dùng
  `scrapePageRange` ở sidepanel (đã gửi `FETCH_HTML` xuống background để fetch). Không chuyển parse
  sang background, không tự gọi FETCH_HTML + parse thủ công.
- **MV3 worker termination:** đi `START_LLM_TASK` (fire-and-forget) nên bền với việc worker bị kill
  giữa LLM call — đây là một lý do chọn pipeline thay vì request/response trực tiếp.
- **Backward compat:** field `version` của `ForumThreadSummary` là optional → không phá scraper/test cũ.
  Store IDB mới không cần migration. Minimal topic chưa lưu IDB (cachedAt=0) — đồng nhất với
  `handleActiveTabTopic` hiện hành.
- **Edge cases:** thớt khoá/poll vẫn mở tả/tóm tắt được; bài #1 rỗng hoặc chỉ ảnh → mô tả fallback
  "Không đủ nội dung để tạo mô tả"; URL trùng giữa các forum → key cache đã normalize theo full URL.
- **a11y/lint:** nút expand cần `label` (IconButton); card đang dùng `card-interactive` + eslint-disable
  có sẵn — giữ pattern, thêm aria cho vùng mô tả mở rộng.

## Implementation Notes

- Làm **Phần A trước** (độc lập, giá trị tức thì, không phụ thuộc LLM), verify rồi mới sang Phần B.
- Phần B thứ tự: `prompts.ts` + `describeThread` (unit test thuần) → `thread-desc-cache.ts` (unit test
  TTL) → background handler → UI expand cuối cùng.
- Tái dùng tối đa: `scrapePageRange`, `withRetry`, `normalizeUrl`, `getSettings` trong background.
- Giữ `card-interactive` click = tóm tắt; chevron `@click.stop` để không kích hoạt flow A.

## Test Plan

- **Unit:**
  - `forum-lister`: `version` gán đúng XF1/XF2; không vỡ thread cũ thiếu version.
  - `thread-desc-cache`: hit trong TTL, miss khi quá hạn, key normalize đúng.
  - minimal topic builder: map đúng `totalPages`, `totalPosts = replyCount + 1`, `version`.
- **Manual:**
  - Click thân card → mở tab forum + sidepanel ở `/summary` đúng title; back lại Điểm báo vẫn còn list.
  - Expand chevron → mô tả hiện; expand lần 2 (hoặc thớt khác cùng url) → `cached: true`, không gọi LLM.
  - Chưa cấu hình provider → hiện hint, không gọi.
  - Bài #1 lỗi/permission → inline error + "Thử lại"; các card khác vẫn hoạt động.
- **Regression:** `npm run verify` (compile + lint + test) sạch; flow tóm tắt active-tab cũ không đổi.

## Degraded Mode

- **Không có provider LLM:** expand hiện hint cấu hình; flow A (tóm tắt) vẫn dùng được khi user cấu hình sau.
- **Fetch bài #1 lỗi / mất quyền:** mô tả báo lỗi + retry; flow A độc lập, vẫn tóm tắt được.
- **LLM lỗi/timeout:** card về trạng thái chưa mô tả + nút "Thử lại"; không cache lỗi.
- **Offline:** cả scrape lẫn mô tả fail gracefully như các luồng summarize hiện có.

## Decision Log

### Quyết định 1: Flow Option C — mở tab + đồng bộ `/summary` (không phải A/B)
- **Đã chọn:** giữ mở tab forum nhưng đồng thời `selectTopic` + `router.push('/summary')` trong 1 click.
- **Lý do:** ít rủi ro nhất, tái dùng pattern `handleActiveTabTopic`; vẫn để App.vue detect tab active
  → backfill version/postCount/title chính xác và enrich live count; bỏ được bước nhảy Hub + click card lần 2.
- **Đã cân nhắc nhưng loại:** (A) tóm tắt thẳng không mở tab — mất live-detection metadata, version có thể
  rỗng lúc đầu; (B) preview inline 2 bước — phức tạp UI hơn, user đã chọn C.
- **Điều kiện thay đổi:** nếu việc mở tab gây phiền (chiếm focus) bị phản hồi nhiều → cân nhắc Option A
  + tự detect version từ document forum list.

### Quyết định 2: Mở tab ở chế độ active (không background)
- **Đã chọn:** `browser.tabs.create({ active: true })`.
- **Lý do:** `App.vue.detectActiveTabTopic` chỉ chạy trên **tab active**; cần active để backfill metadata
  và enrich live post count cho summarize.
- **Đánh đổi:** tab forum chiếm focus thị giác trong khi sidepanel hiện `/summary` — chấp nhận được, đúng
  tinh thần "giữ mở tab".
- **Điều kiện thay đổi:** nếu sau này backfill version qua đường khác (forum-list document) → có thể mở
  background để không cướp focus.

### Quyết định 3: Không auto-start LLM tóm tắt khi land `/summary`
- **Đã chọn:** chỉ `selectTopic` + scrape sẵn; user bấm "Tóm tắt" như luồng hiện tại.
- **Lý do:** giữ cost-guard (F26) — auto-run LLM có chi phí; đồng nhất với `handleActiveTabTopic`.
- **Điều kiện thay đổi:** nếu có cấu hình "auto-summarize on open" trong Settings (out of scope F43).

### Quyết định 4: Mô tả LLM lazy on-demand, KHÔNG eager top-10
- **Đã chọn:** chỉ tạo mô tả khi user expand 1 thớt cụ thể; cache lại.
- **Lý do:** eager = ~10 fetch + 10 LLM call mỗi lần refresh → đụng cost-guard; phần lớn thớt user không
  quan tâm. Lazy đúng triết lý chi phí của dự án.
- **Đã cân nhắc nhưng loại:** eager top-10 (mượt nhưng tốn); không làm gì (title thường đủ nhưng mất giá
  trị preview mà user muốn).
- **Điều kiện thay đổi:** nếu thêm nguồn mô tả rẻ (không cần LLM, ví dụ trích câu đầu bài #1) → có thể
  eager phần "trích" còn LLM vẫn lazy.

### Quyết định 5: Cache mô tả ở IndexedDB store riêng + TTL, không nhồi vào CachedTopic
- **Đã chọn:** store `thread_descriptions` riêng (key normalizeUrl, TTL ~7 ngày).
- **Lý do:** đa số thớt nóng **chưa** là CachedTopic; nhồi vào CachedTopic buộc tạo bản ghi rác. storage.local
  bị giới hạn quota; IDB store riêng gọn, có TTL, độc lập vòng đời topic.
- **Đã cân nhắc nhưng loại:** storage.local map (quota/LRU thủ công); field trên CachedTopic (rác + lệ thuộc cache topic).
- **Điều kiện thay đổi:** nếu sau này mọi thớt Điểm báo đều được upsert thành CachedTopic nhẹ → cân nhắc gộp.

### Quyết định 6: `describeThread` đi qua `START_LLM_TASK` (không phải request/response trực tiếp)
- **Đã chọn:** LLM call đi qua pipeline `START_LLM_TASK` như mọi LLM op khác; cache + scrape bài #1
  nằm **ngoài** pipeline (orchestrate ở sidepanel: `GET/SAVE_THREAD_DESCRIPTION` + `scrapePageRange`).
- **Lý do:** đồng nhất state/stats (`updateModelSpeedStats`, ETA), cancel qua `CANCEL_LLM_TASK`, logging
  chung `LLM_PROGRESS`/`LLM_RESULT`, bền hơn với MV3 worker-termination. Chi phí thêm nhỏ (~12 dòng
  background + ~4 dòng useLLM) — đi lệch ra request/response mới là cái khó debug về sau. `createTask`
  trả Promise nên UI vẫn `await` gọn như request/response.
- **Đã cân nhắc nhưng loại:** request/response trực tiếp (đơn giản hơn vài dòng nhưng lệch chuẩn, mất
  log/stats/cancel chung, kém bền với worker-termination).
- **Ràng buộc liên quan:** parse HTML phải ở sidepanel (MV3 SW không có `DOMParser`); pipeline thuần
  LLM-only nên scrape/cache không nhồi vào background `processLLMTask`.
- **Điều kiện thay đổi:** không — pipeline là chuẩn chung của dự án.

### Quyết định 7: Thêm `version?` vào `ForumThreadSummary`
- **Đã chọn:** field optional, gán trong scrapeXf1/scrapeXf2.
- **Lý do:** cần version ngay để dựng minimal topic, tránh cửa sổ rỗng trước khi App.vue detect.
- **Đã cân nhắc nhưng loại:** detect version lại trong NewsFeedView từ document — lặp logic đã có trong scraper.
- **Điều kiện thay đổi:** không.
