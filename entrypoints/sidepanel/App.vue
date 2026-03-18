<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { DetectResult } from '@/lib/types';
import { useTopicStore } from './composables/useTopicStore';

const route = useRoute();
const router = useRouter();
const store = useTopicStore();

// Detect topic on active tab once when sidepanel opens
onMounted(async () => {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) return;

    const result = await browser.tabs.sendMessage(tab.id, {
      type: 'DETECT_XF',
    }) as DetectResult | undefined;

    if (result && result.version !== 'unknown') {
      store.setActiveTab(result, tab.url);
    }
  } catch {
    // Content script not available on this tab — that's fine
  }
});

// Topic-specific tabs disabled when no topic selected
const hasSelectedTopic = computed(() => !!store.selectedTopic.value);

function navigateTo(path: string) {
  router.push(path);
}
</script>

<template>
  <div class="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
    <!-- Header -->
    <header class="bg-white border-b border-gray-200 px-4 py-3">
      <h1 class="text-lg font-bold text-blue-600">AI Điểm Báo</h1>
    </header>

    <!-- Tab Navigation -->
    <nav class="bg-white border-b border-gray-200 flex">
      <router-link
        to="/"
        class="flex-1 text-center py-2.5 text-xs font-medium transition-colors"
        :class="
          route.name === 'hub'
            ? 'text-blue-600 border-b-2 border-blue-600'
            : 'text-gray-500 hover:text-gray-700'
        "
      >
        Chủ đề
      </router-link>
      <button
        class="flex-1 text-center py-2.5 text-xs font-medium transition-colors"
        :class="
          route.name === 'summary'
            ? 'text-blue-600 border-b-2 border-blue-600'
            : hasSelectedTopic
              ? 'text-gray-500 hover:text-gray-700'
              : 'text-gray-300 cursor-not-allowed'
        "
        :disabled="!hasSelectedTopic"
        @click="hasSelectedTopic && navigateTo('/summary')"
      >
        Tóm tắt
      </button>
      <button
        class="flex-1 text-center py-2.5 text-xs font-medium transition-colors"
        :class="
          route.name === 'opinions'
            ? 'text-blue-600 border-b-2 border-blue-600'
            : hasSelectedTopic
              ? 'text-gray-500 hover:text-gray-700'
              : 'text-gray-300 cursor-not-allowed'
        "
        :disabled="!hasSelectedTopic"
        @click="hasSelectedTopic && navigateTo('/opinions')"
      >
        Ý kiến
      </button>
      <button
        class="flex-1 text-center py-2.5 text-xs font-medium transition-colors"
        :class="
          route.name === 'research'
            ? 'text-blue-600 border-b-2 border-blue-600'
            : hasSelectedTopic
              ? 'text-gray-500 hover:text-gray-700'
              : 'text-gray-300 cursor-not-allowed'
        "
        :disabled="!hasSelectedTopic"
        @click="hasSelectedTopic && navigateTo('/research')"
      >
        Tra cứu
      </button>
      <router-link
        to="/settings"
        class="flex-1 text-center py-2.5 text-xs font-medium transition-colors"
        :class="
          route.name === 'settings'
            ? 'text-blue-600 border-b-2 border-blue-600'
            : 'text-gray-500 hover:text-gray-700'
        "
      >
        Cài đặt
      </router-link>
    </nav>

    <!-- Content -->
    <main class="flex-1 overflow-y-auto">
      <router-view />
    </main>
  </div>
</template>
