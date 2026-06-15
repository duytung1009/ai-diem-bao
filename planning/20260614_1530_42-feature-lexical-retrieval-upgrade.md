# F42 — Nâng cấp Lexical Retrieval cho kho Kiến thức (BM25 + stopword tiếng Việt)

## Overview

Q&A trên kho Kiến thức global (F41) hiện retrieve TOP_K=30 entry bằng keyword scoring thô
(`scoreEntryByTokens` trong `lib/text-similarity.ts`): substring match + trọng số field cố định,
không có IDF, không length-normalize, không lọc stopword. Khi kho phình to và câu hỏi diễn đạt
lệch với lúc lưu, recall tụt — đúng điểm yếu cố hữu của lexical thô.

Đây là **Bước 1** trong lộ trình cải thiện retrieval (Bước 2 = hybrid embeddings, defer Phase 2 vì
rào cản provider — Claude không có embedding API). Bước 1 nâng chất lượng retrieval **mà vẫn 100%
client-side, không phụ thuộc provider**, ROI cao nhất trước khi cân nhắc embeddings.

Mục tiêu: thay keyword scoring thô bằng **BM25F-lite** (TF saturation + length normalization +
field boost) + lọc stopword tiếng Việt + (tùy chọn) query expansion nhẹ, giữ nguyên cơ chế bound
cost (TOP_K=30, QA_DIRECT_THRESHOLD=20).

## Goals

- Tăng recall cho câu hỏi paraphrase/đồng nghĩa mà keyword thô đang trượt (đo bằng bộ truy vấn thủ công).
- Giảm nhiễu do stopword tiếng Việt ("của", "là", "và", "có"...) làm phồng điểm.
- Giảm bias theo độ dài entry (length normalization).
- Không phụ thuộc provider embedding — chạy hoàn toàn client-side, đồng nhất cả 3 adapter.
- Không tăng latency đáng kể: BM25 trên vài trăm–vài nghìn entry < 5ms.
- Không phá vỡ dedup/merge hiện tại (`insertWithDedup`) và không đổi cost-bound của Q&A.

## Requirements

### Module mới: `lib/lexical-search.ts`

- `tokenizeForSearch(text): string[]` — dùng lại `tokenize()` của `text-similarity.ts` rồi lọc qua
  stopword list. Tách riêng để **không đụng** `tokenize()` mà dedup đang dùng.
- `buildBm25Index(docs)` — corpus nhỏ, build in-memory: document frequency (df) mỗi term, độ dài
  trung bình doc, token theo từng field (title / content / tags / category / userNote).
- `scoreBm25(queryTokens, doc, index, opts)` — BM25F-lite:
  - IDF từ df của corpus candidate hiện tại.
  - TF saturation (`k1`), length normalization (`b`).
  - Field boost: title > tags/category > content > userNote (giữ tinh thần trọng số 3/2/2/1/1 cũ).
  - **Exact token match** thay cho `w.includes(qt) || qt.includes(w)` (substring gây false positive
    kiểu "ca" khớp "café"/"canh"). Giữ một guard prefix-match trọng số thấp là tùy chọn.
- `rankBm25(question, docs, opts): {doc, score}[]` — API cấp cao trả danh sách đã xếp hạng, để
  `useNotebookQA` thay vòng `scoreNotebookEntry`.

### Module mới: `lib/stopwords-vi.ts`

- `STOPWORDS_VI: Set<string>` — danh sách stopword tiếng Việt phổ biến (function words, đại từ,
  liên từ, giới từ) + vài stopword tiếng Anh hay lẫn trong forum.
- Giữ gọn, có chú thích nguồn; không over-aggressive (tránh lọc nhầm từ mang nghĩa).

### Module (tùy chọn): `lib/synonyms-vi.ts`

- `expandQueryTokens(tokens): string[]` — seed map nhỏ các biến thể tiếng Việt phổ biến
  (vd "xe máy"↔"mô tô", "điện thoại"↔"đt"). Cố ý nhỏ, dễ tắt/mở rộng; tránh overfit.
