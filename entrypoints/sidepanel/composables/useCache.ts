import { ref } from 'vue';
import { sendMessage } from '@/lib/messaging';
import type { CachedTopic, CacheFreshness } from '@/lib/types';

export function useCache() {
  const cached = ref<CachedTopic | null>(null);
  const freshness = ref<CacheFreshness | null>(null);

  async function load(): Promise<void> {
    try {
      const result = await sendMessage<CachedTopic | null>('GET_CACHED_TOPIC');
      cached.value = result;
      if (result) {
        freshness.value = evaluateFreshness(result);
      }
    } catch {
      cached.value = null;
      freshness.value = null;
    }
  }

  async function save(partial: Partial<CachedTopic>): Promise<void> {
    await sendMessage('SAVE_CACHED_TOPIC', partial);
  }

  async function clear(): Promise<void> {
    const url = cached.value?.url;
    if (url) {
      await sendMessage('DELETE_CACHED_TOPIC', url);
    }
    cached.value = null;
    freshness.value = null;
  }

  function updateLocal(topic: CachedTopic): void {
    cached.value = topic;
    freshness.value = 'fresh';
  }

  function evaluateFreshness(topic: CachedTopic, currentPostCount?: number): CacheFreshness {
    const ageMs = Date.now() - topic.cachedAt;
    const oneDay = 24 * 60 * 60 * 1000;
    const oneWeek = 7 * oneDay;

    if (ageMs > oneWeek) return 'outdated';
    if (ageMs > oneDay || (currentPostCount !== undefined && currentPostCount > topic.totalPosts)) {
      return 'stale';
    }
    return 'fresh';
  }

  return { cached, freshness, load, save, clear, updateLocal, evaluateFreshness };
}
