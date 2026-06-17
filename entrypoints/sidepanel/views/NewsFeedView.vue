<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { sendMessage } from '@/lib/messaging';
import { filterToday, scoreThreads } from '@/lib/hot-threads';
import { scrapeForumList } from '@/lib/scrapers/forum-lister';
import { requestOriginPermission } from '@/lib/permissions';
import type { HotThreadScore } from '@/lib/hot-threads';
import { useActiveForum } from '../composables/useActiveForum';
import { STORAGE_KEYS } from '@/lib/constants';
import IconButton from '../components/IconButton.vue';
import EmptyState from '../components/EmptyState.vue';

const activeForum = useActiveForum();
const { forumUrl, detected: forumDetected, detect: detectForum, setUrl } = activeForum;
const router = useRouter();
const threads = ref<HotThreadScore[]>([]);
const loading = ref(false);
const error = ref('');
const hasLoaded = ref(false);
const forumHistory = ref<string[]>([]);
const pendingPermissionOrigin = ref('');

function openThread(url: string) {
  browser.tabs.create({ url }).then(tab => {
    if (tab?.id) browser.tabs.update(tab.id, { active: true }).catch(() => {});
  }).catch(() => {});
  router.push('/');
}

function relativeTime(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Vừa xong';
  if (mins < 60) return mins + ' phút trước';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + ' giờ trước';
  const days = Math.floor(hours / 24);
  if (days < 7) return days + ' ngày trước';
  return d.toLocaleDateString('vi-VN');
}

function compactNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

async function loadForum() {
  if (!forumUrl.value) return;
  loading.value = true;
  error.value = '';
  pendingPermissionOrigin.value = '';

  try {
    const result = await sendMessage<{ ok: boolean; status: number; html: string; forumUrl: string; errors: string[]; needPermission?: boolean; origin?: string }>(
      'FETCH_FORUM_LIST', { forumUrl: forumUrl.value },
    );
    if (result.needPermission && result.origin) {
      pendingPermissionOrigin.value = result.origin;
      return;
    }
    if (result.errors.length > 0) {
      error.value = result.errors.join('; ');
      return;
    }
    if (!result.ok || !result.html) {
      error.value = `HTTP ${result.status}`;
      return;
    }
    const doc = new DOMParser().parseFromString(result.html, 'text/html');
    const threadsData = scrapeForumList(doc, result.forumUrl);
    const recent = filterToday(threadsData);
    const scored = scoreThreads(recent);
    threads.value = scored.slice(0, 10);
    hasLoaded.value = true;
    await saveToHistory(forumUrl.value);
  } catch (err) {
    error.value = String(err);
    threads.value = [];
  } finally {
    if (!pendingPermissionOrigin.value) loading.value = false;
  }
}

async function handleGrantPermission() {
  const origin = pendingPermissionOrigin.value;
  if (!origin) return;
  const granted = await requestOriginPermission(origin);
  pendingPermissionOrigin.value = '';
  if (granted) {
    await loadForum();
  } else {
    error.value = 'Chưa cấp quyền truy cập forum.';
  }
}

async function loadHistory() {
  try {
    const result = await browser.storage.sync.get(STORAGE_KEYS.NEWS_FEED_HISTORY);
    const list = result[STORAGE_KEYS.NEWS_FEED_HISTORY] as string[] | undefined;
    forumHistory.value = list ?? [];
  } catch {
    forumHistory.value = [];
  }
}

async function saveToHistory(url: string) {
  try {
    const existing = new Set(forumHistory.value);
    existing.add(url);
    const updated = [...existing].slice(0, 5);
    forumHistory.value = updated;
    await browser.storage.sync.set({ [STORAGE_KEYS.NEWS_FEED_HISTORY]: updated });
  } catch { /* non-critical */ }
}

