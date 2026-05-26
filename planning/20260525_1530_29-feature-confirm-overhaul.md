# Feature 29 — Confirm & Cost Estimate Overhaul

## Overview

Thay thế cơ chế confirm inline hiện tại (render trực tiếp trong flow, gây xô lệch layout) bằng một modal bottom-sheet cố định. Đồng thời enrich thông tin estimate từ "~N API calls" thành breakdown đầy đủ: token input/output, thời gian ước tính, chi phí USD.

Hạ tầng estimate đã có sẵn (`estimateCost()`, `estimateTokens()`, pricing table trong `token-estimator.ts`) — chỉ cần wiring lại và thiết kế UI mới.

## Goals

- Xóa pattern `v-if="!confirmingX"` khỏi tất cả views — không còn layout shift khi hiện/ẩn confirm
- Một component duy nhất `CostConfirmModal.vue` xử lý tất cả confirm flows
- Estimate hiển thị: số API calls, token input ước tính, token output ước tính, thời gian ước tính, chi phí USD
- Với model local (LM Studio/Ollama) hoặc model không có trong pricing table: hiển thị "N/A" cho cost, vẫn show token/calls
- Không thay đổi logic LLM hay scraping — chỉ UI layer

## Requirements

### A. Component `CostConfirmModal.vue` — Bottom Sheet

Layout: fixed bottom-0, full width, slide-up animation. Không phải modal overlay toàn màn hình (side panel hẹp).

```
┌─────────────────────────────┐
│ 🔥 Tóm tắt tất cả segments  │  ← title
│ Ước tính cho thớt này:      │
│                             │
│  API calls    ~12           │
│  Token input  ~45,000       │
│  Token output ~8,000        │
│  Thời gian    ~3–5 phút     │
│  Chi phí      ~$0.0082      │  ← ẩn nếu model không có giá
│                             │
│  ⚠ Chi phí cao hơn bình     │  ← warning line (optional)
│    thường do thớt dài.      │
│                             │
│  [  Tiếp tục  ] [  Hủy  ]   │
└─────────────────────────────┘
```

Props:
```typescript
interface CostConfirmModalProps {
  title: string;
  estimate: CostEstimate;         // struct mới (xem B)
  warning?: string;               // text warning màu cam (optional)
  confirmText?: string;           // default 'Tiếp tục'
  cancelText?: string;            // default 'Hủy'
  dangerConfirmText?: string;     // nếu có → render nút danger riêng (cho force-rescan)
}
```

Emits: `confirm`, `cancel`, `dangerConfirm` (optional).

Animation: `transition: transform 200ms ease-out`, slide từ dưới lên. Backdrop nhẹ (opacity 0.3) phía trên để focus vào modal.

### B. Interface `CostEstimate`

```typescript
// lib/types.ts (hoặc lib/cost-estimate.ts mới)
export interface CostEstimate {
  apiCalls: number;
  inputTokens: number;          // ước tính tổng input tokens across all calls
  outputTokens: number;         // ước tính tổng output tokens across all calls
  estimatedMs: number;          // ước tính thời gian milliseconds
  costUsd: number | null;       // null nếu model không có pricing (local/unknown)
  model: string;                // để hiển thị context
}
```

### C. Builder Functions — `lib/llm/cost-estimator.ts`

Thêm các builder function trả về `CostEstimate` đầy đủ thay vì chỉ trả `number`:

```typescript
// Thay thế estimateAutoSummarizeCalls()
export function estimateAutoSummarizeCost(
  totalPages: number,
  budgetTokens: number,
  model: string,
  maxOutputTokens: number,
  avgTokensPerPage?: number,
): CostEstimate

// Thay thế estimateExtractCalls()
export function estimateExtractCost(
  chunkCount: number,
  avgChunkTokens: number,
  model: string,
  maxOutputTokens: number,
): CostEstimate

// Thay thế estimateSummarizeSegmentCalls()
export function estimateSegmentSummarizeCost(
  chunksNeeded: number,
  avgChunkTokens: number,
  model: string,
  maxOutputTokens: number,
): CostEstimate
```

**Token estimate logic:**
- `inputTokens` = `apiCalls × avgChunkTokens` (map phase) + reduce calls × merged tokens
- `outputTokens` = `apiCalls × maxOutputTokens × 0.6` (60% fill rate heuristic — thực tế output thường không fill hết)
- Dùng `estimateCost(inputTokens, outputTokens, model)` đã có sẵn

**Time estimate logic:**
```typescript
const MS_PER_CALL_BASE = 8000;      // 8s baseline mỗi call
const MS_PER_1K_OUTPUT_TOKENS = 500; // 0.5s per 1K output tokens
estimatedMs = apiCalls * MS_PER_CALL_BASE + (outputTokens / 1000) * MS_PER_1K_OUTPUT_TOKENS;
```
Đây là rough heuristic, không cần chính xác — mục đích chỉ cho user có expectation.

**Giờ format thời gian:**
- < 60s → "~X giây"
- 1–10 phút → "~X–Y phút"
- > 10 phút → "~X phút"

### D. Refactor Callers

Thay thế 3 confirm flows hiện tại:

**SummaryView.vue** — `confirmingAutoSummarize`:
- Xóa `ref(false)` + `v-if="!confirmingAutoSummarize"` pattern
- Thay bằng `showConfirmModal = ref(false)` + `<CostConfirmModal>`
- `estimatedAutoSummarizeCalls` → `estimatedAutoSummarizeCost` (full CostEstimate)

