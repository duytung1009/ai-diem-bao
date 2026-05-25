# Lội Thớt Hộ — Styling Guide

## Nguyên tắc chung
1. **Đơn giản** — Ít element, ít nesting, ít decoration
2. **Nhất quán** — Dùng utility classes đã định nghĩa, không invent class mới
3. **Token-based** — Dùng CSS variables cho colors, không hard-code Tailwind colors

## Utilities Reference

### Buttons
| Class | Dùng khi |
|-------|----------|
| `btn btn-primary` | Action chính (Tóm tắt, Xác nhận, Lưu) |
| `btn btn-secondary` | Action phụ (Hủy, Tóm tắt lại) |
| `btn btn-sm` | Thêm vào btn-primary/secondary cho button nhỏ |
| `btn btn-danger` | Action xóa/hủy destructive |

### Layout
| Class | Dùng khi |
|-------|----------|
| `card` | Container tĩnh (summary box, info card) |
| `card-interactive` | Container clickable (topic card) |

### Text hierarchy
| Element | Class |
|---------|-------|
| App title | `text-lg font-bold` |
| Section heading | `text-sm font-semibold` |
| Body text | `text-sm` |
| Label/caption | `text-xs font-medium text-[var(--color-text-secondary)]` |
| Muted hint | `text-xs text-[var(--color-text-muted)]` |

### Badges
| Class | Dùng khi |
|-------|----------|
| `badge badge-success` | Đã hoàn thành (✓ Đã tóm tắt) |
| `badge badge-neutral` | Chưa hoàn thành (○ Chưa tóm tắt) |

### Alerts
| Class | Dùng khi |
|-------|----------|
| `alert alert-warning` | Cảnh báo (page scraping warnings) |
| `alert alert-error` | Lỗi |
| `alert alert-success` | Thành công |
| `alert alert-info` | Thông tin (token estimation) |

### Spacing conventions
- Section spacing: `space-y-4`
- Item spacing trong section: `space-y-2`
- Padding container chính: `p-4`
- Padding card/alert: `p-3`
- Gap giữa buttons: `gap-2`

### Border radius
- Containers/buttons: `rounded-lg` (8px) — **mặc định cho mọi thứ**
- Badges/pills: `rounded-full`
- **Không dùng** `rounded`, `rounded-md` — chỉ `rounded-lg` hoặc `rounded-full`

### Colors
- **Luôn dùng CSS variables**: `var(--color-*)` hoặc Tailwind arbitrary `[color:var(--color-*)]`
- **Không hard-code** `text-gray-600`, `bg-white`, v.v. trong code mới
- Ngoại lệ: Tailwind semantic classes (`text-white` cho button text trên nền accent)
