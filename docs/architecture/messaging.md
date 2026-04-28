# Cơ chế Messaging

> Cập nhật: 2026-04-29

## Tổng quan

Extension dùng Chrome Extension messaging (`browser.runtime.sendMessage`, `browser.tabs.sendMessage`) cho tất cả giao tiếp giữa các thành phần. Typed message system đảm bảo type safety qua toàn bộ pipeline.

## Typed Message System (`lib/messaging.ts`)

```typescript
sendMessage<TResponse>(type: MessageType, payload?: unknown): Promise<TResponse>
```

Wrapping `browser.runtime.sendMessage` với type safety. Response type generic.

```typescript
sendTabMessage<TResponse>(tabId, type: MessageType, payload?): Promise<TResponse>
```

Tương tự nhưng gửi đến một tab cụ thể (dùng cho content script).

```typescript
onMessage(type: MessageType, handler): void
```

Listen cho một message type cụ thể. `handler` có thể sync hoặc async.

## Message Type Reference (`lib/types.ts`)

| Message Type | Direction | Mục đích |
|---|---|---|
| `DETECT_XF` | Sidepanel → Content Script | Phát hiện XenForo version, đọc metadata |
| `SCRAPE_ARTICLE` | Sidepanel → Background | Fetch bài báo gốc (CORS bypass) |
| `START_LLM_TASK` | Sidepanel → Background | Bắt đầu tác vụ LLM |
| `CANCEL_LLM_TASK` | Sidepanel → Background | Hủy tác vụ LLM đang chạy |
| `LLM_PROGRESS` | Background → Sidepanel | Progress update trong lúc LLM chạy |
| `LLM_RESULT` | Background → Sidepanel | Kết quả cuối cùng của LLM task |
| `GET_SETTINGS` | Sidepanel → Background | Lấy LLM config |
| `SAVE_SETTINGS` | Sidepanel → Background | Lưu LLM config |
| `TEST_CONNECTION` | Sidepanel → Background | Test LLM API connectivity |
| `GET_CUSTOM_PROMPTS` | Sidepanel → Background | Lấy custom prompts |
| `SAVE_CUSTOM_PROMPTS` | Sidepanel → Background | Lưu custom prompts |
| `GET_CACHED_TOPIC` | Sidepanel → Background | Lấy topic từ cache |
| `SAVE_CACHED_TOPIC` | Sidepanel → Background | Lưu topic vào cache |
| `DELETE_CACHED_TOPIC` | Sidepanel → Background | Xóa topic khỏi cache |
| `GET_CACHE_SIZE` | Sidepanel → Background | Lấy dung lượng cache |
| `GET_ALL_CACHED_TOPICS` | Sidepanel → Background | Lấy danh sách tất cả topics |

## Fire-and-Forget LLM Pattern

Đây là pattern quan trọng nhất trong messaging. Được thiết kế để tránh Chrome message channel timeout (~5 phút) cho các tác vụ LLM kéo dài.

### Sequence

```
Sidepanel                   Background (service worker)
    │                               │
    │  START_LLM_TASK {taskId,      │
    │    taskType, payload}         │
    │ ──────────────────────────→   │
    │  {started: true, taskId}      │ ← responds IMMEDIATELY
    │ ←────────────────────────── │   (giải phóng message channel)
    │                               │
    │                               │ ← processLLMTask() chạy async
    │                               │   keepalive: setInterval(20s ping)
    │                               │
    │  LLM_PROGRESS {taskId, step,  │ ← trong lúc chạy (mỗi map step)
    │    totalSteps, message,       │
    │    elapsedMs}                 │
    │ ←────────────────────────── │
    │  LLM_PROGRESS ...             │
    │ ←────────────────────────── │
    │                               │
    │  LLM_RESULT {taskId,          │ ← khi hoàn thành hoặc lỗi
    │    success, data, stats}      │
    │ ←────────────────────────── │
```

### Tại sao cần pattern này?

- Chrome extension message channel timeout ~5 phút
- Map-reduce pipeline có thể mất 10–30 phút
- `START_LLM_TASK` trả về `{started: true}` ngay lập tức → giải phóng channel
- Background tiếp tục xử lý async, gửi progress/result qua tin nhắn riêng

