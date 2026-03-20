import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'AI Điểm Báo',
    description: 'Tóm tắt topic XenForo bằng AI',
    permissions: ['storage', 'sidePanel', 'activeTab', 'tabs', 'scripting'],
    host_permissions: ['<all_urls>'],
    action: {},
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
