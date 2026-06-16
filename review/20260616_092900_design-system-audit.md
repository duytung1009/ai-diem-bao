# Design System Audit Report

> **Date:** 2026-06-16 09:29  
> **Auditor:** Task Master AI  
> **Scope:** `entrypoints/sidepanel/**/*.vue` + `assets/main.css`  
> **Method:** Token/scanner inventory + class/attribute analysis

## 1. Token Coverage

### 1.1 Hardcoded Hex Colors in `.vue` Templates

| Count | Location | Detail | Severity |
|-------|----------|--------|----------|
| 0 | — | No hardcoded hex colors found in templates | ✅ Clean |

### 1.2 Tailwind Palette Colors (not tokens)

| Count | Location | Detail | Severity |
|-------|----------|--------|----------|
| 2 | `TrustBadge.vue:20` | `bg-orange-100 text-orange-700 dark:bg-orange-900/40` | 🔶 Should use token |
| 2 | `TrustBadge.vue:22` | `bg-gray-100 text-gray-500 dark:bg-gray-700/50` | 🔶 Should use token |
| 4 | `HelpView.vue` | `text-white` on badges | 🔶 Minor |
| 1 | `CostConfirmModal.vue:28` | `bg-black/40` backdrop overlay | 🔶 Minor |
| ~5 | `SettingsView.vue` toggles | `after:border-gray-300` | 🔶 Should be `--color-border-strong` |

### 1.3 Bare `rounded` Class

| Count | Location | Detail | Severity |
|-------|----------|--------|----------|
| 0 | — | All `rounded-*` are explicit (`rounded-lg`, `rounded-full`, etc.) | ✅ Clean |

### 1.4 `-muted` Token Usage

| Count | Location | Detail | Severity |
|-------|----------|--------|----------|
| 0 | — | No deprecated muted token for text | ✅ Clean |

### 1.5 `text-yellow-*`/`bg-yellow-*` (should be `--color-saved`)

| Count | Location | Detail | Severity |
|-------|----------|--------|----------|
| 0 | — | Correctly uses `text-(--color-saved)` | ✅ Clean |

---

## 2. Form-Control Inventory

| Control Type | Count | Location | Consistency | Action Needed |
|---|---|---|---|---|
| Toggle switch (checkbox) | 5 | `SettingsView.vue` | ✅ Identical pattern 5× | Extract to `ToggleSwitch.vue` |
| Radio button | 2 | `SettingsView.vue` | ✅ Identical inline style | Extract to `radio` utility or `RadioGroup.vue` |
| Range slider | 5 | `SettingsView.vue` | ✅ All use `.input-range` | Promote to `@utility input-range` |
| Number input | 5 | `SettingsView.vue` | ⚠️ Mixed widths: `flex-1` (3×) vs `w-20` (2×) | Accept as intentional |
| Select | 1 | `SettingsView.vue` | OK — uses `input` class | Consider custom `@utility select` |
| Textarea | 7 | Various | ✅ All use `input` class | OK |

### Raw `<input type="checkbox|radio">` Outside Component

| Count | Location | Detail | Severity |
|-------|----------|--------|----------|
| 5 | `SettingsView.vue` | All `sr-only peer` pattern (checkbox for toggle) | ✅ Acceptable once component exists |
| 2 | `SettingsView.vue` | Raw `<input type="radio">` with `appearance-none` | 🔶 Needs `RadioGroup.vue` |

---

## 3. Component Completeness

### 3.1 Existing `@utility` Classes in `assets/main.css` (25 total)

| Utility | Status | Notes |
|---------|--------|-------|
| `btn` / `btn-primary` / `btn-secondary` / `btn-soft` | ✅ Complete | All states defined |
| `btn-sm` / `btn-danger` / `btn-ghost` | ✅ Complete | |
| `card` / `card-interactive` / `card-flat` | ✅ Complete | |
| `badge` / `badge-accent/success/warning/info/neutral` | ✅ Complete | |
| `alert` / `alert-warning/error/success/info` | ✅ Complete | |
| `input` | ✅ Complete | |
| `section-heading` | ✅ Complete | Used 38× across 11 files |
| `link` | ✅ Complete | |
| `btn-llm` | ✅ Complete | |
| `.input-range` (class, not `@utility`) | 🔶 Should be `@utility input-range` | |

