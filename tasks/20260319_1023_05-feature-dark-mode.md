# Feature 05: Dark Mode — Implementation Summary

## Trạng thái: DONE ✅

Build: `npm run build` ✅ | Type check: `npx vue-tsc --noEmit` ✅

---

## Những gì đã thực hiện

### Task 1: Tailwind v4 `@custom-variant dark`
- **File:** `assets/main.css`
- Đã có sẵn từ Feature 04: `@custom-variant dark (&:where(.dark, .dark *));`
- Cơ chế: class-based dark mode — thêm `.dark` vào `<html>` để kích hoạt

### Task 2: ThemeMode type + Constants
- **`lib/types.ts`:** Thêm `export type ThemeMode = 'light' | 'dark' | 'system'`
- **`lib/constants.ts`:** Thêm `THEME: 'theme-mode'` vào `STORAGE_KEYS`, thêm `DEFAULT_THEME: ThemeMode = 'system'`

### Task 3: `useTheme` composable
- **File mới:** `entrypoints/sidepanel/composables/useTheme.ts`
- Module-level singleton `themeMode` ref (same pattern as `useTopicStore`)
- `loadTheme()`: đọc từ `browser.storage.sync`, gọi `applyTheme()`
- `setTheme(mode)`: lưu vào storage, gọi `applyTheme()`
- `applyTheme()`: toggle class `.dark` trên `document.documentElement`
- Listener `window.matchMedia('(prefers-color-scheme: dark)')` để theo OS khi mode=`system`

### Task 4: Khởi tạo theme trong App.vue
- **`entrypoints/sidepanel/App.vue`:** Import `useTheme`, gọi `await loadTheme()` đầu `onMounted`, trước `detectActiveTabTopic()`

### Task 5: Theme selector trong Settings
- **`entrypoints/sidepanel/views/SettingsView.vue`:**
  - Import `useTheme`, extract `{ themeMode: currentTheme, setTheme }`
  - Thêm `themeOptions = [{ Sáng/light }, { Tối/dark }, { Hệ thống/system }]`
  - Block UI đặt **ở trên cùng** trang Settings (trước "Cấu hình LLM")
  - Button active: `bg-blue-600 dark:bg-blue-500`, inactive: CSS vars

### Task 6: Dark variant cho views/components (hardcoded colors)
Các thành phần đã dùng CSS vars `var(--color-*)` hoạt động tự động nhờ `.dark {}` block trong `main.css`. Chỉ cần sửa các hardcoded color class:

**`TopicHubView.vue`:**
- "Tab hiện tại" button: +`dark:border-blue-800 dark:bg-blue-900/30 dark:hover:border-blue-600`
- "Tab hiện tại" badge: +`dark:text-blue-400 dark:bg-blue-900/50`
- Summarizing badges (×2): +`dark:bg-blue-900/50 dark:text-blue-400`
- Topic card summarizing state: +`dark:border-blue-700 dark:bg-blue-900/20`
- Topic card hover: +`dark:hover:border-blue-600`
- Delete button: +`dark:text-gray-600 dark:hover:text-red-400`

**`OpinionsView.vue`:**
- `getSentimentColor()`: thêm dark variants cho Tích cực (green), Tiêu cực (red), default (gray)
- Supporter count badge: +`dark:bg-blue-900/50 dark:text-blue-400`

**`components/TopicMeta.vue`:**
- XF2 badge: +`dark:bg-green-900/30 dark:text-green-400`
- XF1 badge: +`dark:bg-yellow-900/30 dark:text-yellow-300`

**`views/SettingsView.vue`:**
- Cache warning text: `text-orange-600` → +`dark:text-orange-400` (×2)

### Fix: `alert-info` border color
- **`assets/main.css`:** Thêm CSS var `--color-info-border` (light: `blue.200`, dark: `blue.800`), cập nhật `alert-info` utility dùng `var(--color-info-border)` thay vì hardcoded `theme(colors.blue.200)`

---

## Files đã thay đổi
- `lib/types.ts` — ThemeMode type
- `lib/constants.ts` — STORAGE_KEYS.THEME, DEFAULT_THEME
- `entrypoints/sidepanel/composables/useTheme.ts` — **NEW**
- `entrypoints/sidepanel/App.vue` — loadTheme init
- `entrypoints/sidepanel/views/SettingsView.vue` — theme selector + orange dark
- `entrypoints/sidepanel/views/TopicHubView.vue` — blue/gray dark variants
- `entrypoints/sidepanel/views/OpinionsView.vue` — sentiment/badge dark variants
- `entrypoints/sidepanel/components/TopicMeta.vue` — XF badge dark variants
- `assets/main.css` — --color-info-border token

## Files không cần sửa (đã dùng CSS vars)
- `components/LoadingSpinner.vue` ✅
- `components/CacheIndicator.vue` ✅
- `components/ErrorDisplay.vue` ✅
- `components/AccordionItem.vue` ✅
- `components/ExportButton.vue` ✅ (dropdown dùng CSS vars; toast `bg-gray-800` intentional)
- `components/MarkdownContent.vue` ✅ (đã có `dark:prose-invert` từ trước)
- `views/SummaryView.vue` ✅
- `views/ResearchView.vue` ✅
