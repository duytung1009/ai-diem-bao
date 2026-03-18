import { createApp } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import '@/assets/main.css';
import App from './App.vue';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'hub', component: () => import('./views/TopicHubView.vue') },
    { path: '/summary', name: 'summary', component: () => import('./views/SummaryView.vue') },
    { path: '/opinions', name: 'opinions', component: () => import('./views/OpinionsView.vue') },
    { path: '/research', name: 'research', component: () => import('./views/ResearchView.vue') },
    { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') },
  ],
});

createApp(App).use(router).mount('#app');