function selectHistory(url: string) {
  setUrl(url);
  loadForum();
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

onMounted(async () => {
  await loadHistory();
  const detectedUrl = await detectForum();
  if (detectedUrl) {
    await loadForum();
  }
});
</script>

<template>
  <div class="p-3 space-y-3">
    <p class="text-xs text-(--color-text-secondary) leading-relaxed">
      Tổng hợp các thớt nổi bật từ forum. Extension sẽ lấy danh sách thớt,
      lọc thớt có tương tác trong 24h qua và xếp hạng dựa trên số reply, view và thời gian gần đây.
    </p>

    <div class="relative">
      <!-- eslint-disable-next-line vuejs-accessibility/form-control-has-label -- will be fixed in task 407 -->
      <input
        :value="forumUrl"
        class="input pr-9 w-full"
        type="url"
        placeholder="Nhập URL forum, VD: https://voz.vn/f/diem-bao.33/"
        @input="(e: Event) => { const target = e.target as HTMLInputElement; setUrl(target.value) }"
        @keyup.enter="loadForum"
      />
      <div class="absolute right-1.5 top-1/2 -translate-y-1/2">
        <IconButton
          :label="loading ? 'Đang tải' : hasLoaded ? 'Làm mới dữ liệu' : 'Tải dữ liệu'"
          :disabled="loading || !forumUrl"
          @click="loadForum"
        >
          <svg class="w-3.5 h-3.5" :class="{ 'animate-spin': loading }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </IconButton>
      </div>
    </div>

    <div v-if="forumHistory.length > 0" class="flex flex-wrap gap-1.5">
      <button
        v-for="url in forumHistory"
        :key="url"
        class="badge badge-neutral transition-colors hover:bg-(--color-accent-soft) hover:text-(--color-accent-text)"
        @click="selectHistory(url)"
      >
        {{ extractDomain(url) }}
      </button>
    </div>

    <div v-if="error" class="alert alert-error text-xs flex items-center justify-between gap-2">
      <span>{{ error }}</span>
      <button class="btn btn-ghost btn-xs shrink-0" @click="loadForum">Thử lại</button>
    </div>

    <div v-if="pendingPermissionOrigin" class="alert alert-warning text-xs flex items-center justify-between gap-2">
      <span>Cần cấp quyền truy cập <strong class="text-(--color-text-primary)">{{ pendingPermissionOrigin }}</strong> để tải danh sách thớt.</span>
      <button class="btn btn-accent btn-xs shrink-0" @click="handleGrantPermission">Cấp quyền</button>
    </div>

    <EmptyState v-if="!loading && !error && threads.length === 0 && hasLoaded"
      icon="📰"
      title="Chưa có thớt nổi bật"
      description="Không tìm thấy thớt nào có hoạt động trong 24h qua." />

    <div v-if="loading" class="space-y-2">
      <div v-for="i in 5" :key="i" class="card animate-pulse-soft space-y-1.5">
        <div class="h-3.5 bg-(--color-bg-muted) rounded-lg w-3/4"></div>
        <div class="h-2.5 bg-(--color-bg-muted) rounded-lg w-1/2"></div>
      </div>
    </div>

    <div v-if="!loading && threads.length > 0" class="space-y-1.5">
      <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions,vuejs-accessibility/click-events-have-key-events -- intentional interactive container -->
      <div v-for="(item, idx) in threads" :key="idx" class="card-interactive" @click="openThread(item.thread.url)">
        <div class="flex items-start gap-2">
          <span
            v-if="item.heat === 'fire'"
            class="shrink-0 mt-0.5 text-sm"
            title="Rất hot">🔥</span>
          <span
            v-else-if="item.heat === 'hot'"
            class="shrink-0 mt-0.5 text-sm"
            title="Hot">⚡</span>

          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium text-(--color-text-primary) leading-snug truncate">
              {{ item.thread.title }}
              <span v-if="item.thread.isLocked" class="text-(--color-text-muted) text-xs">🔒</span>
              <span v-if="item.thread.hasPoll" class="text-(--color-text-muted) text-xs">📊</span>
            </div>

            <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-(--color-text-secondary) mt-0.5">
              <span>{{ item.thread.author }}</span>
              <span class="text-(--color-border-strong)">|</span>
              <span>{{ compactNumber(item.thread.replyCount) }} replies</span>
              <span class="text-(--color-border-strong)">|</span>
              <span>{{ compactNumber(item.thread.viewCount) }} views</span>
              <span v-if="item.thread.pageCount > 1" class="text-(--color-border-strong)">|</span>
              <span v-if="item.thread.pageCount > 1">{{ item.thread.pageCount }} trang</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>