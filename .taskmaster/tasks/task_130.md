# Task ID: 130

**Title:** Phase 2: Eliminate Triple-State in ResearchView

**Status:** pending

**Dependencies:** 129

**Priority:** high

**Description:** Remove local cachedTopic ref in ResearchView.vue. Read from store.selectedTopic via computed. Update loadTopicData() to use store.updateSelectedTopic().

**Details:**

**Problem:** ResearchView.vue maintains a local cachedTopic ref that duplicates store.selectedTopic.

**Solution:**

1. **File: entrypoints/sidepanel/views/ResearchView.vue** (line 10)
   - Remove: `const cachedTopic = ref<CachedTopic | null>(null);`
   - Add: `const cachedTopic = computed(() => store.selectedTopic.value);`

2. **File: entrypoints/sidepanel/views/ResearchView.vue** (line 41-55: loadTopicData function)
   - Remove: `cachedTopic.value = topic as CachedTopic;` (line 45)
   - Remove: `cachedTopic.value = fresh;` (line 50)
   - Keep: `store.updateSelectedTopic(fresh);` (line 51)
   - After fetch: data flows from store -> computed -> template

3. **File: entrypoints/sidepanel/views/ResearchView.vue** (line 29-30: suggestedQuestions computed)
   - Change: `cachedTopic.value?.title` -> `store.selectedTopic.value?.title` (or use computed alias)

4. **File: entrypoints/sidepanel/views/ResearchView.vue** (line 13-18: allPosts computed)
   - No change needed — reads from cachedTopic.value which is now a computed pointing to store

**Acceptance Criteria:**
- No ref<CachedTopic | null> for cachedTopic in ResearchView
- cachedTopic is a computed: computed(() => store.selectedTopic.value)
- loadTopicData() fetches fresh from IDB via sendMessage(), then calls store.updateSelectedTopic(fresh)
- Research history still saves correctly via sendMessage('SAVE_CACHED_TOPIC')
- npm run compile passes with zero errors

**Test Strategy:**

1. npm run compile — zero errors
2. Select a topic -> navigate to ResearchView -> verify posts load
3. Ask a research question -> verify answer displays
4. Verify research history persists after page reload
5. Switch to another topic and back -> verify history loads correctly