**KnowledgeView.vue** — `confirmingExtract` và `confirmingRestore`:
- Tương tự, 2 CostEstimate computed riêng
- KnowledgeView có 2 confirm triggers nên cần thêm `confirmTarget: 'extract' | 'restore' | null`

**useSummarize.ts** — warn khi segment lớn (hiện dùng `simpleLoadingText`):
- Đây chưa phải confirm, chỉ là warning text. Giữ nguyên hoặc nâng cấp sang inline warning banner — không cần modal.

### E. Xóa `ConfirmInline.vue`

Sau khi migrate xong tất cả callers → xóa component. Không có caller nào còn dùng nữa.

Kiểm tra trước khi xóa:
```bash
grep -rn "ConfirmInline" entrypoints/
```

### F. Threshold logic

Hiện tại threshold: `LLM_WARN_THRESHOLD_CALLS = 5` — chỉ hiện warning khi > 5 calls.

Thay đổi: **luôn hiện modal confirm** khi user bấm action nặng (Extract, Restore, Auto-summarize all), không phụ thuộc threshold. Threshold cũ chỉ dùng để tô màu warning line trong modal (cam = cao, xanh = bình thường).

Lý do: estimate thông tin có ích ngay cả khi chỉ 2 API calls — user biết cần bao lâu.

**Exception:** Nếu `costUsd === 0` (model free/local) AND `apiCalls <= 3` → skip modal, chạy thẳng.

## Technical Considerations

**Affected files:**
- `lib/types.ts` — thêm `CostEstimate` interface
- `lib/llm/cost-estimator.ts` — thêm builder functions mới, giữ cũ cho backward compat tạm thời
- `entrypoints/sidepanel/components/CostConfirmModal.vue` — NEW
- `entrypoints/sidepanel/components/ConfirmInline.vue` — XÓA sau khi migrate
- `entrypoints/sidepanel/views/SummaryView.vue` — refactor confirm flow
- `entrypoints/sidepanel/views/KnowledgeView.vue` — refactor 2 confirm flows
- `entrypoints/sidepanel/composables/useKnowledge.ts` — update exported computed

**Side panel width:** ~380px. Bottom sheet full-width là optimal. Không dùng centered dialog vì quá chật.

**z-index:** Modal cần nằm trên tất cả content nhưng dưới browser UI. `z-50` là đủ trong side panel context.

**Không cần teleport:** Vue Teleport tới `body` không cần thiết vì side panel là isolated document.

**avgChunkTokens:** Tính từ `allPosts` đã có trong composables. Đủ chính xác cho estimate.

## Test Plan

- Mở thớt dài (> 10 trang), bấm "Tóm tắt tất cả" → modal hiện với estimate đầy đủ
- Verify modal không làm nhảy layout phía trên (backdrop + fixed positioning)
- Bấm Hủy → modal đóng, không có gì chạy
- Bấm Tiếp tục → LLM chạy bình thường
- Thử với model local (LM Studio) → cost hiển thị "N/A", các field khác vẫn show
- Thử với model free (Gemma) → cost hiển thị "$0.0000"
- KnowledgeView: Extract và Restore đều hiện modal riêng, không conflict nhau

## Decision Log

### Quyết định 1: Bottom sheet vs centered modal
- **Đã chọn:** Bottom sheet (fixed bottom-0)
- **Lý do:** Side panel 380px quá hẹp cho centered modal. Bottom sheet maximize không gian hiển thị estimate. Pattern quen thuộc trên mobile.
- **Đã cân nhắc nhưng loại:**
  - Centered modal với overlay — loại vì awkward trên viewport hẹp
  - Inline expand (giữ nguyên vị trí) — loại vì vẫn gây layout shift
- **Điều kiện thay đổi:** Không.

### Quyết định 2: Luôn hiện modal vs chỉ hiện khi > threshold
- **Đã chọn:** Luôn hiện modal (ngoại trừ local model + ≤ 3 calls)
- **Lý do:** Estimate thông tin có ích cho mọi trường hợp. User nên biết operation sẽ mất bao lâu dù chỉ 2 calls.
- **Đã cân nhắc nhưng loại:**
  - Giữ threshold cũ (> 5 calls) — loại vì thiếu nhất quán, user không biết khi nào có/không có confirm
- **Điều kiện thay đổi:** Nếu user feedback là modal xuất hiện quá nhiều → tăng threshold lên ≥ 3 calls.

### Quyết định 3: Giữ builder functions cũ hay xóa
- **Đã chọn:** Giữ tạm, deprecated comment, xóa sau khi migrate xong
- **Lý do:** Tránh breaking trong quá trình migrate từng file
- **Điều kiện thay đổi:** Xóa cùng lúc xóa ConfirmInline.vue sau khi verify toàn bộ caller đã migrate

### Quyết định 4: outputTokens estimate dùng 60% fill rate
- **Đã chọn:** `maxOutputTokens × 0.6`
- **Lý do:** LLM thường không fill hết output budget, 60% là empirical estimate hợp lý. Overestimate nhẹ vẫn tốt hơn underestimate (user ngạc nhiên khi tốn nhiều hơn báo).
- **Điều kiện thay đổi:** Sau khi có data thực, calibrate lại tỉ lệ.
