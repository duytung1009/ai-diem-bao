# AGENTS.md

## Task Master AI Instructions
**Import Task Master's development workflow commands and guidelines, treat as if import is in the main CLAUDE.md file.**
@./.taskmaster/CLAUDE.md

---

## Mandatory: Check Task Master Before Code Changes

**Before implementing ANY code change, ALWAYS run these commands first:**
1. `task-master list` — understand current task status
2. `task-master next` — identify the next actionable task

This ensures alignment with the project's Development Workflow and prevents out-of-sync work. Skip this only for informational/non-code questions.

---

## Build & Dev Commands

```bash
npm run dev          # Dev server (Chrome)
npm run build        # Production build → .output/chrome-mv3/
npm run compile      # TypeScript type-check only (vue-tsc --noEmit)
npm run zip          # Package for Chrome Web Store
npm run test         # Run all tests (Vitest)
npm run test:watch   # Run tests in watch mode
```

Primary verification: `npm run compile` (type check) + `npm run test` (unit + E2E tests).

## Architecture Overview

**Chrome Extension (Manifest V3) built with WXT framework + Vue 3 + TypeScript + Tailwind CSS v4.**

### Entry Points

| File | Role |
|------|------|
| `entrypoints/background/index.ts` | Service worker — handles all LLM calls, cache read/write, message routing |
| `entrypoints/content/index.ts` | Content script — detects XenForo version, responds to `DETECT_XF`, scrapes posts |
| `entrypoints/sidepanel/` | Vue 3 SPA — the full UI (router, views, composables) |

### Message-Passing Architecture

All cross-context communication goes through typed messages in `lib/messaging.ts`. The sidepanel never calls LLM APIs directly — it sends `START_LLM_TASK` (fire-and-forget) and receives `LLM_PROGRESS` / `LLM_RESULT` back from the background service worker. Message types are defined in `lib/types.ts` (`MessageType`).

**Fire-and-forget LLM pattern:** `START_LLM_TASK` returns `{ started: true }` immediately; results arrive via `browser.runtime.sendMessage` from background → sidepanel listener. This is necessary because Chrome MV3 service workers can be terminated mid-request.

### Sidepanel SPA Structure

- **Router** (`main.ts`): hash-history, routes: `/` (hub), `/summary`, `/knowledge`, `/analysis`, `/research`, `/notebook`, `/settings`, `/help`
- **`useTopicStore`** (`composables/useTopicStore.ts`): module-level singleton refs (not Pinia). State: `selectedTopic`, `activeTabDetect`, `activeTabUrl`, `summarizingUrl`. Always exposed as `readonly()` — mutate only via store actions like `updateSelectedTopic()`.
- **`useSummarize`** (`composables/useSummarize.ts`): heavy composable managing the full summarize lifecycle — scraping, LLM task dispatch, segment state, cache save.
- **`useLLM`** (`composables/useLLM.ts`): lower-level task manager that sends `START_LLM_TASK` and listens for `LLM_PROGRESS`/`LLM_RESULT`.
- **`useThreadAnalysis`** (`composables/useThreadAnalysis.ts`): lightweight composable managing thread analysis state — reads `summaryJson` from store, calls `threadAnalysisTask`, persists result via `SAVE_CACHED_TOPIC`.
- **`useOptimisticUpdate`** (`composables/useOptimisticUpdate.ts`): wraps `store.updateSelectedTopic + sendMessage(SAVE_CACHED_TOPIC)` with auto-rollback on save failure. Used in KnowledgeView, ResearchView, TopicHubView for user-triggered actions (bookmark, save, delete).
- **`App.vue`**: 4 top-level tabs (Thớt, Sổ tay, Cài đặt, ?). When a topic is selected on a detail route, renders a sub-tab bar (← Danh sách, Tóm tắt, Kiến thức, Phân tích, Tra cứu). Mounts `<TopicMeta>` once above `<router-view>` (shared across summary/knowledge/analysis/research tabs). Handles tab detection and auto-update of cached topic metadata.

### Data Flow — Single Source of Truth

Topic data now flows as a **single source of truth** through the store:

```
IndexedDB (persistent)  →  background (cache-manager.ts)  →  sendMessage()
                                                                    ↓
                                    store.selectedTopic (reactive singleton)
                                                                    ↓
                              computed alias `cachedTopic` in composables/views
```

