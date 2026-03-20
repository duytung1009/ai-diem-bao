# AI Diểm Báo — Agent Rules

## Model Policy
- Planning phức tạp, architecture decision: dùng Opus
- Implementation, bug logging, review routine: dùng Sonnet
- Formatting, rename, simple refactor: dùng Haiku

## Planning Template
- [ ] Objective & scope
- [ ] Affected modules
- [ ] Implementation steps (ordered)
- [ ] Edge cases
- [ ] Test plan
- [ ] Rollback plan

## Degraded Mode (khi Opus bị rate limit)
- Dùng Sonnet với template đầy đủ
- Tag file với `[DRAFT_PENDING_OPUS]`
- Ghi vào MEMORY.md section `Pending Opus Review`

## File Naming Convention (BẮT BUỘC)

Tất cả file trong `planning/`, `tasks/`, `review/` PHẢI đặt tên theo format có timestamp:

```
yyyyMMdd_HHmm_tên_file.md
```

Ví dụ: `20260319_1450_09-feature-detect-search-opinions.md`

Timestamp lấy từ thời điểm tạo file.

## Workflow Rules

### Sau khi lập planning (feature hoặc bugfix)

1. Lưu file planning vào `planning/`
2. Tên file: `yyyyMMdd_HHmm_tên_file.md`
   - Feature: `yyyyMMdd_HHmm_NN-feature-tên.md` (NN = số thứ tự feature)
   - Bug fix: `yyyyMMdd_HHmm_fix-tên.md`
3. Cập nhật `MEMORY.md` — thêm entry mới vào section "Planning Files"

### Sau khi implement/fix code

1. Lưu tóm tắt những gì đã thực hiện vào `tasks/`
2. Tên file theo loại công việc:
   - Task/feature: `yyyyMMdd_HHmm_task_tên_file.md`
   - Bug fix: `yyyyMMdd_HHmm_bug_tên_file.md`
3. Cập nhật `MEMORY.md` — cập nhật status của feature/bug tương ứng

### Sau khi review

1. Lưu nội dung review vào `review/`
2. Tên file: `yyyyMMdd_HHmm_tên_file.md`
3. Thêm 1 field vào format file review: review_tier: sonnet | opus để track lại
4. Cập nhật `MEMORY.md` — thêm entry vào section "Review Files"

## Cập nhật MEMORY.md

Mọi thay đổi về planning, task completion, hoặc review đều PHẢI được phản ánh vào `MEMORY.md` (nằm trong thư mục memory của Claude project). Đảm bảo:
- Status của feature/bugfix được cập nhật (pending → done)
- Tên file mới được ghi nhận đúng (kèm timestamp prefix)
- Tóm tắt ngắn gọn những gì đã làm

## Project Context

Xem `MEMORY.md` để nắm tổng quan dự án, kiến trúc, patterns, và trạng thái hiện tại của từng feature/bugfix.
