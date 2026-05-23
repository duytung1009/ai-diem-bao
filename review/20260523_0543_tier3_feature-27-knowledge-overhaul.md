# Review F27 — Knowledge Overhaul (Teaser, Opt-in Persist, Personal Notebook)

## Metadata

- **File reviewed:** Toàn bộ staged changes cho F27 (22 files, +2188 / -203 LOC)
- **Review tier:** tier3 (>200 LOC, cross-module, IDB schema bump, route mới, MV3 messaging)
- **Model used:** opus
- **Planning ref:** `planning/20260522_1106_27-feature-knowledge-overhaul.md`
- **Diff size:** +2188 / -203 LOC

## Files in scope (staged)

```
lib/types.ts                                       +12  -1
lib/cache-db.ts                                     +9  -2
lib/notebook-db.ts                                +139   (NEW)
lib/messaging.ts                                    +7   (sendMessageQuiet)
lib/constants.ts                                    +3
lib/errors.ts                                       +1  -1
lib/llm/summarizer.ts                              +19  -5
lib/llm/claude-adapter.ts                           +8
lib/prompts.ts                                     +35 -33
entrypoints/background/index.ts                    +66  -1
entrypoints/sidepanel/main.ts                       +1
entrypoints/sidepanel/App.vue                       +6  -1
entrypoints/sidepanel/composables/useNotebook.ts  +171   (NEW)
entrypoints/sidepanel/composables/useSummarize.ts   +1  -5
entrypoints/sidepanel/views/SummaryView.vue        +60 -12
entrypoints/sidepanel/views/KnowledgeView.vue    +192 -45
entrypoints/sidepanel/views/NotebookView.vue     +297   (NEW)
entrypoints/sidepanel/views/TopicHubView.vue       +88 -34
entrypoints/sidepanel/views/HelpView.vue           +22  -0
entrypoints/sidepanel/views/ResearchView.vue        +7  -1
```

## Checklist

| Category | Status | Notes |
|----------|--------|-------|
| Logic correctness | ❌ | Race condition trong notebook orphan/delete (non-atomic tx); double filtering trong useNotebook; filters không trigger reload |
| Edge cases covered | ⚠️ | Một số: focus race xử lý đúng. Bỏ sót: handleDelete không sync notebook, legacy cached topics count sai |
| Error handling | ⚠️ | Fire-and-forget OK qua sendMessageQuiet. Một số catch ăn lỗi không log; `success: false` không kèm reason |
| Performance concerns | ❌ | Lazy orphan trong GET_NOTEBOOK_ENTRIES là O(N²), N×IDB-write per request |
| Security implications | ✅ | Không có injection/XSS path mới — text rendered qua Vue interpolation, IDB local-only |
| Consistency with patterns | ⚠️ | `as any` cast trong handler, import giữa script, dead computed, duplicate CTA template |
| Type safety | ❌ | `sendMessageQuiet(type: string)` mất kiểm soát MessageType; `as any` trong UPSERT handler |
| Test coverage | ⚠️ | Không thấy test mới cho notebook-db, useNotebook, hoặc orphan flow trong staged changes |
| PRD alignment | ⚠️ | 95% theo PRD. Lệch nhỏ: `orphaned: number` thay vì boolean (lý do IDB key — đúng kỹ thuật nhưng PRD chưa update), default "Giữ kiến thức" dùng btn-secondary thay vì btn-primary |

## Issues Found

### Critical — phải fix trước khi merge

