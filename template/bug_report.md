# Bug Report Template (Phase A — Bug Hunting)

> Dùng bởi Sonnet sau khi Tùng test feature. Input: notes testing của Tùng.
> Output: file `tasks/yyyyMMdd_HHmm_bug_batch_tên.md`

## Format mỗi bug

```markdown
### BUG-yyyyMMdd-NN: [Tên ngắn gọn]
- **Severity:** critical | major | minor
- **Affected module:** [file/component chính]
- **Steps to reproduce:**
  1. ...
  2. ...
- **Expected:** ...
- **Actual:** ...
- **Suggested fix direction:** (nếu rõ ràng, để trống nếu không)
```

## Quy tắc
- Mỗi bug một entry riêng, đánh số liên tục (NN = 01, 02, ...)
- Severity critical: crash, data loss, security. Major: chức năng không hoạt động. Minor: UI sai, UX kém.
- Nếu reproduce được → ghi rõ steps. Nếu không → ghi "Intermittent" + điều kiện xảy ra.
