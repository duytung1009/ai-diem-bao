# Cơ chế Thread Analysis

> Cập nhật: 2026-04-29

## Tổng quan

**Thread Analysis** (Feature 25) là phân tích sâu về động thái debate trong thread, gồm 8 sections với phong cách "võ hiệp" ở section cuối. Không scrape lại — dùng `summaryJson` đã có từ tab Tóm tắt.

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

User ở tab **Tóm tắt** → sub-tab **Phân tích** → bấm "Phân tích Thread".

### Luồng xử lý

```
SummaryView.vue (sub-tab "Phân tích")
    │
    ├── Check: cachedTopic.threadAnalysis có sẵn?
    │   └── Có → hiển thị ngay (không gọi LLM)
    │
    ├── Gọi useLLM.threadAnalysisTask(summaryJson, meta)
    │   └── createTask('thread_analysis', { summaryJson, meta })
    │       └── sendMessage('START_LLM_TASK', ...)
    │
    ├── Background processLLMTask()
    │   └── summarizer.generateThreadAnalysis(summaryJson, meta, config)
    │       └── Gửi THREAD_ANALYSIS_PROMPT + input → LLM
    │       └── Parse JSON output (parseSummaryJSON)
    │
    ├── LLM_RESULT → threadAnalysis.value = data
    │
    └── SAVE_CACHED_TOPIC với threadAnalysis
```

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

### Sub-tab trong SummaryView

```
SummaryView.vue
├── [Tóm tắt]      ← SummaryContent component
└── [Phân tích]    ← ThreadAnalysisContent component
```

Chuyển tab không trigger re-fetch — dùng `threadAnalysis.value` đã có sẵn.
