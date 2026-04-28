# Cơ chế Dark Mode

> Cập nhật: 2026-04-29

## Tổng quan

Dark mode dùng class-based approach: thêm class `dark` vào `<html>` element. CSS variables (design tokens) tự động chuyển theme.

## `useTheme` Composable

Module-level singleton:

```typescript
const themeMode = ref<ThemeMode>('system'); // 'light' | 'dark' | 'system'
let mediaListenerRegistered = false;

function useTheme() {
  // Load từ storage.sync khi khởi động
  async function loadTheme() {
    const result = await browser.storage.sync.get(STORAGE_KEYS.THEME);
    themeMode.value = result[STORAGE_KEYS.THEME] || 'system';
    applyTheme();
  }

  // Set và persist
  async function setTheme(mode: ThemeMode) {
    themeMode.value = mode;
    await browser.storage.sync.set({ [STORAGE_KEYS.THEME]: mode });
    applyTheme();
  }

  // Apply theme class
  function applyTheme() {
    const root = document.documentElement;
    if (themeMode.value === 'dark') {
      root.classList.add('dark');
    } else if (themeMode.value === 'light') {
      root.classList.remove('dark');
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('dark', prefersDark);
    }
  }
}
```

### System Preference Listener

Khi mode = `'system'`, lắng nghe OS theme change:

```typescript
if (!mediaListenerRegistered) {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', () => {
    if (themeMode.value === 'system') applyTheme();
  });
  mediaListenerRegistered = true;
}
```

## CSS Variables (Design Tokens)

Định nghĩa trong `assets/main.css` với Tailwind CSS v4 `@theme` directive:

```css
:root {
  --color-bg-primary: #ffffff;
  --color-text-primary: #1a1a2e;
  --color-text-secondary: #4a4a6a;
  --color-text-muted: #9ca3af;
  --color-bg-muted: #f3f4f6;
  --color-border: #e5e7eb;
  --color-accent: #3b82f6;
  /* ... */
}

.dark {
  --color-bg-primary: #1a1a2e;
  --color-text-primary: #e5e7eb;
  --color-text-secondary: #9ca3af;
  --color-text-muted: #6b7280;
  --color-bg-muted: #374151;
  --color-border: #4b5563;
  --color-accent: #60a5fa;
  /* ... */
}
```

### Quy tắc sử dụng (từ STYLE_GUIDE.md)

- **Luôn dùng CSS variables:** `var(--color-*)` hoặc Tailwind arbitrary `[color:var(--color-*)]`
- **Không hard-code** `text-gray-600`, `bg-white`, v.v.
- Ngoại lệ: Tailwind semantic classes (`text-white` cho button text trên nền accent)
- Màu nền component: `var(--color-bg-primary)` (card), `var(--color-bg-muted)` (alert/badge)
- Màu text: `var(--color-text-primary)` (chính), `var(--color-text-secondary)` (phụ), `var(--color-text-muted)` (mờ)

## Settings UI

Trong `SettingsView.vue` → Theme selector:

```
Theme: [Light] [Dark] [System]
```

Lưu vào `storage.sync` key `theme-mode`.

## Flow

```
App mount → useTheme.loadTheme()
              ↓
          storage.sync get → themeMode
              ↓
          applyTheme() → thêm/xóa .dark class
              ↓
          CSS variables tự động chuyển theme
```

Khi user đổi theme trong Settings:
```
setTheme('dark')
  → themeMode.value = 'dark'
  → storage.sync.set
  → applyTheme()
  → root.classList.add('dark')
```
