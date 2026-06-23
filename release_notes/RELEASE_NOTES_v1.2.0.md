# v1.2.0

## 📰 Bảng tin — mô tả thread tức thì do AI tạo

Bảng tin giờ cho phép xem tóm tắt nội dung thread ngay tại chỗ mà không cần mở tab mới.

- **Mô tả thread do AI tạo** — bấm vào thread trong Bảng tin để xem mô tả ngắn gọn được tóm tắt từ bài đăng đầu tiên của OP. Với thread tin tức, AI ưu tiên trích xuất từ blockquote bài báo gốc (chính xác hơn phần bình luận của người đăng).
- **Cache mô tả tự động** — mô tả được lưu lại sau lần đầu tạo; lần sau mở Bảng tin hiển thị ngay, không gọi thêm API.
- **Tóm tắt nhanh từ danh sách** — click vào thread trong Bảng tin tự động chọn topic và chuyển thẳng sang tab Tóm tắt, không cần mở thread trước.

→ Đọc lướt nội dung nhiều thread và bắt đầu tóm tắt mà không cần rời khỏi Bảng tin.

## ✨ Khác

- **SegmentGrid — component dùng chung (F44)** — giao diện danh sách phân đoạn (segment) ở tab Tóm tắt và Kiến thức giờ dùng cùng một component (`SegmentGrid.vue`), xóa ~300 dòng markup trùng lặp và chuẩn hóa hiển thị trạng thái, thanh tiến trình, và các nút hành động giữa hai view.
- **Settings — cải thiện accessibility** — các trường nhập liệu (API Key, Base URL, Model) giờ có liên kết `label`/`id` đúng chuẩn, cải thiện điều hướng bàn phím và hỗ trợ screen reader.

---

**Full Changelog**: https://github.com/duytung1009/ai-diem-bao/compare/v1.1.2...v1.2.0
