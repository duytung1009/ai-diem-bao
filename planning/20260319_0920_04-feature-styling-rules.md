# Feature: Styling Rules — Design System cho Lội Thớt Hộ

## Mục tiêu
Định nghĩa bộ quy tắc styling chung cho toàn bộ dự án. Đảm bảo UI đơn giản, nhất quán, dễ maintain. Sử dụng CSS custom properties (design tokens) thay vì hard-code Tailwind classes rải rác.

---

## Phân tích hiện trạng

### Vấn đề hiện tại:
1. **Không có design tokens** — mỗi component hard-code colors/spacing trực tiếp
2. **Button styles lặp lại** — `py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700` copy-paste ~10 chỗ
3. **Border radius không nhất quán** — mix `rounded`, `rounded-md`, `rounded-lg`, `rounded-full`
4. **Text size hierarchy mờ nhạt** — `text-xs` dùng cho cả labels và body
5. **Spacing không đều** — `space-y-3` và `space-y-4` dùng lẫn lộn cho cùng mục đích
6. **Không có dark mode tokens** — cần sửa ~100 chỗ nếu muốn thêm dark mode

---

## Task 1: Định nghĩa Design Tokens qua CSS custom properties

### File: `assets/main.css`

Thêm CSS custom properties làm single source of truth cho colors, spacing, radii:

```css
@import 'tailwindcss';
@plugin '@tailwindcss/typography';
@custom-variant dark (&:where(.dark, .dark *));

/* ─── Design Tokens ─────────────────────────────── */
:root {
  /* Surface colors */
  --color-bg-base: theme(colors.gray.50);
  --color-bg-surface: theme(colors.white);
  --color-bg-muted: theme(colors.gray.100);

  /* Text colors */
  --color-text-primary: theme(colors.gray.900);
  --color-text-secondary: theme(colors.gray.600);
  --color-text-muted: theme(colors.gray.400);

  /* Border */
  --color-border: theme(colors.gray.200);
  --color-border-strong: theme(colors.gray.300);

  /* Interactive / Accent */
  --color-accent: theme(colors.blue.600);
  --color-accent-hover: theme(colors.blue.700);
  --color-accent-soft: theme(colors.blue.50);
  --color-accent-text: theme(colors.blue.600);

  /* Semantic */
  --color-success-bg: theme(colors.green.50);
  --color-success-text: theme(colors.green.700);
  --color-success-border: theme(colors.green.200);
  --color-warning-bg: theme(colors.yellow.50);
  --color-warning-text: theme(colors.yellow.800);
  --color-warning-border: theme(colors.yellow.200);
  --color-error-bg: theme(colors.red.50);
  --color-error-text: theme(colors.red.700);
  --color-error-border: theme(colors.red.200);
}

.dark {
  --color-bg-base: theme(colors.gray.900);
  --color-bg-surface: theme(colors.gray.800);
  --color-bg-muted: theme(colors.gray.700);

  --color-text-primary: theme(colors.gray.100);
  --color-text-secondary: theme(colors.gray.400);
  --color-text-muted: theme(colors.gray.500);

  --color-border: theme(colors.gray.700);
  --color-border-strong: theme(colors.gray.600);

  --color-accent: theme(colors.blue.500);
  --color-accent-hover: theme(colors.blue.400);
  --color-accent-soft: color-mix(in srgb, theme(colors.blue.900) 30%, transparent);
  --color-accent-text: theme(colors.blue.400);

  --color-success-bg: color-mix(in srgb, theme(colors.green.900) 30%, transparent);
  --color-success-text: theme(colors.green.400);
  --color-success-border: theme(colors.green.800);
  --color-warning-bg: color-mix(in srgb, theme(colors.yellow.900) 30%, transparent);
  --color-warning-text: theme(colors.yellow.300);
  --color-warning-border: theme(colors.yellow.800);
  --color-error-bg: color-mix(in srgb, theme(colors.red.900) 30%, transparent);
  --color-error-text: theme(colors.red.400);
  --color-error-border: theme(colors.red.800);
}
```

**Lợi ích:**
- Dark mode chỉ cần override variables 1 chỗ, không cần `dark:` prefix ở mỗi element
- Dùng `var(--color-*)` trong CSS hoặc Tailwind's `[color:var(--color-*)]` trong templates
- Single source of truth — đổi 1 chỗ ảnh hưởng toàn bộ

---

## Task 2: Định nghĩa utility classes cho components phổ biến

### File: `assets/main.css` (tiếp theo Task 1)

Thêm `@utility` rules cho patterns lặp lại nhiều nhất:

