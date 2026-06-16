# v1.1.1

## 🦊 Sửa lỗi tương thích Firefox

Bản trước build trên Firefox bị lỗi cấp quyền và lưu Settings không chạy được. Bản này vá toàn bộ các điểm khác biệt nền tảng giữa Chrome và Firefox:

- **Sửa build Firefox bị rớt về Manifest V2** — khiến `optional_host_permissions` (key chỉ tồn tại ở MV3) bị loại khỏi manifest, làm mọi yêu cầu cấp quyền (`permissions.request`) trên Firefox luôn thất bại. Ép build Firefox dùng MV3 (Firefox 128+ đã hỗ trợ đầy đủ).
- **Sửa lỗi mất quyền do thao tác người dùng (user-activation)** — luồng Lưu/Kiểm tra kết nối ở Cài đặt kiểm tra quyền trước khi xin quyền, khiến Firefox coi yêu cầu không còn xuất phát từ thao tác click của người dùng và từ chối. Giờ xin quyền ngay lập tức, không qua bước kiểm tra dư.
- **Sửa lỗi `DataCloneError` khi lưu Settings** — dữ liệu cấu hình (reactive object của Vue) bị Firefox từ chối sao chép khi gửi qua nội bộ extension. Giờ luôn chuyển về dữ liệu thuần (plain object) trước khi gửi.
- **Bổ sung khai báo `data_collection_permissions`** — yêu cầu bắt buộc mới của Firefox Add-on store, khai báo rõ extension không thu thập dữ liệu nào (đúng tinh thần lưu local-only, tự mang API key).

→ Cài đặt provider, lưu/kiểm tra kết nối, và thêm forum hỗ trợ giờ hoạt động ổn định trên cả Chrome và Firefox.

---

**Full Changelog**: https://github.com/duytung1009/ai-diem-bao/compare/v1.1.0...v1.1.1
