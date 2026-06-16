import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  // Force MV3 on all targets. WXT defaults Firefox to MV2, where the MV3-only
  // `optional_host_permissions` key is dropped from the manifest — leaving zero
  // optional permissions declared, so `browser.permissions.request({ origins })`
  // always fails on Firefox. Firefox 128+ supports MV3 + optional_host_permissions.
  manifestVersion: 3,
  manifest: (env) => {
    const isFirefox = env.browser === 'firefox';
    return {
      name: 'Lội Thớt Hộ',
      description: 'Cho mấy thím lười lội page. Gom phe kháy đểu, bắt bài seeder, nhặt mẹo hay bỏ túi. Lưu local, tự mang key LLM, hổng có kèm sẵn nha!',
      permissions: isFirefox
        ? ['storage', 'activeTab', 'tabs', 'scripting']
        : ['storage', 'sidePanel', 'activeTab', 'scripting'],
      // host_permissions intentionally empty — LLM provider permissions are requested
      // dynamically via browser.permissions.request() at user gesture (save/test).
      // The wildcard patterns below serve as the allowlist for those requests.
      optional_host_permissions: ['https://*/*', 'http://*/*'],
      action: {},
      ...(isFirefox && {
        browser_specific_settings: {
          gecko: {
            id: 'loithotho@extension',
            strict_min_version: '128.0',
            // Required by Firefox for all new extensions. This extension stores
            // everything locally (settings, cache, API key) and sends nothing to
            // any server we control — no data collection. See PRIVACY.md.
            data_collection_permissions: {
              required: ['none'],
            },
          },
        },
      }),
    };
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
