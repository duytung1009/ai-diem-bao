# Feature: Styling Rules — Design System cho AI Điểm Báo

**Status:** ✅ COMPLETED
**Date:** 2026-03-19
**PR Size:** 14 files modified + 1 file created (STYLE_GUIDE.md)

## Mục tiêu

Định nghĩa bộ quy tắc styling chung (design tokens + utility classes), migrate toàn bộ views/components sang hệ thống mới, chuẩn bị nền tảng cho dark mode.

## Thực hiện

### Task 1+2: CSS Design Tokens + Utility Classes ✅

**File:** `assets/main.css`

Thêm 3 phần vào sau `@import 'tailwindcss'`:

1. **`@custom-variant dark`** — định nghĩa dark mode variant qua class `.dark`

2. **`:root` CSS variables** — single source of truth cho colors:
   - `--color-bg-base/surface/muted` — surface colors
   - `--color-text-primary/secondary/muted` — text hierarchy
   - `--color-border/border-strong` — borders
   - `--color-accent/accent-hover/accent-soft/accent-text` — interactive
   - `--color-success/warning/error-*` (bg, text, border) — semantic

3. **`.dark` overrides** — tất cả colors override tại 1 chỗ, không cần `dark:` prefix ở từng element

4. **`@utility` classes** — component patterns:
   - `btn`, `btn-primary`, `btn-secondary`, `btn-sm`, `btn-danger`
   - `card`, `card-interactive`
   - `badge`, `badge-success`, `badge-neutral`
   - `alert`, `alert-warning`, `alert-error`, `alert-success`, `alert-info`
   - `input`

### Task 3: STYLE_GUIDE.md ✅

**File mới:** `STYLE_GUIDE.md` (project root)

Document hướng dẫn usage: bảng tham chiếu classes, spacing conventions, border radius rules, color policy.

### Task 4: Migrate Views + Components ✅

**Migrate từ hard-coded Tailwind → utility classes + CSS variables.**

Phần lớn migration được VS Code linter/formatter tự động áp dụng ngay sau khi CSS foundations được định nghĩa.

#### Views migrated:

**`App.vue`**
- Root div: `bg-gray-50 text-gray-900` → `bg-[var(--color-bg-base)] text-[var(--color-text-primary)]`
- Header + nav: `bg-white border-gray-200` → `bg-[var(--color-bg-surface)] border-[var(--color-border)]`
- Nav tab inactive states: → CSS vars

**`TopicHubView.vue`**
- Status badges: `text-xs px-2 py-0.5 rounded-full bg-green-100...` → `badge badge-success/badge-neutral`
- Summarizing badge: → `badge bg-blue-100 text-blue-700 animate-pulse`
- Card border: `border-gray-200 hover:bg-blue-50/50` → `border-[var(--color-border)] hover:bg-[var(--color-accent-soft)]`
- Delete confirm: `bg-red-50 border-red-200 rounded-lg...` → `alert alert-error`
- Delete buttons: → `btn btn-danger`, `btn btn-sm btn-secondary`
- Text colors: `text-gray-500/400/900` → CSS vars

**`SummaryView.vue`**
- Summarize button: `py-2.5 bg-blue-600...` → `btn btn-primary`
- Cancel button: `py-1.5 text-xs...` → `btn btn-sm btn-secondary`
- Token estimation box: `border-blue-200 bg-blue-50...` → `alert alert-info`
- Confirm/Cancel buttons: → `btn btn-sm btn-primary/secondary`
- Scraping warnings: `bg-yellow-50...` → `alert alert-warning text-xs`
- Summary content box: `bg-white border-gray-200 p-4` → `card p-4`
- Re-summarize button: → `btn btn-secondary`
- Text colors: → CSS vars

**`OpinionsView.vue`**
- Warning box: → `alert alert-warning`
- Analyze button: → `btn btn-primary`
- Cards: `border border-gray-200 rounded-lg p-3` → `card`
- Opinion item quote: `bg-gray-50 border-gray-200 rounded` → CSS vars
- Badge for supporter count: → `badge`
- Text colors, headings: → CSS vars

**`ResearchView.vue`**
- Warning box: → `alert alert-warning`
- Textarea: → `input resize-none`
- Research button: → `btn btn-primary`
- Suggestion chips: `bg-gray-100 text-gray-700 hover:bg-blue-50` → CSS vars
- Q&A cards: `border-gray-200` → CSS vars (bg + border)
- Text colors: → CSS vars

**`SettingsView.vue`**
- All inputs/selects: → `input`
- Save/Test buttons: → `btn btn-primary`, `btn btn-secondary`
- Cache storage card: `border-gray-200 rounded-lg p-3` → `card`
- Cache bar bg: `bg-gray-200` → `bg-[var(--color-bg-muted)]`
- Clear cache button: `border-red-300 text-red-600` → `btn btn-danger`
- Clear confirm box: → `alert alert-error`
- Test result boxes: → `alert alert-success/error`
- Prompt template section: borders + bg → CSS vars
- Prompt textarea: → `input text-xs font-mono resize-y`
- Prompt tab states: → CSS vars
- Prompt action buttons: → `btn btn-sm btn-primary/secondary`
- Text+message colors: `text-green-600/red-600` → `text-[var(--color-success/error-text)]`

