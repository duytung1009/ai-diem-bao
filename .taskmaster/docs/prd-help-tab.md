# PRD: Tab Hướng dẫn sử dụng — Onboarding Guide

## Context

Extension hiện tại không có tài liệu hướng dẫn người dùng mới. Người dùng cần tự khám phá cách setup LLM provider, cách sử dụng flow tóm tắt, và các tính năng sau tóm tắt. Việc thiếu hướng dẫn gây khó khăn cho onboarding, đặc biệt với các case phổ biến:
- Setup Gemini API Free Tier từ Google AI Studio (miễn phí)
- Setup Local LLM qua LM Studio / Ollama (chạy offline, privacy)
- Flow tóm tắt: xem chủ đề → chọn → tóm tắt
- Tính năng sau tóm tắt: tổng hợp kiến thức, tra cứu

Mục tiêu: Tạo tab "Hướng dẫn" với nội dung text-only, chia thành các step cụ thể, dễ làm theo.

## Goals

1. Người dùng mới có thể setup LLM provider trong 5 phút mà không cần đọc docs bên ngoài
2. Hướng dẫn flow tóm tắt rõ ràng, step-by-step
3. Giới thiệu tính năng sau tóm tắt (kiến thức, tra cứu)
4. Truy cập dễ dàng qua button `?` cạnh tab Cài đặt

## Non-Goals

- Không thêm screenshots (giữ nhẹ, dễ maintain)
- Không thay đổi logic business hiện tại
- Không thêm tính năng mới ngoài tab hướng dẫn
- Không thay đổi routing logic hiện tại (chỉ thêm route mới)

---

## Phase 1: Create HelpView.vue Component

### Description

Tạo component `HelpView.vue` trong `entrypoints/sidepanel/views/` với nội dung hướng dẫn chia thành 3 sections chính:

1. **Setup LLM Provider** — Hướng dẫn setup BYOK (Bring Your Own Key)
2. **Flow tóm tắt** — Hướng dẫn flow cơ bản
3. **Sau tóm tắt** — Giới thiệu tính năng Knowledge và Research

### Content Structure

#### Section 1: Setup LLM Provider

**1.1 Gemini API Free Tier (Google AI Studio)**

```
Bước 1: Truy cập https://aistudio.google.com và đăng nhập tài khoản Google
Bước 2: Vào "Get API Key" → "Create API Key" → chọn project hoặc tạo mới
Bước 3: Copy API key (có dạng bắt đầu bằng "AIza...")
Bước 4: Mở extension → tab Cài đặt → chọn Provider "Google Gemini (Free Tier)"
Bước 5: Dán API key vào ô "Google AI API Key"
Bước 6: Chọn model "gemini-2.5-flash" (nhanh, đủ cho tóm tắt)
Bước 7: Nhấn "Test Connection" để kiểm tra → hiện "Kết nối thành công!" là OK
```

**1.2 Local LLM (LM Studio / Ollama)**

```
Bước 1: Cài đặt LM Studio (https://lmstudio.ai) hoặc Ollama (https://ollama.com)
Bước 2: Tải model mong muốn (VD: llama-3.1-8b, qwen2.5-7b, mistral-7b)
Bước 3: Khởi động local server:
  - LM Studio: Mở app → chọn model → nhấn "Start Server" (cổng mặc định: 1234)
  - Ollama: Chạy terminal → `ollama serve` (cổng mặc định: 11434)
Bước 4: Mở extension → tab Cài đặt → chọn Provider "Custom (OpenAI-compatible)"
Bước 5: Nhập Base URL:
  - LM Studio: http://localhost:1234/v1
  - Ollama: http://localhost:11434/v1
Bước 6: Nhập model name (VD: llama-3.1-8b, qwen2.5-7b-instruct)
Bước 7: API Key có thể để trống hoặc nhập bất kỳ (local không cần auth)
Bước 8: Nhấn "Test Connection" để kiểm tra
```

#### Section 2: Flow tóm tắt

