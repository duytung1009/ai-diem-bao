# F44 — Segment Grid Common Component (Tóm tắt + Trích xuất)

## Overview

KnowledgeView và SummaryView hiện có **hai khối "lưới phân đoạn" gần như giống hệt nhau** nhưng viết tay riêng:

- **KnowledgeView** (`<!-- F33: Per-segment extraction grid -->`, dòng 422–548): card có header (count + progress + nút "Trích xuất tất cả" + nút mở rộng), progress bar, danh sách row mỗi đoạn với **icon trạng thái** (`pending`/`extracting`/`done`/`partial`), nhãn `Trang x–y · n bài · n mục · thời gian`, nút hành động per-row (`Trích xuất`/`Trích xuất lại`/`Làm lại`/`Hủy`), và panel preview khi mở rộng.
- **SummaryView** (`<!-- Segment tabs -->`, dòng 334–378 + `<!-- Individual segment view -->` dòng 482–510): khối **tab/pill** — click một pill để xem tóm tắt từng đoạn ở một "Individual segment view" riêng. Trạng thái đoạn chỉ thể hiện bằng **chấm tròn nhỏ** (xanh = đã tóm tắt, vàng = chưa/incomplete). **Không có trạng thái lỗi**, không có nút "thử lại" per-segment, không có nút "tóm tắt từng đoạn" rõ ràng ngoài việc click vào pill.

Vấn đề:
- Hai pattern lệch nhau về UX dù bản chất giống nhau (đều là "danh sách đoạn + trạng thái + hành động per-segment + batch action").
- SummaryView không phân biệt được đoạn **tóm tắt lỗi** với đoạn **chưa tóm tắt** — khi một segment fail, nó chỉ set `error.value` toàn cục và segment không có summary → nhìn giống hệt đoạn chưa làm.
- "Individual segment view" trong SummaryView ít giá trị (tóm tắt từng đoạn hiếm khi cần đọc rời) nhưng làm phình UI + thêm state `activeSegmentIndex` kiêm nhiệm 2 vai trò (tab đang xem **và** đoạn đang chạy).

Mục tiêu: trích xuất một **component dùng chung `SegmentGrid.vue`** (data-driven, generic) để cả hai view dùng; chuẩn hoá UX phân đoạn; bổ sung **trạng thái lỗi + nút thử lại per-segment** cho SummaryView; **xoá** "Individual segment view".

Phạm vi: chỉ UI + state phái sinh ở tầng composable/view. **Không** đổi pipeline LLM, schema cache, message-passing.

## Goals

- **G1:** Có một component `entrypoints/sidepanel/components/SegmentGrid.vue` dùng chung, nhận dữ liệu chuẩn hoá (`SegmentGridItem[]`) + slot cho hành động và preview; **zero** logic domain (summarize/extract) bên trong.
- **G2:** KnowledgeView render lưới phân đoạn F33 **hoàn toàn qua `SegmentGrid`**; hành vi (extract/re-extract/làm lại/hủy/preview/batch) giữ nguyên, không regression.
- **G3:** SummaryView thay khối tab/pill bằng `SegmentGrid` với 3 hành động: **Tóm tắt tất cả** (header batch), **Tóm tắt từng đoạn** (row action), **Thử lại** (row action khi đoạn lỗi).
- **G4:** SummaryView hiển thị rõ trạng thái mỗi đoạn: `pending` (chưa tóm tắt) / `running` (đang tóm tắt) / `done` (đã tóm tắt) / `partial` (tóm tắt chưa đầy, có thể có bài mới) / **`error` (tóm tắt lỗi)**.
- **G5:** "Individual segment view" bị xoá khỏi SummaryView; tab "Tổng quan" + state `activeSegmentIndex` (vai trò "tab đang xem") bị loại bỏ. Vùng nội dung dưới lưới **chỉ** hiển thị tóm tắt tổng quan.
- **G6:** `npm run verify` (compile + lint + test) pass. Tuân thủ design system: icon-only button có `aria-label` (`IconButton`), không hardcode color, dùng `--color-*` token, `rounded-lg`/`rounded-full`.

## Requirements

### Component A — `SegmentGrid.vue` (mới, dùng chung)

Generic, không biết gì về summarize/extract. API:

**Types (export từ component):**
```ts
export type SegmentStatus = 'pending' | 'running' | 'done' | 'partial' | 'error';

export interface SegmentGridItem {
  index: number;        // chỉ số đoạn (0-based)
  label: string;        // "Trang 1–5" hoặc "1–5"
  meta?: string;        // dòng phụ: "· 30 bài · 12 mục · 5 phút trước"
  status: SegmentStatus;
}
```

