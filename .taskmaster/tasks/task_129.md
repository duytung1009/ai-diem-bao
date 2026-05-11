# Task ID: 129

**Title:** Phase 1: Unify IndexedDB Access in App.vue

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** Replace direct cache-manager.ts calls (getCachedTopic, saveCachedTopic) with sendMessage() in App.vue. Keep isSameTopicUrl and normalizeUrl imports (pure functions).

**Details:**

**Problem:** App.vue is the ONLY component that directly imports and calls cache-manager.ts functions (getCachedTopic, saveCachedTopic). All other components use sendMessage() for IndexedDB access.

**Solution:**

1. **File: entrypoints/sidepanel/App.vue** (line 5)
   - Remove getCachedTopic, saveCachedTopic from import
   - Keep: normalizeUrl, isSameTopicUrl (pure functions, no side effects)

2. **File: entrypoints/sidepanel/App.vue** (line 81-145: autoUpdateCachedTopic function)
   - Line 83: `getCachedTopic(tabUrl)` -> `sendMessage('GET_CACHED_TOPIC', tabUrl)`
   - Line 87: `saveCachedTopic({...})` -> `sendMessage('SAVE_CACHED_TOPIC', {...})`
   - Line 97: `saveCachedTopic({...})` -> `sendMessage('SAVE_CACHED_TOPIC', {...})`
   - Line 114-131: All `saveCachedTopic({...})` calls -> `sendMessage('SAVE_CACHED_TOPIC', {...})`

**Acceptance Criteria:**
- App.vue no longer imports getCachedTopic or saveCachedTopic from cache-manager.ts
- autoUpdateCachedTopic() uses sendMessage() for all IDB operations
- npm run compile passes with zero errors
- Tab detection still updates totalPages, forumPostCount, threadDeleted, threadLocked correctly

**Test Strategy:**

1. npm run compile — zero errors
2. Open sidepanel on a XenForo topic tab
3. Switch to another tab and back → verify totalPages/forumPostCount update in TopicMeta
4. Verify no console errors about message passing