Before this refactoring (tasks 129–134), `cachedTopic` existed as a **local `ref()` in 3 places** (`useSummarize`, `KnowledgeView`, `ResearchView`) plus the store — a triple-state pattern causing sync bugs. Now all code reads `store.selectedTopic` via a computed:

- **`useSummarize.ts`**: `const cachedTopic = computed(() => store.selectedTopic.value)`
- **`KnowledgeView.vue`**: same pattern
- **`ResearchView.vue`**: same pattern

Zero `cachedTopic.value = {...}` assignments remain — `store.updateSelectedTopic()` is the only mutation path.

### IndexedDB Access — Message-Only

All sidepanel IndexedDB operations go through `sendMessage()` to the background worker. `App.vue` previously called `cache-manager.ts` directly; after task 129 it now uses `sendMessage()` consistently with all other components. Pure functions (`normalizeUrl`, `isSameTopicUrl`) remain imported directly since they have no side effects.

### Optimistic Update Pattern

For user-triggered actions (bookmark toggle, knowledge save/delete, research history), the store is updated immediately for instant UI feedback, then the IDB save is attempted in the background. If the save fails, the store is rolled back to the previous state:

```typescript
async function optimisticUpdate(partial: Partial<CachedTopic>): Promise<boolean> {
  const previous = store.selectedTopic.value;
  if (!previous) return false;
  store.updateSelectedTopic(partial);       // instant UI
  try {
    await sendMessage('SAVE_CACHED_TOPIC', { url: previous.url, ...partial });
    return true;
  } catch {
    store.updateSelectedTopic(previous);    // rollback
    return false;
  }
}
```

This pattern is NOT used for LLM-result saves (segment summaries, knowledge chunks) where the data must persist to IDB before updating the store.

### LLM Stack (`lib/llm/`)

- `factory.ts` — `createProvider(config)` → OpenAIAdapter | ClaudeAdapter | GeminiAdapter
- `summarizer.ts` — all LLM operations: `summarizeTopic`, `updateSummary`, `analyzeOpinions`, `researchTopic`, `extractKnowledge`, `summarizeSegments`, `generateThreadAnalysis`; includes `parseSummaryJSON` with `repairUnescapedQuotes` fallback
- `utils.ts` — `mergeAbortSignals()` (shared across all 3 adapters)
- `cost-estimator.ts` — pre-flight API call estimation (cost guard)
- `retry.ts` — `withRetry<T>` (3 attempts, exponential backoff)

### Cache Layer

- `lib/cache-db.ts` — raw IndexedDB wrapper (`dbPut`, `dbGet`, `dbGetAll`, `dbDelete`)
- `lib/cache-manager.ts` — public API (`getCachedTopic`, `saveCachedTopic`, etc.) + URL normalization

Settings stored in `browser.storage.sync`; topic cache stored in IndexedDB (migrated from `storage.local`).

### Segment Mode

Always active — `isSegmentMode = Boolean(topicInfo)`. Long threads are split into segments for LLM context management. Legacy cached topics (have `summary` but no `segments`) are synthesized into `segmentSummaries[0]`. Dynamic segment sizing uses `lib/token-estimator.ts` to fit within the model's context window.

### Styling

Tailwind CSS v4 via Vite plugin. Design tokens as CSS vars `--color-*` in `assets/main.css`. Reusable `@utility` classes: `btn`, `card`, `badge`, `alert`. Full conventions in `STYLE_GUIDE.md`.

### Path Alias

`@/` maps to the project root (configured by WXT). Use `@/lib/...`, `@/assets/...` etc.

### Testing

**Framework:** Vitest + jsdom (`vitest.config.ts`, `tests/`)

| Directory | Purpose |
|-----------|---------|
| `tests/unit/` | Unit tests for pure functions and utilities |
| `tests/e2e/` | End-to-end tests for LLM orchestration flows |
| `tests/fixtures/` | Mock data generators and response fixtures |
| `tests/mocks/` | Mock providers and factory overrides |

**Mock system:**
- `MockLLMProvider` (`tests/mocks/mock-provider.ts`) — implements `LLMProvider` interface with configurable: response queue, delay, fail-after-N, abort-after-N, invalid-JSON-before-valid
- `overrideCreateProvider()` (`tests/mocks/override-factory.ts`) — spies on `createProvider()` to inject mock provider without refactoring production code
- `postFactory` (`tests/fixtures/post-factory.ts`) — generates `ScrapedPost[]` with presets: `shortThread`, `mediumThread`, `longThread`, `veryLongThread`, `mixedLength`
- `mockSummaryResponses` (`tests/fixtures/mock-llm-responses.ts`) — collection of valid SummaryJSON fixtures for single-segment, multi-segment, edge cases

