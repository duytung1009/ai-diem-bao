# Design System Foundation — Tokens, Components & Enforcement

## Overview

Project đã có ~80% của một design system rời rạc: token tầng (`--color-*`, shadow, font, gradient trong `assets/main.css`), một lớp component qua `@utility` (`btn*`, `card*`, `badge*`, `alert*`, `input`, `section-heading`, `link`, `btn-llm`), `lib/tag-styles.ts`, và `STYLE_GUIDE.md` làm hợp đồng.

Vấn đề: hệ thống **không được cưỡng chế** và **không phủ hết form-control**. Audit tháng 6/2026 cho thấy:
- Pattern lặp copy-paste trong `.vue` (icon-button 4 chỗ, inline-confirm, overflow-menu, tag palette từng nằm 3 file) → feature mới tái phát minh biến thể sai; từng gây contrast fail WCAG AA.
- Form-control không có chuẩn: label trong `NotebookEntryEditor` dùng `--color-text-muted` (fail AA, lệch SettingsView); checkbox tồn tại 2 kiểu (toggle-switch `sr-only peer` vs raw `<input type=checkbox>` tại `SettingsView:1125`); radio raw không token (`SettingsView:1218`); `.input-range` là class thường không phải `@utility`; number input width tuỳ biến mỗi nơi; nút ✕ xoá tag (`NotebookEntryEditor:107`) thiếu `type="button"`+`aria-label`.
- `section-heading` utility đã có (dùng 38× / 11 file) nhưng **adoption không đều** — editor tự chế label thay vì dùng.
- Hệ quả điển hình: màn "Tạo ghi chú mới" (`NotebookEntryEditor`) "không ăn nhập" với phần còn lại vì viết tay token sai thay vì compose từ chuẩn chung.

STYLE_GUIDE + self-review là tự giác con người → drift. Project **chưa có ESLint** (`package.json` không có eslint dep).

Mục tiêu: nâng từ "token + utility rời rạc" thành **design system 4 tầng (Audit → Tokens → Components → Patterns) phủ cả form-control, cưỡng chế tự động bằng ESLint**, để mọi sửa đổi/feature mới luôn tuân thủ — không phụ thuộc agent/dev có nhớ đọc STYLE_GUIDE hay không.

Scope chia 4 layer (thứ tự thực thi **L0 → L3 → L1 → L2 → remediation**):
- **L0 (Audit)** — inventory toàn bộ token coverage + component completeness + màn hình lệch chuẩn → báo cáo + remediation backlog. Làm TRƯỚC để biết phạm vi thật, không đoán.
- **L3 (Enforcement)** — dựng ESLint (flat config) + eslint-plugin-vue + vuejs-accessibility + local rules + pre-commit + tích hợp workflow. Đòn bẩy cao nhất; bật sớm để guard chính các component refactor sau.
- **L1 (Tokens/Utilities)** — bổ sung form utilities + chuẩn hoá `section-heading`/`label` + scale tokens còn thiếu.
- **L2 (Components)** — đóng gói pattern lặp (icon-button, confirm, overflow-menu) + form primitives (FormField, ToggleSwitch, Checkbox, RadioGroup, Select) thành component Vue ép a11y; refactor call-site + remediation theo backlog L0.

## Goals