**Props:**
- `items: SegmentGridItem[]` — danh sách đoạn đã chuẩn hoá (bắt buộc).
- `headerLabel: string` — text đếm ở header, ví dụ `"3 / 8 đoạn đã tóm tắt"` (parent tự build, vì wording khác nhau giữa 2 view).
- `progressPercent: number` — % cho progress bar (0–100).
- `expanded?: boolean` (v-model) — đóng/mở toàn lưới (mặc định `false`).
- `expandedIndex?: number | null` (v-model:expandedIndex) — đoạn đang mở preview (null = không có). Chỉ dùng khi có slot `preview`.
- `expandable?: boolean` — mỗi row có thể click để mở preview không (mặc định `true`; SummaryView truyền `false` vì không có preview).

**Slots:**
- `#header-actions` — vùng nút batch ở header (parent đặt "Trích xuất tất cả" / "Tóm tắt tất cả" / "Đang chờ… Hủy").
- `#row-actions="{ item }"` — nút hành động cuối mỗi row (Trích xuất / Tóm tắt / Làm lại / Thử lại / Hủy). Click trong slot này **không** trigger expand row (dùng `@click.stop` ở phía parent, hoặc component bọc trong vùng không-clickable).
- `#preview="{ item }"` — nội dung preview khi `expandedIndex === item.index`. Không cung cấp slot → không render vùng preview.

**Render (đóng gói, dùng lại từ F33 hiện tại):**
- Card (`class="card space-y-2"`) chứa:
  - Header row: `headerLabel` (trái) + `#header-actions` + nút toggle mở/đóng lưới (`IconButton`, `aria-label` "Mở rộng"/"Thu gọn", icon chevron xoay khi `expanded`).
  - Progress bar (track `bg-(--color-bg-muted)`, fill `bg-(--color-accent)`, width = `progressPercent%`).
  - Khi `expanded`: danh sách row. Mỗi row:
    - **Icon trạng thái** (centralize trong component) — `pending` → `○`; `running` → spinner SVG (`animate-spin`, accent); `done` → check xanh (`--color-success-text`); `partial` → `⚠️`; `error` → icon cảnh báo đỏ (`--color-error-text`).
    - **Label + meta** (`label` đậm, `meta` muted).
    - `#row-actions` slot ở cuối.
    - Nếu `expandable && có slot preview`: row click toggle `expandedIndex`; highlight row khi mở (`bg-(--color-accent-soft)`).
  - Khi có `expandedIndex` + slot `preview`: render `#preview` dưới row tương ứng.
- A11y: row clickable theo đúng pattern hiện có (giữ `eslint-disable` cho `no-static-element-interactions` nếu cần), nút toggle là `IconButton`.

**Emits:** `update:expanded`, `update:expandedIndex`.

### Component B — KnowledgeView refactor (dùng `SegmentGrid`)

- Thay toàn bộ block `<!-- F33: Per-segment extraction grid -->` (card + header + progress + danh sách row + preview) bằng `<SegmentGrid>`.
- Map `knowledgeSegments: KnowledgeSegmentView[]` → `SegmentGridItem[]`:
  - `label` = `Trang ${s.startPage}–${s.endPage}`.
  - `meta` = nối `· ${s.postCount} bài` + (nếu `rawEntryCount > 0`) `· ${s.rawEntryCount} mục` + (nếu `lastExtractedAt`) `· ${formatRelativeTime(s.lastExtractedAt)}`.
  - `status` = ánh xạ trực tiếp (`pending`/`extracting`→`running`/`done`/`partial`).
- `headerLabel` = `${done+partial count} / ${total} đoạn đã trích xuất`.
- `#header-actions`: giữ logic hiện tại — "Trích xuất tất cả" (`onExtractAllClick`) khi có đoạn pending/partial; "Đang chờ… / Hủy" khi `isBatchExtracting`.
- `#row-actions`: theo `status` — `pending`/`partial` → `Trích xuất`/`Trích xuất lại` (`extractSegment`); `done` → `Làm lại` (`reExtractSegment`); `extracting`→`running` → `Hủy` (`handleCancel`).
- `#preview`: giữ nguyên panel preview hiện có (badge "Chưa tổng hợp", danh sách 5 raw entries, "+N mục khác").
- Giữ nguyên: info banner (>5 đoạn), partial-warning banner, stale-reduce banner — **nằm ngoài** `SegmentGrid` (không thuộc component chung).
- `segmentGridExpanded` (v-model `expanded`) + `expandedSegmentIndex` (v-model:expandedIndex) chuyển thành props của `SegmentGrid`.

