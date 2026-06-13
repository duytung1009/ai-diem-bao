# F41 — Kho Kiến thức chung (Global Knowledge Store) + Q&A trên kho

## Overview

Hiện `KnowledgeEntry` sống bên trong từng `CachedTopic` (`knowledgeEntries`/`knowledgeChunks`) → chết theo topic, không tái sử dụng xuyên chủ đề. Knowledge extract ra nhiều, nhiễu, trùng lặp; user phải lọc thủ công trong từng topic.

Feature này tách knowledge thành **một kho global độc lập** (IndexedDB store riêng, sống ngoài vòng đời topic). Mỗi lần extract một topic, entries được **insert vào kho với cross-topic dedup/merge** thay vì lưu vào cache topic. Phần "Sổ tay" trở thành 3 tab: **Sổ tay** (canon user chắt lọc), **Hỏi đáp** (retrieve trên kho global), **Kiến thức** (toàn bộ kho global).

Triết lý: Kiến thức là **haystack tra cứu** — không curate thủ công, chỉ dedup lúc insert. Retrieval (keyword scoring client-side) mới là thứ lọc. Curation thủ công dồn hết về Sổ tay.

## Goals

- Kho knowledge global độc lập với `CachedTopic`, sống sót khi topic bị xóa.
- Extraction ghi vào kho global qua cross-topic dedup/merge → kho "đặc", không loãng.
- Notebook section có 3 tab: Sổ tay / Hỏi đáp / Kiến thức (global).
- Q&A retrieve từ kho global Kiến thức (coverage rộng), chi phí API chặn bởi `TOP_K`.
- Nút "ghim vào Sổ tay" trực tiếp từ tab Kiến thức.
- Type reserve sẵn field `vector?` để Phase 2 thêm embeddings không cần migration schema.

## Requirements

### Data Model (lib/types.ts)

- **`GlobalKnowledgeEntry`** — type mới cho kho global:
  - `id: string`
  - `title: string`, `content: string`, `tags: string[]`, `category?: string`
  - `sources: KnowledgeSource[]` — **mảng** (thay `source` đơn của `KnowledgeEntry`) để gộp nhiều nguồn khi merge xuyên topic. `KnowledgeSource = { topicUrl, topicTitle, author, postNumber, timestamp? }`
  - `topicRefs: string[]` — danh sách `topicUrl` đã đóng góp vào entry (cho view lọc "Kiến thức của topic này")
  - `extractedAt: number`, `updatedAt: number`
  - `mergedCount?: number` — số lần entry này được merge thêm nguồn (tín hiệu độ "phổ biến"/tin cậy)
  - `vector?: number[]` — **reserve cho Phase 2 embeddings**, optional, chưa dùng ở F41
- Giữ `KnowledgeEntry` cũ (per-chunk extract output) — đầu ra của LLM vẫn là `KnowledgeEntry[]`, rồi map sang `GlobalKnowledgeEntry` khi insert vào kho.

### Cache Layer (lib/cache-db.ts, lib/cache-manager.ts)

- `cache-db.ts`: object store mới `knowledge` (keyPath `id`), index theo `updatedAt`. Bump DB version + `onupgradeneeded` tạo store.
- `cache-manager.ts`: API public:
  - `getAllKnowledge(): Promise<GlobalKnowledgeEntry[]>`
  - `upsertKnowledgeEntry(entry)`, `deleteKnowledgeEntry(id)`
  - `insertWithDedup(newEntries: KnowledgeEntry[], topic: {url,title}): Promise<{inserted, merged}>` — đường vào chính từ extraction
- Migration: backfill kho global từ `CachedTopic.knowledgeEntries` hiện có (one-shot, idempotent). Sau migration, per-topic `knowledgeEntries` có thể giữ để backward-compat đọc cũ hoặc đánh dấu deprecated.

### Cross-topic Dedup/Merge (lib/knowledge-merge.ts — module mới)

- `insertWithDedup` logic:
  1. Với mỗi entry mới, tính **candidate match** trong kho bằng keyword similarity trên `title` + `content` (tái dụng `tokenize`/`scoreEntry` style từ `useNotebookQA.ts`, tách thành util dùng chung).
  2. Nếu similarity ≥ ngưỡng `MERGE_THRESHOLD` → **merge**: append `sources`, union `tags`, `topicRefs`, tăng `mergedCount`, cập nhật `updatedAt`. Giữ `content` bản dài hơn (hoặc bản mới nếu giàu hơn).
  3. Nếu không có match → **insert** entry mới.
