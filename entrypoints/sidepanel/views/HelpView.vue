<script setup lang="ts">
</script>

<template>
  <div class="p-4 space-y-4">
    <!-- ─── Section 1: Setup LLM Provider ─────────────── -->
    <div>
      <h2 class="font-semibold text-sm text-(--color-text-primary)">1. Thiết lập LLM Provider</h2>
      <p class="text-xs text-(--color-text-secondary) mt-1 mb-3">
        Extension cần một LLM để hoạt động. Bạn có thể dùng API miễn phí của Google hoặc chạy local với LM Studio / Ollama.
      </p>

      <!-- Gemini Free Tier -->
      <div class="card space-y-1.5 mb-3">
        <div class="flex items-center gap-2">
          <span class="badge bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">1.1</span>
          <h3 class="text-xs font-semibold text-(--color-text-primary)">Gemini API Free Tier (Google AI Studio)</h3>
        </div>
        <ol class="space-y-1.5 pl-1">
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">1</span>
            <span>Truy cập <code class="font-mono text-(--color-accent-text)">https://aistudio.google.com</code> và đăng nhập tài khoản Google</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">2</span>
            <span>Vào "Get API Key" → "Create API Key" → chọn project hoặc tạo mới</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">3</span>
            <span>Copy API key (có dạng bắt đầu bằng <code class="font-mono text-(--color-accent-text)">AIza...</code>)</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">4</span>
            <span>Mở extension → tab <strong class="text-(--color-text-primary)">Cài đặt</strong> → chọn Provider <strong class="text-(--color-text-primary)">"Google Gemini (Free Tier)"</strong></span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">5</span>
            <span>Dán API key vào ô "Google AI API Key"</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">6</span>
            <span>Chọn model <code class="font-mono text-(--color-accent-text)">gemini-2.5-flash</code> (nhanh, đủ dùng cho tóm tắt)</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">7</span>
            <span>Nhấn <strong class="text-(--color-text-primary)">"Test Connection"</strong> → hiện "Kết nối thành công!" là OK</span>
          </li>
        </ol>
      </div>

      <!-- Local LLM -->
      <div class="card space-y-1.5">
        <div class="flex items-center gap-2">
          <span class="badge bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">1.2</span>
          <h3 class="text-xs font-semibold text-(--color-text-primary)">Local LLM (LM Studio / Ollama)</h3>
        </div>
        <ol class="space-y-1.5 pl-1">
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">1</span>
            <span>Cài đặt <strong class="text-(--color-text-primary)">LM Studio</strong> (<code class="font-mono text-(--color-accent-text)">https://lmstudio.ai</code>) hoặc <strong class="text-(--color-text-primary)">Ollama</strong> (<code class="font-mono text-(--color-accent-text)">https://ollama.com</code>)</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">2</span>
            <span>Tải model mong muốn (VD: <code class="font-mono text-(--color-accent-text)">llama-3.1-8b</code>, <code class="font-mono text-(--color-accent-text)">qwen2.5-7b</code>, <code class="font-mono text-(--color-accent-text)">mistral-7b</code>)</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">3</span>
            <span>Khởi động local server:<br>
              <strong>LM Studio:</strong> Mở app → chọn model → nhấn "Start Server" (cổng <code class="font-mono text-(--color-accent-text)">1234</code>)<br>
              <strong>Ollama:</strong> Chạy terminal → <code class="font-mono text-(--color-accent-text)">ollama serve</code> (cổng <code class="font-mono text-(--color-accent-text)">11434</code>)
            </span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">4</span>
            <span>Mở extension → tab <strong class="text-(--color-text-primary)">Cài đặt</strong> → chọn Provider <strong class="text-(--color-text-primary)">"Custom (OpenAI-compatible)"</strong></span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">5</span>
            <span>Nhập Base URL:
              <br>LM Studio: <code class="font-mono text-(--color-accent-text)">http://localhost:1234/v1</code>
              <br>Ollama: <code class="font-mono text-(--color-accent-text)">http://localhost:11434/v1</code>
            </span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">6</span>
            <span>Nhập model name (VD: <code class="font-mono text-(--color-accent-text)">llama-3.1-8b</code>, <code class="font-mono text-(--color-accent-text)">qwen2.5-7b-instruct</code>)</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">7</span>
            <span>API Key có thể để trống (local không cần auth)</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">8</span>
            <span>Nhấn <strong class="text-(--color-text-primary)">"Test Connection"</strong> để kiểm tra</span>
          </li>
        </ol>
      </div>
    </div>

    <!-- ─── Section 2: Flow tóm tắt ───────────────────── -->
    <div>
      <h2 class="font-semibold text-sm text-(--color-text-primary)">2. Flow tóm tắt</h2>
      <p class="text-xs text-(--color-text-secondary) mt-1 mb-3">
        Các bước cơ bản để tóm tắt một chủ đề từ forum XenForo.
      </p>
      <div class="card space-y-1.5">
        <ol class="space-y-1.5">
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">1</span>
            <span>Mở tab <strong class="text-(--color-text-primary)">Chủ đề</strong> — hiển thị danh sách topic đã scrape từ XenForo forums</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">2</span>
            <span>Duyệt danh sách, click vào topic muốn xem — extension tự động chuyển sang tab <strong class="text-(--color-text-primary)">Tóm tắt</strong></span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">3</span>
            <span>Nếu topic chưa có tóm tắt, nhấn nút <strong class="text-(--color-text-primary)">"Tóm tắt"</strong> — extension sẽ:
              <br>— Scrape nội dung topic từ forum
              <br>— Chia thành các segments (nếu topic dài)
              <br>— Gửi từng segment đến LLM để tóm tắt
              <br>— Gộp kết quả thành tóm tắt hoàn chỉnh
            </span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">4</span>
            <span>Chờ kết quả hiển thị — progress bar và loading animation cho biết trạng thái</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">5</span>
            <span>Sau khi hoàn thành, tóm tắt được lưu cache — lần sau mở lại không cần chạy lại</span>
          </li>
        </ol>
      </div>
    </div>

    <!-- ─── Section 3: Sau tóm tắt ──────────────────── -->
    <div>
      <h2 class="font-semibold text-sm text-(--color-text-primary)">3. Sau tóm tắt</h2>
      <p class="text-xs text-(--color-text-secondary) mt-1 mb-3">
        Sau khi topic đã được tóm tắt, bạn có thể khai thác thêm với hai tính năng sau.
      </p>

      <!-- Knowledge -->
      <div class="card space-y-1.5 mb-3">
        <h3 class="text-xs font-semibold text-(--color-text-primary) flex items-center gap-1.5">
          <span class="badge bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">3.1</span>
          Tổng hợp kiến thức (Tab "Kiến thức")
        </h3>
        <ul class="space-y-1 pl-1">
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">1</span>
            <span>Truy cập tab <strong class="text-(--color-text-primary)">Kiến thức</strong> sau khi topic đã được tóm tắt</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">2</span>
            <span>Nhấn "Tổng hợp kiến thức" — LLM sẽ extract key points, facts, information từ toàn bộ topic</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">3</span>
            <span>Kết quả hiển thị dưới dạng các knowledge chunks có thể bookmark, chỉnh sửa</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">4</span>
            <span>Kiến thức được lưu cache cùng với topic — truy cập lại bất cứ lúc nào</span>
          </li>
        </ul>
      </div>

      <!-- Research -->
      <div class="card space-y-1.5">
        <h3 class="text-xs font-semibold text-(--color-text-primary) flex items-center gap-1.5">
          <span class="badge bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">3.2</span>
          Tra cứu mở rộng (Tab "Tra cứu")
        </h3>
        <ul class="space-y-1 pl-1">
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">1</span>
            <span>Truy cập tab <strong class="text-(--color-text-primary)">Tra cứu</strong> sau khi topic đã được tóm tắt</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">2</span>
            <span>Nhập câu hỏi hoặc từ khóa vào ô tìm kiếm</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">3</span>
            <span>LLM sẽ phân tích nội dung topic và trả lời dựa trên context của thread</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">4</span>
            <span>Hỗ trợ hỏi đáp chi tiết về nội dung đã tóm tắt mà không cần đọc lại toàn bộ</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-[10px] font-bold flex items-center justify-center mt-0.5">5</span>
            <span>Lịch sử câu hỏi được lưu để tham khảo sau</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