- **G1:** `npm run lint` (ESLint) chặn mọi vi phạm token-system (hardcoded color, bare `rounded`, hex trong class, saved-icon sai màu), form-control raw, và icon-button thiếu `aria-label` — exit code ≠ 0 khi vi phạm.
- **G2:** ESLint chạy tự động ở pre-commit + được liệt kê trong gate verify cạnh `compile`/`test`.
- **G3:** AGENTS.md (Phase 3) + `template/self_review_checklist.md` có mục Design bắt buộc; agent tương lai tự động áp dụng.
- **G4:** ≥6 component dùng chung được tạo (`IconButton`, `ConfirmInline`, `OverflowMenu`, `FormField`, `ToggleSwitch`, `Checkbox`/`RadioGroup`) với a11y ép qua API; refactor ≥6 call-site sang dùng chúng.
- **G5:** Baseline sạch — `npm run lint` exit 0 trên codebase hiện tại sau khi xử lý `eslint-disable` hợp lệ (Tailwind semantic như `text-white` trên nền accent).
- **G6:** `STYLE_GUIDE.md` có section "Component Inventory" liệt kê mọi `@utility` + component Vue dùng chung kèm "Dùng khi" + props chính.
- **G7:** Có báo cáo audit `review/<ts>_design-system-audit.md` liệt kê mọi màn hình/control lệch chuẩn + backlog remediation ưu tiên; `NotebookEntryEditor` được refactor về chuẩn (không còn label `-muted`, nút ✕ → `IconButton`).
- **G8:** Mọi form-control (checkbox/radio/select/range/number/label) có **một** chuẩn component/utility duy nhất; zero raw `<input type=checkbox|radio>` ngoài component chuẩn.

## Requirements

### Layer 0 — Audit & Remediation backlog (ưu tiên 1, chạy trước)

- Inventory có hệ thống toàn bộ `entrypoints/sidepanel/**/*.vue` theo format `/design-system audit`:
  - **Token coverage:** đếm instance hardcoded color / hex / bare `rounded` / `-muted` dùng cho text thông tin.
  - **Form-control inventory:** liệt kê mọi input/select/checkbox/radio/range/textarea + cách style hiện tại → nhóm các biến thể không nhất quán.
  - **Component completeness:** mỗi pattern dùng chung (button, badge, alert, card, form-field, icon-button, confirm) — đủ states/variants/docs/a11y chưa.
  - **Màn hình "không ăn nhập":** chấm điểm từng view/component so với hệ thống; `NotebookEntryEditor` là case đã biết, tìm thêm.
- Output: `review/<ts>_design-system-audit.md` (theo Audit template) gồm bảng vi phạm + **backlog remediation per-screen có ưu tiên**.
- Remediation **không** đoán trước trong PRD này — sinh task từ backlog audit sau khi L1/L2 xong (component đích đã tồn tại để refactor sang).

### Layer 3 — Enforcement bằng ESLint (ưu tiên 2)

#### Dựng ESLint flat config
- Thêm devDeps: `eslint`, `vue-eslint-parser`, `eslint-plugin-vue`, `eslint-plugin-vuejs-accessibility`, `typescript-eslint` (cho `<script lang="ts">` + `.ts`), và một **local plugin** (thư mục `eslint-local-rules/` hoặc inline plugin trong config).
- Tạo `eslint.config.js` (flat config, ESM):
  - Parser SFC: `vue-eslint-parser`; `parserOptions.parser` = `typescript-eslint` parser cho block `<script>`.
  - **WXT auto-imports** (`browser`, `ref`, `computed`, `defineProps`…): khai báo globals hoặc tắt `no-undef` cho phần liên quan để tránh false positive (xem Edge cases).
  - `@source not "../**/*.md"` không liên quan; lint chỉ nhắm `entrypoints/**`, `lib/**`.

#### Rule set
- **`vue/no-restricted-class`** (regex) — ban token vi phạm trên class name, thay vai trò script regex cũ:
  - `/^text-(gray|slate|zinc|stone|neutral)-/` → dùng `text-(--color-text-*)`
  - `/^(bg|text|ring|border)-(yellow|amber)-/` → saved/pinned dùng `--color-saved`
  - `/^rounded$/` → chỉ `rounded-lg`/`rounded-full`
  - `/^(bg-white|bg-black)$/` → dùng `--color-bg-surface`/`--color-bg-base`
  - `/\[#[0-9a-fA-F]{3,8}\]/` → không hex cứng trong class