**Test patterns:**
- Always call `restoreCreateProvider()` in `afterEach` to clean up spies
- Use `willExceedContext()` to predict whether a test should trigger map-reduce vs direct call
- Assert on `mock.getCallCount()` to verify correct number of LLM invocations
- Use `vi.fn()` for `onProgress` callbacks to verify map-reduce step reporting

**Running tests:**
```bash
npm run test          # Run all tests once
npm run test:watch    # Watch mode
npm run test -- path/to/test.ts  # Run specific file
```

---

## Chrome Extension Permission Policy

Extension hướng đến Chrome Web Store — mọi permission thêm vào đều phải được justify rõ ràng. Reviewer sẽ đọc manifest và hỏi tại sao cần permission này.

### Bộ permissions tối thiểu hiện tại (không thêm nếu không có lý do cực kỳ rõ ràng)

```
permissions: ['storage', 'sidePanel', 'activeTab']
host_permissions: []
```

### Nguyên tắc — theo thứ tự ưu tiên

**1. `scripting` permission — WXT tự động inject, không cần khai báo và không thể xóa**
WXT framework hard-code thêm `scripting` vào mọi MV3 extension tại `node_modules/wxt/dist/core/utils/manifest.mjs:264`:
```js
if (wxt.config.manifestVersion === 3) addPermission(manifest, "scripting");
```
Điều này có nghĩa:
- **Không khai báo `scripting` trong `wxt.config.ts`** — WXT tự thêm vào built manifest
- **Không gọi `executeScript` trong code** — `scripting` chỉ dùng bởi WXT framework nội bộ để quản lý content scripts
- Khi giải thích với Chrome Web Store reviewer: *"The `scripting` permission is added by the WXT build framework for content script registration. Our extension code never calls `chrome.scripting.executeScript()` directly."*

**2. Không thêm `tabs` permission — dùng alternative**

| Nhu cầu | Sai (cần `tabs`) | Đúng (không cần) |
|---------|-----------------|-----------------|
| Lấy URL tab hiện tại | `tabs.query().url` | Content script `location.href` trong DETECT_XF response |
| Mở link trong tab mới | `tabs.create()` | `tabs.create()` — thực ra không cần permission! |
| Navigate tab hiện tại | `tabs.update(id, {url})` | Dùng `tabs.create()` thay (mở tab mới) |
| Nghe tab switch | `tabs.onActivated` | `tabs.onActivated` — không cần permission! |

`tabs` permission chỉ cần nếu muốn đọc `tab.url` từ `tabs.query`. Alternative: luôn lấy URL từ content script.

**3. Dùng `optional_host_permissions` + runtime request thay vì `host_permissions` cứng**
Extension hoạt động trên mọi XenForo forum mà không cần `host_permissions` tĩnh vì:
- `optional_host_permissions: ['https://*/*', 'http://*/*']` trong manifest cho phép xin quyền động
- Background `FETCH_HTML` / `FETCH_FORUM_LIST` kiểm tra `chrome.permissions.contains()` trước mỗi fetch; nếu chưa có, trả `needPermission` cho caller
- Sidepanel hiển thị prompt → user click "Cấp quyền" → `chrome.permissions.request()` (phải có user gesture)
- `lib/permissions.ts`: `hasOriginPermission()`, `requestOriginPermission()`, `requestOriginsPermission()`
- `useForumManager.ts`: dùng `requestOriginsPermission` khi thêm forum mới
- `useSummarize.ts` / `NewsFeedView.vue`: pre-flight check + prompt fallback khi fetch bị CORS

**Lưu ý:** Background service worker trong Chrome MV3 **cần** `host_permissions` để bypass CORS khi `fetch()` cross-origin — không giống MV2. `optional_host_permissions` + `chrome.permissions.request()` là giải pháp thay thế an toàn cho Chrome Web Store.

**4. `activeTab` là quyền mạnh nhất cần thiết**
Khi user mở Side Panel, `activeTab` cấp quyền tạm thời để:
- `tabs.sendMessage` đến tab hiện tại
- Content script nhận và trả về `{version, url: location.href, postCount, ...}`

### Khi nào mới được thêm permission mới

Chỉ thêm permission mới khi **cả 3 điều kiện** thỏa mãn:
1. Có use case cụ thể không thể làm theo cách khác
2. Đã tìm kiếm alternative ít nhạy cảm hơn và không có
3. Ghi rõ vào Decision Log của planning file tại sao cần permission này

