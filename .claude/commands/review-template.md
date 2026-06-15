# Review Template

Dùng khi viết review file trong `review/`. File phải có timestamp + tier prefix: `yyyyMMdd_HHmm_tierN_tên.md`.

## Review File Format

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

## QA 2 Phase (sau khi Tùng test)

**Phase A — Bug Hunting (Sonnet):**
- Input: notes testing của Tùng
- Output: thêm bug tasks vào task-master (`task-master add-task --prompt "..."`)
- Theo format `template/bug_report.md`

**Phase B — Strategic Review (Opus):**
- Input: feature vừa hoàn thành + bug list từ Phase A
- Đánh giá: improvements, feature mới phát sinh, technical debt, priority ranking
- Items feed ngược vào task-master + `planning/backlog.md`
