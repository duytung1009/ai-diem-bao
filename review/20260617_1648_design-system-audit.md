# Design System Audit — AI Điểm Báo

> Ngày: 2026-06-17 · Scope: `assets/main.css` (tokens + @utility) + `entrypoints/sidepanel/components/*` (33 components) + `eslint.config.js` enforcement layer

## Summary

**Components reviewed:** 33 · **Issues found:** 5 (1 token violation, 1 a11y-debt cluster, 3 minor) · **Score: 86/100**

Hệ thống đã trưởng thành: token-based đầy đủ (light + dark), `@utility` layer phong phú, STYLE_GUIDE.md chi tiết, **và** lớp enforcement ESLint (L3 trong `planning/20260615_2327_design-system-foundation.md`) **đã được implement** (`no-restricted-class`, `form-control-has-label`, `icon-button-needs-label`, `no-raw-form-control`). `npm run lint` pass sạch. Điểm trừ chính: 1 component né được linter vẫn hardcode màu, và một cụm ~42 a11y suppression hoãn sang "task 407".

## Naming Consistency

| Issue | Components | Recommendation |
|-------|------------|----------------|
| Không phát hiện bất nhất | — | Token (`--color-*`), utility (`btn`/`card`/`badge`/`alert`), component (PascalCase, enforce bởi `vue/component-name-in-template-casing`) đều nhất quán. |

Quy ước "1 metaphor cho saved = star + `--color-saved`", nhãn "Nhóm theo" vs "Sắp xếp", và inline-confirm thay `window.confirm()` đều được tài liệu hóa và tuân thủ trong code.

## Token Coverage