- Có flag bật/tắt; nếu rủi ro thì để pha sau, không block phần BM25 lõi.

### Tích hợp: `entrypoints/sidepanel/composables/useNotebookQA.ts`

- Thay nhánh scoring (`projected.length > TOP_K` → `scoreNotebookEntry`) bằng `rankBm25`.
- Giữ nguyên: `TOP_K=30`, `QA_DIRECT_THRESHOLD=20`, fallback "không có điểm → gửi toàn bộ" khi corpus ≤ TOP_K.
- Build index một lần mỗi câu hỏi từ tập `NotebookEntryForQA` đang có.

### Giữ nguyên (Phase 1): `lib/knowledge-merge.ts`

- Dedup tiếp tục dùng `jaccardSimilarity` + `tokenize` thô (KHÔNG đổi `MERGE_THRESHOLD`).
- Lý do: dedup là bài toán phát hiện trùng (đối xứng), khác relevance ranking; đổi tokenizer sẽ buộc
  re-tune threshold → rủi ro. Nâng dedup bằng IDF-weighting là **follow-up tùy chọn**, không thuộc F42.

## Technical Considerations

- **Affected files:** mới `lib/lexical-search.ts`, `lib/stopwords-vi.ts`, (tùy chọn) `lib/synonyms-vi.ts`;
  sửa `useNotebookQA.ts`; có thể re-export tiện ích từ `text-similarity.ts`.
- **Không đụng:** `knowledge-merge.ts`, `MERGE_THRESHOLD`, `text-similarity.tokenize()` (dedup phụ thuộc).
- **Cost-bound:** TOP_K + QA_DIRECT_THRESHOLD giữ nguyên → số LLM call không đổi; chỉ thay khâu chọn TOP_K.
- **Perf:** corpus cá nhân nhỏ → build index + BM25 brute-force trong JS là đủ, không cần ANN/vector DB.
- **Edge cases:** corpus rỗng/1 entry; câu hỏi toàn stopword (sau lọc rỗng → fallback gửi toàn bộ như cũ);
  entry thiếu content/tags; tiếng Việt có dấu vs không dấu (cân nhắc, nhưng tránh normalize dấu ở Phase 1
  vì dễ gây nhập nhằng — ghi vào Decision Log).
- **Backward compat:** thuần in-memory, không đổi schema IndexedDB, không migration.

## Implementation Notes

- Bắt đầu bằng `lib/lexical-search.ts` + `stopwords-vi.ts` thuần (không UI), viết unit test trước khi wire.
- BM25 tham số khởi điểm: `k1=1.2`, `b=0.75`; field boost title≈3, tags/category≈2, content≈1, note≈1.
- Giữ `scoreEntryByTokens`/`scoreNotebookEntry` cũ lại tạm thời (không xóa) đến khi BM25 verified, để
  dễ so sánh; xóa ở subtask Self-review nếu không còn ai dùng.
- Wire `useNotebookQA` cuối cùng, chạy lại `tests/unit/use-knowledge-helpers.test.ts` để bắt regression.

## Test Plan

- **Unit (`tests/unit/lexical-search.test.ts`):**
  - Stopword filtering loại đúng function words, giữ từ nội dung.
  - IDF: term hiếm xếp hạng cao hơn term phổ biến khi cùng tần suất.
  - Length normalization: entry ngắn khớp đúng không bị entry dài "nuốt" chỉ vì dài.
  - Field boost: trùng ở title xếp trên trùng ở content.
  - Exact-token: "ca" KHÔNG khớp "café"/"canh" (xác nhận hết false positive substring cũ).
  - Fallback: query rỗng sau lọc / corpus ≤ TOP_K → trả toàn bộ.
- **Regression:** `use-knowledge-helpers.test.ts` vẫn pass; `npm run compile` sạch.
- **Thủ công:** bộ ~5–10 câu hỏi paraphrase hiện đang trượt → kiểm tra entry đúng lọt TOP_K sau nâng cấp.

