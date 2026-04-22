# AI Diểm Báo — Agent Rules

## Model Policy

| Tier | Model | Khi nào dùng | Ví dụ |
|------|-------|-------------|-------|
| Quick | Haiku | Formatting, rename, simple refactor | Fix typo, thêm field UI, update text |
| Tier 1 — Quick Review | Sonnet | Review thay đổi < 50 LOC, single file, không đụng logic core | Fix typo, thêm field UI, update text |
| Tier 2 — Standard | Sonnet | Implementation, bug logging, review 50-200 LOC, 2-3 files | Thêm API endpoint, filter/sort, bug fix routine |
| Tier 3 — Deep | Opus | Planning phức tạp, architecture, review > 200 LOC, cross-module, security | Refactor data flow, đổi cache schema, batch planning |

## Planning Template (PRD format — dùng với `task-master parse-prd`)

Planning files phải viết theo format PRD để có thể parse bằng `task-master parse-prd --append`. Task-master sẽ đọc file này và tự động generate tasks + subtasks.

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

**Decision Log BẮT BUỘC** trong mọi planning file. Khi Sonnet implement, tham chiếu Decision Log để hiểu lý do đằng sau mỗi approach. Nếu gặp tình huống không cover → tag `[DECISION_NEEDED]` kèm reasoning và tiếp tục.

## Degraded Mode (khi Opus bị rate limit)
- Dùng Sonnet với template đầy đủ
- BẮT BUỘC đọc Decision Log từ planning file liên quan
- Tag file với `[DRAFT_PENDING_OPUS]`
- Với decisions mới chưa có trong log: tag `[DECISION_NEEDED]` kèm reasoning
- Ghi vào MEMORY.md section `Pending Opus Review`

## Task Master — Quản lý task

Task-master là source of truth cho tất cả pending/in-progress/done tasks.

### Commands thường dùng

```bash
task-master list                        # Xem tất cả tasks + status
task-master show <id>                   # Xem chi tiết task (subtasks, details)
task-master next                        # Task tiếp theo nên làm
task-master set-status <id> <status>    # Cập nhật status (pending|in-progress|done|blocked)
task-master add-task --prompt "..."     # Thêm task mới (LLM parse)
task-master expand <id> --num 4         # Chia task thành subtasks
task-master update <id> --prompt "..."  # Cập nhật task
```

Statuses: `pending` | `in-progress` | `done` | `blocked` | `deferred` | `cancelled` | `review`

## File Naming Convention (BẮT BUỘC)

Tất cả file trong `planning/` và `review/` PHẢI đặt tên theo format có timestamp:

```
yyyyMMdd_HHmm_tên_file.md
```

Ví dụ: `20260319_1450_09-feature-detect-search-opinions.md`

Timestamp lấy từ thời điểm tạo file. Planning files được link từ task details trong tasks.json.

### Review file naming — thêm tier prefix:
```
review/yyyyMMdd_HHmm_tier1_tên_file.md
review/yyyyMMdd_HHmm_tier2_tên_file.md
review/yyyyMMdd_HHmm_tier3_tên_file.md
```

## Workflow Rules

### Sau khi lập planning (feature hoặc bugfix)

1. Lưu file planning vào `planning/` theo PRD format (xem Planning Template)
   - Feature: `yyyyMMdd_HHmm_NN-feature-tên.md` (NN = số thứ tự feature)
   - Bug fix: `yyyyMMdd_HHmm_fix-tên.md`
   - Batch: `yyyyMMdd_HHmm_batch_tên_nhóm.md`
2. Planning file PHẢI có Decision Log
3. Parse PRD thành tasks trong task-master:
   ```bash
   task-master parse-prd planning/yyyyMMdd_HHmm_tên.md --append
   # --append để thêm vào task list hiện có, không overwrite
   ```
4. Cập nhật `MEMORY.md` — thêm entry vào section "Planning Files"

### Sau khi implement/fix code

1. Chạy **Self-review** (Sonnet) theo checklist trong `template/self_review_checklist.md`
2. Fix tất cả issues tìm được
3. Chuyển task sang trạng thái chờ review:
   ```bash
   task-master set-status --id=<id> --status=review
   ```

### Sau khi implement — Review Triage

Phân tích diff để xác định tier:

```
Phân tích diff sau và xác định review tier:
- Tier 1 (Quick): < 50 LOC, single file, no core logic change
- Tier 2 (Standard): 50-200 LOC, 2-3 files, straightforward logic
- Tier 3 (Deep): > 200 LOC, cross-module, architecture/security impact

Output: tier, lý do, và danh sách concerns cần review.
```

