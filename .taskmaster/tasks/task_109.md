# Task ID: 109

**Title:** Bug Fixes: JSON parsing, tree-reduce, isnewstopic sync

**Status:** done

**Dependencies:** 22 ✓

**Priority:** high

**Description:** repairUnescapedQuotes + NBSP + control chars trong parseSummaryJSON; summarizeSegments tree-reduce thực sự (đệ quy); fix-gemini-finish-reason; fix-openai-truncated-json; fix-isnewstopic-store-sync (useSummarize set topicType nhưng không sync store).

**Details:**

Commits: 8b55a51 (repairUnescapedQuotes), 4b2ab0d (gemini), b34cb2e+894df83 (openai truncated)
review: review/20260410_1900_tier3_summarize-segments-tree-reduce.md
review: review/20260410_2030_tier3_summarize-tree-reduce-review-fixes.md

**Test Strategy:**

No test strategy provided.
