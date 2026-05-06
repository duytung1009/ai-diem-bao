# Task ID: 114

**Title:** Step 0: Create lib/topic-utils.ts

**Status:** done

**Dependencies:** 112 ✓

**Priority:** medium

**Description:** Tạo mới lib/topic-utils.ts với 2 pure functions: topicSummaryStatus(topic, isSummarizing) → 'none'|'in-progress'|'partial'|'done' và formatTopicDate(timestampMs) → string (relative < 24h, absolute >= 24h).

**Details:**

Export: TopicSummaryStatus type, topicSummaryStatus(), formatTopicDate(). TopicHubView đã có formatRelativeTime() local — thay thế bằng formatTopicDate() để nhất quán.

**Test Strategy:**

No test strategy provided.
