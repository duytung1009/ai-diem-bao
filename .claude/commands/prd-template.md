# PRD Template — Planning Files

Dùng khi tạo planning file mới trong `planning/`. File phải có timestamp prefix: `yyyyMMdd_HHmm_tên.md`.

## PRD Format (cho `task-master parse-prd`)

```markdown
# [Tên feature/bugfix]

## Overview
Mô tả ngắn gọn: mục tiêu, scope, lý do cần làm.

## Goals
- Goal 1 (measurable outcome)
- Goal 2

## Requirements

### [Component / Module A]
- Requirement 1: mô tả chi tiết
- Requirement 2

### [Component / Module B]
- Requirement 3

## Technical Considerations
- Affected files/modules
- Dependencies giữa components
- Edge cases cần xử lý
- Constraints (performance, backward compat, v.v.)

## Implementation Notes
Gợi ý cụ thể cho agent implement: patterns cần dùng, files cần sửa, thứ tự ưu tiên.

## Test Plan
- Cách verify feature hoạt động đúng
- Edge cases cần test thủ công

## Decision Log

### Quyết định 1: [Tên quyết định]
- **Đã chọn:** [Approach được chọn]
- **Lý do:** [Tại sao chọn cái này]
- **Đã cân nhắc nhưng loại:**
  - [Alternative A] — loại vì [lý do]
- **Điều kiện thay đổi:** [Khi nào nên xem xét lại]
```

**Decision Log BẮT BUỘC** trong mọi planning file. Khi implement, tham chiếu Decision Log để hiểu lý do đằng sau mỗi approach. Nếu gặp tình huống không cover → tag `[DECISION_NEEDED]` kèm reasoning và tiếp tục.

## Degraded Mode (khi Opus bị rate limit)

- Dùng Sonnet với template đầy đủ
- BẮT BUỘC đọc Decision Log từ planning file liên quan
- Tag file với `[DRAFT_PENDING_OPUS]`
- Với decisions mới chưa có trong log: tag `[DECISION_NEEDED]` kèm reasoning
- Ghi vào MEMORY.md section `Pending Opus Review`

## Batch Planning (khi có 2-3 feature liên quan)

1. Gom feature vào `planning/backlog.md` theo nhóm module
2. Khi đủ 2-3 feature liên quan → gọi Opus 1 lần:
   ```
   Lên kế hoạch implementation cho nhóm feature sau.
   Chú ý: shared dependencies, thứ tự tối ưu, shared components, potential conflicts.
   ```
3. Output: `planning/yyyyMMdd_HHmm_batch_tên_nhóm.md` gồm:
   - Dependency graph + implementation order
   - Shared components cần tạo trước
   - Requirements chi tiết từng feature (theo PRD format ở trên)
4. Parse PRD: `task-master parse-prd planning/yyyyMMdd_HHmm_batch_tên_nhóm.md --append`
5. Cập nhật task dependencies trong tasks.json nếu cần
6. Cập nhật backlog: chuyển items sang "Đã batch plan"