- **`eslint-plugin-vuejs-accessibility`** — bật `form-control-has-label` (ép input có label → trị bệnh label form), cùng các rule a11y mặc định hợp lý (`anchor-has-content`, `no-static-element-interactions`…).
- **Local custom rules** (cho thứ eslint-plugin-vue không express được):
  - `local/icon-button-needs-label` — `<button>` chỉ chứa `<svg>` (icon-only) phải có `aria-label`/`:aria-label`.
  - `local/no-raw-form-control` — cấm raw `<input type="checkbox"|"radio">` ngoài component chuẩn (`ToggleSwitch`/`Checkbox`/`RadioGroup`); gợi ý component thay thế.
  - `local/label-token` (heuristic, có thể warning) — `<label>` không dùng `text-(--color-text-muted)`.
- Allow-list: dùng cú pháp ESLint chuẩn `// eslint-disable-next-line vue/no-restricted-class -- lý do` (đẹp hơn comment custom; ưu điểm lớn so với script regex).

#### Scripts + hook + workflow
- `package.json`: `"lint": "eslint ."`, `"lint:fix": "eslint . --fix"`.
- Pre-commit: chạy ESLint trên file staged (ưu tiên `lint-staged` + hook; xem Decision Log để chốt husky vs git hook thuần trên Windows).
- Gate: cân nhắc `"verify": "vue-tsc --noEmit && eslint . && vitest run"`.
- `AGENTS.md` Phase 3: thêm bước "chạy `npm run lint`" cạnh `npm run compile`.
- `template/self_review_checklist.md`: thêm section **Design** (token-only; a11y icon-button có `aria-label`+`p-1.5`; `rounded-lg`/`rounded-full`; saved-icon `--color-saved`; destructive dùng inline-confirm không `window.confirm`; form-control qua component chuẩn; label `text-secondary`; section header dùng `section-heading`).

### Layer 1 — Tokens, form utilities & docs (ưu tiên 3)

- **Form utilities** trong `assets/main.css`:
  - `@utility checkbox`, `@utility radio` (token-based, focus ring giống `input`).
  - `@utility select` (kế thừa `input` + chrome/mũi tên nhất quán).
  - Nâng `.input-range` → `@utility input-range`.
  - Chuẩn `label` field: `text-xs font-medium text-(--color-text-secondary)` (**sửa token `-muted` sai**) — document là chuẩn duy nhất.
- Tuyên bố `section-heading` là **header section duy nhất**; cấm tự chế `text-sm font-semibold` rời rạc cho section header.
- Rà soát scale spacing/typography: chỉ thêm token khi có ≥2 nơi cần giá trị không có sẵn trong Tailwind.
- `STYLE_GUIDE.md`: section **Component Inventory** (bảng `@utility` + component Vue dùng chung + "Dùng khi" + props chính).

### Layer 2 — Components (ưu tiên 4)

#### Pattern components
- **`IconButton.vue`** — props: `label` (**required** → `aria-label`+`title`), `variant?: 'default'|'saved'|'danger'`, `active?`, `disabled?`; ép `type="button"`, `p-1.5`, `rounded-lg`, resting `text-secondary`/hover theo variant. Emit `click`. Refactor: save/pin/delete trong `KnowledgeEntryCard.vue`, edit/export/unsave trong `NotebookView.vue`, ✕ xoá tag trong `NotebookEntryEditor.vue`.
- **`ConfirmInline.vue`** — gộp planning tiền nhiệm `planning/20260418_1131_refactor-confirm-dialog-common.md` (PENDING). Props: `message?`, `confirmLabel?`, `cancelLabel?`, `variant?`. Render hàng inline `btn-danger btn-sm` + `btn-ghost btn-sm`, destructive ở rìa. Emit `confirm`/`cancel`. Refactor: `SummaryView.vue`, `KnowledgeView.vue`, unsave-confirm `NotebookView.vue`.
- **`OverflowMenu.vue`** — trigger `IconButton` 3-dots; panel `rounded-lg`+shadow-dropdown+click-outside+z-index nhất quán; slot action. Refactor: menu "Tùy chọn" trong `KnowledgeView.vue`.