- Dedup thuần client-side (0 API call) ở F41. LLM-based merge để ngỏ (Decision 2).

### Q&A trên kho global (composables/useNotebookQA.ts → tổng quát hóa)

- Q&A retrieve từ `getAllKnowledge()` thay vì notebook entries.
- Tái dụng pipeline hiện tại: `scoreEntry` client-side → `TOP_K=30` → `answerFromNotebook` (đổi tên thành `answerFromKnowledge` hoặc giữ, generalize input type). Chi phí vẫn chặn bởi `TOP_K`, threshold 20 → tối đa 2 call.
- Citation `[n]` map sang `GlobalKnowledgeEntry` (provenance hiển thị nguồn topic).

### Navigation / UI (NotebookView.vue + App.vue)

- Notebook section: 3 sub-tab **Sổ tay / Hỏi đáp / Kiến thức**.
- Tab **Kiến thức** (global): list entries, search, filter theo category/tag/topic, hiển thị `mergedCount`/số nguồn. Mỗi entry có nút **⭐ ghim vào Sổ tay**.
- Per-topic Knowledge view cũ (route `/knowledge`): chuyển thành **view lọc kho global theo `topicRefs`** (hiển thị knowledge của riêng topic đang mở), action "Trích xuất" vẫn ở đây.

### Pin to Notebook

- Nút ⭐ ở tab Kiến thức → tạo `NotebookEntry` từ `GlobalKnowledgeEntry` (map `sources[0]` → `source`, set `savedAt`, `sourceTopicUrl/Title`). Idempotent (đã ghim thì disable).

## Technical Considerations

- **Affected files:** `lib/types.ts`, `lib/cache-db.ts`, `lib/cache-manager.ts`, `lib/knowledge-merge.ts` (mới), `lib/llm/summarizer.ts` (Q&A generalize), `composables/useNotebookQA.ts`, `composables/useKnowledge.ts` (extract → ghi global), `views/NotebookView.vue`, `views/KnowledgeView.vue`, `App.vue`, `lib/exporter.ts`, `entrypoints/background/index.ts` (message handlers cho knowledge store).
- **Chi phí Q&A:** chặn bởi `TOP_K`, không tăng theo kích thước kho. Rủi ro thật = recall keyword + trùng lặp nghẽn TOP_K → dedup (knowledge-merge) là mitigation chính.
- **Provenance:** `sources[]` + `topicRefs[]` phải sống độc lập với topic; xóa topic KHÔNG xóa knowledge entry.
- **Embeddings Phase 2:** field `vector?` optional từ đầu → backfill sau không cần migration schema. Hybrid keyword+semantic, không thay thế keyword.
- **Migration:** one-shot backfill từ per-topic `knowledgeEntries`. Phải idempotent (chạy lại không nhân đôi) — dùng dedup chính khi backfill.
- **Edge cases:** kho rỗng (Q&A báo "chưa có kiến thức"); entry mọi nguồn cùng topic re-extract (không nhân bản — dedup theo nội dung); xóa topic → knowledge giữ nguyên nhưng `topicRefs` có thể chứa url đã xóa (chấp nhận, hoặc dọn lazy).
- **Constraints:** giữ permission tối thiểu (không thêm gì); IndexedDB store mới qua `onupgradeneeded` an toàn với DB cũ.

## Implementation Notes

- Thứ tự ưu tiên: (1) Data model + cache store + migration → (2) knowledge-merge dedup → (3) extraction ghi global → (4) Q&A trên global → (5) UI 3 tab + pin-to-notebook → (6) per-topic view lọc + exporter.
- Tách `tokenize`/keyword-similarity thành util dùng chung (`lib/text-similarity.ts`?) để dedup và Q&A scoring dùng chung, tránh trùng code với `useNotebookQA.ts`.
- Q&A: ưu tiên generalize type input (`NotebookEntryForQA` → interface chung) thay vì viết pipeline mới.
- Mọi thao tác IndexedDB từ sidepanel đi qua `sendMessage` tới background (theo KH/architecture hiện tại) — thêm message types cho knowledge store.

