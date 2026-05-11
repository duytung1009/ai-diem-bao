# Task ID: 131

**Title:** Phase 3: Eliminate Triple-State in KnowledgeView

**Status:** pending

**Dependencies:** 130

**Priority:** high

**Description:** Remove local cachedTopic ref in KnowledgeView.vue (931 lines). Read from store.selectedTopic via computed. Replace all cachedTopic.value = ... with store.updateSelectedTopic().

**Details:**

**Problem:** KnowledgeView.vue maintains a local cachedTopic ref that duplicates store.selectedTopic. Knowledge entries are written to both places manually.

**Solution:**

1. **File: entrypoints/sidepanel/views/KnowledgeView.vue** (line 21)
   - Remove: `const cachedTopic = ref<CachedTopic | null>(null);`
   - Add: `const cachedTopic = computed(() => store.selectedTopic.value);`

2. **File: entrypoints/sidepanel/views/KnowledgeView.vue** (loadTopicData function)
   - Remove all `cachedTopic.value = ...` assignments
   - After fetching fresh data from IDB: call `store.updateSelectedTopic(fresh)`
   - Keep loadedTopicUrl for tracking which topic is loaded

3. **File: entrypoints/sidepanel/views/KnowledgeView.vue** (all knowledge save operations)
   - After extractKnowledge, reduceKnowledgeChunks, or manual save:
   - Replace: `cachedTopic.value = {...}` with `store.updateSelectedTopic({...})`
   - The computed `cachedTopic` will automatically reflect store changes

4. **File: entrypoints/sidepanel/views/KnowledgeView.vue** (allPosts computed)
   - No change needed — reads from cachedTopic.value which is now computed

5. **File: entrypoints/sidepanel/views/KnowledgeView.vue** (entries ref)
   - Keep `const entries = ref<KnowledgeEntry[]>([])` — this is UI state, not topic data
   - On load: `entries.value = [...(store.selectedTopic.value?.knowledgeEntries ?? [])]`
   - On save: `store.updateSelectedTopic({ knowledgeEntries: entries.value })`

**Acceptance Criteria:**
- No ref<CachedTopic | null> for cachedTopic in KnowledgeView
- cachedTopic is a computed: computed(() => store.selectedTopic.value)
- loadTopicData() fetches fresh from IDB, calls store.updateSelectedTopic(fresh)
- Knowledge extract, reduce, and save operations all update store via store.updateSelectedTopic()
- allPosts computed still works (reads from cachedTopic.value.segments or cachedTopic.value.posts)
- npm run compile passes with zero errors

**Test Strategy:**

1. npm run compile — zero errors
2. Open KnowledgeView on a topic with posts
3. Extract knowledge -> verify entries display
4. Save an entry -> verify it persists
5. Reload page -> verify entries still present
6. Switch topics -> verify correct entries load for each topic
