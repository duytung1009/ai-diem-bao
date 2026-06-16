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
9. **Design token compliance:**
   - Không dùng Tailwind palette colors (`text-gray-500`, `bg-white`, v.v.) — dùng `text-(--color-*)` hoặc `bg-(--color-*)`
   - Chỉ dùng `rounded-lg` hoặc `rounded-full` — không dùng bare `rounded` hoặc `rounded-md`
   - Saved/pinned icon dùng `--color-saved`, không dùng `text-yellow-*`/`text-amber-*`
   - Icon-only button có `aria-label` + `p-1.5` + `type="button"`
   - Destructive action dùng `<ConfirmInline>`, không `window.confirm()`
   - Form control qua component chuẩn (`ToggleSwitch`, `Checkbox`, `RadioGroup`), không raw `<input type=checkbox|radio>`
   - Form label dùng `label` utility class, không tự chế token
   - Section header dùng `section-heading` utility, không tự chế `text-sm font-semibold`

## Output format (ghi vào task report)

```markdown
## Self-review Results
- Issues found: [N]
- Issues fixed: [N]
- Remaining (cần review thêm): [danh sách nếu có]
```