| # | Severity | File | Line | Description | Suggestion |
|---|----------|------|------|-------------|------------|
| C1 | critical | `entrypoints/background/index.ts` | 150–183 | **Lazy orphan O(N²) + N transactions**. Trong `GET_NOTEBOOK_ENTRIES`, vòng lặp `for url of orphanedUrls { for e of entries { ... await notebookPut(e) } }`. Với 50 topics × 1000 entries → 50K so sánh và mỗi match là 1 IDB write transaction riêng. Block response thời gian dài. Cũng chỉ orphan entries có trong result set hiện tại — entries bị filter ra vẫn ở trạng thái cũ. | (a) Group entries theo `sourceTopicUrl` bằng `Map` trước (O(N)). (b) `Promise.all` các `dbGet(url)` parallel. (c) Cho từng URL đã chết, lấy TẤT CẢ entries qua `notebookGetByTopic(url)` (không chỉ filtered) rồi `notebookOrphanByTopic(url)` một lần (single tx). (d) Tốt hơn: tách thành job riêng (`RECONCILE_NOTEBOOK_ORPHANS`) chạy 1 lần khi mở NotebookView, không nhét vào hot path GET. |
| C2 | critical | `entrypoints/sidepanel/composables/useNotebook.ts` | 26–48, 91–106 | **Double-filter + filter change không reload**. `loadEntries` gửi filters sang background (background đã filter), rồi `filteredEntries` computed filter lại client-side. Filter chỉ chạy 1 lần lúc `onActivated`; user đổi filter thì `entries.value` đứng yên → client filter trên dataset đã bị backend cắt sẵn → kết quả sai khi user mở rộng filter (ví dụ: tải lần đầu với `topicUrl=A`, sau chọn "Tất cả thớt" → vẫn chỉ thấy A). | Chọn 1 trong 2: **(a)** `loadEntries()` không gửi filters, tải tất cả; mọi filter xử lý client-side. Đơn giản, phù hợp scale ≤2000 entries. **(b)** Watch `filters` deep và reload từ backend mỗi khi đổi — giữ backend filtering. Tránh double-filter ở mọi trường hợp. |
| C3 | critical | `lib/notebook-db.ts` | 86–113 | **`notebookOrphanByTopic` và `notebookDeleteByTopic` không atomic**. Pattern `await notebookGetByTopic(topicUrl)` (tx readonly) → `await getDB().then(...)` mở **tx mới** readwrite, dùng entries cũ. Giữa 2 tx, entries có thể bị modify (toggleSave từ NotebookView khác chẳng hạn). Cũng tốn 2 round-trip IDB. | Mở 1 tx readwrite duy nhất, dùng `cursor` trên `by-topicUrl` index, modify in-place rồi `cursor.update(...)` / `cursor.delete()`. Ví dụ: `index.openCursor(topicUrl)` → trong `onsuccess` modify hoặc delete, advance cursor. Atomic + 1 tx. |
| C4 | critical | `entrypoints/sidepanel/views/KnowledgeView.vue` | 770–795 | **`handleDelete` (nút thùng rác) không sync notebook**. Khi entry có `saved=true` và user bấm delete: entry bị remove khỏi local + topic cache, nhưng KHÔNG gửi `DELETE_NOTEBOOK_ENTRY`. Notebook giữ entry "mồ côi giả" mãi mãi vì `sourceTopicUrl` vẫn tồn tại trong topic cache → lazy orphan không bao giờ fire. | Thêm sync giống `toggleSave`: `if (entry.saved) sendMessageQuiet('DELETE_NOTEBOOK_ENTRY', { id: entry.id });` ngay sau khi update local state. |
| C5 | critical | `entrypoints/sidepanel/composables/useNotebook.ts` | 152–157 | **`unsaveEntry` không sync topic cache**. NotebookView unsave → `DELETE_NOTEBOOK_ENTRY` ok, nhưng nếu source topic đang trong cache với entry đó trong `knowledgeEntries`, cache vẫn coi entry là saved. Phase B đảo ngược: knowledgeEntries chỉ chứa saved → effectively entry vẫn xuất hiện trong KnowledgeView khi user mở topic đó. Hai store lệch. | Sau `DELETE_NOTEBOOK_ENTRY`, gọi `GET_CACHED_TOPIC` cho `entry.sourceTopicUrl`, nếu tồn tại → `SAVE_CACHED_TOPIC` với `knowledgeEntries` đã loại entry đó. Hoặc gửi message mới `SYNC_TOPIC_UNSAVE { topicUrl, entryId }` để background xử lý atomic. |

### Major — cần fix nhưng có thể defer

