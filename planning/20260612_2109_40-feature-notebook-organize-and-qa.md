# F40 — Sổ tay nâng cao: Tự phân loại + Quản lý chuyên sâu + Hỏi đáp kho kiến thức (Notebook Q&A)

**Ngày:** 2026-06-12
**Feature số:** 40
**Tier:** Tier 3 (schema mở rộng, taskType LLM mới, cross-module: notebook-db + background + NotebookView)
**Model:** Opus planning + review; Sonnet implement
**Tham chiếu:** F27 (knowledge overhaul + notebook), F26 (LLM cost guard), F24 (dynamic chunks knowledge)

---

## Overview

Sổ tay (NotebookView, F27) hiện chỉ là kho **đọc**: entries do LLM extract, category/tags do LLM gán, user chỉ xem/filter/export/unsave. F40 nâng Sổ tay thành kho kiến thức cá nhân thực sự với 2 nhóm tính năng:

1. **Phase A — Tự phân loại + quản lý chuyên sâu:** user sửa được title/content/category/tags của entry, thêm ghi chú cá nhân, pin entry, tạo ghi chú thủ công (không cần topic nguồn), rename/merge category, bulk actions (multi-select → đổi category, thêm tag, xóa).
2. **Phase B — Hỏi đáp kho kiến thức (Notebook Q&A):** user đặt câu hỏi bất kỳ; agent retrieve các entries liên quan từ Sổ tay (2-stage: lọc client-side → LLM chọn lọc nếu cần) rồi trả lời kèm citation trỏ về từng entry; có nút lưu câu trả lời thành ghi chú mới.

## Goals

- G1: User sửa được mọi field hiển thị của notebook entry (title, content, category, tags) + thêm `userNote` riêng, ngay trong NotebookView.
- G2: User quản lý category như first-class object: rename (bulk update mọi entry thuộc category), gộp category A vào B, danh sách category hiển thị đầy đủ (bỏ giới hạn 6 pills).
- G3: Multi-select entries → bulk: đổi category, thêm/xóa tag, xóa entries.
- G4: User tạo được ghi chú thủ công (manual entry) không gắn topic nguồn.
- G5: Tab "Hỏi đáp" trong NotebookView: nhập câu hỏi → LLM trả lời dựa **chỉ** trên entries trong Sổ tay, kèm citation `[n]` click được → scroll/highlight entry nguồn.
- G6: Q&A đi qua cost guard (F26 pattern) — hiển thị ước tính số call trước khi chạy nếu vượt threshold; mọi LLM call đều cần user bấm.

## Non-Goals

