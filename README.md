# 🤖 Lội Thớt Hộ

> **Cho mấy thím lười lội page.** Gom phe kháy đểu, bắt bài seeder, nhặt mẹo hay bỏ túi.  
> Lưu local, tự mang key LLM — hổng có kèm sẵn nha!

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue)
![Vue 3](https://img.shields.io/badge/Vue-3-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38bdf8)
![WXT](https://img.shields.io/badge/WXT-0.20-60a5fa)

---

*Sản phẩm của một lập trình viên cận, trĩ, nghèo, rảnh không có gì làm. Open-source 100%, không có backend thu thập dữ liệu, API key và sổ tay kiến thức lưu hoàn toàn dưới IndexedDB của trình duyệt. An tâm hóng biến không lo rò rỉ thông tin cá nhân.*

---

## Tính năng chính

### 📰 Tóm tắt thớt — Không cần lội 47 trang
Đọc toàn bộ topic (kể cả thớt kéo dài cả thập kỷ) rồi tóm lại trong vài dòng. Ý kiến nổi bật, tranh luận tâm điểm, kết luận chung — AI lo hết, thím chỉ cần API key.

### 🧠 Trích xuất kiến thức — Nhặt mẹo hay bỏ túi
Từ đống 700 bài reply lộn xộn, tự động rút ra các tips, kinh nghiệm, công thức, địa chỉ ngon — lưu thành kho kiến thức có cấu trúc. Không còn cảnh "mình đọc ở đâu đó mà không nhớ trang mấy".

### 🔍 Tra cứu Q&A — Hỏi thẳng, khỏi Ctrl+F
Đặt câu hỏi cụ thể về nội dung topic, AI trả lời kèm trích dẫn đến bài gốc. Kiểu "thím nào đề cập đến vụ X?" thay vì phải mò thủ công.

### 🕵️ Phân tích thread — Đọc vị luồng tranh luận
- **User profiling:** Gom user thành 2-4 nhóm theo hành vi trong thớt (phe ủng hộ, phe phản đối, nhóm kháy, nhóm hóng), kèm quote đại diện mỗi nhóm. AI phân loại dựa trên nội dung bài viết, không phải metadata account.
- **Debate streams:** Gom các luồng tranh luận, xem phe nào thắng thế
- **Timeline sự kiện:** Dòng thời gian diễn biến vụ việc
- **Notable comments:** Các bình luận đáng chú ý nhất (kể cả mấy bài bị report)
- **Tóm tắt phong cách võ hiệp:** Vì đời buồn, cần thêm chút drama kiếm hiệp

### 💾 Cache thông minh — Cày một lần, xài mãi mãi
Kết quả lưu vào IndexedDB, phát hiện bài mới tự động. Hôm nay tóm xong, tuần sau mở lại vẫn còn, không cần cày lại từ đầu.

### 📤 Export đủ kiểu — Copy paste cho nhanh
Markdown, plain text, hoặc tải file `.md` về. Dán vào Notion, Obsidian, hay nhóm Zalo tùy thím.

### ⚙️ Map-Reduce tự động — Thớt 1000 bài cũng không sợ
Tự chia nhỏ topic thành chunk phù hợp với context window của model. Xử lý song song rồi gộp lại. Thím không cần biết map-reduce là gì, chỉ cần bấm nút.

---

## Hỗ trợ

| | |
|---|---|
| **Diễn đàn** | XenForo 1.x và XenForo 2.x (Voz, Otofun, và mấy forum cùng engine) |
| **LLM** | OpenAI, Gemini, hoặc bất kỳ API nào compatible OpenAI (LM Studio, Ollama, OpenRouter…) |
| **Trình duyệt** | Chrome (Manifest V3), Firefox |

---

## Cài đặt

### Yêu cầu
- Node.js 18+
- npm
- API key của một LLM nào đó (thím tự lo phần này nhé, xin không được đâu)

```bash
git clone <repo-url>
cd ai-diem-bao
npm install

# Dev mode (hot reload)
npm run dev

# Hoặc build production
npm run build
```

### Load vào Chrome

1. Mở `chrome://extensions/`
2. Bật **Developer mode** (góc trên phải)
3. Bấm **Load unpacked**
4. Chọn thư mục `.output/chrome-mv3/`

Xong. Không cần cài thêm gì cả.

---

## Cấu hình API Key

1. Mở extension → tab **Cài đặt**
2. Chọn Provider (OpenAI / Claude / Gemini / Custom)
3. Dán API Key vào
4. Chọn model, chỉnh temperature nếu thích mấy bài tóm ảo diệu hơn
5. Bấm **Test Connection** cho chắc
6. **Lưu** là xong

### Provider nào dùng model nào?

| Provider | Model gợi ý | Ghi chú |
|---|---|---|
| OpenAI | `gpt-4o-mini` | Rẻ, nhanh, đủ xài |
| Google Gemini | `gemini-2.5-flash` | Context window siêu to, tóm thớt dài ngon lành |
| LM Studio | *(model đang chạy)* | Chạy local, free 100%, tốc độ tùy máy thím |
| Ollama | `llama3` | Như LM Studio nhưng CLI cho thím nào thích gõ lệnh |
| OpenRouter | *(tùy chọn)* | Aggregator, pick model nào cũng được, tính phí từng model |

> **Mẹo thực tế:** Thớt thường thì Haiku/Flash là đủ. Thớt 500+ bài phức tạp mới cần đến Sonnet/GPT-4o. Dùng Haiku cho tiết kiệm — AI cũng biết đọc, không cần hàng xịn mới hiểu Voz nói gì.

---

## Sử dụng

1. Mở một topic XenForo bất kỳ
2. Click icon extension → side panel bật ra bên phải
3. **Danh sách** — Xem các topic đã lưu, tìm kiếm, lọc
4. **Tóm tắt** → Bấm "Tóm tắt" → chờ AI cày (thớt càng dài càng lâu, đừng tắt tab)
5. **Kiến thức** → Trích xuất tips hay, kinh nghiệm, thông tin hữu ích từ thớt
6. **Phân tích** → Bắt bài, profile user, phân tích luồng tranh luận
7. **Tra cứu** → Hỏi thẳng về nội dung topic, AI trả lời kèm nguồn
8. **Xuất** → Copy Markdown hoặc download file `.md`

---

## Tech Stack

| Layer | Công nghệ |
|---|---|
| Extension Framework | [WXT](https://wxt.dev/) v0.20 |
| UI | [Vue 3](https://vuejs.org/) Composition API |
| Styling | [Tailwind CSS](https://tailwindcss.com/) v4 |
| Language | TypeScript 5 |
| Storage | IndexedDB (cache topic) + `chrome.storage.sync` (settings) |

---

## Cấu trúc dự án

```
ai-diem-bao/
├── entrypoints/
│   ├── background/       # Service worker: điều phối LLM, cache, messaging
│   ├── content/          # Content script: detect XenForo, scrape bài viết
│   └── sidepanel/        # Vue 3 app — toàn bộ UI
│       ├── views/        # Các màn hình chính
│       ├── components/   # 12 UI common components tái sử dụng
│       └── composables/  # Logic state, LLM, scraping
├── lib/
│   ├── llm/              # Adapter cho từng LLM provider
│   ├── scrapers/         # Scraper XF1, XF2, page loader
│   └── *.ts              # Utilities, cache, token estimator, prompts…
├── docs/architecture/    # File tài liệu kiến trúc
├── tests/                # Unit + E2E tests
└── planning/             # Planning files với Decision Logs
```

### Kiến trúc đáng chú ý

**Map-Reduce Pipeline:** Thớt dài → chia chunk → tóm từng chunk song song → merge đệ quy → ra kết quả cuối. Không sợ thớt 1000 bài.

**Fire-and-Forget Messaging:** LLM task dispatch không block, progress gửi qua events — tránh timeout Chrome message channel cho tác vụ dài.

**Strategy Pattern:** Scraper (XF1/XF2) và LLM Provider đều implement interface chung. Thêm forum hay provider mới không cần đụng core logic.

**Service Worker Keepalive:** Ping định kỳ giữ background worker sống trong lúc AI đang cày thớt dài.

---

## Scripts

```bash
npm run dev          # Dev mode với hot reload
npm run build        # Production build
npm run compile      # Type check (vue-tsc)
```

---

## Câu hỏi thường gặp

**Extension có gửi dữ liệu về server không?**  
Không. Không có backend. Toàn bộ dữ liệu nằm trong browser của thím — IndexedDB cho cache topic, `chrome.storage.sync` cho settings. API key cũng vậy, lưu local, không đi qua server nào hết.

**Tại sao phải tự cung cấp API key?**  
Vì tác giả không có tiền bao key cho cả Voz. Mỗi thím tự dùng key của mình, tự chịu phí. Fair enough.

**Hỗ trợ forum nào?**  
Hiện tại là XenForo 1.x và 2.x. Tức là hầu hết các forum lớn ở VN chạy XenForo là xài được.

**Model nào tóm hay nhất?**  
Tùy thớt. Gemini Flash có context window lớn nên tóm thớt dài tốt. Claude Haiku nhanh và rẻ cho thớt thường. GPT-4o nếu thím muốn chất lượng cao và không tiếc tiền.

---

## License

MIT — dùng thoải mái, fork thoải mái, đừng claim là của mình thôi.