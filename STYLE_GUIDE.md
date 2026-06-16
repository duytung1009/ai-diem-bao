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
| Label/caption | `text-xs font-medium text-(--color-text-secondary)` |
| Muted hint (decorative only) | `text-xs text-(--color-text-muted)` |

**Contrast rule (WCAG AA):**
- `--color-text-secondary` đã được làm tối để đạt **≥4.5:1** trên cả `--color-bg-muted` lẫn `--color-bg-base` (light + dark). Đây là token mặc định cho **mọi text mang thông tin**: caption, label, author/timestamp, metadata, nội dung phụ.
- `--color-text-muted` **không đạt AA** trên nền muted — chỉ dùng cho element **thuần trang trí** (chevron expand/collapse, icon resting state có hover rõ ràng). Không dùng cho text người đọc cần đọc được.

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
- Padding container chính (view root): `p-3`
- Padding card/alert: `p-3`
- Gap giữa buttons: `gap-2`

### Border radius
- Containers/buttons: `rounded-lg` (8px) — **mặc định cho mọi thứ**
- Badges/pills: `rounded-full`
- **Không dùng** `rounded`, `rounded-md` — chỉ `rounded-lg` hoặc `rounded-full`

### Colors
- **Luôn dùng CSS variables**: `var(--color-*)` hoặc Tailwind arbitrary `[color:var(--color-*)]` / `text-(--color-*)`
- **Không hard-code** `text-gray-600`, `bg-white`, v.v. trong code mới
- Ngoại lệ: Tailwind semantic classes (`text-white` cho button text trên nền accent)
- **Saved / bookmarked / pinned**: dùng token `--color-saved` (vàng gold), không dùng `text-yellow-500`/`text-amber-500`
- **Tag danh mục kiến thức**: import `getTagClass` từ `@/lib/tag-styles` — không copy palette vào view

## Icon-only buttons (a11y)

Mọi button chỉ chứa icon (lưu, ghim, xóa, sửa, xuất, menu…) PHẢI có đủ:
- `type="button"` — tránh submit form ngoài ý muốn
- `:aria-label` (hoặc `aria-label`) mô tả hành động — title tooltip **không** thay được aria-label cho screen reader
- Padding tối thiểu `p-1.5` — đạt touch target ~26px (≥24px floor). Không dùng `p-0.5`/`p-1`
- Resting color: `text-(--color-text-secondary)` (không phải `-muted`), `hover:` đổi sang màu ngữ nghĩa (`--color-saved` cho lưu/ghim, `--color-error-text` cho xóa)

```html
<button type="button" class="p-1.5 rounded-lg text-(--color-text-secondary) hover:text-(--color-saved)"
  :aria-label="saved ? 'Bỏ lưu' : 'Lưu'" :title="saved ? 'Bỏ lưu' : 'Lưu'" @click="...">
  <svg class="w-3.5 h-3.5">…</svg>
</button>
```

## Biểu tượng "lưu" thống nhất (star)

Toàn app dùng **một** metaphor cho saved/bookmarked/pinned: icon **ngôi sao** (Heroicons star), tô màu `--color-saved` khi active. Không dùng cờ (flag), trái tim, hay bookmark cho cùng ngữ nghĩa này. Trash icon chỉ dành cho **xóa**, không dùng cho "bỏ lưu".

## Inline confirm cho hành động destructive

`window.confirm()` **bị chặn** trong sidepanel extension → không dùng. Với hành động phá hủy/khó hoàn tác (xóa, bỏ lưu, xóa tất cả), render một **hàng confirm inline** thay tại chỗ button gốc:

```html
<div v-if="confirmId === entry.id" class="flex items-center gap-2">
  <span class="text-xs text-(--color-text-secondary)">Xác nhận?</span>
  <button type="button" class="btn btn-danger btn-sm" @click="doDelete">Xóa</button>
  <button type="button" class="btn btn-ghost btn-sm" @click="confirmId = null">Hủy</button>
</div>
```

Đặt action destructive ở **rìa** cụm button (không kẹp giữa hai action an toàn) để giảm mis-click.

## Nhãn "Nhóm theo" vs "Sắp xếp"

- Control **gom nhóm** (group-by danh mục/tag) → nhãn **"Nhóm theo:"**
- Control **đổi thứ tự** (sort theo ngày/tên) → nhãn **"Sắp xếp:"**

Không dùng "Sắp xếp:" cho control thực chất là grouping.

## Component Inventory

### Common Patterns

| Component | File | Props | Dùng khi |
|-----------|------|-------|----------|
| `<IconButton>` | `components/IconButton.vue` | `label` (required), `variant?: 'default'\|'saved'\|'danger'`, `active?`, `disabled?` | Icon-only button (save, pin, delete, expand, close). Wraps SVG as slot content. Tự động ép `type="button"`, `p-1.5`, `rounded-lg`, và `aria-label`. |
| `<ConfirmInline>` | `components/ConfirmInline.vue` | `message?`, `confirmLabel?`, `cancelLabel?`, `variant?: 'danger'\|'default'` | Inline confirm row thay `window.confirm()`. Destructive ở rìa. Emit `confirm` / `cancel`. |
| `<OverflowMenu>` | `components/OverflowMenu.vue` | `label?`, `align?: 'left'\|'right'` | Dropdown menu 3-dots với click-outside. Slot `#actions` chứa các action item. |

### Form Components

| Component | File | Props | Dùng khi |
|-----------|------|-------|----------|
| `<FormField>` | `components/FormField.vue` | `label?`, `hint?`, `error?` | Wrapper label+control+hint/error. Slot `#default="{ fieldId, describedBy }"` để binding id/aria. Label dùng `label` utility. |
| `<ToggleSwitch>` | `components/ToggleSwitch.vue` | `v-model:modelValue`, `label?`, `disabled?` | On/off toggle (SettingsView). Gói pattern `sr-only peer`. |
| `<Checkbox>` | `components/Checkbox.vue` | `v-model:modelValue`, `label?`, `disabled?` | Checkbox với label và a11y. Dùng `checkbox` utility. |
| `<RadioGroup>` | `components/RadioGroup.vue` | `v-model:modelValue`, `label?`, `options: RadioOption[]`, `disabled?`, `name?` | Nhóm radio button với legend. Dùng `radio` utility. |

### Form Utilities (`assets/main.css`)

| Utility | Dùng khi |
|---------|----------|
| `label` | Form label chuẩn: `text-xs font-medium text-(--color-text-secondary)` |
| `checkbox` | Checkbox token-based với focus ring, checkmark SVG |
| `radio` | Radio button token-based với radial-gradient checked |
| `select` | Select có styled arrow, kế thừa `input` tokens |
| `input-range` | Range slider (thay `.input-range` cũ)