```
Bước 1: Mở tab "Chủ đề" — hiển thị danh sách topic đã scrape từ XenForo forums
Bước 2: Duyệt danh sách, click vào topic muốn xem — extension tự động chuyển sang tab "Tóm tắt"
Bước 3: Nếu topic chưa có tóm tắt, nhấn nút "Tóm tắt" — extension sẽ:
  - Scrape nội dung topic từ forum
  - Chia thành các segments (nếu topic dài)
  - Gửi từng segment đến LLM để tóm tắt
  - Gộp kết quả thành tóm tắt hoàn chỉnh
Bước 4: Chờ kết quả hiển thị — progress bar và loading animation cho biết trạng thái
Bước 5: Sau khi hoàn thành, tóm tắt được lưu cache — lần sau mở lại không cần chạy lại
```

#### Section 3: Sau tóm tắt

**3.1 Tổng hợp kiến thức (Tab "Kiến thức")**

```
- Truy cập tab "Kiến thức" sau khi topic đã được tóm tắt
- Nhấn "Tổng hợp kiến thức" — LLM sẽ extract key points, facts, information từ toàn bộ topic
- Kết quả hiển thị dưới dạng các knowledge chunks có thể bookmark, chỉnh sửa
- Kiến thức được lưu cache cùng với topic — truy cập lại bất cứ lúc nào
```

**3.2 Tra cứu mở rộng (Tab "Tra cứu")**

```
- Truy cập tab "Tra cứu" sau khi topic đã được tóm tắt
- Nhập câu hỏi hoặc từ khóa vào ô tìm kiếm
- LLM sẽ phân tích nội dung topic và trả lời dựa trên context của thread
- Hỗ trợ hỏi đáp chi tiết về nội dung đã tóm tắt mà không cần đọc lại toàn bộ
- Lịch sử câu hỏi được lưu để tham khảo sau
```

### UI/UX Conventions

- Sử dụng Tailwind CSS classes theo conventions hiện tại: `card`, `badge`, `btn`
- Màu sắc: text dùng `--color-text-*` vars, accent dùng `--color-accent`
- Typography: section headings dùng `font-semibold`, body text dùng `text-xs`/`text-sm`
- Layout: `p-4 space-y-4` cho container chính, mỗi section trong `card`
- Code/URL: dùng `font-mono` cho các giá trị kỹ thuật (URL, API key format, model names)
- Numbered lists: dùng flex layout với số bước trong badge tròn

### Files Created

- `entrypoints/sidepanel/views/HelpView.vue`

### Acceptance Criteria

- `HelpView.vue` render được với đầy đủ 3 sections
- Nội dung text-only, không ảnh/image
- Style nhất quán với các view hiện tại (SettingsView, SummaryView)
- `npm run compile` passes với zero errors

---

## Phase 2: Add Route and Navigation Button

### Description

Thêm route `/help` vào Vue Router và button `?` trong navigation bar của `App.vue`.

### Changes Required

**2.1 Route** — `entrypoints/sidepanel/main.ts`

Thêm route mới:
```typescript
{ path: '/help', name: 'help', component: () => import('./views/HelpView.vue') },
```

**2.2 Navigation Button** — `entrypoints/sidepanel/App.vue`

Thêm button `?` cạnh tab "Cài đặt" trong nav bar:
- Position: Sau `<router-link to="/settings">`, trước đóng `</nav>`
- Style: Giống các tab khác, icon `?` thay vì text
- Active state: Highlight khi route là `help`
- Tooltip: "Hướng dẫn sử dụng"

### Files Changed

- `entrypoints/sidepanel/main.ts` — thêm route
- `entrypoints/sidepanel/App.vue` — thêm button nav

### Acceptance Criteria

- Click button `?` → navigate đến `/help`
- Button `?` highlight khi đang ở tab Hướng dẫn
- Navigation bar vẫn responsive, không bị overflow
- `npm run compile` passes với zero errors

---

## Verification Plan

Sau khi hoàn thành:

```bash
npm run compile
```

Manual testing checklist:

| Test | Expected |
|------|----------|
| Mở sidepanel → click `?` | Navigate đến tab Hướng dẫn |
| Tab Hướng dẫn hiển thị | 3 sections: Setup LLM, Flow tóm tắt, Sau tóm tắt |
| Copy-paste steps từ hướng dẫn | Làm theo được mà không cần docs ngoài |
| Click tab khác rồi quay lại `?` | Vẫn hiển thị đúng nội dung |
| `npm run compile` | Zero errors |
