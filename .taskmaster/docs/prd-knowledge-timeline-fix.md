# PRD: Fix Knowledge Tab Timeline/StepTimeline

## Context

Knowledge tab's `StepTimeline` hiển thị sai so với Summary tab. Nguyên nhân: Knowledge không dùng `pl.pipeline` (Vue reactive ref) để quản lý pipeline — build pipeline mới cho từng LLM call, gán vào task state (ephemeral). `pl.pipeline` reactive ref từ `usePipeline()` bị import nhưng không bao giờ được set.

### Symptom
- Timeline chỉ hiện step hiện tại (1 step), không thấy toàn bộ steps cần thực hiện
- Steps không chuyển từ running → done (luôn ở running hoặc biến mất)
- Giữa các LLM call, pipeline biến mất hoàn toàn

### Root Cause
- `pl.pipeline.value` không bao giờ được set — luôn null
- `buildKnowledgePipeline()` raw function được gọi mỗi LLM call → gán thẳng vào `st.pipeline`
- `activePipeline` computed chỉ đọc từ task state, không có reactive fallback

## Decision

Adopt pattern từ Summary: build **1 pipeline vào `pl.pipeline` reactive ref ở đầu operation**, mutate qua `pl.markRunning()` / `pl.markDone()` step-by-step, copy snapshot vào task state trước mỗi LLM call, sync back sau.

## Goals

1. **Build pipeline once**: `pl.pipeline.value = buildKnowledgePipeline(totalSteps)` ở đầu `handleExtract` / `handleRestore`
2. **Step-by-step mutate**: `pl.markRunning(id)` / `pl.markDone(id)` cho từng extract + reduce step
3. **Task state sync**: Copy `pl.pipeline` snapshot vào `st.pipeline` trước LLM call, sync back sau
4. **Fix `activePipeline`**: Priority pattern — task state first, reactive fallback
5. **Handle resume**: Mark existing-chunk steps done trước khi bắt đầu extract mới

## Non-Goals

- Không thay đổi `buildKnowledgePipeline()` function trong `pipeline-builder.ts`
- Không thay đổi `StepTimeline.vue` component
- Không thay đổi background LLM tasks
- Không thay đổi KnowledgeView.vue

---

## Phase 1: Build Reactive Pipeline at Operation Start

### Trong `handleExtract()`:
- Sau khi `chunkPlan` được tính, build pipeline vào `pl.pipeline.value`
- `pl.markFirstRunning()` để mark step đầu tiên running
- Direct path (`runDirectExtract`): pipeline có 1 extract + 1 reduce (hoặc skip reduce)
- Resume path: mark existing-chunk steps done

### Trong `handleRestore()`:
- Build pipeline với total chunk count, mark existing extract steps done, mark reduce running

### Files Changed
- `entrypoints/sidepanel/composables/useKnowledge.ts`

### Acceptance Criteria
- `pl.pipeline.value` được set trước khi LLM call đầu tiên
- Timeline hiển thị toàn bộ steps (extract_0..N + reduce)
- `npm run compile` passes
- `npm run test` passes

---

## Phase 2: Replace Per-LLM Pipeline Builds with Reactive Mutations

### Trong chunk extraction loop:
- `pl.markRunning('extract_N')` trước mỗi LLM call
- Copy snapshot `pl.pipeline` vào `st.pipeline` thay vì build mới
- `pl.markDone('extract_N')` sau mỗi LLM call
- Sync back từ task state sau LLM

### Trong `runReducePhase()`:
- `pl.markRunning('reduce')` trước reduce
- Copy snapshot vào task state
- `pl.markDone('reduce')` sau reduce

### Files Changed
- `entrypoints/sidepanel/composables/useKnowledge.ts`

### Acceptance Criteria
- Steps chuyển running → done trong suốt extraction
- Pipeline không bị biến mất giữa các LLM call
- `npm run compile` passes
- `npm run test` passes

---

## Phase 3: Fix `activePipeline` Computed

### Update `activePipeline` computed:
- Dùng priority pattern: task state first → `pl.pipeline.value` fallback
- Giống pattern trong SummaryView.vue

### Files Changed
- `entrypoints/sidepanel/composables/useKnowledge.ts`

### Acceptance Criteria
- Timeline hiển thị pipeline từ reactive ref khi không có task state
- Timeline ưu tiên task state version khi có (được background cập nhật)
- `npm run compile` passes

---

## Verification Plan

```bash
npm run compile
npm run test
```

Manual test:
- Extract thớt nhỏ: timeline hiển thị extract_0 + reduce → done
- Extract thớt lớn: timeline extract_0..N + reduce, steps chuyển running→done lần lượt
- Resume: existing steps done, new steps running→done
- Restore: extract steps done, reduce running→done