### 3.2 Missing Utilities

| Missing Utility | Reason | Priority |
|---|---|---|
| `@utility checkbox` | Token-based checkbox styling | Medium |
| `@utility radio` | Replace inline radial-gradient hack | Medium |
| `@utility select` | Custom select arrow (Chrome) | Low |
| `@utility toggle` | Not needed — component instead | — |

### 3.3 Existing Vue Components (21 total)

All 21 in `entrypoints/sidepanel/components/` are structurally sound. No missing component wrappers per se, but pattern extraction needed:

| Pattern | Proposed Component | Priority |
|---|---|---|
| Icon-only button | `IconButton.vue` | High |
| Inline confirm dialog | `ConfirmInline.vue` | Medium |
| 3-dot overflow menu | `OverflowMenu.vue` | Medium |
| Form field wrapper | `FormField.vue` | High |
| Toggle switch | `ToggleSwitch.vue` | High |
| Checkbox | `Checkbox.vue` | Medium |
| Radio group | `RadioGroup.vue` | Medium |

---

## 4. Accessibility Issues

| File:Line | Issue | Severity | Fix |
|---|---|---|---|
| `KnowledgeView.vue:599` | Icon-only close button missing `aria-label` | 🔴 High | Add `aria-label="Đóng"` |
| `SummaryView.vue:331` | Icon-only expand button missing `aria-label` | 🔴 High | Add `aria-label="Mở rộng"` |

---

## 5. Views Inconsistency Score

| View | Score | Notes |
|---|---|---|
| `NotebookEntryEditor.vue` | 🟢 8/10 | Labels use `text-muted` (should be `text-secondary`); close button lacks `aria-label` |
| `SettingsView.vue` | 🟡 6/10 | Duplicated toggle pattern; radio radial-gradient hack; raw `after:border-gray-300` |
| `KnowledgeView.vue` | 🟢 9/10 | One missing `aria-label`; good token usage |
| `SummaryView.vue` | 🟢 9/10 | One missing `aria-label`; good token usage |
| `KnowledgeEntryCard.vue` | 🟢 10/10 | All icon buttons have `title`+`aria-label`; good token usage |
| `NotebookView.vue` | 🟢 10/10 | Proper aria, token usage |

---

## 6. Remediation Backlog (Priority-Ordered)

### P0 — Must fix before ESLint baseline

| # | File | Fix | Depends On |
|---|---|---|---|
| R01 | `KnowledgeView.vue:599` | Add `aria-label="Đóng"` | None |
| R02 | `SummaryView.vue:331` | Add `aria-label` binding | None |

### P1 — After ESLint + components ready

| # | File | Fix | Depends On |
|---|---|---|---|
| R03 | `NotebookEntryEditor.vue` | Replace close button with `IconButton` | Task 404 |
| R04 | `NotebookEntryEditor.vue` | Fix label token `-muted` → `text-secondary` | Task 403 |
| R05 | `SettingsView.vue` | Replace 5× toggle with `ToggleSwitch.vue` | Task 405 |
| R06 | `SettingsView.vue` | Replace 2× radio with `RadioGroup.vue` | Task 405 |
| R07 | `SettingsView.vue` toggles | Fix `after:border-gray-300` → token | Task 405 |
| R08 | `TrustBadge.vue` | Replace raw Tailwind colors with tokens | Task 403 |
| R09 | `HelpView.vue` | Replace `text-white` with token | Task 403 |
| R10 | `CostConfirmModal.vue` | Replace `bg-black/40` | Task 403 |
| R11 | `KnowledgeView.vue` menu | Replace with `OverflowMenu.vue` | Task 404 |
| R12 | `KnowledgeView.vue` error close | Replace with `IconButton.vue` | Task 404 |
| R13 | `SummaryView.vue` expand | Replace with `IconButton.vue` | Task 404 |

### P2 — Polish

| # | File | Fix | Depends On |
|---|---|---|---|
| R14 | All | Update `STYLE_GUIDE.md` with Component Inventory | Task 408 |
| R15 | `assets/main.css` | Promote `.input-range` → `@utility input-range` | Task 403 |
| R16 | `assets/main.css` | Add `@utility select` | Task 403 |
