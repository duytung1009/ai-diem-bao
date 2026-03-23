# Self-Review Checklist

> Chạy bằng Sonnet NGAY SAU khi implement, TRƯỚC khi commit.
> Kết quả ghi vào section "Self-review Results" trong task report.

## Checklist

1. **Error handling:** Mọi async call có try-catch? API response có validate?
2. **Null safety:** Biến nào có thể null/undefined mà chưa check?
3. **Naming consistency:** Có theo convention hiện tại của project? (xem STYLE_GUIDE.md, MEMORY.md)
4. **Missing imports/exports:** Tất cả symbol dùng trong template/code đã import?
5. **Debug code còn sót:** `console.log`, `debugger`, commented-out code?
6. **Hardcoded values:** Có giá trị nên là constant/config trong `lib/constants.ts`?
7. **TypeScript types:** Có dùng `any`? Có thiếu type annotation?
8. **Reactive patterns (Vue):** `readonly()` cho exposed state? `computed` thay vì manual watch khi có thể?

## Output format (ghi vào task report)

```markdown
## Self-review Results
- Issues found: [N]
- Issues fixed: [N]
- Remaining (cần review thêm): [danh sách nếu có]
```
