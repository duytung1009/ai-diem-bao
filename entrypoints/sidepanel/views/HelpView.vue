<script setup lang="ts">
</script>

<template>
  <div class="p-3 space-y-2">
    <!-- ─── Wall-of-text disclaimer ──────────────────── -->
    <div class="alert alert-warning space-y-1.5 text-xs">
      <p class="font-semibold text-(--color-text-primary)">⚠️ Trang này hơi dài. Thím vui lòng đọc trước khi hỏi.</p>
      <p class="text-(--color-text-secondary)">
        Biết là wall-of-text, biết là mệt mắt, nhưng 80% câu hỏi thường gặp đã có câu trả lời ở đây rồi đó.
        Đọc hết một lần, khỏi mò mẫm cả đời. Không đọc mà hỏi thì câu trả lời sẽ là một cái link quay lại trang này 🫡
      </p>
    </div>

    <!-- ─── Section 1: Setup LLM Provider ─────────────── -->
    <div>
      <h2 class="section-heading mt-3">1. Thiết lập LLM Provider</h2>
      <p class="text-xs text-(--color-text-secondary) mt-1 mb-1">
        Extension cần một LLM để hoạt động. Dưới đây là 3 cách thiết lập, xếp theo khuyến nghị giảm dần.
      </p>

      <!-- Local LLM (recommended) -->
      <div class="card space-y-1.5 mb-3">
        <div class="flex items-center gap-2">
          <span class="badge badge-accent">1.1</span>
          <h3 class="text-xs font-semibold text-(--color-text-primary)">Local LLM (LM Studio / Ollama)</h3>
          <span class="badge bg-(--color-success-text) text-white text-[10px] font-bold px-1.5 py-0.5 rounded">Khuyến nghị</span>
        </div>
        <ol class="space-y-1.5 pl-1">
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">1</span>
            <span>Cài đặt <strong class="text-(--color-text-primary)">LM Studio</strong> (<code
                class="font-mono text-(--color-accent-text)">https://lmstudio.ai</code>) hoặc <strong class="text-(--color-text-primary)">Ollama</strong> (<code
                class="font-mono text-(--color-accent-text)">https://ollama.com</code>)</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">2</span>
            <span>Tải model mong muốn (VD: <code class="font-mono text-(--color-accent-text)">llama-3.1-8b</code>, <code
                class="font-mono text-(--color-accent-text)">qwen3.5-4b</code>, ...)</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">3</span>
            <span>Khởi động local server:<br>
              <strong>LM Studio:</strong> Mở app → chọn model → nhấn "Start Server" (port <code class="font-mono text-(--color-accent-text)">1234</code>)<br>
              <strong>Ollama:</strong> Chạy terminal → <code class="font-mono text-(--color-accent-text)">ollama serve</code> (port <code
                class="font-mono text-(--color-accent-text)">11434</code>)
            </span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">4</span>
            <span>Mở extension → tab <strong class="text-(--color-text-primary)">Cài đặt</strong> → chọn Provider <strong
                class="text-(--color-text-primary)">"Custom (OpenAI-compatible)"</strong></span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">5</span>
            <span>Nhập Base URL:
              <br>LM Studio: <code class="font-mono text-(--color-accent-text)">http://localhost:1234/v1</code>
              <br>Ollama: <code class="font-mono text-(--color-accent-text)">http://localhost:11434/v1</code>
            </span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">6</span>
            <span>Nhập model name (VD: <code class="font-mono text-(--color-accent-text)">llama-3.1-8b</code>, <code
                class="font-mono text-(--color-accent-text)">qwen3.5-4b</code>, ...)</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">7</span>
            <span>API Key có thể để trống (local không cần auth)</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">8</span>
            <span>Nhấn <strong class="text-(--color-text-primary)">"Test Connection"</strong> → hiện "Kết nối thành công!" là OK</span>
          </li>
        </ol>
      </div>

      <!-- OpenRouter (recommended) -->
      <div class="card space-y-1.5 mb-3">
        <div class="flex items-center gap-2">
          <span class="badge badge-accent">1.2</span>
          <h3 class="text-xs font-semibold text-(--color-text-primary)">OpenRouter (multi-model)</h3>
          <span class="badge bg-(--color-success-text) text-white text-[10px] font-bold px-1.5 py-0.5 rounded">Khuyến nghị</span>
        </div>
        <div class="alert alert-info text-xs">
          Có các model <code class="font-mono">:free</code> hoàn toàn miễn phí, không cần chạy local, không cần thẻ tín dụng. Model <code class="font-mono">:free</code> có rate limit nhưng đủ cho nhu cầu dùng thử.
        </div>
        <ol class="space-y-1.5 pl-1 mt-1">
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">1</span>
            <span>Đăng ký tài khoản tại <code class="font-mono text-(--color-accent-text)">https://openrouter.ai</code></span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">2</span>
            <span>Vào <code class="font-mono text-(--color-accent-text)">openrouter.ai/settings/keys</code> → "Create Key"</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">3</span>
            <span>Copy API key (bắt đầu bằng <code class="font-mono text-(--color-accent-text)">sk-or-v1-...</code>)</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">4</span>
            <span>Mở extension → tab <strong class="text-(--color-text-primary)">Cài đặt</strong> → chọn Provider <strong class="text-(--color-text-primary)">"OpenRouter (multi-model)"</strong></span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">5</span>
            <span>Dán API key vào ô API Key</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">6</span>
            <span>Nhập model theo format <code class="font-mono text-(--color-accent-text)">provider/model</code>. Gợi ý model <code class="font-mono text-(--color-accent-text)">:free</code>:<br>
              • <code class="font-mono text-(--color-accent-text)">openai/gpt-oss-20b:free</code> (Context 131.1K, Max Output 8.2K, nhanh)<br>
              • <code class="font-mono text-(--color-accent-text)">deepseek/deepseek-v4-flash:free</code> (context lên đến 1M, Max Output 384K, mạnh, uptime kém)<br>
              • <code class="font-mono text-(--color-accent-text)">google/gemma-4-26b-a4b-it:free</code> (Context 262.1K, Max Output 32.8K, nhanh)<br>
              Xem thêm: <code class="font-mono text-(--color-accent-text)">openrouter.ai/models?q=free</code>
            </span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">7</span>
            <span>Nhấn <strong class="text-(--color-text-primary)">"Test Connection"</strong> → hiện "Kết nối thành công!" là OK</span>
          </li>
        </ol>
      </div>

      <!-- Gemini Free Tier -->
      <div class="card space-y-1.5 mb-3">
        <div class="flex items-center gap-2">
          <span class="badge badge-accent">1.3</span>
          <h3 class="text-xs font-semibold text-(--color-text-primary)">Gemini API (Google AI Studio)</h3>
        </div>
        <div class="alert alert-success text-xs">
          💡 Nên dùng model <strong>Gemma 4 / Gemma 3</strong> (miễn phí, rate limit cao ~1.500 requests/ngày) — phù hợp sử dụng thường xuyên. Các model Gemini (trả phí) dành cho nhu cầu chất lượng cao hơn.
        </div>
        <ol class="space-y-1.5 pl-1 mt-1">
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">1</span>
            <span>Truy cập <code class="font-mono text-(--color-accent-text)">https://aistudio.google.com</code> và đăng nhập tài khoản Google</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">2</span>
            <span>Vào "Get API Key" → "Create API Key" → chọn project hoặc tạo mới</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">3</span>
            <span>Copy API key (có dạng bắt đầu bằng <code class="font-mono text-(--color-accent-text)">AIza...</code>)</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">4</span>
            <span>Mở extension → tab <strong class="text-(--color-text-primary)">Cài đặt</strong> → chọn Provider <strong
                class="text-(--color-text-primary)">"Google Gemini"</strong>. Dùng free tier, chọn model <code class="font-mono text-(--color-accent-text)">gemma-4-26b-a4b-it</code> hoặc <code class="font-mono text-(--color-accent-text)">gemma-4-31b-it</code>.</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">5</span>
            <span>Dán API key vào ô "Google AI API Key"</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">6</span>
            <span>Chọn model <code class="font-mono text-(--color-accent-text)">gemma-4-26b-a4b-it</code> hoặc <code class="font-mono text-(--color-accent-text)">gemma-4-31b-it</code>
            </span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">7</span>
            <span>Nhấn <strong class="text-(--color-text-primary)">"Test Connection"</strong> → hiện "Kết nối thành công!" là OK</span>
          </li>
        </ol>
      </div>

      <!-- API Pay-per-request -->
      <div class="card space-y-1.5">
        <div class="flex items-center gap-2">
          <span class="badge badge-accent">1.4</span>
          <h3 class="text-xs font-semibold text-(--color-text-primary)">API Pay-per-request (Gemini / OpenAI)</h3>
        </div>
        <div class="alert alert-warning text-xs">
          ⚠ Chi phí có thể cao do lượng token input lớn. Mỗi request summarize tốn ~1.000 đ. Một topic khoảng 100 trang sẽ cần 15–20 request → tổng
          ~15.000–20.000 đ cho một lần tóm tắt. Cân nhắc kỹ trước khi dùng.
        </div>
        <ol class="space-y-1.5 pl-1 mt-1">
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">1</span>
            <span>Chọn provider <strong class="text-(--color-text-primary)">"Google Gemini"</strong> hoặc <strong
                class="text-(--color-text-primary)">"OpenAI"</strong> trong tab Cài đặt</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">2</span>
            <span>Tạo API key từ <code class="font-mono text-(--color-accent-text)">https://aistudio.google.com</code> (Gemini) hoặc <code
                class="font-mono text-(--color-accent-text)">https://platform.openai.com</code> (OpenAI)</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">3</span>
            <span>Dán API key, chọn model, nhấn <strong class="text-(--color-text-primary)">"Test Connection"</strong> → hiện "Kết nối thành công!" là OK</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">4</span>
            <span>Nên bật <strong class="text-(--color-text-primary)">"Tự động chia segment theo độ dài nội dung"</strong> trong Settings để tối ưu số
              request</span>
          </li>
        </ol>
      </div>

      <!-- DeepSeek -->
      <div class="card space-y-1.5">
        <div class="flex items-center gap-2">
          <span class="badge badge-accent">1.5</span>
          <h3 class="text-xs font-semibold text-(--color-text-primary)">DeepSeek API</h3>
          <span class="badge bg-(--color-success-text) text-white text-[10px] font-bold px-1.5 py-0.5 rounded">Giá rẻ</span>
        </div>
        <div class="alert alert-info text-xs">
          DeepSeek V4 Flash có giá chỉ $0.14/1M input, $0.28/1M output — rẻ hơn GPT-4o-mini. Hỗ trợ 1M context window, output lên đến 384K tokens. Dùng OpenAI-compatible API.
        </div>
        <ol class="space-y-1.5 pl-1 mt-1">
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">1</span>
            <span>Đăng ký tại <code class="font-mono text-(--color-accent-text)">https://platform.deepseek.com</code></span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">2</span>
            <span>Vào API Keys → "Create API Key" → Copy key (bắt đầu bằng <code class="font-mono text-(--color-accent-text)">sk-...</code>)</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">3</span>
            <span>Mở Cài đặt → chọn Provider <strong class="text-(--color-text-primary)">"DeepSeek"</strong> → dán API key</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">4</span>
            <span>Model mặc định <code class="font-mono text-(--color-accent-text)">deepseek-v4-flash</code> đã được thiết lập sẵn</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">5</span>
            <span>Nhấn <strong class="text-(--color-text-primary)">"Test Connection"</strong> → hiện "Kết nối thành công!" là OK</span>
          </li>
        </ol>
      </div>

      <!-- Grok (xAI) -->
      <div class="card space-y-1.5">
        <div class="flex items-center gap-2">
          <span class="badge badge-accent">1.6</span>
          <h3 class="text-xs font-semibold text-(--color-text-primary)">Grok API (xAI)</h3>
        </div>
        <div class="alert alert-info text-xs">
          Grok 4 có context 1M, phù hợp xử lý topic dài. Dùng OpenAI-compatible API. Giá $2.50/1M input, $10/1M output cho Grok 4.
        </div>
        <ol class="space-y-1.5 pl-1 mt-1">
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">1</span>
            <span>Đăng ký tại <code class="font-mono text-(--color-accent-text)">https://console.x.ai</code></span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">2</span>
            <span>Vào API Keys → tạo key mới → Copy key</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">3</span>
            <span>Mở Cài đặt → chọn Provider <strong class="text-(--color-text-primary)">"Grok (xAI)"</strong> → dán API key</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">4</span>
            <span>Model mặc định <code class="font-mono text-(--color-accent-text)">grok-4</code> đã được thiết lập sẵn</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">5</span>
            <span>Nhấn <strong class="text-(--color-text-primary)">"Test Connection"</strong> → hiện "Kết nối thành công!" là OK</span>
          </li>
        </ol>
      </div>
    </div>

    <!-- ─── Section 2: Flow tóm tắt ───────────────────── -->
    <div>
      <h2 class="section-heading mt-3">2. Flow tóm tắt</h2>
      <p class="text-xs text-(--color-text-secondary) mt-1 mb-1">
        Các bước cơ bản để tóm tắt một thớt từ forum XenForo.
      </p>
      <div class="card space-y-1.5">
        <ol class="space-y-1.5">
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">1</span>
            <span>Mở tab <strong class="text-(--color-text-primary)">Thớt</strong> — hiển thị danh sách thớt đã scrape từ XenForo forums</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">2</span>
            <span>Duyệt danh sách, click vào thớt muốn xem — extension tự động chuyển sang tab <strong class="text-(--color-text-primary)">Tóm
                tắt</strong></span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">3</span>
            <span>Nếu thớt chưa có tóm tắt, nhấn nút <strong class="text-(--color-text-primary)">"Tóm tắt"</strong> — extension sẽ:
              <br>— Scrape nội dung thớt từ forum
              <br>— Chia thành các segments (nếu thớt dài)
              <br>— Gửi từng segment đến LLM để tóm tắt
              <br>— Gộp kết quả thành tóm tắt hoàn chỉnh
            </span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">4</span>
            <span>Chờ kết quả hiển thị — progress bar và loading animation cho biết trạng thái</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">5</span>
            <span>Sau khi hoàn thành, tóm tắt được lưu vào IndexedDB — lần sau mở lại không cần chạy lại</span>
          </li>
        </ol>
      </div>
    </div>

    <!-- ─── Section 3: Sau tóm tắt ──────────────────── -->
    <div>
      <h2 class="section-heading mt-3">3. Sau tóm tắt</h2>
      <p class="text-xs text-(--color-text-secondary) mt-1 mb-1">
        Sau khi thớt đã được tóm tắt, bạn có thể khai thác thêm với hai tính năng sau.
      </p>

      <!-- Knowledge -->
      <div class="card space-y-1.5 mb-3">
        <h3 class="text-xs font-semibold text-(--color-text-primary) flex items-center gap-1.5">
          <span class="badge badge-accent">3.1</span>
          Tổng hợp kiến thức (Tab "Kiến thức")
        </h3>
        <ul class="space-y-1 pl-1">
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">1</span>
            <span>Truy cập tab <strong class="text-(--color-text-primary)">Kiến thức</strong> sau khi thớt đã được tóm tắt</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">2</span>
            <span>Nhấn "Tổng hợp kiến thức" — LLM sẽ extract key points, facts, information từ toàn bộ thớt</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">3</span>
            <span>Kết quả hiển thị dưới dạng các knowledge chunks có thể bookmark, chỉnh sửa</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">4</span>
            <span>Kiến thức được lưu vào IndexedDB cùng với thớt — truy cập lại bất cứ lúc nào</span>
          </li>
        </ul>
      </div>

      <!-- Analysis -->
      <div class="card space-y-1.5 mb-3">
        <h3 class="text-xs font-semibold text-(--color-text-primary) flex items-center gap-1.5">
          <span class="badge badge-accent">3.2</span>
          Phân tích luồng (Tab "Phân tích")
        </h3>
        <ul class="space-y-1 pl-1">
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">1</span>
            <span>Truy cập tab <strong class="text-(--color-text-primary)">Phân tích</strong> sau khi thớt đã được tóm tắt</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">2</span>
            <span>Nhấn "Phân tích" — LLM sẽ đọc toàn bộ tóm tắt và phân tích các chiều thảo luận: quan điểm chính, xu hướng ý kiến, điểm đồng thuận và tranh
              cãi</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">3</span>
            <span>Kết quả hiển thị dưới dạng phân tích cấu trúc: các nhóm quan điểm, tỉ lệ ủng hộ/phản đối, và nhận định tổng quan về chất lượng thảo
              luận</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">4</span>
            <span>Kết quả phân tích được lưu vào IndexedDB — không cần chạy lại khi mở thớt lần sau</span>
          </li>
        </ul>
      </div>

      <!-- Research -->
      <div class="card space-y-1.5">
        <h3 class="text-xs font-semibold text-(--color-text-primary) flex items-center gap-1.5">
          <span class="badge badge-accent">3.3</span>
          Tra cứu mở rộng (Tab "Tra cứu")
        </h3>
        <ul class="space-y-1 pl-1">
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">1</span>
            <span>Truy cập tab <strong class="text-(--color-text-primary)">Tra cứu</strong> sau khi thớt đã được tóm tắt</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">2</span>
            <span>Nhập câu hỏi hoặc từ khóa vào ô tìm kiếm</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">3</span>
            <span>LLM sẽ phân tích nội dung thớt và trả lời dựa trên context của thớt</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">4</span>
            <span>Hỗ trợ hỏi đáp chi tiết về nội dung đã tóm tắt mà không cần đọc lại toàn bộ</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">5</span>
            <span>Lịch sử câu hỏi được lưu vào IndexedDB để tham khảo sau</span>
          </li>
        </ul>
      </div>
    </div>

    <!-- ─── Section 4: Sổ tay ────────────────────────── -->
    <div>
      <h2 class="section-heading mt-3">4. Sổ tay</h2>
      <p class="text-xs text-(--color-text-secondary) mt-1 mb-1">
        Sổ tay tập hợp tất cả kiến thức bạn đã bookmark từ nhiều thớt khác nhau vào một nơi, giúp tra cứu và tổng hợp dễ dàng.
      </p>

      <!-- Overview -->
      <div class="card space-y-1.5 mb-3">
        <h3 class="text-xs font-semibold text-(--color-text-primary)">Cách thêm kiến thức vào Sổ tay</h3>
        <ol class="space-y-1.5 pl-1">
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">1</span>
            <span>Mở tab <strong class="text-(--color-text-primary)">Kiến thức</strong> của bất kỳ thớt đã tóm tắt nào</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">2</span>
            <span>Nhấn icon bookmark <svg class="inline-block w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 4a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 20V4z"></path>
              </svg> trên kiến thức muốn lưu — kiến thức đó sẽ được thêm vào Sổ tay</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">3</span>
            <span>Truy cập tab <strong class="text-(--color-text-primary)">Sổ tay</strong> (tab thứ 2 trên thanh điều hướng chính) để xem toàn bộ kiến thức đã
              lưu</span>
          </li>
        </ol>
      </div>

      <!-- View modes -->
      <div class="card space-y-1.5 mb-3">
        <h3 class="text-xs font-semibold text-(--color-text-primary)">Các chế độ xem</h3>
        <p class="text-xs text-(--color-text-secondary)">Sổ tay hỗ trợ 4 chế độ xem, chuyển đổi bằng thanh tab phía trên danh sách:</p>
        <ul class="space-y-1.5 pl-1 mt-1">
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 font-semibold text-(--color-text-primary) w-20">Thớt</span>
            <span>Nhóm kiến thức theo từng thớt nguồn — tiện xem lại toàn bộ kiến thức đã lưu từ một chủ đề</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 font-semibold text-(--color-text-primary) w-20">Danh mục</span>
            <span>Nhóm theo danh mục (kinh nghiệm, mẹo, cảnh báo, thống kê...) — tiện tra cứu theo loại thông tin</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 font-semibold text-(--color-text-primary) w-20">Tag</span>
            <span>Nhóm theo tag tự do đã gắn cho từng chunk — hữu ích khi bạn tự thêm tag cá nhân</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 font-semibold text-(--color-text-primary) w-20">Dòng thời gian</span>
            <span>Sắp xếp theo thời điểm lưu — tiện tìm lại kiến thức mới bookmark gần đây</span>
          </li>
        </ul>
      </div>

      <!-- Actions -->
      <div class="card space-y-1.5">
        <h3 class="text-xs font-semibold text-(--color-text-primary)">Thao tác với kiến thức trong Sổ tay</h3>
        <ul class="space-y-1.5 pl-1">
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 font-semibold text-(--color-text-primary) w-20">Tìm kiếm</span>
            <span>Dùng ô tìm kiếm để lọc nhanh theo từ khóa trong nội dung kiến thức</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 font-semibold text-(--color-text-primary) w-20">Mở nguồn</span>
            <span>Nhấn icon <svg class="inline-block w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg> để mở bài viết gốc trên forum — extension tự nhảy đúng đến post nguồn</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 font-semibold text-(--color-text-primary) w-20">Xem trong thớt</span>
            <span>Khi xem chi tiết từng kiến thức, nhấn vào link ở dưới cùng để mở lại tab Kiến thức của thớt gốc và highlight đúng kiến thức đó</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 font-semibold text-(--color-text-primary) w-20">Bỏ lưu</span>
            <span>Nhấn icon xóa để xóa khỏi Sổ tay — không ảnh hưởng đến dữ liệu thớt gốc</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 font-semibold text-(--color-text-primary) w-20">Mồ côi</span>
            <span>Kiến thức từ thớt đã xóa sẽ được đánh dấu "mồ côi" — nhấn icon <svg class="inline-block w-3.5 h-3.5" fill="none" stroke="currentColor"
                viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg> để xem riêng và dọn dẹp</span>
          </li>
        </ul>
      </div>
    </div>

    <!-- ─── Section 5: Import/Export dữ liệu ───────────────── -->
    <div>
      <h2 class="section-heading mt-3">5. Import/Export dữ liệu</h2>
      <p class="text-xs text-(--color-text-secondary) mt-1 mb-1">
        Dùng Export để sao lưu dữ liệu cache ra file JSON, và Import để khôi phục hoặc chuyển dữ liệu sang máy/trình duyệt khác.
      </p>

      <div class="card space-y-1.5 mb-3">
        <h3 class="text-xs font-semibold text-(--color-text-primary) flex items-center gap-1.5">
          <span class="badge badge-accent">5.1</span>
          Xuất dữ liệu (Backup)
        </h3>
        <ol class="space-y-1.5 pl-1">
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">1</span>
            <span>Mở tab <strong class="text-(--color-text-primary)">Cài đặt</strong>, kéo xuống khối <strong class="text-(--color-text-primary)">Cache local</strong></span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">2</span>
            <span>Nhấn nút <strong class="text-(--color-text-primary)">"Xuất dữ liệu (JSON)"</strong></span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">3</span>
            <span>Trình duyệt sẽ tải xuống file dạng <code class="font-mono text-(--color-accent-text)">loi-thot-ho-export-YYYY-MM-DD.json</code>. Giữ file này để backup hoặc chuyển máy.</span>
          </li>
        </ol>
      </div>

      <div class="card space-y-1.5 mb-3">
        <h3 class="text-xs font-semibold text-(--color-text-primary) flex items-center gap-1.5">
          <span class="badge badge-accent">5.2</span>
          Nhập dữ liệu (Restore)
        </h3>
        <ol class="space-y-1.5 pl-1">
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">1</span>
            <span>Tại tab <strong class="text-(--color-text-primary)">Cài đặt</strong>, chọn trước chế độ xử lý xung đột trong mục <strong class="text-(--color-text-primary)">"Khi trùng dữ liệu, bạn muốn"</strong>:</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">2</span>
            <span><strong class="text-(--color-text-primary)">Giữ dữ liệu hiện có</strong>: bỏ qua các bản ghi bị trùng.</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">3</span>
            <span><strong class="text-(--color-text-primary)">Ghi đè bằng dữ liệu từ file</strong>: cập nhật dữ liệu hiện có bằng dữ liệu trong file import.</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">4</span>
            <span>Nhấn <strong class="text-(--color-text-primary)">"Nhập dữ liệu (JSON)"</strong> và chọn file backup.</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">5</span>
            <span>Sau khi xong, extension hiển thị kết quả: số topic đã nhập, số bỏ qua và số lỗi (nếu có).</span>
          </li>
        </ol>
      </div>

      <div class="alert alert-info text-xs">
        Mẹo: trước khi import vào môi trường chính, nên export dữ liệu hiện tại để có bản sao dự phòng.
      </div>
    </div>
  </div>
</template>