| Category | Defined | Hardcoded Values Found |
|----------|---------|------------------------|
| Colors | 50+ vars (light + dark) | **1 file** — `TrustBadge.vue` (xem Issue #1) |
| Spacing | Tailwind scale + STYLE_GUIDE conventions | 0 arbitrary `[Npx]` vi phạm |
| Typography | 3 font tokens + scale chuẩn | 0 |
| Radius | `rounded-lg` / `rounded-full` only | 0 (`rounded`/`rounded-md` bị ESLint chặn, grep sạch) |
| Hex trong template | — | 0 (chỉ false-positive HTML-entity trong SummaryContent) |

**Vì sao linter bỏ sót Issue #1:** `vue/no-restricted-class` chỉ quét `class` attribute trong template. `TrustBadge.vue` build chuỗi class trong một `computed()` ở `<script>` → ngoài tầm rule. Đồng thời palette dùng là `orange` — **không** nằm trong danh sách cấm (`gray|slate|zinc|stone|neutral|yellow|amber`).

## Component Completeness

| Component | States | Variants | Docs | Score |
|-----------|--------|----------|------|-------|
| IconButton | ✅ | ✅ default/saved/danger | ✅ STYLE_GUIDE | 10/10 |
| ConfirmInline | ✅ | ✅ danger/default | ✅ | 10/10 |
| OverflowMenu | ✅ (click-outside) | ✅ align L/R | ✅ | 9/10 |
| FormField | ✅ error/hint | — | ✅ | 9/10 |
| ToggleSwitch / Checkbox / RadioGroup | ✅ | ✅ | ✅ | 9/10 |
| TrustBadge | ⚠️ | ✅ | ❌ | 6/10 (hardcoded màu) |
| btn / card / badge / alert utilities | ✅ hover/disabled | ✅ đầy đủ | ✅ | 10/10 |

Core component set (7 cái trong L2 của foundation plan) hoàn chỉnh và đã được áp dụng. Form utilities (`label`/`checkbox`/`radio`/`select`/`input-range`) đã có (L1).

## Issues

| # | Severity | File | Vấn đề | Khắc phục |
|---|----------|------|--------|-----------|
| 1 | **Major** | `components/TrustBadge.vue:20,22` | Hardcode `bg-orange-100/text-orange-700/bg-gray-100/text-gray-500/...` (cả dark variants) trong `computed badgeClass`. Né linter vì ở `<script>`, không phải template. | Thêm token cảnh báo "watch" (vd dùng `--color-warning-*` sẵn có hoặc thêm `--color-trust-*`); đổi sang `var(--color-*)`. Cân nhắc mở rộng `no-restricted-class` để bắt cả string literal trong script (hoặc dùng `badge badge-warning` + `badge-neutral`). |
| 2 | **Major (cluster)** | `SettingsView.vue` (39×), `NewsFeedView.vue`, `ResearchView.vue`, `NotebookQAPanel.vue` — **42 suppression** | `form-control-has-label` / `label-has-for` bị `eslint-disable` hoãn sang "task 407" / FormField refactor. A11y debt thật: nhiều `<input>`/`<select>` chưa liên kết `<label for>`/`id`. | Refactor sang `<FormField>` (đã tồn tại, expose `fieldId`/`describedBy`). Đây chính là remediation backlog mà foundation plan dự kiến. Ưu tiên SettingsView. |
| 3 | Minor | `components/NotebookEntryEditor.vue` | Foundation plan ghi nhận "lệch chuẩn" — cần đưa về FormField/utility chuẩn. | Align với `<FormField>` + form utilities khi làm task 407. |
| 4 | Minor | Nhiều view | `no-static-element-interactions` suppression cho backdrop/clickable container ("intentional interactive container"). | Phần lớn hợp lệ (backdrop modal, card click). Giữ nguyên nhưng đảm bảo có keyboard path tương đương ở nơi là control thật. |
| 5 | Nit | `STYLE_GUIDE.md` Component Inventory | Liệt kê 7 component; thực tế có 33 trong `components/`. Inventory chỉ phủ phần "design-system core". | OK theo chủ đích, nhưng nên ghi rõ "core only" để tránh hiểu nhầm coverage. |

## Priority Actions

1. **Issue #1 — TrustBadge tokens** (nhanh, đóng lỗ hổng token cuối cùng + lỗ hổng linter): chuyển sang `var(--color-*)` / `badge-warning`+`badge-neutral`, rồi nâng `no-restricted-class` để quét string trong `<script>`.
2. **Issue #2 — "task 407" form a11y backlog** (cụm lớn nhất, 42 suppression): refactor form controls sang `<FormField>`, bắt đầu từ `SettingsView.vue`. Đây là remediation phase trong `planning/20260615_2327_design-system-foundation.md`.
3. **Issue #3 — NotebookEntryEditor** align chuẩn cùng đợt task 407.

## Resolution (2026-06-17)

Cả 3 issue đã được khắc phục trong cùng phiên. `npm run verify` xanh (compile + lint + 411 tests pass).

- **Issue #1 — TrustBadge** ✅ `badgeClass` đổi từ hardcode Tailwind palette sang utility token-based `badge-warning` / `badge-neutral`. Không còn màu hardcode trong toàn bộ codebase.
- **Issue #2 — 42 form a11y suppression** ✅ Toàn bộ `eslint-disable ... "task 407"` đã gỡ:
  - `SettingsView.vue`: 16 cặp label+control gắn `for`/`id`; 2 control không nhãn (file input, forum URL) + 3 prompt textarea gắn `aria-label`; 2 model-dropdown `<li>` đổi comment suppression sang lý do "intentional" chuẩn (mouse-only suggestion, keyboard gõ trực tiếp vào input).
  - `NewsFeedView.vue` / `ResearchView.vue` / `NotebookQAPanel.vue`: textarea câu hỏi gắn `aria-label`.
  - **L3 enforcement**: `eslint.config.js` nới `label-has-for` → `{ required: { some: ['nesting', 'id'] } }` (chấp nhận liên kết `for`/`id`, vốn là WCAG hợp lệ; trước đó mặc định `every` ép vừa nesting vừa id).
- **Issue #3 — NotebookEntryEditor / FormField** ✅ `FormField.vue` đổi label từ `<span class="label">` (không liên kết screen-reader) sang `<label :for="fieldId" class="label">` (liên kết thật). NotebookEntryEditor vốn đã dùng FormField nên tự hưởng lợi, không cần sửa.

## Kết luận

Design system ở trạng thái **tốt và được enforce tự động** — phần lớn 4 layer của foundation plan (L0 tokens, L1 form utilities, L2 components, L3 ESLint) đã hiện diện. Việc còn lại chủ yếu là **remediation**: 1 component hardcode màu + 1 backlog a11y form đã được đánh dấu sẵn ("task 407"). Không có vấn đề kiến trúc design-system nào nghiêm trọng.