```css
/* ─── Component Utilities ───────────────────────── */

/* Buttons */
@utility btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: theme(fontSize.sm);
  font-weight: 500;
  border-radius: theme(borderRadius.lg);
  transition-property: color, background-color, border-color;
  transition-duration: 150ms;
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

@utility btn-primary {
  background-color: var(--color-accent);
  color: white;
  padding: theme(spacing.2) theme(spacing.4);
  &:hover:not(:disabled) { background-color: var(--color-accent-hover); }
}

@utility btn-secondary {
  border: 1px solid var(--color-border-strong);
  color: var(--color-text-secondary);
  padding: theme(spacing.2) theme(spacing.4);
  &:hover:not(:disabled) { background-color: var(--color-bg-muted); }
}

@utility btn-sm {
  font-size: theme(fontSize.xs);
  padding: theme(spacing[1.5]) theme(spacing.3);
}

@utility btn-danger {
  background-color: theme(colors.red.600);
  color: white;
  padding: theme(spacing[1.5]) theme(spacing.3);
  font-size: theme(fontSize.xs);
  border-radius: theme(borderRadius.DEFAULT);
  &:hover:not(:disabled) { background-color: theme(colors.red.700); }
}

/* Cards */
@utility card {
  background-color: var(--color-bg-surface);
  border: 1px solid var(--color-border);
  border-radius: theme(borderRadius.lg);
  padding: theme(spacing.3);
}

@utility card-interactive {
  background-color: var(--color-bg-surface);
  border: 1px solid var(--color-border);
  border-radius: theme(borderRadius.lg);
  padding: theme(spacing.3);
  transition-property: border-color, background-color;
  transition-duration: 150ms;
  &:hover {
    border-color: var(--color-accent-text);
    background-color: var(--color-accent-soft);
  }
}

/* Badges */
@utility badge {
  display: inline-flex;
  align-items: center;
  font-size: theme(fontSize.xs);
  padding: theme(spacing[0.5]) theme(spacing.2);
  border-radius: theme(borderRadius.full);
  font-weight: 500;
}

@utility badge-success {
  background-color: var(--color-success-bg);
  color: var(--color-success-text);
}

@utility badge-neutral {
  background-color: var(--color-bg-muted);
  color: var(--color-text-muted);
}

/* Alert boxes */
@utility alert {
  border-radius: theme(borderRadius.lg);
  padding: theme(spacing.3);
  font-size: theme(fontSize.sm);
  border-width: 1px;
}

@utility alert-warning {
  background-color: var(--color-warning-bg);
  color: var(--color-warning-text);
  border-color: var(--color-warning-border);
}

@utility alert-error {
  background-color: var(--color-error-bg);
  color: var(--color-error-text);
  border-color: var(--color-error-border);
}

@utility alert-success {
  background-color: var(--color-success-bg);
  color: var(--color-success-text);
  border-color: var(--color-success-border);
}

@utility alert-info {
  background-color: var(--color-accent-soft);
  color: var(--color-accent-text);
  border-color: theme(colors.blue.200);
}

/* Form inputs */
@utility input {
  width: 100%;
  border: 1px solid var(--color-border-strong);
  border-radius: theme(borderRadius.lg);
  padding: theme(spacing.2) theme(spacing.3);
  font-size: theme(fontSize.sm);
  background-color: var(--color-bg-surface);
  color: var(--color-text-primary);
  &:focus {
    border-color: var(--color-accent);
    outline: none;
    box-shadow: 0 0 0 1px var(--color-accent);
  }
}
```

---

## Task 3: Viết Styling Guide (convention document)

### File mới: `STYLE_GUIDE.md` (root project)

Nội dung:

```markdown
# Lội Thớt Hộ — Styling Guide

## Nguyên tắc chung
1. **Đơn giản** — Ít element, ít nesting, ít decoration
2. **Nhất quán** — Dùng utility classes đã định nghĩa, không invent class mới
3. **Token-based** — Dùng CSS variables cho colors, không hard-code Tailwind colors

## Utilities Reference

### Buttons
| Class | Dùng khi |
|-------|----------|
| `btn btn-primary` | Action chính (Tóm tắt, Xác nhận, Lưu) |
| `btn btn-secondary` | Action phụ (Hủy, Tóm tắt lại) |
| `btn btn-sm` | Thêm vào btn-primary/secondary cho button nhỏ |
| `btn btn-danger` | Action xóa/hủy destructive |

### Layout
| Class | Dùng khi |
|-------|----------|
| `card` | Container tĩnh (summary box, info card) |
| `card-interactive` | Container clickable (topic card) |

### Text hierarchy
| Element | Class |
|---------|-------|
| App title | `text-lg font-bold` |
| Section heading | `text-sm font-semibold` |
| Body text | `text-sm` |
| Label/caption | `text-xs font-medium text-[var(--color-text-secondary)]` |
| Muted hint | `text-xs text-[var(--color-text-muted)]` |

### Badges
| Class | Dùng khi |
|-------|----------|
| `badge badge-success` | Đã hoàn thành (✓ Đã tóm tắt) |
| `badge badge-neutral` | Chưa hoàn thành (○ Chưa tóm tắt) |

### Alerts
| Class | Dùng khi |
|-------|----------|
| `alert alert-warning` | Cảnh báo (page scraping warnings) |
| `alert alert-error` | Lỗi |
| `alert alert-success` | Thành công |
| `alert alert-info` | Thông tin (token estimation) |

### Spacing conventions
- Section spacing: `space-y-4`
- Item spacing trong section: `space-y-2`
- Padding container chính: `p-4`
- Padding card/alert: `p-3`
- Gap giữa buttons: `gap-2`

### Border radius
- Containers/buttons: `rounded-lg` (8px) — **mặc định cho mọi thứ**
- Badges/pills: `rounded-full`
- **Không dùng** `rounded`, `rounded-md` — chỉ `rounded-lg` hoặc `rounded-full`

### Colors
- **Luôn dùng CSS variables**: `var(--color-*)` hoặc Tailwind arbitrary `[color:var(--color-*)]`
- **Không hard-code** `text-gray-600`, `bg-white`, v.v. trong code mới
- Ngoại lệ: Tailwind semantic classes (`text-white` cho button text trên nền accent)
```

---

## Task 4: Migrate views/components sang utility classes mới

Thay các patterns lặp lại bằng utility classes đã định nghĩa. Ví dụ:

### Buttons (tất cả files):
**Cũ:**
```html
<button class="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50">
```
**Mới:**
```html
<button class="w-full btn btn-primary">
```

**Cũ:**
```html
<button class="flex-1 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition-colors">
```
**Mới:**
```html
<button class="flex-1 btn btn-secondary">
```

### Cards (TopicHubView, SummaryView):
**Cũ:**
```html
<button class="w-full text-left border border-gray-200 rounded-lg p-3 hover:border-blue-300 hover:bg-blue-50/50 transition-colors">
```
**Mới:**
```html
<button class="w-full text-left card-interactive">
```

### Badges (TopicHubView):
**Cũ:**
```html
<span class="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">✓ Đã tóm tắt</span>
```
**Mới:**
```html
<span class="badge badge-success">✓ Đã tóm tắt</span>
```

### Alerts (SummaryView, OpinionsView):
**Cũ:**
```html
<div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
```
**Mới:**
```html
<div class="alert alert-warning">
```

### Inputs (SettingsView, ResearchView):
**Cũ:**
```html
<input class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
```
**Mới:**
```html
<input class="input" />
```

### Root backgrounds (App.vue):
**Cũ:**
```html
<div class="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
  <header class="bg-white border-b border-gray-200">
```
**Mới:**
```html
<div class="min-h-screen bg-(--color-bg-base) text-(--color-text-primary) flex flex-col">
  <header class="bg-(--color-bg-surface) border-b border-(--color-border)">
```

### Files cần migrate (theo thứ tự):
1. `App.vue` — root, header, nav
2. `TopicHubView.vue` — cards, badges
3. `SummaryView.vue` — buttons, alerts, summary box
4. `OpinionsView.vue` — buttons, alerts, opinion cards
5. `ResearchView.vue` — input, buttons, Q&A cards
6. `SettingsView.vue` — inputs, buttons, cache bar
7. `components/ErrorDisplay.vue` — alert pattern
8. `components/CacheIndicator.vue` — badge pattern
9. `components/TopicMeta.vue` — card pattern
10. `components/ExportButton.vue` — dropdown, buttons
11. `components/MarkdownContent.vue` — thêm `dark:prose-invert`
12. `components/LoadingSpinner.vue` — spinner colors
13. `components/AccordionItem.vue` — card pattern

---

## Thứ tự triển khai

1. **Task 1** (CSS tokens + dark variant) — foundation, không breaking
2. **Task 2** (utility classes) — foundation, không breaking
3. **Task 3** (style guide document) — documentation
4. **Task 4** (migrate components) — bulk refactor, có thể chia thành nhiều sub-tasks

**Lưu ý:** Task 1-2 không break code hiện tại (chỉ thêm, không đổi). Task 4 là refactor lớn nên nên làm từng file, build test sau mỗi file.

## Verification
1. `npx vue-tsc --noEmit` + `npm run build` → pass
2. UI trông y hệt trước khi refactor (pixel-perfect regression)
3. Toggle dark mode → tất cả elements hiển thị đúng colors
4. Kiểm tra tất cả views trong cả light/dark mode
5. Grep project không còn hard-coded `bg-white`, `text-gray-900` v.v. trong templates (ngoại trừ `text-white`)