### Component C — SummaryView refactor (dùng `SegmentGrid`, xoá Individual view)

- **Xoá** block `<!-- Segment tabs -->` (dòng 334–378) và `<!-- Individual segment view -->` (dòng 482–510), kể cả pill "Tổng quan".
- Khi `segments.length > 1`: render `<SegmentGrid>` (thay cho card progress + pill grid cũ). Lưới hiện **luôn** khi có >1 đoạn (kể cả khi chưa có tóm tắt tổng quan), để user tóm tắt từng đoạn / tất cả.
- Map sang `SegmentGridItem[]` từ `segments` + `segmentSummaries` + `runningSegmentIndex` + `segmentErrors` (xem Component D):
  - `label` = `seg.label` (đã là `start–end`).
  - `meta` = nếu có `segmentSummaries[i]?.postCount` → `· ${postCount} bài`.
  - `status`:
    - `running` nếu `runningSegmentIndex === i`.
    - `error` nếu `segmentErrors[i]` có giá trị.
    - `done` nếu `segmentSummaries[i]?.summary && complete !== false`.
    - `partial` nếu `segmentSummaries[i]?.summary && complete === false`.
    - `pending` còn lại (kể cả đã scrape, chưa tóm tắt).
- `headerLabel` = `${summarizedCount} / ${segments.length} đoạn đã tóm tắt`.
- `#header-actions`: **Tóm tắt tất cả** (`onAutoSummarizeClick`, giữ cost-guard modal) khi không chạy; "Đang chờ… / Hủy" (`handleCancel`) khi đang batch.
- `#row-actions`:
  - `pending` → `Tóm tắt` (`handleSummarizeSegment(i)`).
  - `error` → `Thử lại` (`handleSummarizeSegment(i)` — clear `segmentErrors[i]` trước khi chạy).
  - `done`/`partial` → `Tóm tắt lại` (`handleSummarizeSegment(i)`).
  - `running` → `Hủy` (`handleCancel`).
- **Không** cung cấp slot `#preview`; truyền `:expandable="false"`.
- Vùng dưới lưới: chỉ phần "overall summary" (`activeSegmentIndex === null` cũ) — bỏ điều kiện `activeSegmentIndex`, luôn render nhánh tổng quan (single-segment fast path giữ nguyên).
- Single segment (`segments.length === 1`): **không** render lưới (giữ fast-path nút "Tóm tắt" trực tiếp như hiện tại).

### Component D — Per-segment error/running state (useSummarize.ts)

- Thêm `const segmentErrors = ref<Record<number, string>>({})` — lỗi tóm tắt theo chỉ số đoạn (in-memory, **không** persist cache).
- Thêm `const runningSegmentIndex = ref<number | null>(null)` — đoạn đang được tóm tắt (tách khỏi `activeSegmentIndex` kiêm nhiệm). Đặt = `segmentIndex` khi bắt đầu `handleSummarizeSegment`/vòng lặp `handleAutoSummarizeAll`; reset `null` ở `finally`/khi xong.
- Trong `handleSummarizeSegment` catch: `segmentErrors.value = { ...segmentErrors.value, [segmentIndex]: message }` (bỏ qua AbortError). Khi bắt đầu (đầu hàm) và khi thành công: xoá `segmentErrors.value[segmentIndex]`.
- Trong `handleAutoSummarizeAll` / driver: nếu một đoạn fail, set `segmentErrors` cho đúng index (best-effort theo index đang xử lý).
- Reset toàn bộ `segmentErrors` + `runningSegmentIndex` trong `loadTopicData()` (đầu hàm, cùng chỗ reset state khác) để tránh rò trạng thái khi chuyển thớt.
- **Xoá** `activeSegmentIndex` (vai trò "tab đang xem"): 
  - Loại khỏi return của composable + khỏi SummaryView.
  - Các chỗ nội bộ dùng `activeSegmentIndex` làm "đoạn đang chạy" (442, 470, 489, 534, 1383) → chuyển sang `runningSegmentIndex`.
  - `handleRetry` (378): dùng `runningSegmentIndex.value ?? nextPendingSegmentIndex.value ?? 0`.
- Export thêm: `segmentErrors`, `runningSegmentIndex`.

## Technical Considerations

