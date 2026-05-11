# Task ID: 134

**Title:** Phase 6: Cleanup TopicHubView Sync

**Status:** pending

**Dependencies:** 133

**Priority:** medium

**Description:** Replace fragile selectedTopicKey computed watch in TopicHubView.vue with simpler URL-based watch. Store is now single source, so only need to sync when topic URL changes.

**Details:**

**Problem:** TopicHubView uses a fragile computed key string to detect store changes:

```typescript
const selectedTopicKey = computed(() => {
  const t = store.selectedTopic.value;
  if (!t) return null;
  return `${t.url}|${t.summary?.slice(0, 20) ?? ''}|${t.segments?.length ?? 0}|${t.bookmarked ?? false}|${t.knowledgeEntries?.length ?? 0}|${t.totalPosts ?? 0}`;
});
```

This watch is brittle (misses deep changes, depends on string slicing) and unnecessary once store is single source.

**Solution:**

1. **File: entrypoints/sidepanel/views/TopicHubView.vue** (line 116-149)
   - Remove: `selectedTopicKey` computed (lines 116-120)
   - Remove: `watch(selectedTopicKey, ...)` (lines 122-149)
   - Add: `watch(() => store.selectedTopic.value?.url, (newUrl) => {...})`
   - The watch should:
     a. When a NEW topic is selected (URL changes): add it to allTopics list if not present
     b. When the SAME topic is updated (URL unchanged): update the existing entry in allTopics

2. **Simplified watch logic:**
   ```typescript
   watch(() => store.selectedTopic.value, (updated) => {
     if (!updated?.url) return;
     const idx = allTopics.value.findIndex(t => isSameTopicUrl(t.url, updated.url));
     if (idx >= 0) {
       // Update existing entry — deep merge
       allTopics.value[idx] = { ...allTopics.value[idx], ...updated };
     } else if (updated.summary || updated.posts?.length) {
       // New topic with content — add to list
       allTopics.value = [...allTopics.value, { ...updated }];
     }
   }, { deep: false }); // Only triggers when selectedTopic reference changes
   ```

3. **Bookmark sync:** toggleBookmark already updates allTopics directly (line 207), so no change needed there.

**Acceptance Criteria:**
- selectedTopicKey computed is removed
- Replaced with watch on store.selectedTopic.value?.url or store.selectedTopic directly
- Topic list still syncs when a new topic is selected
- Topic list still syncs when bookmark is toggled
- Topic list still shows 'Đang tóm tắt...' indicator for summarizing topics
- npm run compile passes with zero errors

**Test Strategy:**

1. npm run compile — zero errors
2. Open TopicHubView -> select a topic -> verify it navigates to SummaryView
3. Go back to TopicHubView -> verify the selected topic shows updated data
4. Toggle bookmark on a topic -> verify bookmark icon updates in list
5. Start summarizing a new topic -> verify 'Đang tóm tắt...' indicator shows in list
6. Delete a topic -> verify it removes from list
