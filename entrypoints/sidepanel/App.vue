<script setup lang="ts">
import { useRoute } from 'vue-router';
const route = useRoute();
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
        class="flex-1 text-center py-2.5 text-sm font-medium transition-colors"
        :class="
          route.name === 'summary'
            ? 'text-blue-600 border-b-2 border-blue-600'
            : 'text-gray-500 hover:text-gray-700'
        "
      >
        Tóm tắt
      </router-link>
      <router-link
        to="/opinions"
        class="flex-1 text-center py-2.5 text-sm font-medium transition-colors"
        :class="
          route.name === 'opinions'
            ? 'text-blue-600 border-b-2 border-blue-600'
            : 'text-gray-500 hover:text-gray-700'
        "
      >
        Ý kiến
      </router-link>
      <router-link
        to="/settings"
        class="flex-1 text-center py-2.5 text-sm font-medium transition-colors"
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