| # | Severity | File | Line | Description | Suggestion |
|---|----------|------|------|-------------|------------|
| M1 | major | `lib/messaging.ts` | 18 | `sendMessageQuiet(type: string, ...)` — không dùng `MessageType` union như `sendMessage`. Mọi caller mất compile-time check cho tên message — typo `'UPSER_NOTEBOOK_ENTRY'` sẽ silent fail. | Đổi signature thành `sendMessageQuiet(type: MessageType, payload?: unknown): void`. Test compile pass với existing callers. |
| M2 | major | `entrypoints/background/index.ts` | 191 | `notebookPut(message.payload as any)` — bypass type safety. Nếu payload bị mangled trong runtime, sẽ throw deep trong IDB. | `notebookPut(message.payload as NotebookEntry)` + validate cơ bản: `if (!isNotebookEntry(payload)) return sendResponse({ success: false, error: 'invalid payload' });` |
| M3 | major | `entrypoints/sidepanel/views/TopicHubView.vue` | 511–537 | **Dialog count dùng `topic.knowledgeEntries.length`** — sau Phase B đây là saved entries. Với cached topic legacy (pre-F27) chứa toàn bộ entries (cả unsaved), dialog nói "5 kiến thức đã lưu" nhưng `notebookGetByTopic` trả 0 → "Giữ kiến thức" thành no-op confusing. | Lấy count thật từ `GET_NOTEBOOK_ENTRIES { topicUrl }` khi `confirmDelete()` được gọi; cache vào `pendingDeleteNotebookCount`. Hoặc kèm `notebookCount` trong `GET_ALL_CACHED_TOPICS` response. |
| M4 | major | `entrypoints/sidepanel/views/KnowledgeView.vue` | 76–97 | Hai watchers cho `route.query.restore` và `route.query.extract` — không có `immediate: true`. Nếu user vào URL `?extract=true` lần đầu, watchers chỉ fire khi query *thay đổi*, không fire ở load. | Thêm `{ immediate: true }` hoặc dùng `onMounted` đọc `route.query` rồi trigger. Test bằng SummaryView.handleKnowledgeCTA. |
| M5 | major | `entrypoints/sidepanel/views/SummaryView.vue` | 402–426, 488–512 | **CTA block duplicate 2 lần** — cùng nội dung HTML trong 2 nhánh isSegmentMode (segment / non-segment). Sửa 1 nơi quên nơi khác là kiểu bug F26 đã gặp với `confirmingExtract`. | Extract thành component `<KnowledgeCTA :state="..." @action="..." />` hoặc đưa ra `<template v-if>` ngoài cùng cùng các CTA. Single source of truth. |
| M6 | major | `lib/cache-db.ts` | 13 | `getDB()` export — trước private. OK nếu chỉ `notebook-db.ts` dùng (single-connection per DB là đúng pattern), nhưng đã expose nội bộ — ai khác có thể grab lock/blocking tx. | Thêm JSDoc cảnh báo: `/** Internal: chỉ dùng từ {cache-db, notebook-db}. Tránh share connection trực tiếp từ UI layer. */` Hoặc tách thành `_getDB` (convention) hoặc tách file `lib/db-connection.ts` cho rõ ràng. |

### Minor / Nit