- Không dùng embeddings / vector DB — retrieval bằng keyword scoring + LLM selection (xem Decision Log #5).
- Không sync cloud, không multi-device.
- Không chat đa lượt (multi-turn conversation) — mỗi câu hỏi là 1 lượt độc lập; lịch sử Q&A chỉ giữ trong session (xem Decision Log #7).
- Không sửa entry từ KnowledgeView (per-topic) — quản lý chuyên sâu chỉ ở Sổ tay (Decision Log #3).
- Không hierarchical categories (category cha/con) — flat list.
- Không virtual scroll (đã defer từ F27).

---

## Requirements

### Phase A — Tự phân loại + Quản lý chuyên sâu

#### A1. Schema mở rộng `NotebookEntry` (`lib/types.ts`)

```typescript
export interface NotebookEntry extends KnowledgeEntry {
  sourceTopicUrl: string;        // '' cho manual entry
  sourceTopicTitle: string;      // '' cho manual entry
  savedAt: number;
  orphaned?: number;
  orphanedAt?: number;
  // F40 mới:
  userNote?: string;             // ghi chú cá nhân của user, render dưới content
  pinned?: number;               // 1 = ghim lên đầu (number để IDB index được, giống orphaned)
  editedAt?: number;             // timestamp lần sửa cuối (phân biệt entry đã chỉnh tay)
  manual?: number;               // 1 = entry user tự tạo, không từ LLM extract
}
```

- KHÔNG bump DB_VERSION cho các field optional (IDB schemaless per-record). Chỉ bump nếu thêm index mới — Phase A cần index `by-pinned`? → KHÔNG (xem Decision Log #2: pin sort client-side, số entries nhỏ).

#### A2. Sửa entry inline (NotebookView)

- Mỗi entry card (expanded) thêm nút "✏️ Sửa" → chuyển card sang edit mode inline:
  - `title`: input text.
  - `content`: textarea (auto-grow).
  - `category`: combobox — chọn từ category hiện có HOẶC gõ tên mới (datalist).
  - `tags`: tag editor đơn giản (chip list + input thêm, click ✕ xóa chip).
  - `userNote`: textarea riêng, label "Ghi chú của bạn".
- Lưu → set `editedAt = Date.now()` → `UPSERT_NOTEBOOK_ENTRY` (message đã có) → update local `entries.value`.
- Hủy → restore giá trị cũ (giữ snapshot trước khi edit).
- Đồng bộ ngược topic cache: nếu `sourceTopicUrl` còn trong cache và entry tồn tại trong `knowledgeEntries` → cập nhật bản sao qua `SAVE_CACHED_TOPIC` (cùng pattern `unsaveEntry` trong `useNotebook.ts`) — fire-and-forget (Decision Log #4).
- Entry đã sửa hiển thị badge nhỏ "đã sửa" (tooltip ngày sửa).

#### A3. Pin entry

- Icon 📌 trên card → toggle `pinned`.
- Trong mọi view mode: pinned entries nổi lên đầu group của chúng (sort `pinned desc` trước sort hiện tại).
- Filter nhanh "Đã ghim" cạnh toggle "Mồ côi" hiện có.

#### A4. Quản lý category

- `allCategories` hiển thị đầy đủ (xóa `.slice(0, 6)` nếu có với category; tags vẫn giới hạn nhưng tăng lên 12 + nút "..." mở rộng).
- Nút "⚙️ Quản lý" cạnh hàng category pills → mở panel quản lý:
  - List mọi category + count entries.
  - **Rename**: input mới → `RENAME_NOTEBOOK_CATEGORY { from, to }` → background bulk update qua cursor trên index `by-category`. Nếu `to` trùng category đã có → coi như merge, confirm trước.
  - **Merge**: chọn category đích → cùng message (rename to existing = merge).
  - **Xóa category**: entries thuộc nó chuyển về `category: undefined` (hiện "Khác"), không xóa entries. Confirm trước.
- Category list luôn derive từ entries (không có store metadata riêng — Decision Log #2).

#### A5. Bulk actions (multi-select)

- Nút "Chọn" trên toolbar → vào selection mode: mỗi card hiện checkbox, header hiện "Đã chọn N".
- Actions khi có selection: **Đổi category** (combobox), **Thêm tag**, **Xóa tag** (chọn từ union tags của selection), **Xóa entries** (confirm), **Bỏ chọn / Thoát**.
- Message mới `BULK_UPDATE_NOTEBOOK_ENTRIES { ids: string[], patch: { category?: string | null; addTags?: string[]; removeTags?: string[] } }` và dùng `DELETE_NOTEBOOK_ENTRY` lặp (hoặc thêm `BULK_DELETE_NOTEBOOK_ENTRIES { ids }`) — 1 transaction IDB cho bulk.
- Sau bulk → reload entries + stats.

#### A6. Manual entry (ghi chú thủ công)

- Nút "+ Ghi chú" trên header NotebookView → form (cùng UI với edit mode): title (bắt buộc), content (bắt buộc), category, tags, userNote.
- Tạo `NotebookEntry` với: `id = crypto.randomUUID()`, `manual: 1`, `sourceTopicUrl: ''`, `sourceTopicTitle: ''`, `source: { author: 'Bạn', postNumber: 0 }`, `savedAt/extractedAt = Date.now()`, `saved: true`.
- Card manual entry: badge "✍️ Tự tạo", không có link post/topic, không có nút "Open in extension".
- `unsaveEntry`/`handleUnsave` với manual entry: chỉ xóa notebook (skip sync topic cache vì `sourceTopicUrl` rỗng); label nút đổi "Xóa" thay vì "Bỏ lưu".

#### A7. Background handlers + notebook-db mới

- `lib/notebook-db.ts` thêm:
  - `notebookRenameCategory(from: string, to: string | null): Promise<number>` — cursor trên `by-category`, trả số entries đã đổi.
  - `notebookBulkUpdate(ids: string[], patch): Promise<number>` — 1 readwrite transaction, get → merge patch → put.
  - `notebookBulkDelete(ids: string[]): Promise<number>`.
- `lib/types.ts` MessageType thêm: `RENAME_NOTEBOOK_CATEGORY` | `BULK_UPDATE_NOTEBOOK_ENTRIES` | `BULK_DELETE_NOTEBOOK_ENTRIES`.
- `entrypoints/background/index.ts`: 3 handlers mới, return count để UI toast "Đã cập nhật N mục".

### Phase B — Hỏi đáp kho kiến thức (Notebook Q&A)

#### B1. Task type LLM mới

- `LLMTaskRequest.taskType` thêm `'notebook_qa'`.
- Payload: `{ question: string, entries: NotebookEntryForQA[] }` — sidepanel tự load + lọc entries rồi gửi xuống background (KHÔNG để background tự đọc notebook-db cho task này, giữ pattern hiện tại: sidepanel orchestrate, background execute — như `research`).
- `NotebookEntryForQA` = projection gọn: `{ id, title, content, userNote?, category?, tags, sourceTopicTitle, source: { author, postNumber } }` — bỏ timestamps/flags để tiết kiệm token.

#### B2. Retrieval 2 tầng (không embeddings)

Trong composable mới `useNotebookQA.ts`:

1. **Tầng 0 — client-side scoring (miễn phí):** tokenize câu hỏi (lowercase, bỏ dấu câu, giữ tiếng Việt có dấu), score mỗi entry = tổng match trên `title×3 + tags×2 + category×2 + content×1 + userNote×1` (substring match per token, đủ tốt cho tiếng Việt không cần stemming). Lấy top-K theo score (K tính từ token budget, xem B3).
2. **Nhánh nhỏ:** nếu **toàn bộ** entries (sau projection) fit trong context budget → bỏ qua scoring, gửi tất cả trong 1 call (chất lượng tốt nhất, vẫn 1 call).
3. **Nhánh lớn:** nếu top-K theo scoring vẫn vượt budget HOẶC câu hỏi không match keyword nào (score toàn 0 — câu hỏi trừu tượng) → **LLM selection call**: gửi index gọn `{ id, title, tags, category }` của mọi entry, yêu cầu LLM trả JSON mảng ids liên quan (cap 30) → call 2 trả lời với full content của các ids đó. Tối đa 2 calls.

#### B3. Token budget

- Dùng `estimateTokens` + `getContextLimit(config)` hiện có (đã có hệ số 1.4× correction tiếng Việt từ fix trước).
- Budget cho entries = `contextLimit − promptOverhead(~1000) − Math.max(2000, config.maxTokens ?? 0)` (theo pattern fix-summarize-token-overflow-maxtokens).
- K được cắt theo budget thực, không hardcode.

#### B4. Prompt + parse

- `lib/prompts.ts` thêm:
  - `NOTEBOOK_QA_PROMPT` — system: "Bạn là trợ lý tra cứu sổ tay cá nhân. CHỈ trả lời dựa trên các ghi chú được cung cấp. Mỗi ý phải kèm citation dạng [n] tham chiếu ghi chú số n. Nếu sổ tay không có thông tin liên quan, nói rõ 'Sổ tay chưa có thông tin về câu hỏi này' — KHÔNG bịa." Output: markdown thuần (không JSON — Decision Log #6) + dòng cuối `SOURCES: [1,3,5]`.
  - `NOTEBOOK_QA_SELECT_PROMPT` — cho LLM selection call, output JSON `{ "ids": [...] }`.
- `lib/llm/summarizer.ts` thêm `answerFromNotebook(question, entries, config, onProgress, prompts, signal)` (đặt cùng file với `researchTopic` — cùng pattern call đơn).
- Parse citation `[n]` → map về `entries[n-1].id` ở UI; parse selection JSON tái dùng pattern parse hiện có (strip backticks).

#### B5. Background handler

- `case 'notebook_qa'` trong `processLLMTask`: nhận `{ question, entries, mode }`:
  - `mode: 'select'` → gọi selection prompt, result `{ ids }`.
  - `mode: 'answer'` → gọi answer prompt, result `{ answer, entryIds }`.
  - Orchestration 2-stage nằm ở **sidepanel** (`useNotebookQA`) — mỗi stage 1 `START_LLM_TASK` riêng, để progress UI + cancel + cost guard hoạt động per-call như mọi task khác.
- `buildPipeline` (background): `notebook_qa` → `{ workflow: 'research', steps: [pendingStep('qa', 'Tra cứu sổ tay')] }`.

#### B6. UI — tab "Hỏi đáp" trong NotebookView

- NotebookView thêm sub-tab bar trên cùng: `[Sổ tay] [Hỏi đáp]` (state local, không route mới — Decision Log #8).
- Tab Hỏi đáp:
  - Textarea câu hỏi + nút "Hỏi" (disable khi đang chạy / sổ tay trống).
  - Empty state khi `totalEntries === 0`: "Sổ tay trống — lưu kiến thức trước khi hỏi đáp."
  - Cost guard: trước khi chạy hiện ước tính "~1–2 lệnh gọi LLM, ~N ngàn tokens" theo pattern `confirmingExtract` (ConfirmInline) nếu vượt `LLM_WARN_THRESHOLD_CALLS`/token threshold; câu hỏi nhỏ (1 call, ít tokens) chạy thẳng.
  - Khi chạy: progress qua `useLLM` (`LLM_PROGRESS`), nút Hủy (CANCEL_LLM_TASK).
  - Kết quả: render markdown (tái dùng renderer của SummaryContent nếu tách được, hoặc renderer tối giản), citations `[n]` thành button → switch sang tab Sổ tay + scroll/highlight entry (tái dùng focus pattern C9a của F27, nội bộ view nên đơn giản hơn — không cần query param).
  - Dưới câu trả lời: panel "Nguồn (N ghi chú)" — list title các entries được cite, click → focus.
  - Nút "💾 Lưu thành ghi chú": tạo manual entry `{ title: question, content: answer, category: 'Hỏi đáp', manual: 1 }` (tái dùng A6).
  - Lịch sử trong session: mảng `{ question, answer, entryIds, at }` ref local — đổi tab không mất, đóng sidepanel mất (Decision Log #7).

---

## Technical Considerations

### Affected files

**New:**
- `entrypoints/sidepanel/composables/useNotebookQA.ts` — retrieval + 2-stage orchestration + session history.
- `entrypoints/sidepanel/components/NotebookEntryEditor.vue` — form edit/create entry (dùng chung A2 + A6).
- `entrypoints/sidepanel/components/NotebookQAPanel.vue` — tab Hỏi đáp (tách khỏi NotebookView cho gọn).

**Modified:**
- `lib/types.ts` — `NotebookEntry` fields mới, 3 MessageType mới, `'notebook_qa'` taskType, `NotebookEntryForQA`.
- `lib/notebook-db.ts` — `notebookRenameCategory`, `notebookBulkUpdate`, `notebookBulkDelete`.
- `lib/prompts.ts` — `NOTEBOOK_QA_PROMPT`, `NOTEBOOK_QA_SELECT_PROMPT`.
- `lib/llm/summarizer.ts` — `answerFromNotebook` (+ select variant hoặc param `mode`).
- `entrypoints/background/index.ts` — 3 message handlers + case `notebook_qa` + pipeline entry.
- `entrypoints/sidepanel/composables/useNotebook.ts` — actions mới: `updateEntry`, `togglePin`, `renameCategory`, `bulkUpdate`, `bulkDelete`, `createManualEntry`; bỏ slice(6) categories.
- `entrypoints/sidepanel/views/NotebookView.vue` — sub-tabs, edit mode, selection mode, category manager panel, pin, manual entry button.

### Data flow Q&A

```
User gõ câu hỏi (tab Hỏi đáp)
  │
  ├── useNotebookQA: load entries (đã có trong useNotebook) → projection → estimateTokens
  │
  ├── fit context?
  │     ├── Yes → START_LLM_TASK notebook_qa { mode:'answer', entries: all }
  │     └── No  → client scoring → top-K fit? 
  │                 ├── Yes → START_LLM_TASK { mode:'answer', entries: topK }
  │                 └── No/score=0 → START_LLM_TASK { mode:'select', index }   (call 1)
  │                                  → ids → START_LLM_TASK { mode:'answer' }  (call 2)
  │
  └── LLM_RESULT → parse citations → render answer + nguồn → optional save manual entry
```

### Edge cases

1. **Edit entry đang nằm trong selection mode** → thoát selection trước khi mở editor (1 mode tại 1 thời điểm).
2. **Rename category trùng tên đích (merge)** → confirm "Gộp N mục từ 'A' vào 'B'?"; idempotent.
3. **Rename khi filter đang active trên category cũ** → sau rename, filter chuyển sang tên mới (hoặc clear filter).
4. **Edit entry orphaned/manual** → skip sync topic cache (không có `sourceTopicUrl` hợp lệ).
5. **Q&A khi đang có LLM task khác chạy** → disable nút Hỏi (dùng `isLoading` của useLLM, giống các view khác).
6. **Selection call trả ids không tồn tại / JSON hỏng** → filter ids hợp lệ; nếu rỗng → fallback dùng top-K client scoring; nếu vẫn rỗng → báo "Không tìm thấy ghi chú liên quan".
7. **Câu trả lời cite [n] ngoài range** → render text thường, không crash.
8. **Entry bị xóa giữa lúc Q&A đang chạy** → citation focus không tìm thấy element → silently skip (pattern F27 C9b).
9. **Concurrent edits 2 sidepanel** → last-write-wins qua `notebookPut`, chấp nhận (single user).
10. **Bulk update với ids một phần đã bị xóa** → skip missing, trả count thực tế.
11. **`finish_reason: length` trong answer call** → đã có salvage pattern `INCOMPLETE_RESPONSE` + `partialText`; hiển thị câu trả lời partial + warning (tái dùng `truncationWarning` pattern).
12. **Manual entry export (F38 granular export)** — exporter phải serialize được fields mới (kiểm tra `lib/exporter.ts` strip/giữ fields; thêm fields mới vào export schema, bump minor schema version nếu cần).

### Constraints

- Local-only, không thêm dependency mới (không vector lib, không markdown lib mới nếu đã có renderer).
- Q&A tối đa 2 LLM calls cho 1 câu hỏi.
- Mọi LLM call đều user-triggered + qua cost guard (nguyên tắc F26/F27 Decision #2).
- `npm run compile` + `npm run test` clean.

---

## Implementation Notes

Thứ tự: **A trước, B sau** (B đọc dữ liệu A làm phong phú — userNote tham gia scoring/answer; A độc lập hoàn toàn).

**Phase A (estimate 2–3 ngày):**
1. types.ts fields mới → notebook-db 3 hàm mới → background 3 handlers (thuần data layer, test unit được ngay với fake-indexeddb nếu có, không thì test qua compile + manual).
2. `NotebookEntryEditor.vue` + tích hợp edit inline + sync topic cache.
3. Pin + filter pinned.
4. Category manager panel (rename/merge/delete).
5. Selection mode + bulk actions.
6. Manual entry (reuse editor).
7. Self-review.

**Phase B (estimate 2–3 ngày):**
1. Prompts + `answerFromNotebook` + background case + taskType.
2. `useNotebookQA.ts` — scoring, budget, 2-stage orchestration.
3. `NotebookQAPanel.vue` + sub-tabs trong NotebookView + citation focus.
4. Cost guard + save-as-note.
5. Self-review.

**Patterns tái sử dụng:** `useLLM` (START_LLM_TASK/LLM_RESULT), `ConfirmInline`, cost guard F26, focus-highlight F27 C9a, `sendMessageQuiet` cho sync topic cache, salvage `INCOMPLETE_RESPONSE`.

**Anti-patterns cần tránh:**
- KHÔNG để background tự đọc notebook-db trong LLM task (sidepanel orchestrate — giữ contract hiện tại).
- KHÔNG auto-trigger Q&A khi user đang gõ (chỉ chạy khi bấm Hỏi).
- KHÔNG dùng `JSON.stringify(x, null, 2)` khi build payload entries cho LLM (lãng phí ~30% tokens — bài học F24).
- KHÔNG hardcode K hoặc word cap trong prompt — tính từ `maxTokens`/context (bài học fix-reduce-summary-word-cap, KH5).

---

## Test Plan

### Phase A
- [ ] Sửa title/content/category/tags/userNote → reload sidepanel → giữ nguyên; badge "đã sửa" hiện.
- [ ] Edit entry có topic nguồn còn cache → mở KnowledgeView topic đó → bản sao trong `knowledgeEntries` đã cập nhật.
- [ ] Edit entry orphaned → không lỗi, không gọi SAVE_CACHED_TOPIC.
- [ ] Pin 2 entries → nổi đầu group ở cả 4 view modes; filter "Đã ghim" đúng.
- [ ] Rename category "Mẹo vặt" → "Tips" → mọi entry đổi theo, pills cập nhật, stats đúng.
- [ ] Rename sang tên đã tồn tại → confirm merge → gộp đúng.
- [ ] Xóa category → entries về "Khác", không mất entry.
- [ ] Multi-select 5 entries → đổi category + thêm tag → cả 5 cập nhật trong 1 lần.
- [ ] Bulk delete có confirm; hủy không xóa.
- [ ] Tạo manual entry → hiện badge "Tự tạo", không có link post; unsave = xóa hẳn.
- [ ] Export (F38) topic/group chứa entry đã edit + manual entry → JSON hợp lệ, import lại đủ fields.

### Phase B
- [ ] Sổ tay 10 entries (fit context) → hỏi → 1 call duy nhất, trả lời kèm [n] citations đúng.
- [ ] Sổ tay lớn (giả lập 300 entries, không fit) → keyword question → 1 call với top-K; abstract question (score 0) → 2 calls (select → answer).
- [ ] Citation [2] click → switch tab Sổ tay, entry expand + highlight ring.
- [ ] Câu hỏi ngoài phạm vi sổ tay → trả lời "chưa có thông tin", không bịa.
- [ ] Cancel giữa chừng → task hủy sạch, UI reset, hỏi lại được.
- [ ] "Lưu thành ghi chú" → manual entry mới category "Hỏi đáp" xuất hiện trong tab Sổ tay.
- [ ] Sổ tay trống → tab Hỏi đáp hiện empty state, nút Hỏi disabled.
- [ ] `finish_reason: length` → partial answer + truncation warning, không trắng màn.
- [ ] Đổi qua lại tab Sổ tay/Hỏi đáp → lịch sử Q&A trong session còn nguyên.

### Integration
- [ ] `npm run compile` clean.
- [ ] `npm run test` pass (unit mới: scoring function, budget calc, citation parse, notebook-db bulk ops nếu mock được).
- [ ] E2E mock: `MockLLMProvider` queue 2 responses cho 2-stage flow, assert `getCallCount() === 2`; single-stage assert `=== 1`.

---

## Rollback Plan

- **Phase A:** fields mới đều optional — revert code, data cũ/mới đều đọc được. Không cần migration ngược.
- **Phase B:** xóa taskType + prompts + composable + panel; không đụng schema. Manual entries đã tạo (category "Hỏi đáp") vẫn là NotebookEntry hợp lệ.

---

## Decision Log

### Quyết định 1: Sửa trực tiếp `category`/`tags` của entry, không thêm field `userCategory` song song
- **Đã chọn:** Edit mutate thẳng field hiện có + set `editedAt`.
- **Lý do:** 1 nguồn truth cho filter/group/index (`by-category`, `by-tags` index đang trỏ vào field này); 2 field song song bắt mọi consumer phải resolve ưu tiên → bug surface lớn.
- **Đã cân nhắc nhưng loại:**
  - `userCategory` override LLM category — loại vì index `by-category` không thấy override, filter sai.
  - Giữ bản gốc LLM trong `originalCategory` để "reset" — loại vì YAGNI; user sửa là có chủ đích.
- **Điều kiện thay đổi:** Nếu sau này có "re-extract làm mới entries" cần phân biệt LLM-gen vs user-edit → `editedAt` đã đủ làm guard (không overwrite entry có `editedAt`).

### Quyết định 2: Category derive từ entries, không tạo store metadata riêng
- **Đã chọn:** Không có object store `categories`; rename/merge = bulk update entries qua index `by-category`.
- **Lý do:** Tránh 2 nguồn truth phải sync (category store vs thực tế trên entries); empty category không có ý nghĩa hiển thị; pattern F27 đã derive categories trong `notebookGetStats`.
- **Đã cân nhắc nhưng loại:**
  - Store `notebookMeta` lưu category order + màu — loại vì chưa có yêu cầu order/màu custom; thêm sau không phá schema (store mới = bump version, độc lập).
- **Điều kiện thay đổi:** Khi cần custom ordering / màu sắc / category rỗng chờ dùng → thêm store metadata lúc đó.

### Quyết định 3: Quản lý chuyên sâu chỉ ở NotebookView, không ở KnowledgeView
- **Đã chọn:** Edit/pin/bulk/manual chỉ trong Sổ tay. KnowledgeView (per-topic) giữ nguyên: extract → xem → save/unsave.
- **Lý do:** Semantics F27 — KnowledgeView là "kết quả LLM + cửa vào sổ tay", Sổ tay là "tài sản đã curate". Edit ở KnowledgeView tạo câu hỏi khó: entry chưa saved mà edit thì lưu đi đâu? Sync 2 chiều liên tục giữa knowledgeEntries và notebook là nguồn bug (đúng loại triple-state đã trả giá ở tasks 129–134).
- **Đã cân nhắc nhưng loại:**
  - Edit cả 2 nơi — loại vì sync 2 chiều phức tạp, lợi ích thấp.
- **Điều kiện thay đổi:** Nếu user thường xuyên muốn sửa ngay lúc save → thêm "Save & edit" navigate sang notebook focus entry đó.

### Quyết định 4: Edit sync ngược topic cache theo kiểu fire-and-forget một chiều (notebook → topic)
- **Đã chọn:** Sau UPSERT notebook thành công, nếu source topic còn cache → cập nhật bản sao trong `knowledgeEntries` qua `SAVE_CACHED_TOPIC`, fire-and-forget, không rollback.
- **Lý do:** Nhất quán pattern `unsaveEntry` hiện có trong `useNotebook.ts`; notebook là canonical sau khi save (tinh thần F27 Decision #5 — eventual consistency đủ cho local IDB).
- **Đã cân nhắc nhưng loại:**
  - Không sync (chấp nhận divergence) — loại vì user mở lại KnowledgeView thấy bản cũ → tưởng mất edit.
  - Atomic 2-store transaction — loại vì topic cache đi qua message SAVE_CACHED_TOPIC (merge logic ở background), không cùng transaction scope; over-engineer.
- **Điều kiện thay đổi:** Nếu xuất hiện bug mất sync lặp lại → reconciliation khi mở KnowledgeView (đọc notebook entries theo topicUrl, overwrite saved copies).

### Quyết định 5: Retrieval không dùng embeddings — client scoring + LLM selection 2-stage
- **Đã chọn:** Tầng 0 keyword scoring miễn phí; cả kho fit context → gửi hết; không fit → top-K; câu hỏi trừu tượng → LLM selection call rồi answer call (max 2 calls).
- **Lý do:**
  - Extension local-only: không có embedding API mặc định (user có thể chỉ dùng 1 LLM key); lưu vector vào IDB + tính cosine JS là cả hệ thống mới (re-embed khi edit, migration, model mismatch giữa các provider).
  - Quy mô thực tế Sổ tay (trăm → nghìn entries, mỗi entry ~100–300 tokens) nằm trong tầm context của model hiện đại — phần lớn câu hỏi chỉ tốn 1 call.
  - LLM selection trên index gọn (id+title+tags) xử lý tốt semantic gap mà keyword miss, chi phí 1 call nhỏ.
- **Đã cân nhắc nhưng loại:**
  - Embeddings + cosine trong IDB — loại vì complexity/maintenance lớn, cần provider hỗ trợ embedding, lợi ích chỉ rõ khi >5–10K entries.
  - Chỉ keyword scoring (không LLM selection) — loại vì tiếng Việt đồng nghĩa nhiều ("mua nhà" vs "bất động sản") → recall kém với câu hỏi trừu tượng.
  - Gửi toàn bộ kho mọi lúc — loại vì kho lớn tràn context + tốn token vô ích.
- **Điều kiện thay đổi:** Khi notebook > ~5000 entries hoặc user phàn nàn recall → cân nhắc embeddings làm F4x riêng.

### Quyết định 6: Answer output là markdown thuần + dòng `SOURCES:`, không JSON
- **Đã chọn:** LLM trả markdown tự do với citation `[n]` inline; dòng cuối `SOURCES: [...]` để UI biết entries nào được dùng.
- **Lý do:** Bài học xương máu của project với JSON parsing (`repairUnescapedQuotes`, control chars, truncated JSON...) — câu trả lời tự nhiên dài là worst-case cho JSON escape. Markdown + regex citation đơn giản, bền với truncation (partial markdown vẫn đọc được, partial JSON thì chết).
- **Đã cân nhắc nhưng loại:**
  - JSON `{ answer, sources }` — loại vì lý do trên.
  - Structured output / JSON mode per-provider — loại vì 3 adapters hỗ trợ không đồng đều, local LLM càng không.
- **Điều kiện thay đổi:** Như F27 Decision #1 — khi mọi provider hỗ trợ JSON Schema mode reliable.

### Quyết định 7: Lịch sử Q&A session-only, không persist
- **Đã chọn:** Lịch sử hỏi đáp là ref local trong NotebookView/composable; mất khi đóng sidepanel. Muốn giữ → bấm "Lưu thành ghi chú".
- **Lý do:** Persist history = thêm store/schema + UI quản lý history + câu hỏi "history có vào export không" — scope phình. Save-as-note tái dùng manual entry (A6) cho user lựa chọn giữ cái đáng giữ, đúng triết lý opt-in persist của F27.
- **Đã cân nhắc nhưng loại:**
  - Store `qaHistory` trong IDB — loại vì over-engineer ở phase này.
  - `browser.storage.session` — loại vì sidepanel reload là mất, không hơn ref bao nhiêu.
- **Điều kiện thay đổi:** Nếu dùng Q&A thường xuyên và cần xem lại → thêm store history + giới hạn N items.

### Quyết định 8: Q&A là sub-tab trong NotebookView, không phải route mới
- **Đã chọn:** Tab bar local `[Sổ tay] [Hỏi đáp]` trong NotebookView; không thêm route `/notebook/qa`.
- **Lý do:** Q&A và list dùng chung data (`entries` đã load), citation focus chuyển tab nội bộ mượt hơn cross-route; nav chính (App.vue 4 tabs) không đổi → không đụng Phase 5 doc sync nặng.
- **Đã cân nhắc nhưng loại:**
  - Route riêng `/qa` — loại vì phải reload entries, focus cross-route phức tạp (lại cần query param + race condition pattern).
  - Q&A đặt ở TopicHub — loại vì kho dữ liệu là notebook, đặt trong notebook đúng mental model.
- **Điều kiện thay đổi:** Nếu Q&A trở thành tính năng chính được dùng nhiều hơn cả list → cân nhắc nâng cấp thành tab top-level.

### Quyết định 9: 2-stage orchestration nằm ở sidepanel, mỗi stage 1 START_LLM_TASK
- **Đã chọn:** `useNotebookQA` điều phối select → answer; background chỉ execute từng call.
- **Lý do:** Giữ contract hiện tại (sidepanel orchestrate — useKnowledge map-reduce cũng vậy); cost guard, progress, cancel đều hoạt động per-call sẵn có; background không cần đọc notebook-db trong LLM path.
- **Đã cân nhắc nhưng loại:**
  - Background tự chạy cả pipeline trong 1 task — loại vì phải nhét retrieval logic + notebook read vào background, cancel giữa 2 stage phức tạp hơn, khác pattern mọi task hiện có.
- **Điều kiện thay đổi:** Nếu MV3 SW termination giữa 2 stage gây lỗi thực tế (stage 2 không start) → chuyển orchestration xuống background với keepalive như summarize.
