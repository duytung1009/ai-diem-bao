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
npm run lint         # ESLint — design system token/a11y enforcement
npm run lint:fix     # ESLint with auto-fix
npm run verify       # compile + lint + test (full gate)
npm run zip          # Package for Chrome Web Store
npm run test         # Run all tests (Vitest)
npm run test:watch   # Run tests in watch mode
```

Primary verification: `npm run verify` (compile + lint + test).

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
- **Common components** (`components/`): `IconButton.vue` (icon-only button with required `label` prop for a11y), `ConfirmInline.vue` (inline confirm row), `OverflowMenu.vue` (3-dot dropdown), `FormField.vue` (label+control+hint wrapper), `ToggleSwitch.vue` (on/off toggle), `Checkbox.vue`, `RadioGroup.vue` (radio with options), `SegmentGrid.vue` (generic per-segment list: status icon + progress + batch/`#header-actions` + `#row-actions` + `#preview` slots; shared by SummaryView and KnowledgeView). Form utilities (`checkbox`, `radio`, `select`, `label`, `input-range`) in `assets/main.css`.

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

When `segments.length > 1`, SummaryView renders a `SegmentGrid` (replacing the old per-segment tab UI — there is no longer an "individual segment view"): per-segment status (`pending`/`running`/`done`/`partial`/`error`) + "Tóm tắt tất cả" (header) + per-row "Tóm tắt"/"Tóm tắt lại"/"Thử lại". Per-segment summarize errors live in `useSummarize`'s in-memory `segmentErrors` ref (keyed by index, not persisted); `runningSegmentIndex` tracks the segment being summarized. Status derivation is the pure helper `lib/segment-grid-status.ts` (`deriveSummarySegmentStatus` / `mapKnowledgeSegmentStatus`). KnowledgeView feeds its F33 extraction grid through the same `SegmentGrid`.

Batch summarize ("Tóm tắt tất cả" → `runSummarizeJob`; "Cập nhật" → `handleSegmentUpdate`) is **fault-tolerant per-segment** in both dynamic and fixed mode, like KnowledgeView's `extractAllSegments`: a failing segment is recorded in `segmentErrors[i]` (→ grid `error` status + "Thử lại") and marked via `pl.markError(stepId)`, then the loop **continues** to the next segment. Global `error.value` is not set, so the overall summary still runs from completed segments. Only a user cancel (`AbortError`) or stale guard aborts the whole batch. Dynamic mode wraps each `summarizeAndSaveSegment` in `try/catch`. Fixed mode reuses `handleSummarizeSegment(i, { token })` — the batch owns one stale-guard token and passes it in so the per-call `summarizeGuard.begin()` is skipped (otherwise it would invalidate the batch loop after the first segment); in batch mode `handleSummarizeSegment` flags `segmentErrors` instead of `error.value` and leaves the `setSummarizing` lifecycle to the caller.

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

Minimum: `['storage', 'sidePanel', 'activeTab']`. Không thêm permission mới trừ khi 3 điều kiện trong `/permission-policy` thỏa mãn.

Gọi `/permission-policy` để xem: `tabs` alternatives, `optional_host_permissions` pattern, WXT `scripting` note, `detectActiveTabTopic()` pattern.

---

## Know How

Debug lessons từ Chrome extension platform. Gọi `/know-how` để xem toàn bộ entries (KH1–KH6) và format thêm entry mới.

Khi gặp bug khó: CORS, CSP, scraper mất post, LLM token overflow, Chrome API quirks → check `/know-how` trước. Entry mới thêm vào `.claude/commands/know-how.md`.

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
- LUÔN chạy `npm run verify` (compile + lint + test) sau khi code
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
    │       → npm run verify
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
2. `npm run lint` — ESLint check (design token + a11y enforcement)
3. Nếu fail → fix trước khi implement task mới

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
