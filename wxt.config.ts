import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'Lười điểm báo',
    description: 'Tóm tắt thread Voz bằng AI (hổng có kèm AI)',
    permissions: ['storage', 'sidePanel', 'activeTab', 'tabs', 'scripting'],
    host_permissions: ['<all_urls>'],
    action: {},
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
