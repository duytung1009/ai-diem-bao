import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'Lội Thớt Hộ',
    description: 'Cho mấy thím lười lội page. Gom phe kháy đểu, bắt bài seeder, nhặt mẹo hay bỏ túi. Lưu local, tự mang key LLM, hổng có kèm sẵn nha!',
    permissions: ['storage', 'sidePanel', 'activeTab'],
    host_permissions: [],
    action: {},
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