#### Form components
- **`FormField.vue`** — wrapper `label` + control slot + hint/error; tự nối `for`/`id`/`aria-describedby`; label dùng token chuẩn. Đây là primitive ép mọi field tương lai đồng bộ.
- **`ToggleSwitch.vue`** — gói pattern `sr-only peer` (đang lặp 5 chỗ Settings); `v-model:checked`, `label`, `disabled`.
- **`Checkbox.vue`** / **`RadioGroup.vue`** — thay raw input; ép label + a11y.
- **`Select.vue`** (tuỳ chọn nếu `@utility select` chưa đủ) — option slot + token chrome.
- Refactor `NotebookEntryEditor.vue` sang `FormField` (sửa label `-muted`) — đóng case "không ăn nhập"; refactor toggle/checkbox/radio trong `SettingsView.vue` sang component.

## Technical Considerations

- **Affected files:**
  - Mới: `eslint.config.js`, `eslint-local-rules/*` (local rules), `review/<ts>_design-system-audit.md`, `entrypoints/sidepanel/components/{IconButton,ConfirmInline,OverflowMenu,FormField,ToggleSwitch,Checkbox,RadioGroup}.vue`, (tuỳ) `Select.vue`, (tuỳ) `docs/architecture/design-system.md`.
  - Sửa: `package.json` (deps + scripts), `assets/main.css` (form utilities), `AGENTS.md`, `template/self_review_checklist.md`, `STYLE_GUIDE.md`, `KnowledgeEntryCard.vue`, `NotebookView.vue`, `KnowledgeView.vue`, `SummaryView.vue`, `NotebookEntryEditor.vue`, `SettingsView.vue`, hook config.
- **Dependency order:** L0 audit → L3 ESLint (cần để guard) → L1 utilities → L2 (IconButton trước vì OverflowMenu dùng nó; FormField trước các form component refactor) → remediation theo backlog L0.
- **ESLint edge cases:**
  - SFC cần `vue-eslint-parser` ở top-level, `parserOptions.parser` cho `<script lang="ts">`.
  - **WXT auto-imports** (`browser`, `ref`, `computed`, `defineProps`, `withDefaults`…) sẽ bị `no-undef`/`no-unused` báo nhầm → khai báo globals (WXT sinh `.wxt/types` — cân nhắc reference) hoặc tắt `no-undef` cho `.vue`.
  - `vue/no-restricted-class` chỉ thấy class **tĩnh** + một số binding; `:class` dạng object/array phức tạp có thể lọt → bổ sung local rule nếu cần, hoặc chấp nhận giới hạn (đa số vi phạm là class tĩnh).
  - Không lint `<style>` block CSS (eslint-plugin-vue chỉ template/script) — phù hợp, tránh false positive với CSS thuần.
  - `dist`/`.output`/`.wxt` phải ignore.
- **Backward compat:** ESLint phải pass trên codebase HIỆN TẠI trước khi bật hook (G5) — vi phạm hợp lệ dùng `eslint-disable` có lý do, không nới rule.
- **Windows constraint:** ESLint + hook chạy trên PowerShell/Windows; `lint-staged`/husky v9 OK; fallback git hook thuần gọi `npx eslint`.
- **Component refactor không regress:** giữ nguyên behavior + a11y đã đạt AA ở đợt critique trước.

## Implementation Notes

- Thứ tự: **L0 → L3 → L1 → L2 → remediation**. Audit trước để backlog trung thực; ESLint trước để guard chính các refactor.
- L3: kiểm tra `.wxt/` types để cấu hình globals đúng; bắt đầu với rule set tối thiểu pass baseline, siết dần. Local rules viết nhỏ gọn, có test riêng (ESLint `RuleTester`).
- Component: tham chiếu markup hiện có (icon-button trong `KnowledgeEntryCard.vue`; toggle `sr-only peer` trong `SettingsView.vue`; unsave-confirm `NotebookView.vue`) để giữ visual.
- Sau mỗi đơn vị: `npm run compile` + `npm run lint` + `npm run test`.
- Document-as-you-build: cập nhật `STYLE_GUIDE.md` Component Inventory ngay khi tạo component.
- Phase 5 — Documentation Sync: thêm component dùng chung → cập nhật `docs/architecture/` + AGENTS.md "Sidepanel SPA Structure".

