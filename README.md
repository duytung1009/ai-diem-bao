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
- **Phân tích phong cách võ hiệp:** Vì đời buồn, cần thêm chút drama kiếm hiệp

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
| **Diễn đàn** | Mọi forum chạy XenForo 1.x và 2.x — user tự thêm domain trong Cài đặt |
| **LLM** | OpenAI, Gemini, hoặc bất kỳ API nào compatible OpenAI (LM Studio, Ollama, OpenRouter…) |
| **Trình duyệt** | Chrome (Manifest V3), Firefox |

> Extension không yêu cầu quyền truy cập vào bất kỳ website nào theo mặc định. Mỗi forum được thêm thủ công — Chrome sẽ hỏi xác nhận cho từng domain, không có gì chạy ngầm.

---

## Cài đặt

### Yêu cầu
- Node.js 18+
- npm
- API key của một LLM nào đó (thím tự lo phần này nhé, không có mà xin đâu)

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
4. Chọn thư mục `.output/chrome-mv3/` hoặc file release đã giải nén (tải về từ [Releases](https://github.com/duytung1009/ai-diem-bao/releases) page)

Xong. Không cần cài thêm gì cả.

---

## Cấu hình API Key

1. Mở extension → tab **Cài đặt**
2. Chọn Provider (OpenAI / Claude / Gemini / OpenRouter / Custom)
3. Dán API Key vào
4. Chọn model, chỉnh temperature nếu thích mấy bài tóm tắt ảo diệu hơn
5. Bấm **Test Connection** cho chắc
6. **Lưu** là xong

> **Lưu ý quyền truy cập:** Lần đầu Save hoặc Test Connection, Chrome sẽ hiển thị hộp thoại yêu cầu cấp quyền truy cập domain của provider (ví dụ `api.openai.com`). Extension không có sẵn quyền truy cập website nào trong manifest — mỗi provider được cấp quyền riêng lẻ tại thời điểm bạn bấm Lưu/Test. Permission được lưu lại ở các lần sử dụng sau (không hỏi lại).

### Provider nào dùng model nào?

| Provider | Model gợi ý | Ghi chú |
|---|---|---|
| OpenAI | `gpt-4o-mini` | Rẻ, nhanh, đủ xài |
| Google Gemini | `gemini-2.5-flash` | Context window siêu to, tóm thớt dài ngon lành |
| LM Studio | *(model đang chạy)* | Chạy local, free 100%, tốc độ tùy máy thím |
| Ollama | `llama3` | Như LM Studio nhưng CLI cho thím nào thích gõ lệnh |
| OpenRouter | *(tùy chọn)* | Aggregator, pick model nào cũng được, tính phí từng model |

> **Mẹo thực tế:** Thường thì xài local LLM (qwen, llama...) hoặc đồ free như gemma-4-26b-a4b-it/gpt-oss-20b là đủ. Thớt 500+ bài phức tạp mới cần đến GPT-5/Gemini Flash/Gemini Pro. Dùng model rẻ nhất cho tiết kiệm — AI nào cũng biết đọc, không cần hàng xịn mới hiểu Vozer đang nói gì.

---

## Sử dụng

1. Click icon extension → side panel bật ra bên phải
2. **Lần đầu (chưa có forum nào):** Màn hình chính sẽ hiển thị onboarding, bấm "Thêm voz.vn" hoặc "Thêm otofun.net" → Chrome hỏi xác nhận cấp quyền → Approve
3. **Quản lý forum:** Vào **Cài đặt → Forum hỗ trợ** để xem danh sách forum đã thêm, thêm forum khác (vd: `https://forum.example.com`), hoặc xóa forum
4. Mở một topic trên forum vừa thêm → side panel tự động phát hiện và hiển thị thông tin
5. **Danh sách** — Xem các topic đã lưu, tìm kiếm, lọc
6. **Tóm tắt** → Bấm "Tóm tắt" → chờ AI cày (thớt càng dài càng lâu, đừng tắt tab)
7. **Kiến thức** → Trích xuất tips hay, kinh nghiệm, thông tin hữu ích từ thớt
8. **Phân tích** → Bắt bài, profile user, phân tích luồng tranh luận
9. **Tra cứu** → Hỏi thẳng về nội dung topic, AI trả lời kèm nguồn
10. **Xuất** → Copy Markdown hoặc download file `.md`

> Extension không có quyền truy cập bất cứ website nào khi mới cài đặt. Bạn chủ động cấp quyền cho từng forum (qua onboarding hoặc Settings) và từng LLM provider (qua Save/Test Connection).

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

**Map-Reduce Pipeline:** Thớt dài → chia chunk → tóm tắt lần lượt từng chunk → merge đệ quy → ra kết quả cuối. Không sợ thớt 1000 bài.

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
Mọi forum chạy XenForo 1.x và 2.x. Vào **Cài đặt → Forum hỗ trợ**, bấm "Thêm voz.vn" / "Thêm otofun.net" để bắt đầu, hoặc nhập URL bất kỳ forum XenForo nào. Chrome sẽ hỏi xác nhận cấp quyền cho từng domain — không có domain nào được truy cập mà không có sự cho phép của bạn.

**Model nào tóm tắt hay nhất?**  
Tùy khẩu vị. Gemini Flash có context window lớn nên tóm tắt thớt dài tốt, ít hallucinate. DeepSeek V4 Flash nhanh và rẻ cho thớt thường. Claude Sonnet/Opus nếu thím thừa tiền. Local LLM context window bé nên hay bị ảo giác, dễ mất niềm tin. Prompt cũng là yếu tố quan trọng, thím có thể vào Cài Đặt -> Prompt Templates để tùy biến prompt cho bay bổng hơn.

---

## ⚠️ Từ chối trách nhiệm (Disclaimer)

> *Đọc kỹ trước khi dùng — không phải kiểu "Đồng ý với điều khoản" rồi bấm Next cho lẹ nhé.*

### 💸 Tiền ai nấy trả

Mọi chi phí token phát sinh khi dùng API trả phí (OpenAI, Gemini, Claude, v.v.) là **trách nhiệm hoàn toàn của thím**. Tớ không chịu trách nhiệm nếu thím vô tình tóm tắt một thớt 4000 bài về drama màn hình cong bằng Claude Opus rồi nhận bill cuối tháng tim đập chân run.

Khuyến khích mạnh: dùng **Local LLM** (LM Studio, Ollama) hoặc các gói **free tier** là đủ xài cho 90% trường hợp. Thớt Voz không cần model xịn — AI nào cũng đọc được, miễn là biết tiếng Việt và chịu đựng được văn phong "anh không nhận ra tôi" cùng "thế lực thù địch" mỗi ngày.

### 🤖 AI chỉ là máy

Toàn bộ nội dung tóm tắt, chia phe, phân tích luồng tranh luận **phụ thuộc 100% vào dữ liệu bài viết cào được**. Tớ không chịu trách nhiệm nếu:

- AI "bóp méo" drama vì không hiểu ngữ cảnh ngầm của thớt
- AI xếp nhầm phe do các thím trong thớt **bẻ lái văn mẫu quá gắt** — kiểu "em ủng hộ mà" nhưng đọc xong 3 trang rõ ràng là đang chửi
- AI kết luận "không có kẻ thua cuộc" trong một thớt mà cả hai phe đều đang tự đánh nhau
- Kết quả ra ngược đời đến mức bản thân thím cũng không nhận ra thớt vừa đọc

Mọi phân tích chỉ mang tính **tham khảo cho vui**. Muốn kết quả chuẩn hơn thì vào **Cài đặt → Prompt Templates** mà tự chỉnh — AI nghe lời chủ nhà hơn lời developer.

### 🤝 Sản phẩm của hội đồng AI (Vibe Code)

Codebase này là thành quả hợp tác giữa Claude Code, GitHub Copilot, OpenCode, Antigravity, và có thể còn vài em AI khác tớ không nhớ tên. Mỗi em một phong cách, mỗi em một quan điểm về cách đặt tên biến, và không em nào thèm hỏi ý kiến em nào trước khi làm.

Kết quả là một đống bùi nhùi *hoạt động được*, nhưng đôi chỗ có thể hơi **messed up theo những cách khó đoán**. Bug dị? Có thể. Logic kỳ lạ không rõ lý do? Bình thường. Comment tiếng Anh xen tiếng Việt xen pseudocode? Đặc sản.

Rất mong các thím Vozer có kinh nghiệm ghé vào **[report bug hoặc PR](https://github.com/duytung1009/ai-diem-bao/issues)** nếu thấy chỗ nào sai sai. Cộng đồng cùng fix thì nhanh hơn một mình tớ ngồi hỏi AI tại sao mày lại code như vậy.

### 🛋️ Dùng vì đam mê (của chính bản thân)

App này viết ra để **phục vụ cơn lười của tớ là chính**. Không có SLA, không có ticket support, không có cam kết uptime 99.9%, không có đội ngũ on-call 24/7 sẵn sàng xử lý sự cố lúc 2h sáng khi thớt hot đang vào cao trào.

Nếu extension bị lỗi, thím cứ mở Issue trên GitHub. Tớ sẽ xem — *khi nào có thời gian và hứng*. Còn nếu thớt đó quan trọng đến mức không thể chờ, thì lội tay vẫn là phương án truyền thống đáng tin cậy nhất từ trước đến nay.

---

## License

MIT — dùng thoải mái, fork thoải mái, đừng claim là của mình thôi.