#### Components migrated:

**`ErrorDisplay.vue`**
- Root: `bg-red-50 border-red-200 rounded-lg p-4` → `alert alert-error p-4`
- SVG + text: removed explicit red colors (inherit from `alert-error`)
- Action buttons: `border-red-300 text-red-700 hover:bg-red-100` → CSS vars

**`CacheIndicator.vue`** — linter migrated `text-gray-400/blue-600` → CSS vars; badge class still uses computed values (freshness-specific colors)

**`TopicMeta.vue`** — linter migrated `bg-white border-gray-200` → `card`; text colors → CSS vars

**`ExportButton.vue`** — linter migrated dropdown: `bg-white border-gray-200` → CSS vars; trigger button → `btn btn-secondary btn-sm`; dropdown items → CSS vars

**`MarkdownContent.vue`** — thêm `dark:prose-invert` (was already done in this session)

**`LoadingSpinner.vue`** — linter migrated: spinner `border-blue-200 border-t-blue-600` → CSS vars; text → CSS var

**`AccordionItem.vue`** — linter migrated: border, bg colors → CSS vars

## Verification ✅

- ✅ `npx vue-tsc --noEmit` — pass (no type errors)
- ✅ `npm run build` — pass (306.45 kB, thêm ~18 kB so với trước do CSS tokens)
- ⚠️ 1 CSS optimizer warning về `[color:var(--color-*)]` trong generated CSS — harmless, do Tailwind scan STYLE_GUIDE.md và pick up literal `[color:var(--color-*)]` text làm class name

## Architecture Notes

### Design Token Strategy

```css
:root { --color-*: theme(colors.*); }
.dark { --color-*: theme(colors.*); /* darker overrides */ }
```

Component templates dùng:
- `var(--color-*)` trong CSS classes
- Tailwind arbitrary: `text-[var(--color-text-primary)]`
- Semantic utility classes: `badge badge-success`, `alert alert-warning`, etc.

### Cascade Order

Trong Tailwind v4, `@utility` classes được thêm sau `@import 'tailwindcss'` nên có cascade priority cao hơn built-in utilities. Khi cần override property từ `@utility` class (ví dụ: `btn-primary` sets `py-2` nhưng cần `py-2.5`), cần thêm explicit Tailwind class + accept CSS cascade behavior.

### Linter Auto-migration

VS Code eslint/prettier plugin tự động áp dụng nhiều class replacements khi detect các patterns đã match với utility class definitions. Điều này đẩy nhanh migration đáng kể.

## Files Modified

1. `assets/main.css` — +150 lines: design tokens + utility classes
2. `STYLE_GUIDE.md` — NEW: styling documentation
3. `entrypoints/sidepanel/App.vue` — root bg/surface colors
4. `entrypoints/sidepanel/views/TopicHubView.vue` — badges, buttons, text colors
5. `entrypoints/sidepanel/views/SummaryView.vue` — buttons, alerts, cards, text colors
6. `entrypoints/sidepanel/views/OpinionsView.vue` — buttons, alerts, cards, text colors
7. `entrypoints/sidepanel/views/ResearchView.vue` — input, buttons, cards, text colors
8. `entrypoints/sidepanel/views/SettingsView.vue` — inputs, buttons, alerts, cards, text colors
9. `entrypoints/sidepanel/components/ErrorDisplay.vue` — alert pattern
10. `entrypoints/sidepanel/components/CacheIndicator.vue` — text colors (linter)
11. `entrypoints/sidepanel/components/TopicMeta.vue` — card pattern (linter)
12. `entrypoints/sidepanel/components/ExportButton.vue` — buttons + dropdown (linter)
13. `entrypoints/sidepanel/components/MarkdownContent.vue` — dark:prose-invert (linter)
14. `entrypoints/sidepanel/components/LoadingSpinner.vue` — spinner + text colors (linter)
15. `entrypoints/sidepanel/components/AccordionItem.vue` — borders + bg (linter)

## Testing Checklist

- [ ] UI hiển thị đúng (pixel-perfect so với trước khi refactor)
- [ ] Tất cả buttons, inputs, cards đều dùng utility classes
- [ ] Không còn hard-coded `bg-white`, `text-gray-900` trong templates (ngoại trừ `text-white` cho button text)
- [ ] Toggle dark mode → tất cả elements hiển thị đúng (thêm class `.dark` vào root element để test)
- [ ] All views functional: TopicHub, Summary, Opinions, Research, Settings
- [ ] Dropdown ExportButton hoạt động đúng

## Next Steps

- **Feature 05+:** Khi thêm components mới, dùng utility classes đã định nghĩa
- **Dark mode toggle:** Implement UI toggle thêm/xóa `.dark` class vào `<html>` element
- **Badge variants:** Nếu cần badge-warning/badge-error, thêm vào `assets/main.css`
