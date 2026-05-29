import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: (env) => {
    const isFirefox = env.browser === 'firefox';
    return {
      name: 'Lội Thớt Hộ',
      description: 'Cho mấy thím lười lội page. Gom phe kháy đểu, bắt bài seeder, nhặt mẹo hay bỏ túi. Lưu local, tự mang key LLM, hổng có kèm sẵn nha!',
      permissions: isFirefox
        ? ['storage', 'activeTab', 'tabs']
        : ['storage', 'sidePanel', 'activeTab', 'scripting'],
      // host_permissions intentionally empty — LLM provider permissions are requested
      // dynamically via chrome.permissions.request() at user gesture (save/test).
      // The wildcard patterns below serve as the allowlist for those requests.
      optional_host_permissions: ['https://*/*', 'http://*/*'],
      action: {},
      ...(isFirefox && {
        browser_specific_settings: {
          gecko: {
            id: 'loithotho@extension',
            strict_min_version: '128.0',
          },
        },
      }),
    };
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
