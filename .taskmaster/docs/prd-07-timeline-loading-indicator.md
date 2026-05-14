# PRD-07: Timeline Loading Indicator

## Context

Loading hiện tại dùng `ProgressIndicator.vue` với spinner + text message thay đổi tuần tự.
User không thấy được bức tranh tổng thể — không biết còn bao nhiêu bước nữa, bước nào đang chạy, bước nào đã xong.

**Vấn đề:**
- Text loading thay đổi liên tục, khó nắm progress tổng quan
- Progress bar chỉ hiển thị % của step hiện tại, không phải toàn pipeline
- ETA chỉ áp dụng cho step đang chạy, không có timeline tổng thể

**Giải pháp:**
- Hiển thị toàn bộ các step dưới dạng vertical timeline ngay từ khi bắt đầu
- Mỗi step có 3 trạng thái: done (✓ xanh), running (⏳ + spinner + ETA), pending (○ xám)
- User nhìn vào là biết ngay: đang ở đâu, còn bao lâu, đã xong những gì

## PRD

### 1. Data Model — Pipeline Steps

```typescript
interface PipelineStep {
  id: string;           // unique: 'scrape', 'summarize_0', 'summarize_1', 'overall'
  label: string;        // 'Scrape bài viết (trang 1-5)', 'Tóm tắt phần 1/3'
  status: 'pending' | 'running' | 'done' | 'error';
  etaMs?: number;       // estimated time remaining (chỉ có khi running)
  error?: string;       // error message (chỉ có khi error)
}

interface PipelineDefinition {
  workflow: 'summarize' | 'knowledge' | 'research' | 'opinions';
  steps: PipelineStep[];
}
```

### 2. Component — StepTimeline.vue

**Props:**
- `pipeline: PipelineDefinition`
- `showCancel?: boolean`
- `onCancel?: () => void`

**Layout:**
```
┌─────────────────────────────────────┐
│  StepTimeline                       │
│                                     │
│  ✓ Scrape bài viết (trang 1-5)      │  ← done: green check, muted text
│  ⏳ Tóm tắt phần 1/3  ~2m 30s      │  ← running: spinner + ETA
│  ○ Tóm tắt phần 2/3                │  ← pending: gray circle
│  ○ Tóm tắt phần 3/3                │
│  ○ Tạo tóm tắt tổng quan            │
│                                     │
│  [ Hủy ]                            │
└─────────────────────────────────────┘
```

**Styling conventions:**
- Done: `text-green-600` + `✓` icon + text opacity 70%
- Running: `text-blue-600` + animated spinner icon + ETA badge
- Pending: `text-gray-400` + empty circle + text opacity 50%
- Error: `text-red-600` + `✗` icon + error message below
- Active step được highlight với subtle background

### 3. Message Protocol Update

**LLM_PROGRESS mở rộng:**

```typescript
export interface LLMProgressMessage {
  taskId: string;
  step: number;
  totalSteps: number;
  message: string;
  elapsedMs: number;
  // MỚI:
  pipeline?: {
    workflow: string;
    steps: {
      id: string;
      label: string;
      status: 'pending' | 'running' | 'done' | 'error';
    }[];
  };
}
```

Background gửi `pipeline` definition ở progress đầu tiên, sau đó chỉ gửi step updates.

### 4. Composable Updates

**useLLM.ts:**
- `LLMTaskState` thêm `pipeline: PipelineDefinition | null`
- `handleProgress()` cập nhật step statuses trong pipeline
- `startTask()` nhận `pipeline` definition từ caller

**useSummarize.ts:**
- `handleSummarizeSegment()`: build pipeline trước khi bắt đầu
- `handleAutoSummarizeAll()`: build pipeline với tất cả segments + overall
- `autoSummarizeDynamic()`: build pipeline dynamically

### 5. Background Updates

**entrypoints/background/index.ts:**
- `processLLMTask()`: nhận `pipeline` từ task payload, gửi kèm progress đầu tiên
- `onProgress` callback: gửi step index để sidepanel update status

**lib/llm/summarizer.ts:**
- Mỗi hàm (summarize, summarizeSegments, extractKnowledge, ...) nhận `onProgress` callback
- Gọi `onProgress` với step index trước/sau mỗi phase

### 6. Views Update

**SummaryView.vue:**
- Thay `ProgressIndicator` bằng `StepTimeline`
- Build pipeline từ `useSummarize` state

**KnowledgeView.vue:**
- Thay progress display bằng `StepTimeline`
- Pipeline: extracting chunks + reducing phase

**ResearchView.vue:**
- Thay progress display bằng `StepTimeline`
- Pipeline: research steps

**OpinionsView.vue:**
- Thay progress display bằng `StepTimeline`
- Pipeline: opinion analysis steps

### 7. Pipeline Definitions per Workflow

**Summarize (single segment):**
1. `scrape` — "Scrape bài viết (trang X-Y)"
2. `summarize` — "Tóm tắt bằng AI"
3. `save` — "Lưu kết quả"

**Summarize (multi-segment, N segments):**
1. `scrape_seg_0` — "Scrape phần 1 (trang X-Y)"
2. `summarize_seg_0` — "Tóm tắt phần 1"
3. `scrape_seg_1` — "Scrape phần 2 (trang A-B)"
4. `summarize_seg_1` — "Tóm tắt phần 2"
5. ...
6. `overall` — "Tạo tóm tắt tổng quan"
7. `save` — "Lưu kết quả"

**Knowledge Extract (M chunks):**
1. `extract_0` — "Trích xuất phần 1/M"
2. `extract_1` — "Trích xuất phần 2/M"
3. ...
4. `reduce` — "Gộp kiến thức"

**Research:**
1. `research` — "Tra cứu và phân tích"
2. `save` — "Lưu kết quả"

**Opinions:**
1. `analyze` — "Phân tích luồng ý kiến"
2. `save` — "Lưu kết quả"

### 8. Backward Compatibility

- `ProgressIndicator.vue` giữ lại nhưng deprecate (comment `@deprecated`)
- Các message types cũ vẫn hoạt động, pipeline là optional
- Nếu background không gửi `pipeline`, fallback về behavior cũ (spinner + text)

### 9. Acceptance Criteria

- [ ] Timeline hiển thị đầy đủ steps ngay khi bắt đầu task
- [ ] Step đang chạy có spinner animation + ETA
- [ ] Step hoàn thành chuyển sang ✓ xanh
- [ ] Step chờ để ○ xám
- [ ] Step lỗi có ✗ đỏ + error message
- [ ] Hoạt động cho cả 4 workflows: summarize, knowledge, research, opinions
- [ ] Fallback về behavior cũ nếu pipeline không được gửi
- [ ] `npm run compile` pass không lỗi
