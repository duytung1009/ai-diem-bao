<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { sendMessage } from '@/lib/messaging';
import { filterToday, scoreThreads } from '@/lib/hot-threads';
import { scrapeForumList } from '@/lib/scrapers/forum-lister';
import { extractFirstPostDescriptionSource, toThreadFirstPageUrl } from '@/lib/scrapers/first-post-extractor';
import { requestOriginPermission } from '@/lib/permissions';
import type { HotThreadScore } from '@/lib/hot-threads';
import type { CachedTopic, ScrapedPost } from '@/lib/types';
import { useActiveForum } from '../composables/useActiveForum';
import { useTopicStore } from '../composables/useTopicStore';
import { useLLM } from '../composables/useLLM';
import { STORAGE_KEYS } from '@/lib/constants';
import IconButton from '../components/IconButton.vue';
import EmptyState from '../components/EmptyState.vue';

const activeForum = useActiveForum();
const { forumUrl, detect: detectForum, setUrl } = activeForum;
const store = useTopicStore();
const router = useRouter();
const { describeThreadTask, checkLLMConfigured } = useLLM();
const threads = ref<HotThreadScore[]>([]);
const loading = ref(false);
const error = ref('');
const hasLoaded = ref(false);
const forumHistory = ref<string[]>([]);
const pendingPermissionOrigin = ref('');

interface DescState { loading: boolean; text?: string; error?: string }
const descState = ref<Record<string, DescState>>({});
const expandedUrls = ref<Set<string>>(new Set());

function buildMinimalTopic(item: HotThreadScore): CachedTopic {
  const { thread } = item;
  return {
    url: thread.url,
    title: thread.title,
    version: thread.version ?? 'unknown',
    posts: [],
    summary: '',
    llmConfig: { provider: '', model: '' },
    cachedAt: 0,
    lastPostNumber: 0,
    totalPosts: thread.replyCount + 1,
    totalPages: thread.pageCount,
  };
}

function selectAndSummarize(item: HotThreadScore) {
  browser.tabs.create({ url: item.thread.url, active: true }).catch(() => {});
  store.selectTopic(buildMinimalTopic(item));
  router.push('/summary');
}

async function toggleDescription(item: HotThreadScore) {
  const url = item.thread.url;
  if (expandedUrls.value.has(url)) {
    expandedUrls.value = new Set([...expandedUrls.value].filter(u => u !== url));
    return;
  }
  expandedUrls.value = new Set([...expandedUrls.value, url]);

  // Already fetched
  if (descState.value[url]?.text) return;

  // Check cache first
  const cached = await sendMessage<{ description: string | null }>('GET_THREAD_DESCRIPTION', { url });
  if (cached?.description) {
    descState.value = { ...descState.value, [url]: { loading: false, text: cached.description } };
    return;
  }

  // Check LLM configured
  const llmCheck = await checkLLMConfigured();
  if (!llmCheck.ok) {
    descState.value = { ...descState.value, [url]: { loading: false, error: 'Cấu hình LLM trong Cài đặt để xem mô tả.' } };
    return;
  }

  descState.value = { ...descState.value, [url]: { loading: true } };
  try {
    // Fetch thread page 1 directly (same origin as forum — permission already granted
    // by loading the forum list). The OP's article-summary blockquote is the most
    // accurate description source and is always present in-page for news threads.
    const page1Url = toThreadFirstPageUrl(url);
    const fetchResult = await sendMessage<{ ok: boolean; html: string; needPermission?: boolean }>(
      'FETCH_HTML', { url: page1Url },
    );
    if (fetchResult.needPermission) {
      descState.value = { ...descState.value, [url]: { loading: false, error: 'Cần cấp quyền truy cập forum để tạo mô tả.' } };
      return;
    }
    if (!fetchResult.ok || !fetchResult.html) {
      descState.value = { ...descState.value, [url]: { loading: false, error: 'Không tải được nội dung thread.' } };
      return;
    }

    const sourceText = extractFirstPostDescriptionSource(fetchResult.html);
    if (!sourceText || sourceText.length < 20) {
      descState.value = { ...descState.value, [url]: { loading: false, error: 'Không đủ nội dung để tạo mô tả.' } };
      return;
    }
    const firstPost: ScrapedPost = { author: 'OP', content: sourceText, timestamp: '', postNumber: 1 };

    const { result } = describeThreadTask(firstPost);
    const r = await result;
    if (!r.success || !r.data) {
      descState.value = { ...descState.value, [url]: { loading: false, error: r.error ?? 'Lỗi tạo mô tả.' } };
      return;
    }
    const description = (r.data as { description: string }).description;
    descState.value = { ...descState.value, [url]: { loading: false, text: description } };
    await sendMessage('SAVE_THREAD_DESCRIPTION', { url, description }).catch(() => {});
  } catch (err) {
    descState.value = { ...descState.value, [url]: { loading: false, error: String(err) } };
  }
}