### Lý do tại sao `detectActiveTabTopic()` không cần `tabs` permission

Vấn đề: `tabs.query({ active, currentWindow })` không trả `url` nếu thiếu `tabs` permission.

Fix hiện tại: `detectActiveTabTopic()` trong `App.vue` lấy `tabId` từ `tabs.query` (tabId vẫn được trả), sau đó `tabs.sendMessage(tabId, DETECT_XF)` → content script trả về `{ url: location.href, ... }`.

```typescript
// ✅ Không cần tabs permission
const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
if (!tab?.id) return;  // Chỉ cần tabId, không cần tab.url

const result = await browser.tabs.sendMessage(tab.id, { type: 'DETECT_XF' });
// result.url = location.href từ content script
store.setActiveTab(result, result.url);

// ❌ Cần tabs permission (tránh)
if (!tab?.id || !tab.url) return;
store.setActiveTab(result, tab.url);
```

---

## Know How

Các bài học từ bug / pattern phức tạp đã debug. Mỗi mục gồm: **triệu chứng** → **root cause** → **fix** → **anti-pattern cần tránh**.

### Agent Guidelines — Khi Nào Thêm Know How Mới

Thêm entry mới khi gặp **cả 3 điều kiện**:
1. Bug tốn > 2 vòng debug (agent đoán sai root cause ít nhất 1 lần)
2. Root cause nằm ở hành vi platform/browser/framework, không hiển nhiên từ error message
3. Fix pattern có thể tái sử dụng

**Format entry mới:**

```markdown
### KH{n}: {tiêu đề ngắn gọn}

**Triệu chứng:**
- {dấu hiệu nhận biết}

**Root cause:**
- {tại sao xảy ra, sai lầm phổ biến khi debug}

**Fix:**
- {pattern fix, kèm code before/after nếu cần}

**Anti-pattern:**
- {pattern code không được dùng}
```

Đặt entry mới ở **cuối** section Know How, đánh số tăng dần.

---

### KH1: CSP `script-src 'self'` Violation Khi `fetch()` HTML Từ Extension Page

**Triệu chứng:**
- Sidepanel console báo CSP violation: `Loading the script 'https://...' violates script-src 'self'`
- Lỗi xuất hiện tại dòng `await fetch(url)`, ngay cả khi chưa gọi `DOMParser.parseFromString()`
- URL trong error là external script từ trang đích (vd `voz.vn/js/...`)

**Root cause:**
- Chrome MV3 áp `script-src 'self'` lên **response body** của `fetch()` gọi từ extension page context (sidepanel, popup, options)
- CSP engine quét resource URL trong raw HTML response, không cần parse DOM
- Background service worker **không** bị kiểm tra này vì chạy không có renderer

**Fix:**
- Luôn route `fetch()` HTML qua background service worker bằng message `FETCH_HTML`
- Sidepanel nhận raw text, tự xử lý `DOMParser` + `safeHtml` sanitize

```typescript
// ❌ Sidepanel: CSP violation
const res = await fetch(pageUrl, { credentials: 'include' });

// ✅ Sidepanel gọi background
const { ok, status, html, finalUrl } = await sendMessage<FetchHtmlResult>(
  'FETCH_HTML', { url: pageUrl }
);
```

**Anti-pattern:**
- `fetch()` external HTML trực tiếp từ **bất kỳ** extension page context nào (sidepanel, popup, options)

---

### KH2: Mock `createProvider()` để test LLM orchestration mà không refactor production code

**Triệu chứng:**
- Cần test `summarizeTopic`, `updateSummary` nhưng không muốn gọi API thật
- `createProvider()` được gọi trực tiếp trong `summarizer.ts` — không có dependency injection
- Refactor để inject provider sẽ thay đổi nhiều file production code

**Root cause:**
- Factory pattern `createProvider()` hard-coded trong orchestrator functions
- Test cần override behavior nhưng không muốn thay đổi signature của production functions

**Fix:**
- Dùng `vi.spyOn(factoryModule, 'createProvider')` trong test để intercept calls
- `MockLLMProvider` implement `LLMProvider` interface — trả về configurable responses
- `overrideCreateProvider()` và `restoreCreateProvider()` wrapper để manage spy lifecycle
- Test predict behavior bằng `willExceedContext()` trước khi assert `mock.getCallCount()`

