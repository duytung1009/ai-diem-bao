# Planning: Common ConfirmDialog Component

## Objective & Scope

Tạo một component `ConfirmInline.vue` dùng chung và thay thế 2 inline confirm pattern hiện có ở SummaryView + KnowledgeView. ResearchView hiện không có confirm — component sẵn sàng khi cần.

**Không trong scope:** modal overlay, toast, animation phức tạp.

---

## Affected Modules

| File | Vai trò |
|------|---------|
| `entrypoints/sidepanel/components/ConfirmInline.vue` | **Tạo mới** — component dùng chung |
| `entrypoints/sidepanel/views/SummaryView.vue` | Thay inline confirm `confirmingAutoSummarize` |
| `entrypoints/sidepanel/views/KnowledgeView.vue` | Thay inline confirm `confirmingExtract` |

---

## Hiện trạng (trước khi refactor)

### SummaryView — `confirmingAutoSummarize` (line 38, 207–229)
- Trigger: click "⚡ Tóm tắt toàn bộ"
- UI: inline span với pill-style buttons, hiển thị số segment + optional cost warning
- Style: `bg-blue-600` (primary), `bg-(--color-bg-muted)` (secondary) — không dùng design tokens

### KnowledgeView — `confirmingExtract` (line 29, 292–301, 658–670)
- Trigger: `onExtractClick()` khi `showExtractCostWarning === true`
- UI: block riêng bên dưới nút trigger, full-width stacked buttons
- Style: `btn-primary`, `btn-secondary` — dùng design tokens ✅

Hai pattern style khác nhau → cần chuẩn hoá.

---

## Component Design: `ConfirmInline.vue`

```vue
<!-- Props -->
message: string          // câu hỏi xác nhận, ví dụ "Tóm tắt 5 phần, không thể hủy. Tiếp tục?"
warning?: string         // optional amber text, ví dụ "⚠️ Ước tính ~3 API calls"
confirmText?: string     // default: "Xác nhận"
cancelText?: string      // default: "Hủy"

<!-- Emits -->
@confirm
@cancel
```

**Layout (nhất quán với KnowledgeView pattern — block, dùng design tokens):**
```vue
<div class="space-y-2">
  <p class="text-xs text-(--color-text-secondary)">{{ message }}</p>
  <p v-if="warning" class="text-xs text-amber-600 dark:text-amber-400">{{ warning }}</p>
  <div class="flex gap-2">
    <button class="flex-1 btn btn-primary text-xs" @click="$emit('confirm')">
      {{ confirmText ?? 'Xác nhận' }}
    </button>
    <button class="flex-1 btn btn-secondary text-xs" @click="$emit('cancel')">
      {{ cancelText ?? 'Hủy' }}
    </button>
  </div>
</div>
```

**Lý do chọn block layout (không dùng pill inline):**
- Dễ đọc hơn khi message dài (cost warning + segment count)
- Dùng `btn` design tokens → consistent với phần còn lại
- SummaryView pill style hiện tại không dùng tokens → đây là cơ hội chuẩn hoá

---

## Implementation Steps

### Step 1 — Tạo `ConfirmInline.vue`
```
entrypoints/sidepanel/components/ConfirmInline.vue
```
Props + emits như thiết kế trên. Không có logic, chỉ là presentational component.

### Step 2 — Refactor `KnowledgeView.vue`
Xoá inline confirm HTML (lines 658–670), thay bằng:
```vue
<ConfirmInline
  v-if="confirmingExtract"
  :message="`Trích xuất kiến thức từ topic này. Tiếp tục?`"
  :warning="showExtractCostWarning ? `⚠️ Ước tính ~${estimatedExtractApiCalls} API calls. Chi phí có thể cao.` : undefined"
  @confirm="confirmingExtract = false; handleExtract()"
  @cancel="confirmingExtract = false"
/>
```

