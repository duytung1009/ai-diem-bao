import { createApp } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import '@/assets/main.css';
import App from '@/entrypoints/sidepanel/App.vue';

export function mountApp(): void {
  const router = createRouter({
    history: createWebHashHistory(),
    routes: [
      { path: '/', name: 'hub', component: () => import('@/entrypoints/sidepanel/views/TopicHubView.vue') },
      { path: '/summary', name: 'summary', component: () => import('@/entrypoints/sidepanel/views/SummaryView.vue') },
      { path: '/knowledge', name: 'knowledge', component: () => import('@/entrypoints/sidepanel/views/KnowledgeView.vue') },
      { path: '/analysis', name: 'analysis', component: () => import('@/entrypoints/sidepanel/views/AnalysisView.vue') },
      { path: '/research', name: 'research', component: () => import('@/entrypoints/sidepanel/views/ResearchView.vue') },
      { path: '/settings', name: 'settings', component: () => import('@/entrypoints/sidepanel/views/SettingsView.vue') },
      { path: '/help', name: 'help', component: () => import('@/entrypoints/sidepanel/views/HelpView.vue') },
      { path: '/notebook', name: 'notebook', component: () => import('@/entrypoints/sidepanel/views/NotebookView.vue') },
    ],
  });

  createApp(App).use(router).mount('#app');
}
