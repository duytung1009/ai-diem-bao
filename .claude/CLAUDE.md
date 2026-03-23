# AI Diểm Báo — Agent Rules

## Model Policy

| Tier | Model | Khi nào dùng | Ví dụ |
|------|-------|-------------|-------|
| Quick | Haiku | Formatting, rename, simple refactor | Fix typo, thêm field UI, update text |
| Tier 1 — Quick Review | Sonnet | Review thay đổi < 50 LOC, single file, không đụng logic core | Fix typo, thêm field UI, update text |
| Tier 2 — Standard | Sonnet | Implementation, bug logging, review 50-200 LOC, 2-3 files | Thêm API endpoint, filter/sort, bug fix routine |
| Tier 3 — Deep | Opus | Planning phức tạp, architecture, review > 200 LOC, cross-module, security | Refactor data flow, đổi cache schema, batch planning |

## Planning Template

- [ ] Objective & scope
- [ ] Affected modules
- [ ] Implementation steps (ordered)
- [ ] Edge cases
- [ ] Test plan
- [ ] Rollback plan
- [ ] Decision Log (xem bên dưới)

### Decision Log (BẮT BUỘC trong mọi planning file)

Mỗi quyết định kiến trúc quan trọng cần ghi lại:

```markdown
## Decision Log

### Quyết định 1: [Tên quyết định]
- **Đã chọn:** [Approach được chọn]
- **Lý do:** [Tại sao chọn cái này]
- **Đã cân nhắc nhưng loại:**
  - [Alternative A] — loại vì [lý do]
  - [Alternative B] — loại vì [lý do]
- **Điều kiện thay đổi:** [Khi nào nên xem xét lại quyết định này]
```

Mục đích: Khi Sonnet implement, tham chiếu Decision Log để hiểu lý do đằng sau mỗi approach. Nếu gặp tình huống không cover → tag `[DECISION_NEEDED]` kèm reasoning và tiếp tục.

## Degraded Mode (khi Opus bị rate limit)
- Dùng Sonnet với template đầy đủ
- BẮT BUỘC đọc Decision Log từ planning file liên quan
- Tag file với `[DRAFT_PENDING_OPUS]`
- Với decisions mới chưa có trong log: tag `[DECISION_NEEDED]` kèm reasoning
- Ghi vào MEMORY.md section `Pending Opus Review`

## File Naming Convention (BẮT BUỘC)

Tất cả file trong `planning/`, `tasks/`, `review/` PHẢI đặt tên theo format có timestamp:

```
yyyyMMdd_HHmm_tên_file.md
```

Ví dụ: `20260319_1450_09-feature-detect-search-opinions.md`

Timestamp lấy từ thời điểm tạo file.

### Review file naming — thêm tier prefix:
```
review/yyyyMMdd_HHmm_tier1_tên_file.md
review/yyyyMMdd_HHmm_tier2_tên_file.md
review/yyyyMMdd_HHmm_tier3_tên_file.md
```

## Workflow Rules

### Sau khi lập planning (feature hoặc bugfix)

1. Lưu file planning vào `planning/`
2. Tên file: `yyyyMMdd_HHmm_tên_file.md`
   - Feature: `yyyyMMdd_HHmm_NN-feature-tên.md` (NN = số thứ tự feature)
   - Bug fix: `yyyyMMdd_HHmm_fix-tên.md`
   - Batch: `yyyyMMdd_HHmm_batch_tên_nhóm.md`
3. Planning file PHẢI có Decision Log
4. Cập nhật `MEMORY.md` — thêm entry mới vào section "Planning Files"

### Sau khi implement/fix code

1. Chạy **Self-review** (Sonnet) theo checklist trong `template/self_review_checklist.md`
2. Fix tất cả issues tìm được
3. Lưu tóm tắt vào `tasks/`:
   - Task/feature: `yyyyMMdd_HHmm_task_tên_file.md`
   - Bug fix: `yyyyMMdd_HHmm_bug_tên_file.md`
   - Bug batch (Phase A): `yyyyMMdd_HHmm_bug_batch_tên.md`
4. Task report PHẢI có section **Self-review Results**:
   ```markdown
   ## Self-review Results
   - Issues found: [N]
   - Issues fixed: [N]
   - Remaining (cần review thêm): [danh sách nếu có]
   ```
5. Cập nhật `MEMORY.md` — cập nhật status

### Sau khi implement — Review Triage

Sau khi commit + task report, chạy Sonnet phân tích diff:

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

1. Lưu nội dung review vào `review/`
2. Tên file: `yyyyMMdd_HHmm_tierN_tên_file.md` (N = 1, 2, hoặc 3)
3. BẮT BUỘC theo format Review Template bên dưới
4. Cập nhật `MEMORY.md` — thêm entry vào section "Review Files"

### QA 2 Phase (sau khi Tùng test)

**Phase A — Bug Hunting (Sonnet):**
- Input: notes testing của Tùng
- Output: `tasks/yyyyMMdd_HHmm_bug_batch_tên.md` (theo format `template/bug_report.md`)

**Phase B — Strategic Review (Opus):**
- Input: feature vừa hoàn thành + bug list từ Phase A
- Output: `tasks/yyyyMMdd_HHmm_improvement_tên.md`
- Đánh giá: improvements, feature mới phát sinh, technical debt, priority ranking
- Items feed ngược vào `planning/backlog.md` cho batch planning

### Batch Planning (khi có 2-3 feature liên quan)

1. Gom feature vào `planning/backlog.md` theo nhóm module
2. Khi đủ 2-3 feature liên quan → gọi Opus 1 lần với prompt:
   ```
   Lên kế hoạch implementation cho nhóm feature sau.
   Chú ý: shared dependencies, thứ tự tối ưu, shared components, potential conflicts.
   ```
3. Output: `planning/yyyyMMdd_HHmm_batch_tên_nhóm.md`
   - Dependency graph
   - Shared components cần tạo trước
   - Implementation order
   - Plan chi tiết từng feature (theo Planning Template)
4. Cập nhật backlog: chuyển items sang "Đã batch plan"

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

Mọi thay đổi về planning, task completion, hoặc review đều PHẢI được phản ánh vào `MEMORY.md` (nằm trong thư mục memory của Claude project). Đảm bảo:
- Status của feature/bugfix được cập nhật (pending → done)
- Tên file mới được ghi nhận đúng (kèm timestamp prefix)
- Tóm tắt ngắn gọn những gì đã làm

## Project Context

Xem `MEMORY.md` để nắm tổng quan dự án, kiến trúc, patterns, và trạng thái hiện tại của từng feature/bugfix.