## Decision Log

### Quyết định 1: BM25F-lite thay vì TF-IDF cosine hay giữ keyword thô
- **Đã chọn:** BM25F-lite (TF saturation + length norm + field boost).
- **Lý do:** BM25 mạnh nhất cho truy vấn ngắn (đúng dạng câu hỏi Q&A), saturates TF tránh spam từ,
  length-normalize tránh bias entry dài; là chuẩn IR phổ biến, dễ test.
- **Đã cân nhắc nhưng loại:** TF-IDF cosine (ổn nhưng kém BM25 với query ngắn); giữ keyword thô (recall không đủ);
  pure embeddings (Bước 2, defer Phase 2 vì rào cản provider — Claude no embedding API).
- **Điều kiện thay đổi:** nếu sau Bước 1 vẫn miss nhiều paraphrase/đồng nghĩa → kích hoạt Bước 2 hybrid embeddings.

### Quyết định 2: Exact-token match thay cho substring
- **Đã chọn:** exact token sau tokenize+stopword; bỏ `w.includes(qt) || qt.includes(w)`.
- **Lý do:** substring gây false positive (vd "ca" khớp "café"/"canh"), nhiễu điểm.
- **Đã cân nhắc nhưng loại:** giữ substring trọng số thấp — phức tạp, lợi ích mờ. Bù phần partial-match bằng synonym map nếu cần.
- **Điều kiện thay đổi:** nếu mất recall ở từ ghép tiếng Việt → thêm prefix-match guard trọng số thấp.

### Quyết định 3: Tách `tokenizeForSearch`, KHÔNG đổi tokenizer của dedup
- **Đã chọn:** stopword filtering chỉ áp cho đường search (BM25); dedup (`knowledge-merge`) giữ `tokenize` thô + `MERGE_THRESHOLD` cũ.
- **Lý do:** đổi tokenizer dedup buộc re-tune threshold → rủi ro phá hành vi gộp đã ổn định.
- **Đã cân nhắc nhưng loại:** dùng chung một tokenizer đã lọc stopword cho cả hai — gọn hơn nhưng phải re-tune dedup.
- **Điều kiện thay đổi:** khi nâng dedup (follow-up) → cân nhắc IDF-weighting + stopword cho cả dedup, re-tune threshold có chủ đích.

### Quyết định 4: Query expansion (synonym) là tùy chọn, seed nhỏ
- **Đã chọn:** map đồng nghĩa tiếng Việt nhỏ, tách module riêng, có flag; có thể defer.
- **Lý do:** lợi ích thật cho paraphrase nhưng dễ overfit/nhiễu nếu map to; tách riêng để dễ tắt.
- **Đã cân nhắc nhưng loại:** không làm gì (mất một phần recall paraphrase); map lớn tĩnh (bảo trì nặng, dễ nhiễu).
- **Điều kiện thay đổi:** nếu Bước 2 embeddings vào → synonym map gần như thừa, có thể bỏ.

### Quyết định 5: Không normalize dấu tiếng Việt ở Phase 1
- **Đã chọn:** giữ nguyên dấu; không fold "có không dấu".
- **Lý do:** bỏ dấu gây nhập nhằng nghĩa (vd "ma"/"má"/"mà"); rủi ro cao hơn lợi ích cho kho cá nhân.
- **Điều kiện thay đổi:** nếu thực tế nhiều câu hỏi gõ không dấu → cân nhắc accent-insensitive fallback có trọng số thấp.

### Quyết định 6: 100% client-side, không thêm phụ thuộc provider
- **Đã chọn:** toàn bộ Bước 1 chạy in-browser, không gọi API embedding.
- **Lý do:** đây là lý do tồn tại của Bước 1 — nâng chất lượng mà giữ đồng nhất 3 adapter (kể cả Claude-only).
- **Điều kiện thay đổi:** không — ràng buộc cứng của Phase 1.