| # | Severity | File | Line | Description | Suggestion |
|---|----------|------|------|-------------|------------|
| m1 | minor | `entrypoints/sidepanel/views/TopicHubView.vue` | 163–166 | `pendingDeleteTopic` computed không được tham chiếu ở đâu. | Xoá hoặc dùng trong template thay vì `topic.knowledgeEntries?.length` repeat. |
| m2 | minor | `entrypoints/sidepanel/views/TopicHubView.vue` | 184 | `if (entries.length > 0) return;` trong `executeDelete` — template chia 2 branch nên branch này không gọi `executeDelete`, guard là dead code defensive. | Xoá guard hoặc throw để bắt regression nếu template logic đổi. |
| m3 | minor | `entrypoints/sidepanel/views/TopicHubView.vue` | 522–533 | PRD C7: "default highlight 'Chỉ xoá thớt — giữ kiến thức'". Implementation dùng `btn-secondary` (xám) cho lựa chọn này và `btn-danger` (đỏ) cho destructive. Visual emphasis ngược với PRD intent. | Đổi orphan button thành `btn-primary` (xanh) để user click theo bản năng vào lựa chọn an toàn. Giữ `btn-danger` cho destructive. |
| m4 | minor | `entrypoints/sidepanel/views/TopicHubView.vue` | 514, 555 | Diacritic mix: `"Xóa"` (btn-danger) và `"Xoá thớt này?"` cùng file. | Standardize "Xoá" (đúng chính tả VN hiện đại) hoặc "Xóa" — pick 1 và replace_all. |
| m5 | minor | `entrypoints/sidepanel/views/NotebookView.vue` | 39 | `import { useTopicStore }` ở giữa script (sau function definitions). | Move lên đầu cùng các imports khác. |
| m6 | minor | `entrypoints/sidepanel/views/NotebookView.vue` | 23–25 | `openInExtension` không xử lý khi `GET_CACHED_TOPIC` trả null (topic deleted ngoài luồng). Silent no-op. | Hiển thị toast/alert "Thớt gốc đã xoá khỏi cache. Mở link gốc thay thế?" và auto-fallback `openPostLink`. |
| m7 | minor | `entrypoints/sidepanel/views/KnowledgeView.vue` | 60 | `canRestore = !!ct?.knowledgeChunks?.length && entries.value.length === 0` — chỉ true khi entries hoàn toàn trống. User có 1-2 saved entries từ session trước + chunks → button Khôi phục biến mất. UX gap. | Thêm action "Khôi phục danh sách (thêm vào danh sách hiện tại)" trong header thay vì chỉ ở empty state. Hoặc đổi điều kiện `entries.length === savedEntries.length` (no fresh entries). |
| m8 | minor | `lib/types.ts` | 218 | `orphaned?: number` thay vì `boolean` theo PRD. Lý do IDB không index boolean — đúng kỹ thuật. Nhưng PRD chưa update, các nơi check `if (e.orphaned)` đang dựa vào truthy của 1/undefined. | (a) Update PRD Phase C2 ghi rõ schema dùng `number` cho IDB compat. (b) Thêm comment trong types.ts: `/** 1 = orphaned, undefined = active. number để hỗ trợ IDB index */`. (c) Định nghĩa hằng `ORPHAN_TRUE = 1` để tránh magic number. |
| m9 | minor | `entrypoints/sidepanel/composables/useNotebook.ts` | 64–77 | `groupedEntries` cho tag view: entry có nhiều tags xuất hiện ở nhiều groups → tổng count tag-view > totalEntries. Có thể confuse khi user thấy "(15)" cho mỗi group nhưng totalEntries = 8. | Hoặc note trong UI: "Một kiến thức có thể thuộc nhiều thẻ". Hoặc cluster theo tag chính (tag[0]) — đơn giản hơn nhưng mất data. |
| m10 | nit | `entrypoints/background/index.ts` | 191, 197, 203, 209 | `sendResponse({ success: false })` không kèm error message. Debug khó. | `.catch(err => sendResponse({ success: false, error: String(err) }))`. |
| m11 | nit | `entrypoints/sidepanel/composables/useNotebook.ts` | 158 | `unsaveEntry` swallow error trong empty catch. Không log, không toast. | `catch (err) { console.warn('[useNotebook] unsave failed', err); error.value = 'Không thể bỏ lưu — thử lại.'; }` |
| m12 | nit | `lib/prompts.ts` | global | Replace "thớt" → "thread" trong LLM prompts trong khi UI giữ "thớt". Intent có vẻ là để LLM dùng từ chuẩn tiếng Việt; nhưng VN reader sẽ thấy LLM output trộn "thread" rất sống sượng. | Document quyết định này trong CLAUDE.md "Know How" hoặc rollback — giữ "thớt" trong prompts (Vozer biết từ này hơn LLM "thread"). |
| m13 | nit | `entrypoints/sidepanel/composables/useSummarize.ts` | 646–650 | Đổi từ tìm scrape step running → `pl.markRunning('overall')`. Cleanup good nhưng commit ngoài scope F27. | OK — nhưng nếu Self-review phát hiện regression pipeline thì revert. |

## What looks good