- **Tier 1-2:** Sonnet review (đủ)
- **Tier 3:** Opus review (focus architecture/logic, skip đã self-review)

### Sau khi review

1. Lưu nội dung review vào `review/yyyyMMdd_HHmm_tierN_tên_file.md` theo Review Template
2. Link file vào task và cập nhật status:
   ```bash
   # Approve
   task-master update-task --id=<id> --prompt="Review: review/yyyyMMdd_HHmm_tierN_tên.md — approve"
   task-master set-status --id=<id> --status=done

   # Request changes
   task-master update-task --id=<id> --prompt="Review: review/yyyyMMdd_HHmm_tierN_tên.md — request-changes: [tóm tắt issue chính]"
   task-master set-status --id=<id> --status=blocked
   ```
3. Không cần cập nhật MEMORY.md "Review Files" — link đã có trong task notes

### QA 2 Phase (sau khi Tùng test)

**Phase A — Bug Hunting (Sonnet):**
- Input: notes testing của Tùng
- Output: thêm bug tasks vào task-master (`task-master add-task --prompt "..."`)
- Theo format `template/bug_report.md`

**Phase B — Strategic Review (Opus):**
- Input: feature vừa hoàn thành + bug list từ Phase A
- Đánh giá: improvements, feature mới phát sinh, technical debt, priority ranking
- Items feed ngược vào task-master + `planning/backlog.md`

### Batch Planning (khi có 2-3 feature liên quan)

1. Gom feature vào `planning/backlog.md` theo nhóm module
2. Khi đủ 2-3 feature liên quan → gọi Opus 1 lần với prompt:
   ```
   Lên kế hoạch implementation cho nhóm feature sau.
   Chú ý: shared dependencies, thứ tự tối ưu, shared components, potential conflicts.
   ```
3. Output: `planning/yyyyMMdd_HHmm_batch_tên_nhóm.md` theo PRD format, gồm:
   - Dependency graph + implementation order
   - Shared components cần tạo trước
   - Requirements chi tiết từng feature (theo Planning Template)
4. Parse PRD thành tasks:
   ```bash
   task-master parse-prd planning/yyyyMMdd_HHmm_batch_tên_nhóm.md --append
   ```
5. Cập nhật task dependencies trong tasks.json nếu cần
6. Cập nhật backlog: chuyển items sang "Đã batch plan"

## Review Template (BẮT BUỘC cho mọi review file)

### Metadata
- **File reviewed:** [path]
- **Review tier:** tier1 | tier2 | tier3
- **Model used:** sonnet | opus
- **Diff size:** [LOC changed]

### Checklist
| Category | Status | Notes |
|----------|--------|-------|
| Logic correctness | ✅/❌/⚠️/N/A | |
| Edge cases covered | ✅/❌/⚠️/N/A | |
| Error handling | ✅/❌/⚠️/N/A | |
| Performance concerns | ✅/❌/⚠️/N/A | |
| Security implications | ✅/❌/⚠️/N/A | |
| Consistency with patterns | ✅/❌/⚠️/N/A | |
| Type safety | ✅/❌/⚠️/N/A | |
| Test coverage | ✅/❌/⚠️/N/A | |

### Issues Found
| # | Severity | Category | Description | Suggestion |
|---|----------|----------|-------------|------------|
| 1 | critical/major/minor/nit | [category] | [mô tả] | [gợi ý fix] |

### Summary
- **Overall:** approve / request-changes / needs-opus-review
- **Key concern:** [1 dòng tóm tắt concern chính nếu có]

## Cập nhật MEMORY.md

**Task status** được quản lý bởi task-master (`tasks.json`). MEMORY.md chỉ cần cập nhật khi:
- Thêm planning file mới (section "Planning Files")
- Ghi nhận bug fix đáng chú ý (section "Bug Fixes")
- Thay đổi kiến trúc, patterns, hoặc key decisions

Không cần cập nhật MEMORY.md cho review files — link review đã lưu trong task notes qua `update-task`.
Đừng duplicate task status vào MEMORY.md — dùng `task-master list` để xem trạng thái.

## Project Context

- Xem `MEMORY.md` để nắm tổng quan dự án, kiến trúc, patterns, và lịch sử planning/review files
- Dùng `task-master list` để xem trạng thái pending tasks hiện tại
- Dùng `task-master show <id>` để xem chi tiết và subtasks của từng task
