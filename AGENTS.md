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

- **Router** (`main.ts`): hash-history, routes: `/` (hub), `/summary`, `/knowledge`, `/research`, `/settings`
- **`useTopicStore`** (`composables/useTopicStore.ts`): module-level singleton refs (not Pinia). State: `selectedTopic`, `activeTabDetect`, `activeTabUrl`, `summarizingUrl`. Always exposed as `readonly()` — mutate only via store actions like `updateSelectedTopic()`.
- **`useSummarize`** (`composables/useSummarize.ts`): heavy composable managing the full summarize lifecycle — scraping, LLM task dispatch, segment state, cache save.
- **`useLLM`** (`composables/useLLM.ts`): lower-level task manager that sends `START_LLM_TASK` and listens for `LLM_PROGRESS`/`LLM_RESULT`.
- **`useOptimisticUpdate`** (`composables/useOptimisticUpdate.ts`): wraps `store.updateSelectedTopic + sendMessage(SAVE_CACHED_TOPIC)` with auto-rollback on save failure. Used in KnowledgeView, ResearchView, TopicHubView for user-triggered actions (bookmark, save, delete).
- **`App.vue`**: mounts `<TopicMeta>` once above `<router-view>` (shared across summary/knowledge/research tabs). Handles tab detection and auto-update of cached topic metadata.

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
