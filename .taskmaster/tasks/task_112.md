# Task ID: 112

**Title:** Bug Fixes: token overflow, reduce summary word cap, topic-meta refactor

**Status:** done

**Dependencies:** 111 ✓

**Priority:** medium

**Description:** fix-summarize-token-overflow-maxtokens (willExceedContext hardcode buffer 2000 không tính maxTokens; tree-reduce guard; 1.4× token correction); fix-reduce-summary-word-cap (buildReduceSummaryPrompt(wordCap)); refactor-topic-meta-to-app (lift TopicMeta lên App.vue).

**Details:**

task: .taskmaster/tasks/20260418_1041_bug_fix-summarize-token-overflow-maxtokens.md
task: .taskmaster/tasks/20260419_1400_bug_fix-reduce-summary-word-cap.md
planning: planning/20260419_1400_fix-reduce-summary-prompt-word-cap.md
task: .taskmaster/tasks/20260410_2210_task_refactor-topic-meta-to-app.md

**Test Strategy:**

No test strategy provided.