async function preloadCachedDescriptions(items: HotThreadScore[]) {
  const results = await Promise.all(
    items.map(async (item) => {
      const url = item.thread.url;
      const cached = await sendMessage<{ description: string | null }>('GET_THREAD_DESCRIPTION', { url });
      return { url, description: cached?.description ?? null };
    }),
  );
  const newDescState: Record<string, DescState> = {};
  const newExpanded = new Set<string>();
  for (const { url, description } of results) {
    if (description) {
      newDescState[url] = { loading: false, text: description };
      newExpanded.add(url);
    }
  }
  descState.value = { ...descState.value, ...newDescState };
  expandedUrls.value = new Set([...expandedUrls.value, ...newExpanded]);
}

async function retryDescription(item: HotThreadScore) {
  const url = item.thread.url;
  delete descState.value[url];
  descState.value = { ...descState.value };
  await toggleDescription(item);
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
    descState.value = {};
    expandedUrls.value = new Set();
    await saveToHistory(forumUrl.value);
    preloadCachedDescriptions(threads.value);
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
      <input
        :value="forumUrl"
        class="input pr-9 w-full"
        type="url"
        placeholder="Nhập URL forum, VD: https://voz.vn/f/diem-bao.33/"
        aria-label="URL forum điểm báo"
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
      <div v-for="(item, idx) in threads" :key="idx" class="card-interactive" @click="selectAndSummarize(item)">
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

            <!-- Expand panel -->
            <div v-if="expandedUrls.has(item.thread.url)" class="mt-1.5 text-xs text-(--color-text-secondary)">
              <span v-if="descState[item.thread.url]?.loading" class="flex items-center gap-1.5 italic">
                <svg class="w-3.5 h-3.5 shrink-0 animate-sparkle text-(--color-accent-text)" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill-rule="evenodd" clip-rule="evenodd" d="M9 4.5a.75.75 0 0 1 .721.544l.813 2.846a3.75 3.75 0 0 0 2.576 2.576l2.846.813a.75.75 0 0 1 0 1.442l-2.846.813a3.75 3.75 0 0 0-2.576 2.576l-.813 2.846a.75.75 0 0 1-1.442 0l-.813-2.846a3.75 3.75 0 0 0-2.576-2.576l-2.846-.813a.75.75 0 0 1 0-1.442l2.846-.813A3.75 3.75 0 0 0 7.466 7.89l.813-2.846A.75.75 0 0 1 9 4.5ZM18 1.5a.75.75 0 0 1 .728.568l.258 1.036c.236.94.97 1.674 1.91 1.91l1.036.258a.75.75 0 0 1 0 1.456l-1.036.258c-.94.236-1.674.97-1.91 1.91l-.258 1.036a.75.75 0 0 1-1.456 0l-.258-1.036a2.625 2.625 0 0 0-1.91-1.91l-1.036-.258a.75.75 0 0 1 0-1.456l1.036-.258a2.625 2.625 0 0 0 1.91-1.91l.258-1.036A.75.75 0 0 1 18 1.5ZM16.5 15a.75.75 0 0 1 .712.513l.394 1.183c.15.447.5.799.948.948l1.183.395a.75.75 0 0 1 0 1.422l-1.183.395c-.447.15-.799.5-.948.948l-.395 1.183a.75.75 0 0 1-1.422 0l-.395-1.183a1.5 1.5 0 0 0-.948-.948l-1.183-.395a.75.75 0 0 1 0-1.422l1.183-.395c.447-.15.799-.5.948-.948l.395-1.183A.75.75 0 0 1 16.5 15Z" />
                </svg>
                <span>Đang tạo mô tả...</span>
              </span>
              <span v-else-if="descState[item.thread.url]?.text">{{ descState[item.thread.url].text }}</span>
              <div
                v-else-if="descState[item.thread.url]?.error"
                class="alert alert-error flex items-center justify-between gap-2 py-1.5 px-2"
                @click.stop
              >
                <span class="flex-1 leading-snug">{{ descState[item.thread.url].error }}</span>
                <IconButton
                  v-if="!descState[item.thread.url].error?.includes('Cấu hình')"
                  label="Thử lại"
                  class="shrink-0"
                  @click.stop="retryDescription(item)"
                >
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </IconButton>
              </div>
            </div>
          </div>

          <!-- Chevron button — @click.stop prevents triggering selectAndSummarize -->
          <IconButton
            :label="expandedUrls.has(item.thread.url) ? 'Thu gọn mô tả' : 'Xem mô tả'"
            class="shrink-0 mt-0.5 text-(--color-text-muted)"
            @click.stop="toggleDescription(item)"
          >
            <svg
              class="w-3.5 h-3.5 transition-transform duration-150"
              :class="{ 'rotate-180': expandedUrls.has(item.thread.url) }"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </IconButton>
        </div>
      </div>
    </div>
  </div>
</template>
