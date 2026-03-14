import { createApp } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import '@/assets/main.css';
import App from './App.vue';
import SummaryView from './views/SummaryView.vue';
import SettingsView from './views/SettingsView.vue';
import OpinionsView from './views/OpinionsView.vue';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'summary', component: SummaryView },
    { path: '/opinions', name: 'opinions', component: OpinionsView },
    { path: '/settings', name: 'settings', component: SettingsView },
  ],
});

createApp(App).use(router).mount('#app');
