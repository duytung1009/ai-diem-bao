# Test Infrastructure — AI Điểm Báo

> Cập nhật: 2026-05-14

## Tổng quan

Dự án sử dụng **Vitest + jsdom** cho unit tests và E2E tests. Toàn bộ test files nằm trong thư mục `tests/`.

### Cấu trúc thư mục

```
tests/
├── unit/                          # Unit tests — pure functions
│   ├── summarizer-parse.test.ts   # parseSummaryJSON, repairUnescapedQuotes
│   ├── summarizer-dedup.test.ts   # deduplicateSupporters
│   ├── token-estimator.test.ts    # estimateTokens, willExceedContext, budget, cost
│   ├── cache-manager.test.ts      # normalizeUrl, isSameTopicUrl
│   └── mock-system-integration.test.ts  # Mock system integration smoke tests
├── e2e/                           # E2E tests — LLM orchestration flows
│   ├── summarize-single-segment.test.ts      # Tóm tắt không chia segment
│   ├── summarize-multi-segment.test.ts       # Tóm tắt có chia nhiều segment
│   ├── update-summary-no-segments.test.ts    # Cập nhật khi bài gốc không segment
│   ├── update-summary-with-segments.test.ts  # Cập nhật khi bài gốc có nhiều segment
│   ├── update-summary-segment-transition.test.ts  # Transition: không segment → nhiều segment
│   └── edge-cases.test.ts         # Abort, invalid JSON, empty posts, recursive reduce
├── fixtures/                      # Mock data generators
│   ├── post-factory.ts            # ScrapedPost[] generator với presets
│   └── mock-llm-responses.ts      # SummaryJSON fixtures + response formatters
├── mocks/                         # Mock implementations
│   ├── mock-provider.ts           # MockLLMProvider — configurable responses
│   └── override-factory.ts        # Spy on createProvider() để inject mock
└── vitest-setup.ts                # Global setup — polyfill browser API
```

### Chạy tests

```bash
npm run test                    # Run all tests once
npm run test:watch              # Watch mode
npm run test -- path/to/test    # Run specific file
```

---

## Mock System

### MockLLMProvider

`MockLLMProvider` implement `LLMProvider` interface, cho phép config behavior mà không cần gọi API thật:

```typescript
const mock = new MockLLMProvider({
  responses: ['{"summary":"...","opinions":[],"conclusion":"..."}'],  // Queue responses
  delayMs: 100,           // Simulate network delay
  failAfter: 3,           // Throw error after N calls
  failMessage: 'API error',
  abortAfter: 2,          // Throw AbortError after N calls
});
```

**Methods:**
- `getCallCount()` — số lần `summarize()` được gọi
- `reset()` — reset call count
- `getLastPosts()` — posts được truyền vào call cuối cùng

### overrideCreateProvider / restoreCreateProvider

Pattern spy trên `createProvider()` để inject mock mà không refactor production code:

```typescript
import { createMockProvider, restoreCreateProvider } from '@/tests/mocks/override-factory';

describe('my test', () => {
  afterEach(() => {
    restoreCreateProvider();  // IMPORTANT: always cleanup
  });

  it('should work', async () => {
    const mock = createMockProvider();
    await summarizeTopic(posts, config);
    expect(mock.getCallCount()).toBe(1);
  });
});
```

**Tại sao cần pattern này:**
- `createProvider()` hard-coded trong `summarizer.ts`
- Refactor để inject provider sẽ thay đổi signature của nhiều functions
- Spy pattern cho phép override behavior mà không sửa production code

### postFactory

Generator `ScrapedPost[]` với presets:

| Preset | Default count | Content length | Use case |
|--------|--------------|----------------|----------|
| `shortThread(n)` | 10 | ~80 chars/post | Small topics, single-segment tests |
| `mediumThread(n)` | 50 | ~400 chars/post | Medium topics |
| `longThread(n)` | 200 | ~1200 chars/post | Large topics, map-reduce tests |
| `veryLongThread(n)` | 500 | ~2500 chars/post | Very large topics, tree-reduce tests |
| `mixedLength({short, medium, long})` | varies | mixed | Realistic thread simulation |
| `custom(options)` | any | any | Fine-grained control |

### mockSummaryResponses

