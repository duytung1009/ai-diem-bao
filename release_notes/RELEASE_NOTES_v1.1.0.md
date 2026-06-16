# v1.1.0

## 🧠 Kho Kiến thức + Hỏi đáp xuyên thớt (F40 + F41)

Sổ tay giờ có 3 tab: **Sổ tay / Hỏi đáp / Kiến thức**.

- **Kho Kiến thức global** — độc lập với từng thớt (`CachedTopic`). Kiến thức trích xuất từ nhiều thớt khác nhau tự động gom vào một kho dùng chung, **gộp các mục trùng ý** (cross-topic dedup/merge) và đếm số nguồn.
- **Hỏi đáp xuyên thớt** — đặt câu hỏi, hệ thống tra trên toàn bộ kho (không chỉ 1 thớt), trả lời kèm trích dẫn `[n]` link trực tiếp tới nguồn.
- **Sổ tay nâng cấp:**
  - Category manager — gán/đổi/xóa danh mục cho ghi chú
  - Bulk actions — chọn nhiều ghi chú, gắn tag/danh mục/xóa hàng loạt
  - Tạo ghi chú thủ công (không cần từ LLM extract)
  - **Lưu câu trả lời Hỏi đáp thành ghi chú riêng** — loại entry mới (badge `💬 Hỏi đáp`), giữ nguyên trích dẫn nguồn, tách biệt với ghi chú tự tạo
  - Pin kiến thức từ kho global vào Sổ tay
  - Xóa entry trực tiếp trong kho Kiến thức global

## 🔍 Nâng cấp tìm kiếm — BM25 lexical retrieval (F42)

Khi kho Kiến thức vượt 30 mục, Hỏi đáp giờ dùng **BM25F-lite** thay keyword scoring thô:

- IDF (term hiếm được ưu tiên hơn term phổ biến)
- TF saturation + length normalization (không bias entry dài)
- Field boost (khớp ở tiêu đề > tag/danh mục > nội dung)
- Lọc stopword tiếng Việt — giảm nhiễu từ "của", "là", "và", "có"...
- Exact-token match — loại false positive kiểu "ca" khớp nhầm "café"

→ Recall tốt hơn cho câu hỏi diễn đạt khác với lúc lưu kiến thức, vẫn 100% client-side, không phụ thuộc provider.

## ✨ Khác

- **Top React (F39)** — hiển thị reaction nổi bật nhất mỗi bài viết trong tóm tắt
- **News Feed** — thêm luồng đọc tin tức tích hợp
- **Design System + Common Components** — chuẩn hóa token màu/spacing, component dùng chung (`IconButton`, `ConfirmInline`, `OverflowMenu`, `FormField`, `ToggleSwitch`, `Checkbox`, `RadioGroup`), ESLint rule enforce design token + a11y
- Cập nhật LLM provider config
- Fix lỗi fetch thread bị khóa (locked thread)
- Nhiều fix nhỏ cho Knowledge/Notebook flow

## 🐛 Fixes

- Sửa lỗi tóm tắt (summarize bugs) phát hiện trong quá trình thêm News Feed
- Sửa nhiều vấn đề UI/UX trong luồng Knowledge + Notebook trước khi hoàn thiện F40/F41

---

**Full Changelog**: https://github.com/duytung1009/ai-diem-bao/compare/v1.0.0...v1.1.0
