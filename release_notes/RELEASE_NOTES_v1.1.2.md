# v1.1.2

## ✨ Đồng bộ trạng thái rỗng + gộp build hai trình duyệt

Bản này dọn lại giao diện các màn hình "chưa có dữ liệu" cho nhất quán và đơn giản hoá quy trình đóng gói.

- **Thêm component `EmptyState` dùng chung** — gom mọi trạng thái rỗng / chưa chọn thớt về một chuẩn hiển thị (icon, tiêu đề, mô tả, vùng nút hành động). Áp dụng cho Tóm tắt, Kiến thức, Phân tích, Tra cứu, Sổ tay, Bảng tin và Danh sách thớt.
- **Giao diện trạng thái rỗng đồng nhất hơn** — mỗi màn hình giờ có icon và tiêu đề rõ ràng thay vì một dòng chữ xám trơ trọi. Ví dụ "Chưa chọn thớt" 🧵, "Chưa có thớt nổi bật" 📰, "Chưa có ghi chú nào" 📝.
- **Cải thiện trạng thái rỗng của Sổ tay** — gợi ý rõ hai cách tạo ghi chú (lưu ⭐ từ tab Kiến thức, hoặc tổng hợp từ tab Hỏi đáp) kèm nút đi thẳng đến Hỏi đáp.
- **Bỏ dòng "Chưa có tóm tắt/phân tích" thừa** — khi chưa có nội dung, chỉ hiển thị thẳng nút tạo cho gọn.
- **Sửa lỗi null pointer ở màn Phân tích** — thanh hành động (`ContentActions`) trước đây vẫn render khi chưa có kết quả phân tích, gọi `formatAnalysisAsText(threadAnalysis!, …)` trên giá trị `null` và gây lỗi. Giờ chỉ render khi đã có phân tích, loại bỏ ép kiểu non-null thiếu an toàn.
- **Gộp lệnh build & zip cho cả Chrome và Firefox** — `npm run build` và `npm run zip` giờ tự đóng gói cả hai trình duyệt trong một lần chạy, không cần lệnh `:firefox` riêng.

→ Trải nghiệm các màn hình rỗng gọn gàng, nhất quán hơn; quy trình release đơn giản hơn.

---

**Full Changelog**: https://github.com/duytung1009/ai-diem-bao/compare/v1.1.1...v1.1.2
