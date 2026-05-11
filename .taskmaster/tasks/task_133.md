# Task ID: 133

**Title:** Phase 5: Add Optimistic Update with Rollback

**Status:** pending

**Dependencies:** 132

**Priority:** medium

**Description:** Create useOptimisticUpdate composable. Replace dual-write patterns (store.updateSelectedTopic + sendMessage SAVE_CACHED_TOPIC) with optimisticUpdate(). Auto-rollback on save failure.

**Details:**

**Problem:** Store updates and IndexedDB saves are not atomic. If IDB save fails, store is already updated with data that won't persist. No rollback mechanism.

**New File: entrypoints/sidepanel/composables/useOptimisticUpdate.ts**

```typescript
import type { CachedTopic } from '@/lib/types';
import { sendMessage } from '@/lib/messaging';
import type { useTopicStore } from './useTopicStore';

export function useOptimisticUpdate(store: ReturnType<typeof useTopicStore>) {
  async function optimisticUpdate(partial: Partial<CachedTopic>): Promise<boolean> {
    const previous = store.selectedTopic.value;
    if (!previous) return false;

    // 1. Optimistic: update store immediately
    store.updateSelectedTopic(partial);

    // 2. Persist to IndexedDB
    try {
      await sendMessage('SAVE_CACHED_TOPIC', { url: previous.url, ...partial });
      return true;
    } catch (err) {
      // 3. Rollback: restore previous state
      store.updateSelectedTopic(previous);
      console.error('[OptimisticUpdate] Failed to save, rolled back:', err);
      return false;
    }
  }

  return { optimisticUpdate };
}
```

**Files to Update:**

1. **useSummarize.ts:** Replace patterns like:
   ```
   store.updateSelectedTopic({ field: value });
   await sendMessage('SAVE_CACHED_TOPIC', { url, field: value });
   ```
   With:
   ```
   await optimisticUpdate({ field: value });
   ```

2. **KnowledgeView.vue:** Same replacement for knowledge entries save

3. **ResearchView.vue:** Same replacement for research history save

4. **TopicHubView.vue (toggleBookmark, line 204-212):** Replace manual dual-write

5. **App.vue (autoUpdateCachedTopic):** Replace manual dual-write

**Important:** Do NOT apply rollback for append-only operations (e.g., adding new segment summaries) where rollback could lose user-entered data. Only apply for field updates (topicType, bookmarked, summary, knowledgeEntries, researchHistory).

**Acceptance Criteria:**
- useOptimisticUpdate.ts exports optimisticUpdate(partial): Promise<boolean>
- Returns true on success, false on failure (after rollback)
- Logs error to console on rollback
- Existing dual-write patterns replaced with optimisticUpdate()
- npm run compile passes with zero errors

**Test Strategy:**

1. npm run compile — zero errors
2. Toggle bookmark on a topic -> verify instant UI update
3. Simulate network failure (devtools offline) -> toggle bookmark -> verify rollback (UI reverts)
4. Test knowledge entry save with network failure -> verify rollback
5. Test research history save with network failure -> verify rollback
6. Verify console shows error message on rollback