- **Phase B core logic** — `runDirectExtract`, `runReducePhase`, `toggleSave` đúng PRD: chỉ persist saved entries vào topic cache, `knowledgeChunks` giữ nguyên cho restore.
- **Focus race resolution** — đúng pattern `watch + nextTick + clear query` như PRD C9a; reset `hasFocused` qua `route.fullPath` watcher.
- **`KNOWLEDGE_MAX_CHUNK_BUDGET = 12_000` cap** — quan trọng cho 128K context models, tránh chunk to làm LLM output kém.
- **`computeKnowledgeEntryCap`** dùng constant `TOKENS_PER_KNOWLEDGE_ENTRY_JSON = 200` (trước hardcode 150) — refactor sạch.
- **Claude adapter `stop_reason: 'max_tokens'` detection** — bắt được edge case LLM bị cắt response, hiện error rõ ràng cho user.
- **`parseKnowledgeEntries` hardening** — throw rõ error khi text quá ngắn / parse fail thay vì return `[]` silent.
- **IDB DB_VERSION bump 2→3** — upgrade path đúng convention; chỉ tạo store mới, không touch store cũ.
- **Index `by-tags` dùng `multiEntry: true`** — đúng theo review point #1 lần trước.
- **TopicHubView 2-choice delete dialog** — implement đúng UX intent của Decision Log #7.
- **NotebookView grouping** — 4 view modes (topic/category/tag/timeline) clean; timeline group "Hôm nay/Hôm qua" + ngày là touch UX tốt.
- **`handleClearKnowledgeData` recovery action** — bắt được trường hợp restore fail vì LLM JSON corrupted, cho user lối thoát.

## Summary

- **Overall:** **request-changes** — có 5 issue critical phải fix trước khi merge (data consistency notebook↔topic cache, performance lazy orphan, atomicity IDB tx).
- **Key concern:** **Notebook và Topic cache có 2 đường sync nhưng không đầy đủ**:
  - KnowledgeView toggleSave: ✅ sync 2 chiều
  - KnowledgeView handleDelete: ❌ chỉ update topic cache, không touch notebook (C4)
  - NotebookView unsaveEntry: ❌ chỉ update notebook, không touch topic cache (C5)
  - Topic delete: ✅ có 2 lựa chọn rõ ràng
  - Lazy orphan: ❌ logic đúng nhưng impl O(N²) + non-atomic + chỉ apply cho filtered subset (C1, C3)
  - useNotebook loadEntries: ❌ double-filter conflict với reactive filters (C2)
- **Recommended priority cho fix:**
  1. C2 (double-filter) — user-visible, easy fix.
  2. C4 + C5 (sync gaps) — silent data corruption.
  3. C1 (perf O(N²)) — chỉ visible khi notebook >100 entries.
  4. C3 (atomicity) — race window thực tế hẹp nhưng đúng practice IDB.
  5. M1, M2 (type safety) — chặn future bugs.
  6. M5 (CTA dup) — chặn drift giữa 2 nhánh.
- **Tier 3 escalation:** đã Opus review. Không cần Opus lần 2; Sonnet fix tốt dựa trên review này.
- **PRD compliance:** ~92% — implementation chấm điểm cao về structure và intent, các bug critical đều là implementation detail (không cần redesign).

## Test Plan đề xuất (verify sau khi fix)

- [ ] **C1**: tạo 200 notebook entries từ 50 topic mock; xoá 10 topic ngoài luồng (qua DELETE_CACHED_TOPIC); mở NotebookView → check response time < 200ms; check tất cả entries từ 10 topic đã orphan, không chỉ filtered subset.
- [ ] **C2**: mở NotebookView, filter `topicUrl=A` (load), sau đó clear filter → entries phải hiện thêm các topic khác (yêu cầu reload hoặc client filter trên full set).
- [ ] **C3**: chạy `notebookOrphanByTopic` đồng thời với `notebookPut` cho cùng topic → không bị lost-update.
- [ ] **C4**: extract → save entry → delete entry qua nút thùng rác → mở NotebookView → entry phải biến mất.
- [ ] **C5**: save entry trong topic A → mở NotebookView → unsave → quay về tab Kiến thức của A → entry phải KHÔNG còn (knowledgeEntries của topic cache đã sync).
- [ ] **M3**: cached topic legacy (manual seed `knowledgeEntries` 10 entries pre-F27, no notebook entries) → delete topic → dialog phải hiện đúng "0 kiến thức đã lưu" hoặc skip về simple confirm.
- [ ] **M4**: navigate trực tiếp `/knowledge?extract=true` (URL bar) → confirm box mở. Cũng test từ SummaryView CTA.
- [ ] `npm run compile` clean.
- [ ] `npm run test` pass.

## Self-review checklist (đã chạy?)

Trước khi set task `--status=review`, verify subtask Self-review đã chạy `template/self_review_checklist.md`. Nếu chưa, các điểm trong checklist này gợi ý self-review chưa được làm kỹ:
- Type safety (M1, M2)
- Cross-cutting sync (C4, C5)
- Performance hot path (C1)

Đề xuất chạy self-review lại trước khi merge.