## Test Plan

- **ESLint guard:**
  - File `.vue` tạm với `text-gray-500`, `rounded`, `bg-white`, `text-[#fff]`, raw `<input type=checkbox>`, icon-button thiếu `aria-label` → `npm run lint` fail, báo đúng dòng + rule.
  - `// eslint-disable-next-line vue/no-restricted-class -- lý do` → dòng đó qua.
  - Codebase hiện tại → exit 0 sau xử lý disable hợp lệ.
  - Local rules: ESLint `RuleTester` cho `icon-button-needs-label`, `no-raw-form-control`.
  - Pre-commit: commit file vi phạm → bị chặn; file sạch → qua.
- **Components:**
  - `IconButton`: thiếu prop `label` → TS lỗi (required); render `type="button"`+`aria-label`.
  - `ConfirmInline`: confirm→emit `confirm`, cancel→emit `cancel`, destructive ở rìa.
  - `OverflowMenu`: mở/đóng + click-outside.
  - `FormField`: label nối `for`/`id`; `form-control-has-label` không còn báo.
  - `ToggleSwitch`/`Checkbox`/`RadioGroup`: `v-model` đúng, a11y có label.
  - Verify thủ công các view refactor (Notebook/Knowledge/Summary/Settings): visual + AA không regress; `NotebookEntryEditor` đồng bộ với phần còn lại.
- **Regression:** `npm run test` pass; `npm run compile` clean.

## Decision Log

### Quyết định 1: Cưỡng chế bằng ESLint (flat config + eslint-plugin-vue + vuejs-accessibility + local rules), KHÔNG dùng script regex `lint-design.mjs`
- **Đã chọn:** ESLint flat config với `eslint-plugin-vue` (`vue/no-restricted-class` regex bans), `eslint-plugin-vuejs-accessibility` (`form-control-has-label`…), và local custom rules (`icon-button-needs-label`, `no-raw-form-control`, `label-token`).
- **Lý do:** Tốt về lâu dài — AST-aware (đọc đúng SFC, không lint nhầm `<style>` CSS), **tích hợp editor + CI chuẩn**, autofix (`--fix`), `eslint-disable` có sẵn cú pháp + lý do, mở rộng vô hạn bằng local rule. `vue/no-restricted-class` đã express được phần lớn token policy bằng regex; `vuejs-accessibility` phủ form-label; local rule phủ phần còn lại → objection cũ ("eslint không express được rule project") không còn đúng.
- **Đã cân nhắc nhưng loại:**
  - Custom regex script `scripts/lint-design.mjs` — loại vì regex trên text thô dễ false positive, không đọc AST/binding, **không tích hợp editor**, không autofix, khó bảo trì khi rule phình to. (Đây là quyết định đảo so với bản nháp đầu — ưu tiên đầu tư đúng tầng.)
  - Stylelint — loại vì không thấy class trong template Vue.
- **Điều kiện thay đổi:** Nếu cấu hình ESLint trên WXT (auto-imports/globals) quá tốn công để baseline sạch → tạm dùng script tối thiểu chặn CI, nhưng đích cuối vẫn là ESLint.

### Quyết định 2: Thứ tự L0 Audit → L3 Enforcement → L1 → L2 → remediation
- **Đã chọn:** Audit trước, enforcement thứ nhì, component sau, remediation cuối.
- **Lý do:** Audit cho backlog trung thực (không đoán màn hình lệch chuẩn); enforcement bật sớm để guard chính các component refactor; remediation cần component đích tồn tại trước.
- **Đã cân nhắc nhưng loại:** Component-first cho "thấy kết quả ngay" — loại vì không giải quyết enforcement (yêu cầu cốt lõi) và dễ sa đà.
- **Điều kiện thay đổi:** Baseline quá bẩn → chèn task "dọn baseline" giữa L3 và L1.