```typescript
// tests/mocks/override-factory.ts
export function overrideCreateProvider(provider: LLMProvider): void {
  vi.spyOn(factoryModule, 'createProvider').mockImplementation(() => provider);
}
export function restoreCreateProvider(): void {
  vi.restoreAllMocks();
}

// In test:
const mock = createMockProvider();
await summarizeTopic(posts, config);
expect(mock.getCallCount()).toBe(1);
```

**Anti-pattern:**
- Refactor production code chỉ để phục vụ testing (thêm DI, inject provider vào mọi function)
- Mock `fetch`/`browser.runtime` ở level quá thấp — nên mock ở `LLMProvider` interface level

---

### KH4: Thêm Debug Logs Sớm Khi Gặp Bug Phức Tạp — Đừng Suy Đoán Quá Nhiều

**Triệu chứng:**
- Bug không tái hiện được trong test environment
- Agent spending nhiều vòng phân tích code tĩnh, suy đoán root cause mà không verify được
- Multiple hypotheses đều plausible nhưng không confirm được cái nào đúng

**Root cause:**
- Khi bug chỉ xảy ra ở runtime (real extension, scraper parsing, network) — code analysis tĩnh không đủ
- Agent có xu hướng "dry-debug" — đọc code, suy luận, hypothesize — thay vì add logs để capture thực tế
- Mỗi vòng hypothesize tốn context window mà không tiến gần hơn đến root cause

**Fix:**
- Khi bug phức tạp (> 2 vòng đoán sai hoặc không reproduce được trong test), **NGAY LẬP TỨC** thêm `console.log` strategic ở các điểm data flow quan trọng
- Log format: `[functionName]` prefix + structured data (counts, distributions, key values)
- Đặt logs ở: (1) input/output của function suspected, (2) mỗi bước transform data, (3) ngay trước khi data gửi đi (VD: trước LLM call)
- Giữ logs trong code cho đến khi bug confirmed fix — không xóa sớm
- Xóa logs chỉ khi bug đã fix và user confirm

```typescript
// ✅ Strategic logging tại data flow checkpoints
console.log('[runSummarizeJob] Scrape complete:', {
  newPostsCount: newPosts.length,
  allPostsCount: allPosts.length,
  pageDistribution: Object.entries(allPosts.reduce(...)).join(', '),
});
console.log('[summarizeAndSaveSegment] seg=${seg}, posts=${posts.length}, postPages={${pages}}`);
```

**Anti-pattern:**
- Spending > 2 vòng đọc code suy đoán root cause mà không add logs
- Xóa debug logs ngay sau khi test pass — cần giữ cho user verify ở runtime
- Add logs quá chi tiết (logging từng post) — nên log aggregated data (counts, distributions)

---

### KH3: Scraper filter `content.trim()` gây mất bài viết khi tóm tắt

**Triệu chứng:**
- FETCH_HTML trả về số post ít hơn thực tế (thiếu 1 post, thường là post cuối của trang trước)
- Số post bị thiếu không cố định — phụ thuộc vào nội dung HTML của từng post

**Root cause:**
- XF1/XF2 scraper filter `if (content.trim())` loại bỏ post có content rỗng sau khi strip quote, signature, media wrapper
- Một số post chỉ chứa image, emoji, hoặc embed media — sau khi `extractContent()` strip các thẻ HTML thì `content.trim()` trả về `""` → post bị loại hoàn toàn
- `page-loader.ts` gọi `deduplicateAndSort()` giữ đúng số lượng duy nhất theo `postNumber`, nhưng số lượng đầu vào đã bị giảm bởi filter A/B trước đó

**Fix:**
- Xóa filter `content.trim()` trong cả `xf1-scraper.ts` và `xf2-scraper.ts` — scrapers phải trả về TẤT CẢ posts, để LLM quyết định nội dung nào quan trọng
- `deduplicateAndSort()` trong `page-loader.ts` vẫn giữ — chỉ loại trùng `postNumber`, không lọc theo content

```typescript
// ❌ Trước: filter content rỗng — loại bỏ post image-only, emoji-only
if (content.trim()) {
  posts.push({ author, content, timestamp, postNumber });
}