### Implementation

**Background (`entrypoints/background/index.ts`):**

```typescript
case 'START_LLM_TASK': {
  const { taskId, taskType, payload } = message.payload;
  sendResponse({ started: true, taskId }); // ← respond ngay

  const keepalive = setInterval(() => {
    void browser.storage.sync.get(''); // no-op ping
  }, KEEPALIVE_INTERVAL_MS); // 20s

  const ctrl = new AbortController();
  activeLLMTasks.set(taskId, ctrl);

  processLLMTask(taskId, taskType, payload, ctrl.signal)
    .finally(() => {
      clearInterval(keepalive);
      activeLLMTasks.delete(taskId);
    });

  return true; // keep channel open for sendResponse
}
```

**Sidepanel (`useLLM` composable):**

```typescript
function startTask(taskType, payload, onComplete?): string {
  const taskId = crypto.randomUUID();
  // ETA estimation
  activeTasks.value.set(taskId, { status: 'running', ... });
  // Fire-and-forget sendMessage
  sendMessage('START_LLM_TASK', { taskId, taskType, payload })
    .catch(err => { /* handle send error */ });
  return taskId;
}
```

**Listener (module-level singleton, đăng ký 1 lần):**

```typescript
if (!listenerRegistered) {
  browser.runtime.onMessage.addListener((message) => {
    if (message.type === 'LLM_PROGRESS') handleProgress(message.payload);
    if (message.type === 'LLM_RESULT') handleResult(message.payload);
  });
  listenerRegistered = true;
}
```

### `createTask()` wrapper

```typescript
function createTask(taskType, payload): { taskId, result: Promise<LLMResultMessage> } {
  // Trả về Promise resolve/reject dựa trên LLM_RESULT
  let resolve, reject;
  const result = new Promise((res, rej) => { resolve = res; reject = rej; });
  const taskId = startTask(taskType, payload, (r) => {
    r.success ? resolve(r) : reject(new Error(r.error));
  });
  return { taskId, result };
}
```

### Cancel pattern

Sidepanel gửi `CANCEL_LLM_TASK {taskId}`:

```typescript
case 'CANCEL_LLM_TASK':
  activeLLMTasks.get(taskId)?.abort(); // → signal.aborted
```

Background kiểm tra `signal?.aborted` trong `processLLMTask` và dừng map-reduce.

## Service Worker Keepalive

```typescript
const keepalive = setInterval(() => {
  void browser.storage.sync.get(''); // no-op ping
}, KEEPALIVE_INTERVAL_MS); // 20_000ms

processLLMTask(taskId, taskType, payload, ctrl.signal)
  .finally(() => clearInterval(keepalive));
```

**Tại sao cần:** Chrome có thể terminate service worker sau ~30s không hoạt động. LLM task có thể kéo dài 10–30 phút. Ping định kỳ ngăn worker bị "ngủ đông".

## ETA Estimation (`useLLM`)

`startTask` tự ước lượng thời gian hoàn thành:

1. **Model speed stats** — lưu trong `storage.sync` key `model-speed-stats` sau mỗi LLM call
   - `{ model: string; tokensPerSecond: number; samples: number; lastUpdated: number }`
2. **Token estimate** — `estimateTokens(text)` tính input tokens
3. **Fallback** — `inputTokens × FALLBACK_MS_PER_TOKEN` (20ms/token) nếu chưa có stats

## Background Handler Map

Background service worker dùng `switch/case` trên `message.type`:

```typescript
browser.runtime?.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'GET_SETTINGS':     getSettings().then(sendResponse); return true;
    case 'SAVE_SETTINGS':    saveSettings(...).then(...);       return true;
    case 'START_LLM_TASK':   /* fire-and-forget */             return true;
    case 'CANCEL_LLM_TASK':  activeLLMTasks.get(...)?.abort();   return true;
    // ... (16+ message types)
  }
});
```

Mỗi `case` trả về `true` để giữ message channel open cho async response.
