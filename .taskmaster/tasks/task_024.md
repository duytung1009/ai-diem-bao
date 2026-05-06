# Task ID: 24

**Title:** F24: Dynamic Chunks Knowledge — Fix Critical Issues

**Status:** done

**Dependencies:** 23 ✓

**Priority:** high

**Description:** Fix 1 CRITICAL (topic switch mid-extract → data corruption) + 1 major (stale cachedTopic.value sau persistChunks) từ Opus review.

**Details:**

planning: planning/20260410_2316_24-feature-dynamic-chunks-knowledge.md
review (Sonnet, degraded): review/20260411_0030_tier3_feature-24-dynamic-chunks-knowledge.md
review (Opus verified): review/20260411_0128_tier3_feature-24-opus-verification.md

CRITICAL (Opus phát hiện, Sonnet bỏ sót):
- KnowledgeView.loadTopicData() thiếu activeExtractId++ → topic switch mid-extract corrupt cache
- persistChunks đọc cachedTopic.value!.url tại thời điểm persist thay vì snapshot → chunks Topic A → Topic B

Fix order:
1. activeExtractId++ + state reset trong loadTopicData
2. Capture topicUrl/topicTitle snapshot đầu handleExtract
3. Update cachedTopic.value trong persistChunks
4. Minors: reset search/tags on fresh extract, compact JSON (JSON.stringify(x) thay vì null,2 → ~30% savings)

**Test Strategy:**

Switch topic khi đang extract → verify không data corruption. Cancel+resume → verify restart đúng chunk. Test compact JSON reduce tokens.

## Subtasks

### 24.1. Fix activeExtractId invalidation trong loadTopicData

**Status:** done  
**Dependencies:** None  

Thêm activeExtractId++ + full state reset trong KnowledgeView.loadTopicData() theo pattern F23 (useSummarize.ts:203)

### 24.2. Capture topicUrl/topicTitle snapshot tại đầu handleExtract

**Status:** done  
**Dependencies:** None  

const topicUrl = cachedTopic.value!.url ở đầu hàm, không đọc lại trong persistChunks

### 24.3. Update cachedTopic.value trong persistChunks

**Status:** done  
**Dependencies:** None  

Sau IDB update, sync cachedTopic.value để resume detect đúng lastKnowledgePostNumber

### 24.4. Fix minors: search/tags reset, compact JSON

**Status:** done  
**Dependencies:** None  

Reset search+tags filter khi extract mới. JSON.stringify(x) thay vì null,2 trong reduceKnowledgeChunks