// ✅ Sau: giữ tất cả posts, để LLM xử lý
posts.push({ author, content, timestamp, postNumber });
```

**Anti-pattern:**
- Bất kỳ filter nào trong scraper loại bỏ post theo content — scraper phải neutral, chỉ thu thập, không quyết định nội dung nào quan trọng
- Kiểm tra luôn: sau khi thay đổi scraper/filter, verify tổng số post phải khớp với số post trên trang web thật

---

### KH5: `reduce_knowledge_chunks` completion_tokens vượt max_tokens — sai lầm khi dùng floor `Math.max(10, ...)` và split theo chunk count

**Triệu chứng:**
- `reduce_knowledge_chunks` task thường xuyên bị `INCOMPLETE_RESPONSE` (`finish_reason: 'length'` / `stop_reason: 'max_tokens'`)
- `truncationWarning` tăng bất thường trong Knowledge view
- Lỗi xảy ra cả khi chưa bật thinking mode, `max_tokens` khớp config

**Root cause:**
- **`calcMaxOutputEntries()` (`useKnowledge.ts:212`)** dùng `Math.max(10, ...)` làm floor: với `maxOutputTokens = 4096`: `Math.max(10, floor(3276/700)) = 10`. Model chỉ đủ ~4 entries (700 tokens/entry × 4 = 2800 < 4096), nhưng cap=10 → model cố output 10 → completion_tokens vượt budget.
- **Pre-reduce split theo chunk count** (`useKnowledge.ts:500-501`): mỗi chunk có 0-20+ entries, split theo `allPartial.length` khiến mỗi group có thể chứa 20-50 entries. Pre-reduce không truyền `entryCap` → default `cap=20` (`summarizer.ts:338`).
- Kết hợp: cap quá lớn + input quá nhiều entries → model buộc phải output vượt `max_tokens`.

**Fix:**
- Bỏ `Math.max(10, ...)`, thay bằng `Math.max(2, ...)` — để multi-call split path xử lý workload lớn
- Pre-reduce: flatten entry arrays → split theo entry count (input = 2×maxPerCall entries/group, output cap = maxPerCall) thay vì theo chunk count
- Truyền `entryCap = maxPerCall` cho mọi pre-reduce call

```typescript
// ❌ Trước: floor quá cao, split theo chunk count, không có entryCap
function calcMaxOutputEntries(maxOutputTokens: number): number {
  return Math.max(10, Math.floor(maxOutputTokens * 0.8 / TOKENS_PER_ENTRY_REDUCE));
}
// pre-reduce:
const groupSize = Math.ceil(allPartial.length / groupCount);
reduceKnowledgeChunksTask(group); // NO entryCap → defaults to 20

