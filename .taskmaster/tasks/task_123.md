# Task ID: 123

**Title:** Tạo utility function formatNumber trong lib/format.ts

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Tạo file lib/format.ts chứa hàm formatNumber(n: number): string dùng toLocaleString('en-US') để format số với dấu phẩy phân cách hàng nghìn

**Details:**

1. Tạo file mới `lib/format.ts`
2. Implement function:
```typescript
export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}
```
3. Export function để các component có thể import
4. Locale 'en-US' sẽ format với dấu phẩy (4,656) thay vì dấu chấm của vi-VN (4.656) để tránh nhầm lẫn với dấu thập phân
5. Function chỉ nhận số nguyên, không áp dụng cho phần trăm hay số thập phân

**Test Strategy:**

1. Build project với `npm run build` phải pass
2. Type check với `npx vue-tsc --noEmit` phải clean
3. Test manual: gọi formatNumber(4656) phải return '4,656'
4. Test với số nhỏ: formatNumber(999) return '999' (không có dấu phẩy)
5. Test với số lớn: formatNumber(1234567) return '1,234,567'
