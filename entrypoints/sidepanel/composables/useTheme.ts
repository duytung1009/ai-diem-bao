import { ref } from 'vue';
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

  // Listen for OS theme changes when mode = 'system'
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', () => {
    if (themeMode.value === 'system') applyTheme();
  });

  return { themeMode, loadTheme, setTheme };
}