// ✅ Sau: floor thấp, split theo entry count, luôn có entryCap
function calcMaxOutputEntries(maxOutputTokens: number): number {
  return Math.max(2, Math.floor(maxOutputTokens * 0.8 / TOKENS_PER_ENTRY_REDUCE));
}
// pre-reduce: flatten entries, split by 2×maxPerCall per group
const maxPerCall = calcMaxOutputEntries(maxOutputTokens);
const allFlat = allPartial.flat();
for (let i = 0; i < allFlat.length; i += maxPerCall * 2) {
  reduceKnowledgeChunksTask([allFlat.slice(i, i + maxPerCall * 2)], maxPerCall);
}
```

**Anti-pattern:**
- Floor `Math.max(10, ...)` cho entry cap — con số 10 cứng này bỏ qua budget thực tế của model nhỏ (2K-4K tokens). Luôn tính cap từ `maxOutputTokens`, để multi-call path xử lý overflow.
- Split theo chunk count thay vì entry count trong map-reduce — chunk count không phản ánh khối lượng công việc thực tế. Luôn flatten và split theo số lượng entries.
- Gọi reduce mà không truyền `entryCap` — default 20 thường quá cao. Luôn tính cap từ output budget và truyền tường minh.

---

### KH6: Background Service Worker Không Tự Động Bypass CORS — Cần `host_permissions` hoặc `optional_host_permissions` + Runtime Request

**Triệu chứng:**
- `fetch()` từ sidepanel hoặc background đến XenForo forum bị CORS block: `No 'Access-Control-Allow-Origin' header is present on the requested resource`
- Lỗi chỉ xảy ra với một số forum (otofun.net), không xảy ra với forum khác (voz.vn có CORS headers)

**Root cause:**
- AGENTS.md trước đây ghi sai: "service worker không bị same-origin policy" — thực tế Chrome MV3 service workers **cần** `host_permissions` để bypass CROSS khi `fetch()` cross-origin
- Một số forum (voz.vn) trả `Access-Control-Allow-Origin: *` nên hoạt động dù không có `host_permissions`
- Otofun.net không trả CORS headers → fetch thất bại

**Fix:**
- `optional_host_permissions: ['https://*/*', 'http://*/*']` trong manifest → xin quyền động qua `chrome.permissions.request()`
- `lib/permissions.ts`: `hasOriginPermission()` + `requestOriginPermission()` — kiểm tra và xin quyền trước khi fetch
- Background handler `FETCH_HTML`/`FETCH_FORUM_LIST`: kiểm tra `chrome.permissions.contains()` trước fetch, trả `{ needPermission: true, origin }` nếu chưa có
- Sidepanel (`NewsFeedView.vue`, `useSummarize.ts`): nhận `needPermission` → hiển thị prompt → user click "Cấp quyền" → retry

```typescript
// Background handler pattern:
case 'FETCH_HTML': {
  const { url } = message.payload;
  const origin = new URL(url).origin + '/*';
  chrome.permissions.contains({ origins: [origin] }, (hasPerm) => {
    if (!hasPerm) {
      sendResponse({ needPermission: true, origin });
      return;
    }
    // proceed with fetch...
  });
}
```

**Anti-pattern:**
- Giả định background service worker tự động bypass CORS không cần `host_permissions` — sai cho Chrome MV3
- Gọi `fetch()` cross-origin từ sidepanel/popup/options page trực tiếp — luôn route qua background
- Dùng `host_permissions: ['*://*/*']` cứng trong manifest — nên dùng `optional_host_permissions` + runtime request để qua Chrome Web Store review

---

## Development Workflow (MANDATORY)

Tuân thủ workflow sau cho **mọi** thay đổi code. AI agent phải tự động áp dụng workflow này, user không cần prompt chi tiết từng step.

### Phase 1 — Planning (User-driven)

User cập nhật `dev_plan.md` với plan tổng quan chia theo phase (1, 2, 3...). Mỗi phase có checklist `- [ ]` các task cần làm.

AI agent: Khi user yêu cầu "tạo PRD cho Phase X" hoặc "bắt đầu Phase X":
- Đọc `dev_plan.md`, đối chiếu với existing `.taskmaster/docs/*.md`
- Tạo PRD files mới trong `.taskmaster/docs/` theo đúng template `.taskmaster/templates/example_prd.txt` (hoặc `.md`)
- Mỗi PRD có cấu trúc `<context>` + `<PRD>` blocks

### Phase 2 — Task Generation (AI-driven)

Sau khi PRD files được tạo/cập nhật xong, CHẠY TUẦN TỰ:

```
1. task-master parse-prd .taskmaster/docs/<file>.md [--append]
2. task-master analyze-complexity --research
3. task-master complexity-report
4. task-master expand --all --research
5. Với MỖI task vừa generate/expand: thêm subtask Self-review ở VỊ TRÍ CUỐI CÙNG
   task-master add-subtask --parent=<id> --title="Self-review" \
     --description="Chạy template/self_review_checklist.md, fix mọi issue, rồi set-status task --status=review"
```

**Quy tắc:**
- PRD mới → `task-master parse-prd` không có `--append`
- PRD cập nhật (plan thay đổi) → `task-master parse-prd --append`
- Luôn chạy `analyze-complexity` sau khi parse xong TẤT CẢ PRD
- `complexity-report` chỉ cần chạy 1 lần, review các task complexity > 5
- `expand --all --research` để tự động bung subtasks cho complex tasks
- **BẮT BUỘC — Self-review subtask:** mỗi task PHẢI có subtask **Self-review** là subtask **cuối cùng** (sau toàn bộ subtask implement). `expand` không tự sinh subtask này → LUÔN thêm thủ công bằng step 5 sau khi expand. Áp dụng cho MỌI task, kể cả complexity thấp, không ngoại lệ. Subtask Self-review chỉ được set done sau khi đã chạy `template/self_review_checklist.md` và fix hết issue tìm được.

### Phase 3 — Implementation (AI-driven)

Khi user yêu cầu "implement task N" hoặc "tiếp tục":

```
1. task-master set-status --id=N --status=in-progress
2. task-master show N                       # đọc chi tiết task
3. Implement code theo task description
4. Verify: npm run compile
5. task-master update-subtask --id=N --prompt="ghi chú implementation"
6. task-master set-status --id=N --status=done
7. task-master next                          # show task tiếp theo
```

**Quy tắc implementation:**
- LUÔN chạy `npm run compile` (type check) sau khi code
- Subtask **Self-review** (subtask cuối) PHẢI được thực hiện sau khi xong mọi subtask implement: chạy `template/self_review_checklist.md`, fix hết issue, rồi mới set task `--status=review`. Không skip subtask này dù task nhỏ.
- Sau mỗi task done → `task-master next` → hỏi user có muốn tiếp tục không
- Không tự commit code

### Phase 5 — Documentation Sync (MANDATORY)

**Sau mọi thay đổi về kiến trúc (route mới, component mới, thay đổi data flow, tái cấu trúc tab/nav), PHẢI cập nhật `docs/architecture/`:**

1. Xác định file architecture nào bị ảnh hưởng (dùng glob `docs/architecture/*.md`)
2. Đọc file liên quan, cập nhật nội dung phản ánh thay đổi
3. Cập nhật ngày ở header `> Cập nhật: YYYY-MM-DD`
4. Cập nhật thông tin tương ứng trong `AGENTS.md` (các section: Architecture Overview, Sidepanel SPA Structure, file paths)

### Phase 4 — Alignment (khi plan thay đổi)

Khi user thay đổi `dev_plan.md` trong quá trình implement:

```
1. Cập nhật .taskmaster/docs/<prd-file>.md tương ứng
2. task-master parse-prd .taskmaster/docs/<prd-file>.md --append
3. Chạy lại từ Phase 2 step 2 nếu thay đổi lớn
```

### Decision Flow cho AI Agent

```
User request
    │
    ├── "tạo PRD cho Phase X" / "lập plan Phase X"
    │       → Đọc dev_plan.md
    │       → Tạo .taskmaster/docs/<prd-file>.md theo template
    │       → Parse PRDs (Phase 2)
    │
    ├── "implement task N"
    │       → task-master set-status --id=N --status=in-progress
    │       → Implement code
    │       → npm run compile verify
    │       → Log update-subtask + set-status done
    │       → task-master next → hỏi tiếp tục?
    │
    ├── "update plan" / "cập nhật plan"
    │       → Update dev_plan.md
    │       → Update PRD files
    │       → Re-parse + analyze (Phase 2 + Phase 4)
    │
    ├── "show status" / "what's next"
    │       → task-master list
    │       → task-master next
    │
    └── "parse tasks" / "generate tasks"
            → Phase 2 (parse → analyze → expand)
```

### Environment Checks Trước Khi Implement

Mỗi lần bắt đầu implement task mới:
1. `npm run compile` — type check toàn project
2. Nếu fail → fix trước khi implement task mới

---

## Plan Management & Sync Rules

### Rule 1 — Brainstorm → Plan Update

Khi user brainstorm ý tưởng mới với AI agent:

1. AI agent ghi nhận các actionable items từ cuộc brainstorm
2. Đề xuất cập nhật `dev_plan.md` — thêm mục mới vào phase phù hợp hoặc tạo phase mới
3. **KHÔNG tự động sửa plan** — chỉ đề xuất, user confirm rồi mới sửa
4. Format đề xuất: `[Phase] [Section] [Action] — [Mô tả]`

### Rule 2 — Post-Implementation Sync Check

Sau khi hoàn thành một phase hoặc một nhóm tasks quan trọng:

1. Đọc lại `dev_plan.md` phase đã implement
2. Đối chiếu với code thực tế (check file structure, entry points, lib modules)
3. Nếu có discrepancy → báo cáo dạng:
   ```
   ⚠️ Plan misalignment detected:
   - Plan nói [X] nhưng code có [Y]
   - Đề xuất: [update plan / update code]
   ```
4. User quyết định update plan hay sửa code

### Rule 3 — Plan Update Decision Matrix

| Tình huống | Action |
|---|---|
| Brainstorm có idea mới → chưa có trong plan | **Đề xuất** thêm vào phase phù hợp, user confirm → sửa plan → tạo PRD nếu cần |
| Brainstorm có ADR → conflict với plan hiện tại | **Flag** conflict, user chọn giữ plan cũ hay ADR mới |
| Code đã implement → khác với plan | **Report discrepancy**, user chọn update plan hay sửa code |
| Phase đã done → plan vẫn ghi `- [ ]` | **Tự động** đánh dấu `- [x]` trong plan |

---

### Communication Rules

- AI agent thông báo step hiện tại đang làm (VD: "Đang parse PRD-01...")
- Khi hỏi user "có muốn tiếp tục không?" → chỉ hỏi 1 lần, không loop
- Khi error (`npm run compile` fail) → tự fix trước, chỉ hỏi user nếu không fix được sau 2 attempts
- Output ngắn gọn, tập trung vào kết quả
