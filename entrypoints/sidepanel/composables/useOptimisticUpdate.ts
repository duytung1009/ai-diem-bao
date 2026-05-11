import type { CachedTopic } from '@/lib/types';
import { sendMessage } from '@/lib/messaging';
import type { useTopicStore } from './useTopicStore';

export function useOptimisticUpdate(store: ReturnType<typeof useTopicStore>) {
  async function optimisticUpdate(partial: Partial<CachedTopic>): Promise<boolean> {
    const previous = store.selectedTopic.value;
    if (!previous) return false;

    // Snapshot for rollback
    const snapshot = { ...previous };

    store.updateSelectedTopic(partial);

    try {
      await sendMessage('SAVE_CACHED_TOPIC', { url: previous.url, ...partial });
      return true;
    } catch (err) {
      store.updateSelectedTopic(snapshot as unknown as Partial<CachedTopic>);
      console.error('[OptimisticUpdate] Failed to save, rolled back:', err);
      return false;
    }
  }

  return { optimisticUpdate };
}
