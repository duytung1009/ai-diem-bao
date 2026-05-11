# Task ID: 132

**Title:** Phase 4: Eliminate Triple-State in useSummarize (Critical)

**Status:** pending

**Dependencies:** 131

**Priority:** high

**Description:** Remove local cachedTopic ref in useSummarize.ts (1216 lines). Replace with computed pointing to store. Remove ALL cachedTopic.value = {...} assignments — only store.updateSelectedTopic() mutates data.

**Details:**

**Problem:** useSummarize.ts is the heaviest composable and source of most sync bugs. Local cachedTopic ref mirrors store.selectedTopic. Every operation performs dual-write.

**Key Dual-Write Locations to Fix:**

| Line | Current Pattern | Fix |
|------|----------------|-----|
| 32 | `const cachedTopic = ref<...>(null)` | Replace with `computed(() => store.selectedTopic.value)` |
| 148-149 | `cachedTopic.value = {...}; store.updateSelectedTopic({topicType})` | Remove cachedTopic assignment, keep only store.updateSelectedTopic() |
| 233 | `cachedTopic.value = topic as CachedTopic` | Remove — data already in store via selectTopic() |
| 267-279 | `cachedTopic.value = {...}; store.updateSelectedTopic({...})` | Remove cachedTopic assignment, merge all fields into store.updateSelectedTopic() |
| 441-442 | `cachedTopic.value = {...}; store.updateSelectedTopic({topicType: 'news'})` | Remove cachedTopic assignment |
| 543-545 | `store.updateSelectedTopic(...); if (saved) cachedTopic.value = saved` | Remove cachedTopic assignment |
| 586-588 | `store.updateSelectedTopic(...); if (saved) cachedTopic.value = saved` | Remove cachedTopic assignment |
| 632-634 | `store.updateSelectedTopic(...); if (saved) cachedTopic.value = saved` | Remove cachedTopic assignment |
| 1014-1015 | `cachedTopic.value = {...}; store.updateSelectedTopic({topicType: 'news'})` | Remove cachedTopic assignment |

**Detailed Steps:**

1. **Line 32:** Remove `const cachedTopic = ref<CachedTopic | null>(null);`
   Add: `const cachedTopic = computed(() => store.selectedTopic.value);`

2. **Line 60-61 (summarizedPostCount computed):**
   Change `cachedTopic.value` references — already works via computed alias

3. **Line 110 (isNewsTopic computed):**
   Change `cachedTopic.value` references — already works via computed alias

4. **Line 113-117 (watch activeTabPostCount):**
   Change `cachedTopic.value` to `store.selectedTopic.value` in the watch callback

5. **Line 126-155 (detectAndCacheTopicType):**
   - Line 130-133: Remove `cachedTopic.value` checks for threadDeleted — use store.selectedTopic.value
   - Line 136-139: Remove `cachedTopic.value` checks for threadLocked — use store.selectedTopic.value
   - Line 146: Guard check — change `cachedTopic.value?.url` to `store.selectedTopic.value?.url`
   - Line 148: Remove `cachedTopic.value = {...}` — keep only `store.updateSelectedTopic({ topicType })`

6. **Line 210-320 (loadTopicData):**
   - Line 226: Remove `cachedTopic.value = null;` — use `store.clearSelection()` if needed, or just set local vars
   - Line 233: Remove `cachedTopic.value = topic as CachedTopic;`
   - Line 267-269: Remove `cachedTopic.value = {...}` — merge all fields into store.updateSelectedTopic()
   - The store.updateSelectedTopic() call at line 270-279 should include ALL fields from fresh data

7. **Line 441-442, 1014-1015 (news detection during summarize):**
   - Remove `cachedTopic.value = {...}` — keep only `store.updateSelectedTopic({ topicType: 'news' })`

8. **Line 543-545, 586-588, 632-634 (save operations):**
   - Remove `if (saved) cachedTopic.value = saved;` lines
   - The store is already updated via updateSelectedTopic() before the save

9. **Export:** Ensure `cachedTopic` computed is in the return object so SummaryView can destructure it

**Acceptance Criteria:**
- No ref<CachedTopic | null> for cachedTopic in useSummarize
- cachedTopic is a computed: computed(() => store.selectedTopic.value)
- Zero `cachedTopic.value = {...}` assignments remain
- isNewsTopic, summarizedPostCount, topicInfo computed properties work correctly
- loadTopicData() updates store via store.updateSelectedTopic() with fresh IDB data
- All summarize operations update store correctly
- News type detection updates store correctly
- npm run compile passes with zero errors

**Test Strategy:**

1. npm run compile — zero errors
2. Select a topic -> SummaryView loads -> verify posts, summary, segments display
3. Summarize a single segment -> verify summary shows instantly
4. Run auto-summarize all -> verify progress and results
5. Generate overall summary -> verify it displays
6. Detect news topic -> verify 'Tin tức' badge shows immediately
7. Reload page -> verify all data persists
8. Switch between topics -> verify correct data loads each time