## Test Plan

- **Dedup:** extract 2 topic cùng chủ đề → kho không nhân đôi entry trùng; `sources`/`topicRefs` gộp đúng; `mergedCount` tăng.
- **Independence:** xóa topic → knowledge entry vẫn còn trong kho.
- **Q&A cost:** kho >20 entry → confirm 2 call; kho ≤20 → 1 call; kho 1000 entry vẫn chỉ gửi ~30 entry cho LLM (assert qua mock).
- **Migration:** chạy backfill 2 lần → không nhân đôi (idempotent).
- **Pin:** ⭐ từ Kiến thức → xuất hiện trong Sổ tay; ghim lại bị disable.
- **Empty:** kho rỗng → Q&A báo trạng thái trống, không gọi LLM.
- `npm run compile` + `npm run test` clean.

## Decision Log

### Quyết định 1: Q&A retrieve từ kho Kiến thức global (không phải Sổ tay)
- **Đã chọn:** Q&A query trên global Knowledge store (Option A).
- **Lý do:** coverage rộng đúng mục tiêu "sổ tay luôn có kiến thức relevant, tham chiếu từ kho tổng hợp". Chi phí API vẫn chặn bởi `TOP_K` nên kho lớn không làm tăng tiền.
- **Đã cân nhắc nhưng loại:**
  - Option B (Q&A trên Sổ tay) — loại vì coverage hẹp, không khai thác kho tổng hợp.
  - Option C (hybrid Sổ tay + Kiến thức) — loại ở F41 vì phức tạp; có thể nâng cấp sau khi dedup ổn.
- **Điều kiện thay đổi:** nếu dedup không đủ tốt → kho nhiễu làm Q&A kém → cân nhắc fallback B hoặc nâng lên C.

### Quyết định 2: Dedup/merge thuần client-side (keyword), LLM-merge để ngỏ
- **Đã chọn:** dedup bằng keyword similarity client-side lúc insert (0 API call).
- **Lý do:** rẻ, đủ tốt cho phần lớn trùng lặp hiển nhiên; giữ insert nhanh, không phụ thuộc LLM.
- **Đã cân nhắc nhưng loại:** LLM-based semantic merge mỗi insert — loại vì tốn API call mỗi lần extract, chậm.
- **Điều kiện thay đổi:** nếu trùng lặp tinh vi (diễn đạt khác) lọt qua keyword nhiều → thêm LLM-merge cho cặp near-threshold, hoặc đợi Phase 2 embeddings.

### Quyết định 3: Embeddings (semantic retrieval) để Phase 2
- **Đã chọn:** F41 dùng keyword retrieval; reserve field `vector?: number[]` optional.
- **Lý do:** (1) phân mảnh provider — Claude không có embedding API, phá mô hình "1 provider"; (2) keyword đủ cho corpus bounded của 1 user; (3) cần validate kiến trúc global-store + dedup trước.
- **Đã cân nhắc nhưng loại:** làm embeddings ngay — loại vì kéo theo config provider embedding riêng + migration phức tạp trước khi kiến trúc nền được kiểm chứng.
- **Điều kiện thay đổi:** recall keyword tụt rõ ở kho lớn → Phase 2: hybrid keyword+semantic, backfill `vector` (không cần migration schema nhờ field đã reserve).

### Quyết định 4: Knowledge store độc lập với CachedTopic
- **Đã chọn:** IndexedDB object store riêng `knowledge`, entry sống sót khi topic bị xóa.
- **Lý do:** cả mục đích feature là persist knowledge để tra cứu xuyên thời gian/chủ đề.
- **Đã cân nhắc nhưng loại:** giữ knowledge trong `CachedTopic` — loại vì chết theo topic, không gộp xuyên topic được.
- **Điều kiện thay đổi:** không (nền tảng của feature).

### Quyết định 5: `source` đơn → `sources[]` mảng
- **Đã chọn:** `GlobalKnowledgeEntry.sources: KnowledgeSource[]` + `topicRefs[]`.
- **Lý do:** merge xuyên topic phải gộp nhiều nguồn mà không mất provenance; `topicRefs` cho view lọc per-topic.
- **Đã cân nhắc nhưng loại:** giữ `source` đơn — loại vì merge sẽ mất nguồn cũ.
- **Điều kiện thay đổi:** không.