**Affected files:**
- `entrypoints/sidepanel/components/SegmentGrid.vue` — **mới**.
- `entrypoints/sidepanel/views/KnowledgeView.vue` — thay block F33; map sang `SegmentGridItem`; di chuyển preview vào slot.
- `entrypoints/sidepanel/views/SummaryView.vue` — xoá tab + individual view; thêm `SegmentGrid` + mapping computed; bỏ `activeSegmentIndex`.
- `entrypoints/sidepanel/composables/useSummarize.ts` — thêm `segmentErrors` + `runningSegmentIndex`; bỏ `activeSegmentIndex`; cập nhật catch/reset/retry.
- `docs/architecture/*.md` (summarization + sidepanel structure) + `AGENTS.md` (Common components, Sidepanel SPA Structure) — Phase 5 doc sync.

**Dependencies:**
- D (state) phải xong trước C (SummaryView mapping cần `segmentErrors`/`runningSegmentIndex`).
- A (component) phải xong trước B và C.
- Thứ tự: **A → D → C**, và **A → B** (B độc lập với D).

**Edge cases:**
- KnowledgeView `partial` (chunk fail) vẫn map `partial`; không nhầm với `error` (Knowledge không có `error` status — giữ nguyên semantics F33).
- SummaryView: đoạn đã scrape posts nhưng chưa tóm tắt → `pending` (mất "chấm vàng" riêng cho trạng thái này; chấp nhận — xem Decision 4).
- Cancel giữa batch: `runningSegmentIndex` phải reset `null` để icon spinner không kẹt (theo pattern `activeKnowledgeSegmentIndex` của Knowledge khi cancel).
- Chuyển thớt khi đang có lỗi đoạn: `loadTopicData` reset `segmentErrors` → lưới thớt mới sạch.
- `complete === false` (đoạn cuối chưa đầy budget): map `partial`, không phải `error`.
- Component generic không được import type domain (`KnowledgeSegmentView`/`TopicSegment`) — chỉ `SegmentGridItem`.

**Constraints:**
- Backward compat: legacy topic (single segment, không `segments`) — SummaryView giữ fast-path, không render lưới.
- Không đổi message-passing/schema cache; `segmentErrors` thuần in-memory.
- Design system: dùng `IconButton` cho nút toggle/icon-only; token màu; ESLint pass.

## Implementation Notes

- Bắt đầu bằng `SegmentGrid.vue`: bê nguyên markup card+header+progress+row+preview từ KnowledgeView (dòng 444–547) làm khung, tham số hoá qua props/slots, centralize icon trạng thái theo `status`. Thêm nhánh icon `error` (đỏ) chưa có ở F33.
- Refactor KnowledgeView trước (B) để verify component không regression (so sánh trực quan với bản cũ), vì Knowledge là nguồn gốc markup.
- Sau đó D (state) rồi C (SummaryView). Khi xoá `activeSegmentIndex`, chạy `grep activeSegmentIndex` để chắc không còn tham chiếu.
- Mapping `SegmentGridItem[]` đặt thành `computed` trong từng view (không nhét vào composable) để giữ component thuần trình bày.
- Giữ các banner (info/partial/stale/resume) **ngoài** `SegmentGrid`.
- Sau khi xong: cập nhật `AGENTS.md` (mục Common components thêm `SegmentGrid`) + `docs/architecture` + ngày header.

## Test Plan

- **Compile/lint/test:** `npm run verify` pass.
- **KnowledgeView (regression thủ công):**
  - Thớt nhiều đoạn: lưới hiển thị đúng count/progress; trạng thái `pending`/`extracting`/`done`/`partial` icon đúng.
  - Trích xuất 1 đoạn → spinner → done; "Làm lại" hoạt động; "Trích xuất tất cả" chạy batch + "Hủy" hoạt động.
  - Mở rộng đoạn → preview raw entries đúng (badge "Chưa tổng hợp", 5 mục + "+N khác").
- **SummaryView:**
  - Thớt >1 đoạn: lưới hiện ngay cả khi chưa có tổng quan; "Tóm tắt tất cả" (qua cost modal) chạy hết các đoạn, progress tăng.
  - "Tóm tắt" 1 đoạn → `running` spinner → `done`.
  - Ép lỗi 1 đoạn (vd: ngắt mạng / model lỗi) → đoạn hiện trạng thái **`error`** (icon đỏ) + nút **"Thử lại"**; bấm Thử lại → clear lỗi, chạy lại.
  - Đoạn `complete === false` → hiện `partial`, không phải error.
  - Không còn "Individual segment view"; không còn pill "Tổng quan"; vùng dưới lưới chỉ có tóm tắt tổng quan.
  - Single-segment topic: không có lưới, nút "Tóm tắt" trực tiếp vẫn chạy.
  - Chuyển sang thớt khác rồi quay lại: trạng thái lỗi không rò sang thớt mới.

