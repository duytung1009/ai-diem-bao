# Task: Cải thiện CHUNK_SUMMARY_PROMPT và REDUCE_SUMMARY_PROMPT

Ngày: 2026-03-21

## Vấn đề

`CHUNK_SUMMARY_PROMPT` (map phase) quá lỏng lẻo:
- "Markdown tự do, không cần cấu trúc cố định" → mỗi chunk output format khác nhau
- 200 từ quá ngắn → mất tên tác giả, số người ủng hộ
- "Liệt kê quan điểm (nếu có)" → LLM thường bỏ qua

Hệ quả: `REDUCE_SUMMARY_PROMPT` nhận input hỗn loạn → output thiếu section "Quan điểm nổi bật" + "Kết luận".

## Thay đổi

### File: `lib/prompts.ts`

**CHUNK_SUMMARY_PROMPT:**
- 200 → 300 từ
- Free-form → 3 sections cố định: "Nội dung chính", "Quan điểm và tác giả", "Điểm đáng chú ý"
- Thêm: "BẮT BUỘC giữ tên tác giả khi đề cập quan điểm"
- Thêm: "BẮT BUỘC tuân theo format sau"

**REDUCE_SUMMARY_PROMPT:**
- Mô tả input format rõ ràng: "mỗi phần có mục Nội dung chính, Quan điểm và tác giả, Điểm đáng chú ý"
- Hướng dẫn gộp: "Gộp các tác giả cùng quan điểm vào một nhóm, đếm tổng số người ủng hộ"
- N, M giải thích rõ: "đếm từ danh sách tác giả trong các bản tóm tắt từng phần"
- Kết luận: thêm "Nếu các ý kiến đối lập nhau, tóm tắt điểm bất đồng chính"

### File: `docs/architecture/summarization.md` (TẠO MỚI)

Tài liệu kiến trúc cơ chế tóm tắt: pipeline map-reduce, các mode (normal/segment/incremental), chunking strategy, token estimation, custom prompts.

### File: `docs/README.md`

Thêm entry cho `summarization.md` vào mục lục.

## Verification

- `npx vue-tsc --noEmit` → pass
- Không thay đổi code logic, chỉ thay nội dung string prompts