### Quyết định 3: Đóng gói pattern thành component Vue thật, không chỉ `@utility`
- **Đã chọn:** Component Vue (`IconButton`, `ConfirmInline`, `OverflowMenu`, `FormField`, `ToggleSwitch`, `Checkbox`, `RadioGroup`).
- **Lý do:** Các pattern này có logic + a11y bắt buộc (required `label` prop ép `aria-label`, `for`/`id` wiring, click-outside, emit confirm/cancel) — `@utility` chỉ gói class tĩnh, không ép API đúng. Component ép consistency "by construction".
- **Đã cân nhắc nhưng loại:** Chỉ `@utility` cho form-control — loại vì không ép được label/aria/`type`.
- **Điều kiện thay đổi:** Pattern thuần tĩnh (không logic/a11y) → vẫn dùng `@utility`.

### Quyết định 4: Pre-commit — husky/lint-staged vs git hook thuần
- **Đã chọn:** `[DECISION_NEEDED tại thời điểm implement]` — ưu tiên `lint-staged` (chỉ lint file staged, nhanh) + cơ chế hook ít phụ thuộc nhất chạy trên Windows/PowerShell; mặc định nghiêng husky v9 + lint-staged, fallback git hook thuần `npx eslint`.
- **Lý do:** Cần verify môi trường thực tế (project chưa có hook nào) trước khi cố định; tránh thêm dep thừa.
- **Điều kiện thay đổi:** Có CI sau này → guard lên CI là bắt buộc, hook chỉ là cảnh báo sớm.

### Quyết định 5: Gộp planning ConfirmInline tiền nhiệm
- **Đã chọn:** `planning/20260418_1131_refactor-confirm-dialog-common.md` (PENDING) thành requirement con của L2.
- **Lý do:** Cùng mục tiêu (component dùng chung), tránh 2 nguồn sự thật.
- **Điều kiện thay đổi:** Không.

### Quyết định 6: Mở rộng PRD foundation thay vì tách PRD riêng cho form-control
- **Đã chọn:** Gộp form-control + audit vào PRD này.
- **Lý do:** Form-control chỉ là *thêm component/utility vào đúng 3 layer đã định* và chia sẻ **cùng tầng enforcement (ESLint)**. Tách PRD riêng tạo "hai design system cạnh tranh", quản lý rời, dễ lệch.
- **Đã cân nhắc nhưng loại:** PRD riêng "form standard" — loại vì trùng tầng enforcement, tăng chi phí đồng bộ.
- **Điều kiện thay đổi:** Nếu form-control phình thành hệ thống lớn độc lập (vd form builder) → tách lúc đó.

### Quyết định 7: Remediation màn hình lệch chuẩn theo audit-driven, không đoán trước trong PRD
- **Đã chọn:** L0 audit sinh backlog; task remediation tạo sau khi component đích tồn tại.
- **Lý do:** Chưa biết hết danh sách offender (`NotebookEntryEditor` là 1, có thể còn). Đoán trong PRD = sót + dễ sai. Audit-driven = inventory đầy đủ, ưu tiên trung thực, whack-a-mole bị loại.
- **Đã cân nhắc nhưng loại:** Liệt kê cứng các màn hình cần sửa ngay trong PRD — loại vì incomplete + phải sửa PRD khi phát hiện thêm.
- **Điều kiện thay đổi:** Audit cho thấy chỉ đúng 1-2 offender nhỏ → có thể nhập thẳng vào L2 thay vì backlog riêng.

### Quyết định 8: `FormField.vue` là primitive ép mọi form đồng bộ
- **Đã chọn:** Mọi field mới compose qua `FormField` (label + control + hint/error + aria wiring).
- **Lý do:** Tập trung label-token + `for`/`id`/`aria-describedby` vào 1 chỗ → không thể tạo field lệch chuẩn; `vuejs-accessibility/form-control-has-label` tự pass.
- **Đã cân nhắc nhưng loại:** Để mỗi view tự ghép label+input — loại vì chính là nguyên nhân gốc của bệnh hiện tại.
- **Điều kiện thay đổi:** Control đặc biệt (range slider phức tạp) có thể nằm ngoài `FormField` nhưng vẫn dùng token chuẩn.
