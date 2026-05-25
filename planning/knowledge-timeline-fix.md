# Planning: Fix Knowledge Tab Timeline/StepTimeline

## Context

Knowledge tab's `StepTimeline` hiển thị sai so với Summary tab. Nguyên nhân gốc: Knowledge không sử dụng `pl.pipeline` (Vue reactive ref) để quản lý pipeline — thay vào đó build pipeline mới cho từng LLM call và gán trực tiếp vào task state.

### So sánh

| Aspect | Summary | Knowledge (hiện tại) |
|--------|---------|---------------------|
| **Pipeline owner** | `pl.pipeline` (Vue `ref`, persistent) | Không có — build fresh mỗi LLM call |
| **Build timing** | Trước khi scrape (thấy hết steps từ đầu) | Trong loop, mỗi chunk build lại |
| **Step advance** | `pl.markRunning()` / `pl.markDone()` | Không có — `markFirstStepRunning()` 1 lần |
| **Reduce phase** | `pl.markRunning('overall')` → `pl.markDone('overall')` | Build pipeline mới với `[extract_0, reduce]` |
| **`usePipeline` usage** | Full: build + mutate qua `pl.*` | Imported but unused — `pl.pipeline` stays null |
| **`activePipeline` computed** | Priority: task state → reactive fallback | Chỉ đọc từ task state (ephemeral) |

### Root Cause

Knowledge gọi `buildKnowledgePipeline(totalExtractSteps)` raw function → gán kết quả vào `st.pipeline` (task state) → task state bị overwrite khi LLM call mới bắt đầu → pipeline biến mất giữa các LLM call. `pl.pipeline` reactive ref không bao giờ được set.

---

## Solution

Adopt pattern từ Summary: **build 1 pipeline reactive vào `pl.pipeline` ở đầu operation, mutate step-by-step qua `pl.markRunning()` / `pl.markDone()`, copy snapshot vào task state trước mỗi LLM call**.

### Task Breakdown

#### Task A: Add `pl.pipeline` initialization at operation start

**File**: `useKnowledge.ts`

Trong `handleExtract()`:
- Sau khi `chunkPlan` được tính (line 392), build pipeline vào reactive ref:
  ```typescript
  const totalSteps = resume.existingChunks.length + chunkPlan.length;
  pl.pipeline.value = buildKnowledgePipeline(totalSteps);
  pl.markFirstRunning();
  ```
- Direct path (`runDirectExtract`): build pipeline với 1 step + 1 reduce (hoặc skip reduce nếu dùng direct)
  ```typescript
  pl.pipeline.value = buildKnowledgePipeline(1);
  pl.markFirstRunning();
  ```
- Resume-only path (`postsToProcess.length === 0`): build pipeline chỉ có reduce step

Trong `handleRestore()`:
- Build pipeline với `buildKnowledgePipeline(chunks.length)` và `pl.markFirstRunning()`

#### Task B: Replace per-LLM pipeline builds with reactive mutations

**File**: `useKnowledge.ts`

Trong chunk extraction loop (line 396-437):
- **Before**: Build `buildKnowledgePipeline(totalExtractSteps)` fresh → gán vào `st.pipeline`
- **After**: Copy snapshot từ reactive `pl.pipeline` → gán vào `st.pipeline`
  ```typescript
  const segId = `extract_${newChunks.length}`;
  pl.markRunning(segId);
  // ...
  if (st && pl.pipeline.value) {
    st.pipeline = JSON.parse(JSON.stringify(pl.pipeline.value));
  }
  // After LLM result:
  if (knowledgeGuard.isStale(guardId)) return;
  pl.markDone(segId);
  // Sync back from task state:
  const ft = getTaskState(taskId);
  if (ft?.pipeline) pl.pipeline.value = JSON.parse(JSON.stringify(ft.pipeline));
  ```

Trong `runReducePhase()` (line 203-319):
- **Before**: Build `buildKnowledgePipeline(1)` fresh cho mỗi reduce call
- **After**: 
  ```typescript
  pl.markRunning('reduce');
  // Copy to task state:
  if (st && pl.pipeline.value) st.pipeline = JSON.parse(JSON.stringify(pl.pipeline.value));
  // After reduce:
  pl.markDone('reduce');
  ```

#### Task C: Update `activePipeline` computed

**File**: `useKnowledge.ts` (line 41-44)

- **Before**: Chỉ đọc từ task state
- **After**: Priority pattern như Summary
  ```typescript
  const activePipeline = computed(() => {
    if (llmTaskId.value) {
      const task = getTaskState(llmTaskId.value);
      if (task?.pipeline) return task.pipeline;
    }
    return pl.pipeline.value;
  });
  ```

#### Task D: Handle `runDirectExtract` (direct path)

**File**: `useKnowledge.ts` (line 145-201)

- Build pipeline via `pl.pipeline.value = buildKnowledgePipeline(1)` trước khi gọi LLM
- `pl.markFirstRunning()` → copy vào task state → sau LLM: `pl.markDone('extract_0')`

#### Task E: Handle resume/restore flows

**File**: `useKnowledge.ts`

Khi `handleExtract` có `existingChunks.length > 0` (resume):
- Mark các steps đã hoàn thành trước đó là done trước khi bắt đầu extract chunks mới
  ```typescript
  for (let j = 0; j < existingChunks.length; j++) {
    pl.markDone(`extract_${j}`);
  }
  ```

Khi `handleRestore` gọi `runReducePhase`:
- Pipeline đã được build ở Task A với extract steps (mark done) + reduce (mark running)

#### Task F: Cleanup — remove dead imports if any

**File**: `useKnowledge.ts`

Check nếu `buildKnowledgePipeline` và `markFirstStepRunning` imported từ `pipeline-builder` còn cần thiết không (vẫn cần để build pipeline ban đầu). Giữ lại.

---

## Verification

```bash
npm run compile
npm run test
```

Manual test:
- Extract knowledge trên thớt nhỏ → timeline hiển thị extract → reduce với step done
- Extract knowledge trên thớt lớn → timeline hiển thị extract_0..N + reduce, từng step chuyển từ running → done
- Resume → các step đã done hiển thị done, step mới running
- Restore → extract steps done, reduce running → done

---

## Files Changed

| File | Scope |
|------|-------|
| `entrypoints/sidepanel/composables/useKnowledge.ts` | ~30 dòng thay đổi (add pl.* calls, fix activePipeline) |

## Estimated Lines

~30 lines changed, zero new files. Phạm vi nhỏ, single file.
