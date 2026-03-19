# Feature: Dark Mode

## Mục tiêu
Hỗ trợ dark mode cho toàn bộ sidepanel UI. User có thể chọn: Light / Dark / System (theo OS preference). Mặc định: System.

---

## Task 1: Cấu hình Tailwind v4 dark mode

### File: `assets/main.css`

Tailwind v4 hỗ trợ dark mode qua CSS `@variant`. Thêm config:

```css
@import 'tailwindcss';
@plugin '@tailwindcss/typography';

@custom-variant dark (&:where(.dark, .dark *));
```

**Cơ chế:** Class-based dark mode — thêm class `dark` lên root element `<html>` hoặc `<body>` để kích hoạt. Lý do chọn class thay vì `prefers-color-scheme`: cho phép user override manual (Light/Dark), không chỉ theo OS.

---

## Task 2: Thêm theme setting vào types và constants

### File: `lib/types.ts`
Thêm type mới:
```typescript
export type ThemeMode = 'light' | 'dark' | 'system';
```

### File: `lib/constants.ts`
Thêm storage key:
```typescript
export const STORAGE_KEYS = {
  SETTINGS: 'llm-settings',
  CACHE_PREFIX: 'cache:',
  CUSTOM_PROMPTS: 'custom-prompts',
  THEME: 'theme-mode',         // ← thêm
} as const;

export const DEFAULT_THEME: ThemeMode = 'system';
```

---

## Task 3: Tạo composable useTheme

### File mới: `entrypoints/sidepanel/composables/useTheme.ts`

```typescript
import { ref, watchEffect } from 'vue';
import type { ThemeMode } from '@/lib/types';
import { STORAGE_KEYS } from '@/lib/constants';

const themeMode = ref<ThemeMode>('system');

export function useTheme() {
  async function loadTheme() {
    const result = await browser.storage.sync.get(STORAGE_KEYS.THEME);
    themeMode.value = (result[STORAGE_KEYS.THEME] as ThemeMode) || 'system';
    applyTheme();
  }

  async function setTheme(mode: ThemeMode) {
    themeMode.value = mode;
    await browser.storage.sync.set({ [STORAGE_KEYS.THEME]: mode });
    applyTheme();
  }

  function applyTheme() {
    const root = document.documentElement;
    if (themeMode.value === 'dark') {
      root.classList.add('dark');
    } else if (themeMode.value === 'light') {
      root.classList.remove('dark');
    } else {
      // System: follow OS preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('dark', prefersDark);
    }
  }

  // Listen for OS theme changes khi mode = 'system'
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', () => {
    if (themeMode.value === 'system') applyTheme();
  });

  return { themeMode, loadTheme, setTheme };
}
```

---

## Task 4: Khởi tạo theme khi App mount

### File: `entrypoints/sidepanel/App.vue`

Thêm vào `onMounted`:
```typescript
import { useTheme } from './composables/useTheme';
const { loadTheme } = useTheme();

onMounted(async () => {
  await loadTheme();   // ← thêm, chạy đầu tiên
  await detectActiveTabTopic();
  // ...listeners...
});
```

---

## Task 5: Thêm theme selector vào Settings

### File: `entrypoints/sidepanel/views/SettingsView.vue`

Thêm block ở **đầu** trang Settings (trước "Cấu hình LLM"):

```html
<!-- Theme -->
<div>
  <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Giao diện</label>
  <div class="flex gap-2">
    <button
      v-for="option in themeOptions"
      :key="option.value"
      class="flex-1 py-1.5 text-xs rounded-lg border transition-colors"
      :class="currentTheme === option.value
        ? 'bg-blue-600 text-white border-blue-600'
        : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'"
      @click="setTheme(option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</div>
```

```typescript
import { useTheme } from '../composables/useTheme';
const { themeMode: currentTheme, setTheme } = useTheme();

const themeOptions = [
  { value: 'light' as const, label: 'Sáng' },
  { value: 'dark' as const, label: 'Tối' },
  { value: 'system' as const, label: 'Hệ thống' },
];
```

---

## Task 6: Thêm dark: variant cho tất cả views và components

Đây là task lớn nhất — cần thêm `dark:` class cho mọi element có hard-coded light colors.

### Nguyên tắc mapping:

| Light | Dark |
|-------|------|
| `bg-gray-50` | `dark:bg-gray-900` |
| `bg-white` | `dark:bg-gray-800` |
| `text-gray-900` | `dark:text-gray-100` |
| `text-gray-700` | `dark:text-gray-300` |
| `text-gray-600` | `dark:text-gray-400` |
| `text-gray-500` | `dark:text-gray-400` |
| `text-gray-400` | `dark:text-gray-500` |
| `border-gray-200` | `dark:border-gray-700` |
| `border-gray-300` | `dark:border-gray-600` |
| `bg-blue-600` | `dark:bg-blue-500` (primary button) |
| `bg-blue-50` | `dark:bg-blue-900/30` |
| `bg-green-50` | `dark:bg-green-900/30` |
| `bg-yellow-50` | `dark:bg-yellow-900/30` |
| `bg-red-50` | `dark:bg-red-900/30` |
| `hover:bg-gray-50` | `dark:hover:bg-gray-700` |
| `hover:bg-blue-50/50` | `dark:hover:bg-blue-900/20` |

### Files cần sửa (theo thứ tự):

1. **`App.vue`** — root bg, header, nav tabs
2. **`TopicHubView.vue`** — cards, badges, empty state
3. **`SummaryView.vue`** — buttons, loading, summary box, warnings
4. **`OpinionsView.vue`** — opinion cards, sentiment colors
5. **`ResearchView.vue`** — input, Q&A history cards
6. **`SettingsView.vue`** — form inputs, cache bar, prompt editor
7. **`components/LoadingSpinner.vue`** — spinner colors
8. **`components/TopicMeta.vue`** — card background
9. **`components/ErrorDisplay.vue`** — error box
10. **`components/CacheIndicator.vue`** — badge colors
11. **`components/MarkdownContent.vue`** — thêm `dark:prose-invert` cho typography
12. **`components/ExportButton.vue`** — dropdown menu
13. **`components/AccordionItem.vue`** — header/content bg

### Ví dụ cho App.vue:

**Cũ:**
```html
<div class="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
  <header class="bg-white border-b border-gray-200 px-4 py-3">
```

**Mới:**
```html
<div class="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 flex flex-col">
  <header class="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
```

---

## Thứ tự triển khai

1. Task 1 (Tailwind config) — foundation
2. Task 2 (types/constants) — foundation
3. Task 3 (useTheme composable) — logic
4. Task 4 (App.vue init) — wiring
5. Task 5 (Settings selector) — UI control
6. Task 6 (all dark: classes) — bulk styling, có thể chia thành sub-tasks

## Verification
1. `npx vue-tsc --noEmit` + `npm run build` → pass
2. Settings → chọn "Tối" → toàn bộ UI chuyển dark
3. Chọn "Sáng" → quay lại light
4. Chọn "Hệ thống" → follow OS setting
5. Kiểm tra tất cả views: Hub, Summary, Opinions, Research, Settings đều hiển thị đúng trong cả 2 mode
6. Prose/markdown content readable trong dark mode
7. Reload extension → theme setting persist
