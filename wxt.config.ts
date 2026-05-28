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
        : ['storage', 'sidePanel', 'activeTab'],
      // Explicit host_permissions for known LLM providers.
      // Without this, the background service worker cannot fetch these origins after
      // content_scripts.matches was narrowed from *://*/* to only voz.vn + otofun.net
      // (content script matches implicitly grant host_permissions in MV3).
      host_permissions: [
        'https://api.openai.com/*',                    // OpenAI
        'https://api.anthropic.com/*',                 // Anthropic Claude
        'https://generativelanguage.googleapis.com/*', // Google Gemini
        'https://openrouter.ai/*',                     // OpenRouter
      ],
      // Allows chrome.permissions.request() to grant access to any custom endpoint at
      // runtime. Required for the 'custom' provider: the user enters an arbitrary URL
      // (including http:// local servers with ports, e.g. http://host.local:1234/v1),
      // and chrome.permissions.request() fails unless the origin matches a pattern here.
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