## Decision Log

### Quyết định 1: Một component generic dùng chung thay vì hai component song song
- **Đã chọn:** Một `SegmentGrid.vue` data-driven (nhận `SegmentGridItem[]` + slots), cả KnowledgeView và SummaryView feed dữ liệu chuẩn hoá vào.
- **Lý do:** Hai lưới gần như giống hệt (header+progress+row+status+action+preview). Một component giảm trùng lặp, đồng nhất UX, và đúng tinh thần "common component" trong yêu cầu. Khác biệt domain (status enum, label, action, preview) tách qua props/slots + mapping ở view.
- **Đã cân nhắc nhưng loại:**
  - Hai component riêng (`KnowledgeSegmentGrid` + `SummarySegmentGrid`) — loại vì trùng lặp markup/CSS, dễ drift lại như hiện tại.
  - Để component biết domain (truyền `mode="summary"|"knowledge"`) — loại vì nhồi logic domain vào component trình bày, khó mở rộng.
- **Điều kiện thay đổi:** Nếu sau này một trong hai lưới phân kỳ mạnh về layout (không chỉ data), cân nhắc tách hoặc thêm biến thể.

### Quyết định 2: Xoá hẳn "Individual segment view" trong SummaryView
- **Đã chọn:** Bỏ vùng đọc tóm tắt từng đoạn rời + pill "Tổng quan" + state `activeSegmentIndex` (vai trò tab). Lưới chỉ còn vai trò trạng thái + hành động; nội dung hiển thị duy nhất là tóm tắt tổng quan.
- **Lý do:** Yêu cầu trực tiếp của user. Đọc tóm tắt từng đoạn rời hiếm dùng; gỡ giúp đơn giản hoá state (loại nhiệm vụ kép của `activeSegmentIndex`).
- **Đã cân nhắc nhưng loại:** Chuyển individual view thành `#preview` slot (như Knowledge) — loại vì user yêu cầu bỏ, và preview tóm tắt dài không hợp layout lưới.
- **Điều kiện thay đổi:** Nếu user muốn lại khả năng đọc tóm tắt từng đoạn → thêm qua slot `#preview` (component đã hỗ trợ sẵn).

### Quyết định 3: Trạng thái lỗi per-segment lưu in-memory, không persist
- **Đã chọn:** `segmentErrors: Record<number, string>` + `runningSegmentIndex` là `ref` trong useSummarize, reset khi chuyển thớt; không ghi vào `CachedTopic`.
- **Lý do:** Lỗi tóm tắt là tình huống runtime (mạng/model), không phải dữ liệu bền. Persist sẽ làm bẩn cache + cần migration schema. Knowledge cũng suy ra `partial`/status từ dữ liệu phái sinh, không lưu status riêng.
- **Đã cân nhắc nhưng loại:** Thêm field `error?` vào `TopicSegment` (persist) — loại vì đổi schema + lỗi mất ý nghĩa sau reload.
- **Điều kiện thay đổi:** Nếu cần nhớ đoạn lỗi qua phiên (đóng/mở lại sidepanel) thì mới persist.

### Quyết định 4: Gộp "đã scrape chưa tóm tắt" vào `pending` ở SummaryView
- **Đã chọn:** Bỏ phân biệt visual riêng cho "đã scrape posts nhưng chưa tóm tắt" (chấm vàng cũ) → map `pending`.
- **Lý do:** Đơn giản hoá enum trạng thái dùng chung; với user, "chưa tóm tắt" là đủ. `partial` dành cho summary incomplete (`complete === false`).
- **Đã cân nhắc nhưng loại:** Thêm status thứ 6 `scraped` — loại vì tăng phức tạp component chung cho lợi ích nhỏ.
- **Điều kiện thay đổi:** Nếu user phản hồi cần thấy "đã tải sẵn nội dung" thì thêm meta text thay vì status mới.

### Quyết định 5: `headerLabel` và mapping do view tự build, không nằm trong component
- **Đã chọn:** Component nhận `headerLabel` string + `items` đã chuẩn hoá; view chịu trách nhiệm wording ("đã tóm tắt" vs "đã trích xuất") và mapping status.
- **Lý do:** Giữ `SegmentGrid` thuần trình bày, không phụ thuộc i18n/domain. Mapping là computed nhẹ ở view.
- **Đã cân nhắc nhưng loại:** Truyền raw domain object + để component tự đếm/đặt chữ — loại vì kéo domain vào component.
- **Điều kiện thay đổi:** Không.
