<script setup lang="ts">
import { ref } from 'vue';
import PillTabs from '../components/PillTabs.vue';

const activeTab = ref<'llm' | 'flow' | 'notebook' | 'import-export'>('llm');

const tabs = [
  { value: 'llm' as const, label: 'LLM Provider' },
  { value: 'flow' as const, label: 'Flow Tóm tắt' },
  { value: 'notebook' as const, label: 'Flow Sổ tay' },
  { value: 'import-export' as const, label: 'Import/Export' },
];
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

    <PillTabs :tabs="tabs" :model-value="activeTab" @update:model-value="activeTab = $event" class="mt-2" />

    <!-- ─── Section 1: Setup LLM Provider ─────────────── -->
    <div v-show="activeTab === 'llm'">
      <h2 class="section-heading mt-3">1. Thiết lập LLM Provider</h2>
      <p class="text-xs text-(--color-text-secondary) mt-1 mb-1">
        Extension cần một LLM để hoạt động. Dưới đây là 6 cách thiết lập, xếp theo khuyến nghị giảm dần.
      </p>

      <!-- Gemini API (recommended) -->
      <div class="card space-y-1.5 mb-3">
        <div class="flex items-center gap-2">
          <span class="badge badge-accent">1.1</span>
          <h3 class="text-xs font-semibold text-(--color-text-primary)">Gemini API (Google AI Studio)</h3>
          <span class="badge bg-(--color-success-text) text-white text-[10px] font-bold px-1.5 py-0.5">Khuyến nghị</span>
        </div>
        <div class="alert alert-success text-xs">
          💡 Nên dùng model <strong>Gemma 4 / Gemma 3</strong> (miễn phí, rate limit cao ~1.500 requests/ngày) — phù hợp sử dụng thường xuyên. Các model Gemini (trả phí) dành cho nhu cầu chất lượng cao hơn.
        </div>
        <ol class="space-y-1.5 pl-1 mt-1">
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">1</span>
            <span>Truy cập <a href="https://aistudio.google.com" target="_blank" rel="noopener noreferrer" class="font-mono text-(--color-accent-text) underline">https://aistudio.google.com</a> và đăng nhập tài khoản Google</span>
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

      <!-- Local LLM -->
      <div class="card space-y-1.5 mb-3">
        <div class="flex items-center gap-2">
          <span class="badge badge-accent">1.2</span>
          <h3 class="text-xs font-semibold text-(--color-text-primary)">Local LLM (LM Studio / Ollama)</h3>
          <span class="badge bg-(--color-success-text) text-white text-[10px] font-bold px-1.5 py-0.5">Khuyến nghị</span>
        </div>
        <ol class="space-y-1.5 pl-1">
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">1</span>
            <span>Cài đặt <strong class="text-(--color-text-primary)">LM Studio</strong> (<a href="https://lmstudio.ai" target="_blank" rel="noopener noreferrer" class="font-mono text-(--color-accent-text) underline">https://lmstudio.ai</a>) hoặc <strong class="text-(--color-text-primary)">Ollama</strong> (<a href="https://ollama.com" target="_blank" rel="noopener noreferrer" class="font-mono text-(--color-accent-text) underline">https://ollama.com</a>)</span>
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

      <!-- OpenRouter -->
      <div class="card space-y-1.5 mb-3">
        <div class="flex items-center gap-2">
          <span class="badge badge-accent">1.3</span>
          <h3 class="text-xs font-semibold text-(--color-text-primary)">OpenRouter (multi-model)</h3>
          <span class="badge bg-(--color-success-text) text-white text-[10px] font-bold px-1.5 py-0.5">Khuyến nghị</span>
        </div>
        <div class="alert alert-info text-xs">
          Có các model <code class="font-mono">:free</code> hoàn toàn miễn phí, không cần chạy local, không cần thẻ tín dụng. Model <code class="font-mono">:free</code> có rate limit nhưng đủ cho nhu cầu dùng thử.
        </div>
        <ol class="space-y-1.5 pl-1 mt-1">
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">1</span>
            <span>Đăng ký tài khoản tại <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer" class="font-mono text-(--color-accent-text) underline">https://openrouter.ai</a></span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">2</span>
            <span>Vào <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener noreferrer" class="font-mono text-(--color-accent-text) underline">openrouter.ai/settings/keys</a> → "Create Key"</span>
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
              Xem thêm: <a href="https://openrouter.ai/models?q=free" target="_blank" rel="noopener noreferrer" class="font-mono text-(--color-accent-text) underline">openrouter.ai/models?q=free</a>
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
      <div class="card space-y-1.5 mb-3">
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
            <span>Tạo API key từ <a href="https://aistudio.google.com" target="_blank" rel="noopener noreferrer" class="font-mono text-(--color-accent-text) underline">https://aistudio.google.com</a> (Gemini) hoặc <a href="https://platform.openai.com" target="_blank" rel="noopener noreferrer" class="font-mono text-(--color-accent-text) underline">https://platform.openai.com</a> (OpenAI)</span>
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
      <div class="card space-y-1.5 mb-3">
        <div class="flex items-center gap-2">
          <span class="badge badge-accent">1.5</span>
          <h3 class="text-xs font-semibold text-(--color-text-primary)">DeepSeek API</h3>
          <span class="badge bg-(--color-success-text) text-white text-[10px] font-bold px-1.5 py-0.5">Giá rẻ</span>
        </div>
        <div class="alert alert-info text-xs">
          DeepSeek V4 Flash có giá chỉ $0.14/1M input, $0.28/1M output — rẻ hơn GPT-4o-mini. Hỗ trợ 1M context window, output lên đến 384K tokens. Dùng OpenAI-compatible API.
        </div>
        <ol class="space-y-1.5 pl-1 mt-1">
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">1</span>
            <span>Đăng ký tại <a href="https://platform.deepseek.com" target="_blank" rel="noopener noreferrer" class="font-mono text-(--color-accent-text) underline">https://platform.deepseek.com</a></span>
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
      <div class="card space-y-1.5 mb-3">
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
            <span>Đăng ký tại <a href="https://console.x.ai" target="_blank" rel="noopener noreferrer" class="font-mono text-(--color-accent-text) underline">https://console.x.ai</a></span>
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

    <div v-show="activeTab === 'flow'">

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
              <br>- Scrape nội dung thớt từ forum
              <br>- Chia thành các segments (nếu thớt dài)
              <br>- Gửi từng segment đến LLM để tóm tắt
              <br>- Gộp kết quả thành tóm tắt hoàn chỉnh
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
        Sau khi thớt đã được tóm tắt, bạn có thể khai thác thêm với các tính năng sau.
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
    </div>

    <!-- ─── Section 4: Flow Sổ tay ────────────────────────── -->
    <div v-show="activeTab === 'notebook'">
      <h2 class="section-heading mt-3">4. Flow Sổ tay</h2>
      <p class="text-xs text-(--color-text-secondary) mt-1 mb-1">
        Sổ tay là trung tâm kiến thức tổng hợp từ tất cả thớt bạn đã trích xuất. Tab Sổ tay có 3 giao diện chính: <strong class="text-(--color-text-primary)">Sổ tay</strong> (kiến thức đã bookmark), <strong class="text-(--color-text-primary)">Hỏi đáp</strong> (hỏi đáp trên toàn bộ kho) và <strong class="text-(--color-text-primary)">Kiến thức</strong> (toàn bộ kho global).
      </p>

      <!-- Tab Sổ tay -->
      <div class="card space-y-1.5 mb-3">
        <h3 class="text-xs font-semibold text-(--color-text-primary) flex items-center gap-1.5">
          <span class="badge badge-accent">4.1</span>
          Tab Sổ tay
        </h3>
        <p class="text-xs text-(--color-text-secondary)">Tab <strong class="text-(--color-text-primary)">Sổ tay</strong> là bộ sưu tập cá nhân — chỉ hiển thị các kiến thức bạn đã bookmark (ghim) từ kho global hoặc tự tạo. Hỗ trợ quản lý chuyên sâu và 4 chế độ xem:</p>
        <ul class="space-y-1.5 pl-1 mt-1">
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 font-semibold text-(--color-text-primary) w-20">Chỉnh sửa</span>
            <span>Nhấn <svg class="w-3.5 h-3.5 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg> để sửa tiêu đề, nội dung, danh mục, tag, và thêm ghi chú cá nhân — entry đã sửa có badge "đã sửa"</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 font-semibold text-(--color-text-primary) w-20">Ghi chú thủ công</span>
            <span>Tạo ghi chú mới không cần topic nguồn — dùng để ghi chép ý tưởng, tổng hợp cá nhân</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 font-semibold text-(--color-text-primary) w-20">Quản lý danh mục</span>
            <span>Đổi tên hoặc gộp danh mục — entries sẽ tự động cập nhật theo</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 font-semibold text-(--color-text-primary) w-20">Thao tác hàng loạt</span>
            <span>Chọn nhiều entry cùng lúc → đổi danh mục, thêm/xóa tag, hoặc xóa hàng loạt</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span class="shrink-0 font-semibold text-(--color-text-primary) w-20">Chế độ xem</span>
            <span>4 chế độ: nhóm theo Thớt / Danh mục / Tag / Dòng thời gian — kết hợp với thanh tìm kiếm để lọc nhanh</span>
          </li>
        </ul>
      </div>

      <!-- Global Knowledge Store -->
      <div class="card space-y-1.5 mb-3">
        <h3 class="text-xs font-semibold text-(--color-text-primary) flex items-center gap-1.5">
          <span class="badge badge-accent">4.2</span>
          Kho kiến thức tổng hợp (Tab "Kiến thức")
        </h3>
        <p class="text-xs text-(--color-text-secondary)">Khi bạn trích xuất kiến thức từ một thớt (tab Kiến thức trong thớt), các mục đó <strong>tự động được gộp vào một kho chung</strong> — không nằm riêng trong từng topic. Nếu hai thớt khác nhau có nội dung trùng, hệ thống tự động gộp lại và đếm số nguồn.</p>
        <ul class="space-y-1.5 pl-1 mt-1">
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">1</span>
            <span>Tab <strong class="text-(--color-text-primary)">Kiến thức</strong> trong Sổ tay hiển thị <strong>tất cả</strong> mục kiến thức đã trích xuất từ mọi thớt — không cần bookmark thủ công</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">2</span>
            <span>Khi trích xuất, entry mới được dedup/merge với các entry có sẵn — kho luôn "đặc", không bị trùng lặp</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">3</span>
            <span>Nhấn icon star <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"></path></svg> để ghim mục yêu thích vào tab <strong class="text-(--color-text-primary)">Sổ tay</strong></span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">4</span>
            <span>Kho kiến thức sống độc lập — xóa thớt sẽ không làm mất kiến thức đã trích xuất</span>
          </li>
        </ul>
      </div>

      <!-- Notebook Q&A -->
      <div class="card space-y-1.5 mb-3">
        <h3 class="text-xs font-semibold text-(--color-text-primary) flex items-center gap-1.5">
          <span class="badge badge-accent">4.3</span>
          Hỏi đáp kho kiến thức (Tab "Hỏi đáp")
        </h3>
        <p class="text-xs text-(--color-text-secondary)">Đặt câu hỏi và AI trả lời dựa trên toàn bộ kho kiến thức (gom từ tất cả thớt đã trích xuất), kèm trích dẫn nguồn cụ thể.</p>
        <ul class="space-y-1.5 pl-1 mt-1">
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">1</span>
            <span>Vào tab <strong class="text-(--color-text-primary)">Hỏi đáp</strong> trong Sổ tay</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">2</span>
            <span>Nhập câu hỏi bất kỳ (VD: "kinh nghiệm thuê giúp việc chăm bé?")</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">3</span>
            <span>AI sẽ tìm các entry liên quan trong kho và trả lời kèm trích dẫn <code class="font-mono text-(--color-accent-text)">[n]</code> về entry nguồn</span>
          </li>
          <li class="flex gap-2 text-xs text-(--color-text-secondary)">
            <span
              class="shrink-0 w-4 h-4 rounded-full bg-(--color-bg-muted) text-(--color-accent-text) text-xs font-bold flex items-center justify-center mt-0.5">4</span>
            <span>Nhấn <strong class="text-(--color-text-primary)">"Lưu thành ghi chú"</strong> để lưu câu trả lời vào Sổ tay</span>
          </li>
        </ul>
      </div>
    </div>

    <!-- ─── Section 5: Import/Export dữ liệu ───────────────── -->
    <div v-show="activeTab === 'import-export'">
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
