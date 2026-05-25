# Cơ chế Thread Analysis

> Cập nhật: 2026-05-25

## Tổng quan

**Thread Analysis** (Feature 25) là phân tích sâu về động thái debate trong thread, gồm 8 sections với phong cách "võ hiệp" ở section cuối. Không scrape lại — dùng `summaryJson` đã có từ tab Tóm tắt.

Từ Phase 9 (Tab Restructuring), **Phân tích được tách thành tab riêng** `/analysis` với `AnalysisView.vue` + composable `useThreadAnalysis.ts`, thay vì là sub-tab bên trong SummaryView như trước đây.

## Data Model (`ThreadAnalysisJSON`)

```typescript
interface ThreadAnalysisJSON {
  overview: {
    heat: 'hot' | 'normal' | 'low';           // Độ nóng của thread
    coreConflict: string;                        // Mâu thuẫn chính
    keyFacts: readonly string[];                 // Fact quan trọng
    misconception: string;                       // Điểm VOZ hiểu sai
  };
  userProfiles: ThreadUserProfile[];             // 2-4 nhóm user tiêu biểu
  debateStreams: ThreadDebateStream[];            // 3-5 luồng tranh luận
  combats: ThreadCombat[];                       // 2-3 combat tiêu biểu
  timeline: ThreadTimelinePhase[];               // 3-4 giai đoạn
  notableComments: ThreadNotableComment[];        // 3 comment: defining + insightful + meme
  conclusion: {
    breakdown: { label: string; percent: number }[];  // % các loại tranh luận
    insightPolicy: string;                              // Góc nhìn hệ thống
    insightPublic: string;                              // Phản ứng VOZ
    finalNote: string;                                  // Tổng kết
  };
  wuxia: string;                               // Đoạn văn kiếm hiệp 10-15 dòng
}
```

## Flow

### Trigger

User chọn thớt → vào sub-tab **Phân tích** trong tab **Thớt** → bấm "Phân tích Thread".

### Luồng xử lý

```
AnalysisView.vue  (tab /analysis)
    │
    ├── useThreadAnalysis(store)
    │   ├── threadAnalysis: computed từ store.selectedTopic.threadAnalysis
    │   ├── summaryJson:   computed từ store.selectedTopic (top-level hoặc từ segments)
    │   └── hasSummary:    computed — kiểm tra summaryJson có sẵn chưa
    │
    ├── Check: threadAnalysis có sẵn?
    │   └── Có → hiển thị ngay (không gọi LLM)
    │
    ├── generateAnalysis()
    │   └── useLLM.threadAnalysisTask(summaryJson, meta)
    │       └── createTask('thread_analysis', { summaryJson, meta })
    │           └── sendMessage('START_LLM_TASK', ...)
    │
    ├── Background processLLMTask()
    │   └── summarizer.generateThreadAnalysis(summaryJson, meta, config)
    │       └── Gửi THREAD_ANALYSIS_PROMPT + input → LLM
    │       └── Parse JSON output (parseSummaryJSON)
    │
    ├── LLM_RESULT → store.updateSelectedTopic({ threadAnalysis })
    │
    └── SAVE_CACHED_TOPIC với threadAnalysis
```

### `useThreadAnalysis` Composable

```typescript
export function useThreadAnalysis(store) {
  const { threadAnalysisTask, cancelTask, getTaskState } = useLLM();

  // Reactive state
  const isAnalyzing = ref(false);
  const error = ref('');

  // Computed từ store (single source of truth)
  const threadAnalysis = computed(() => cachedTopic.value?.threadAnalysis ?? null);
  const summaryJson = computed(() => {
    // Ưu tiên: top-level summaryJson → single-segment → overall segment
  });
  const hasSummary = computed(() => !!summaryJson.value);

  // Actions
  async function generateAnalysis(): Promise<void> {
    // Gọi LLM → store.updateSelectedTopic({ threadAnalysis }) → SAVE_CACHED_TOPIC
  }

  return { threadAnalysis, isAnalyzing, error, summaryJson, hasSummary, generateAnalysis, cancelTask, getTaskState };
}
```

Stale guard dùng `createRunGuard()` — nếu user navigate đi trong lúc đang phân tích, kết quả chỉ lưu vào IDB, không update UI.

### Prompt (`THREAD_ANALYSIS_PROMPT`)

LLM nhận **tóm tắt JSON** (SummaryJSON) làm input — không phải posts gốc. Yêu cầu output 8 sections với constraints:
- `notableComments`: đúng 3 items (1 defining + 1 insightful + 1 meme)
- `breakdown`: các percent cộng đúng 100
- `userProfiles`: 2-4 nhóm
- `debateStreams`: 3-5 luồng

### LLM Function

```typescript
generateThreadAnalysis(
  summaryJson: SummaryJSON,           // tóm tắt JSON đã có
  meta: { title, totalPages, totalPosts },
  config: LLMConfig,
  onProgress?: LLMProgressCallback,
  signal?: AbortSignal,
): Promise<ThreadAnalysisJSON>
```

### Background Task Type

| `taskType` | Payload | Result |
|---|---|---|
| `thread_analysis` | `{ summaryJson, meta }` | `ThreadAnalysisJSON` |

### useLLM Wrapper

```typescript
// Trong useLLM composable:
function threadAnalysisTask(summaryJson, meta) {
  return createTask('thread_analysis', { summaryJson, meta });
}
```

## UI Rendering (`ThreadAnalysisContent.vue`)

Component nhận `ThreadAnalysisJSON` và render 8 sections với styling:

1. **TỔNG QUAN** — heat badge, coreConflict, keyFacts, misconception
2. **USER TIÊU BIỂU** — grid cards: role, description, note, quote
3. **LUỒNG TRANH LUẬN** — card list với heat icon (🔥/🧠/💬)
4. **COMBAT TIÊU BIỂU** — grid `Phe A VS Phe B`
5. **TIMELINE** — phases với pageRange + events
6. **COMMENT NỔI BẬT** — defining/insightful/meme icons
7. **KẾT LUẬN** — breakdown bars + insights
8. **KIẾM HIỆP** — bordered purple section

### Copy Plain-Text

`formatAnalysisAsText()` xuất toàn bộ analysis dưới dạng text thuần (không HTML) để copy clipboard.

### Navigation

**Top-level:** `[Thớt] [Sổ tay] [Cài đặt] [?]`

**Sub-tab bar trong Thớt (khi chọn thớt):** `[← Danh sách] [Tóm tắt] [Kiến thức] [Phân tích] [Tra cứu]`

```
App.vue
├── [Thớt]  ← active cho hub + summary/knowledge/analysis/research
│   ├── TopicHubView.vue        ← / (khi chưa chọn thớt)
│   └── [sub-tab bar]           ← hiển thị khi chọn thớt + đang ở detail route
│       ├── SummaryView.vue     ← /summary
│       ├── KnowledgeView.vue   ← /knowledge
│       ├── AnalysisView.vue    ← /analysis
│       └── ResearchView.vue    ← /research
├── [Sổ tay]
│   └── NotebookView.vue        ← /notebook
├── [Cài đặt]
│   └── SettingsView.vue        ← /settings
└── [?]
    └── HelpView.vue            ← /help
```

`AnalysisView.vue` dùng `ThreadAnalysisContent` component (giống như trước đây dùng trong SummaryView). Component này không thay đổi.