### Step 3 — Refactor `SummaryView.vue`
Xoá inline confirm span (lines 207–229), thay bằng:
```vue
<ConfirmInline
  v-if="confirmingAutoSummarize"
  :message="`Tóm tắt ${segments.length} phần, không thể hủy. Tiếp tục?`"
  :warning="showAutoSummarizeCostWarning ? `⚠️ Ước tính ~${estimatedAutoSummarizeCalls} API calls. Chi phí có thể cao.` : undefined"
  @confirm="confirmingAutoSummarize = false; handleAutoSummarizeAll()"
  @cancel="confirmingAutoSummarize = false"
/>
```

**Lưu ý SummaryView:** confirm UI hiện nằm trong `<span>` inline cùng hàng với nút trigger. Sau refactor cần chuyển thành block element (div) để `ConfirmInline` render đúng layout.

### Step 4 — Self-review & cleanup
- Xoá `confirmingAutoSummarize` / `confirmingExtract` inline styles cũ
- Kiểm tra dark mode
- `npx vue-tsc --noEmit`

---

## Edge Cases

- **`warning` undefined:** component không render dòng warning → không lộ template trống
- **Double-click confirm:** các `confirmingXxx = false` trước khi gọi handler → ngăn double-trigger
- **ResearchView:** hiện không có confirm; nếu cần sau này chỉ cần import `ConfirmInline`

---

## Test Plan

1. SummaryView: click "Tóm tắt toàn bộ" → ConfirmInline hiện → Xác nhận → chạy summarize
2. SummaryView: click Hủy → ConfirmInline ẩn, không chạy
3. SummaryView: cost warning hiện khi `showAutoSummarizeCostWarning = true`
4. KnowledgeView: click Trích xuất khi cost cao → ConfirmInline hiện với warning
5. KnowledgeView: click Trích xuất khi cost thấp → bỏ qua confirm, chạy luôn
6. Dark mode: màu amber + btn tokens đúng

---

## Rollback Plan

Đây là pure UI refactor, không đổi logic. Nếu lỗi: revert 3 file (`ConfirmInline.vue`, `SummaryView.vue`, `KnowledgeView.vue`).

---

## Decision Log

### Quyết định 1: Block layout thay vì pill inline
- **Đã chọn:** Block layout với full-width buttons (pattern từ KnowledgeView)
- **Lý do:** Dùng được `btn` design tokens; dễ đọc hơn khi message dài; SummaryView pill style hiện không dùng tokens nên đây là cơ hội chuẩn hoá
- **Đã cân nhắc nhưng loại:**
  - Pill inline (SummaryView style) — loại vì không dùng design tokens, khó tái sử dụng khi message dài
- **Điều kiện thay đổi:** Nếu UX feedback cho rằng block layout làm layout SummaryView bị đứt quãng, xem xét lại

### Quyết định 2: Inline component, không phải modal overlay
- **Đã chọn:** `ConfirmInline.vue` render tại chỗ, không dùng teleport/modal
- **Lý do:** Sidepanel hẹp; 2 use case đều là "confirm trước khi chạy tác vụ nặng" nằm trong flow hiện tại; modal overkill
- **Đã cân nhắc nhưng loại:**
  - Modal overlay — loại vì quá nặng cho confirm đơn giản; trong Chrome extension sidepanel, overlay có thể bị clip
- **Điều kiện thay đổi:** Nếu cần confirm cho destructive action (xóa toàn bộ) → có thể cần modal với severity cao hơn

### Quyết định 3: Props-based, không dùng composable `useConfirm()`
- **Đã chọn:** Simple props + emits
- **Lý do:** Chỉ 2 use case, không cần programmatic API; props đủ rõ ràng; ít abstraction hơn
- **Đã cân nhắc nhưng loại:**
  - `useConfirm()` composable với promise — loại vì over-engineering cho 2 use case; thêm complexity không cần thiết
- **Điều kiện thay đổi:** Nếu số confirm use case > 5 và cần gọi từ nhiều composable → xem xét composable pattern
