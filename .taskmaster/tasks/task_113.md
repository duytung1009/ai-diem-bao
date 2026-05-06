# Task ID: 113

**Title:** Refactor: TopicMeta + TopicHubView Consistent Display

**Status:** done

**Dependencies:** 112 ✓

**Priority:** medium

**Description:** Refactor TopicMeta.vue và topic cards trong TopicHubView.vue để hiển thị thông tin nhất quán: tách totalPosts vs summarizedPostCount, thêm trạng thái tóm tắt (none/in-progress/partial/done), thêm cachedAt timestamp, đổi prop info:DetectResult → topic:CachedTopic, extract topicSummaryStatus() shared helper.

**Details:**

planning: planning/20260422_1706_refactor-topic-meta-fields.md\nAffected files: lib/topic-utils.ts (new), entrypoints/sidepanel/components/TopicMeta.vue, entrypoints/sidepanel/App.vue, entrypoints/sidepanel/views/OpinionsView.vue, entrypoints/sidepanel/views/TopicHubView.vue

**Test Strategy:**

No test strategy provided.

## Subtasks

### 113.1. UI: đổi badge sang text trong TopicMeta + TopicHubView

**Status:** done  
**Dependencies:** None  

Replace badge-style status/news labels with plain text while preserving existing color semantics and animate-pulse on in-progress state.