Collection valid SummaryJSON fixtures:

| Fixture | Opinions | Use case |
|---------|----------|----------|
| `singleSegment` | 2 opinions | Standard single-segment summary |
| `segment1`, `segment2`, `segment3` | 2 opinions each | Multi-segment summaries with overlapping authors |
| `emptyOpinions` | 0 opinions | Topic without debate |
| `minimal` | 0 opinions | Minimal valid summary |

**Response formatters:**
- `mockJsonResponse(json)` → plain JSON string
- `mockFencedResponse(json)` → triple-backtick fenced JSON
- `mockBrokenJsonResponse(json)` → JSON with unescaped quotes
- `mockMarkdownResponse(json)` → markdown text wrapping JSON

---

## Test Conventions

### Unit tests (`tests/unit/`)

- Test pure functions: `parseSummaryJSON`, `deduplicateSupporters`, `willExceedContext`, `normalizeUrl`, etc.
- No mock provider needed — these functions don't call LLM
- Use `expect()` assertions directly on return values
- Cover edge cases: empty input, boundary values, invalid data

### E2E tests (`tests/e2e/`)

- Test orchestration flow: `summarizeTopic`, `updateSummary`, `summarizeSegments`
- **Always** use `createMockProvider()` to override `createProvider()`
- **Always** call `restoreCreateProvider()` in `afterEach`
- Use `willExceedContext()` to predict map-reduce vs direct call behavior
- Assert on `mock.getCallCount()` to verify correct number of LLM invocations
- Use `vi.fn()` for `onProgress` callbacks to verify progress reporting

### Common patterns

```typescript
// Pattern 1: Predict behavior before asserting
const contextCheck = willExceedContext(posts, config.model, 500, 2000, config.contextWindow);
expect(contextCheck.exceeds).toBe(false);  // or true for map-reduce

// Pattern 2: Verify LLM call count
const mock = createMockProvider();
await summarizeTopic(posts, config);
expect(mock.getCallCount()).toBe(1);  // or > 1 for map-reduce

// Pattern 3: Verify progress callback
const onProgress = vi.fn();
await summarizeTopic(posts, config, onProgress);
expect(onProgress).toHaveBeenCalled();  // or not.toHaveBeenCalled()

// Pattern 4: Verify result structure
const result = await summarizeTopic(posts, config);
const parsed = parseSummaryJSON(result);
expect(parsed).not.toBeNull();
expect(typeof parsed?.summary).toBe('string');
expect(Array.isArray(parsed?.opinions)).toBe(true);
```

---

## Test Coverage Summary

| Category | Tests | Files |
|----------|-------|-------|
| **Unit — Parse JSON** | 18 | `summarizer-parse.test.ts` |
| **Unit — Dedup** | 8 | `summarizer-dedup.test.ts` |
| **Unit — Token Estimator** | 38 | `token-estimator.test.ts` |
| **Unit — Cache Manager** | 19 | `cache-manager.test.ts` |
| **Unit — Mock Integration** | 8 | `mock-system-integration.test.ts` |
| **E2E — Single Segment** | 5 | `summarize-single-segment.test.ts` |
| **E2E — Multi Segment** | 7 | `summarize-multi-segment.test.ts` |
| **E2E — Update (no segments)** | 5 | `update-summary-no-segments.test.ts` |
| **E2E — Update (with segments)** | 5 | `update-summary-with-segments.test.ts` |
| **E2E — Segment Transition** | 7 | `update-summary-segment-transition.test.ts` |
| **E2E — Edge Cases** | 17 | `edge-cases.test.ts` |
| **Total** | **137** | 11 files |

---

## vitest-setup.ts

Polyfill `browser` global cho test environment (jsdom không có Chrome extension APIs):

```typescript
(globalThis as Record<string, unknown>).browser = {
  runtime: { sendMessage: vi.fn(), onMessage: { addListener: vi.fn() } },
  storage: { sync: { get: vi.fn(), set: vi.fn() }, local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } },
  tabs: { query: vi.fn(), sendMessage: vi.fn() },
  sidePanel: { setPanelBehavior: vi.fn() },
};
```

## vitest.config.ts

```typescript
export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname) } },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/vitest-setup.ts'],
    include: ['tests/**/*.test.ts'],
  },
});
```
