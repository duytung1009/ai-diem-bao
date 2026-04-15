# F25 — Thread Analysis View (Phân tích Thread VOZ)

## Objective & Scope

Thêm loại tóm tắt mới dạng "Phân tích Thread VOZ": 8 sections có cấu trúc (TỔNG QUAN, USER TIÊU BIỂU, LUỒNG TRANH LUẬN, COMBAT, TIMELINE, COMMENT NỔI BẬT, KẾT LUẬN, KIẾM HIỆP). Render bằng component mới `ThreadAnalysisContent.vue`. Hiển thị song song với tóm tắt cũ qua 2 sub-tab bên trong Tổng quan. Kèm chức năng copy dạng plain-text để chia sẻ.

**Scope:**
- `lib/types.ts` — thêm `ThreadAnalysisJSON` interface + field `threadAnalysis?` vào `CachedTopic`
- `lib/prompts.ts` — thêm `THREAD_ANALYSIS_PROMPT`
- `lib/llm/summarizer.ts` — thêm `generateThreadAnalysis(summaryJson, meta, config)` function
- `entrypoints/background/index.ts` — handler cho task mới trong START_LLM_TASK
- `entrypoints/sidepanel/composables/useSummarize.ts` — thêm `threadAnalysis` ref + `handleGenerateAnalysis()`
- `entrypoints/sidepanel/components/ThreadAnalysisContent.vue` — component mới render 8 sections
- `entrypoints/sidepanel/views/SummaryView.vue` — thêm 2 sub-tab "Tóm tắt" / "Phân tích"

**Không thuộc scope F25:**
- Per-segment thread analysis (chỉ Tổng quan)
- Custom prompt cho analysis (để F14 xử lý nếu cần)
- Export analysis ra JSON riêng (đã có export chung)

---

## Affected Modules

| Module | Loại thay đổi |
|--------|--------------|
| `lib/types.ts` | Thêm type |
| `lib/prompts.ts` | Thêm prompt |
| `lib/llm/summarizer.ts` | Thêm function |
| `entrypoints/background/index.ts` | Thêm task handler |
| `composables/useSummarize.ts` | Thêm state + handler |
| `components/ThreadAnalysisContent.vue` | Tạo mới |
| `views/SummaryView.vue` | Thêm sub-tab UI |

---

## Implementation Steps

### Step 1 — Định nghĩa `ThreadAnalysisJSON` trong `lib/types.ts`

```typescript
export interface ThreadUserProfile {
  role: string;         // "User mở combat", "Phe hiểu đúng", v.v.
  description: string;  // Mô tả nhóm user này
  note: string;         // Nhận xét ngắn
  quote: string;        // 1 quote tiêu biểu nhất
}

export interface ThreadDebateStream {
  title: string;        // Tên luồng
  heat: 'high' | 'medium' | 'low';  // Độ nóng
  description: string;  // Mô tả 1-2 câu
}

export interface ThreadCombat {
  title: string;        // Tên combat
  sideA: string;        // Stance/quote phe A
  sideB: string;        // Stance/quote phe B
  note: string;         // Nhận xét tóm tắt combat
}

export interface ThreadTimelinePhase {
  name: string;         // Tên giai đoạn: "Shock", "Tranh luận", "Peak combat", "Loãng"
  pageRange: string;    // "Page 1-3"
  events: string[];     // Bullet points diễn biến
}

export interface ThreadNotableComment {
  type: 'defining' | 'insightful' | 'meme';
  author: string;
  text: string;
}

export interface ThreadAnalysisJSON {
  // 1. TỔNG QUAN
  overview: {
    heat: 'hot' | 'normal' | 'low';
    coreConflict: string;       // Chủ đề chính của thread
    keyFacts: string[];         // 2-4 fact quan trọng
    misconception: string;      // Điểm VOZ hiểu sai nhiều nhất
  };

  // 2. USER TIÊU BIỂU
  userProfiles: ThreadUserProfile[];   // 2-4 nhóm user

  // 3. LUỒNG TRANH LUẬN
  debateStreams: ThreadDebateStream[];  // 3-5 luồng

  // 4. COMBAT TIÊU BIỂU
  combats: ThreadCombat[];             // 2-3 combat

  // 5. TIMELINE
  timeline: ThreadTimelinePhase[];     // 3-4 giai đoạn

  // 6. COMMENT NỔI BẬT
  notableComments: ThreadNotableComment[]; // 3 comments: 1 defining + 1 insightful + 1 meme

  // 7. KẾT LUẬN
  conclusion: {
    breakdown: { label: string; percent: number }[];  // Tỷ lệ % các loại tranh luận
    insightPolicy: string;   // Góc nhìn của chính sách / hệ thống
    insightPublic: string;   // Cách công chúng/VOZ phản ứng
    finalNote: string;       // 1 câu nhận xét tổng kết
  };

  // 8. KIẾM HIỆP
  wuxia: string;  // Đoạn văn phong kiếm hiệp, 10-15 dòng
}
```

Thêm vào `CachedTopic`:
```typescript
threadAnalysis?: ThreadAnalysisJSON;
```

---

### Step 2 — Thêm `THREAD_ANALYSIS_PROMPT` trong `lib/prompts.ts`

**Input cho LLM:** Không dùng raw posts — dùng `summaryJson` đã có + topic metadata. Rẻ hơn nhiều (1 LLM call nhỏ thay vì re-process toàn bộ posts).

Prompt nhận:
- `title`: tên thread
- `totalPages`: số trang
- `totalPosts`: số bài
- `summaryJson`: JSON string của `SummaryJSON` đã có

Output: JSON hợp lệ theo `ThreadAnalysisJSON`.

Constraints quan trọng:
- Trả về JSON thuần (không markdown fence)
- Quote trong các field phải dùng single quote hoặc escaped (tránh break JSON)
- `notableComments` PHẢI có đúng 3 items: 1 `defining` + 1 `insightful` + 1 `meme`
- `breakdown` percent phải cộng đúng 100%
- Tất cả nội dung bằng tiếng Việt, trừ quote giữ nguyên gốc

---

### Step 3 — Thêm `generateThreadAnalysis()` trong `lib/llm/summarizer.ts`

```typescript
export async function generateThreadAnalysis(
  summaryJson: SummaryJSON,
  meta: { title: string; totalPages: number; totalPosts: number },
  config: LLMConfig,
  onProgress?: LLMProgressCallback,
): Promise<ThreadAnalysisJSON>
```

- Gọi `provider.summarize()` với `THREAD_ANALYSIS_PROMPT` + input JSON
- Parse output qua `parseThreadAnalysisJSON()` (tương tự `parseSummaryJSON`)
- Throw `LLMError` nếu parse fail

Thêm `parseThreadAnalysisJSON(raw: string): ThreadAnalysisJSON | null` — dùng lại logic từ `parseSummaryJSON`.

---

### Step 4 — Background handler trong `entrypoints/background/index.ts`

Trong `START_LLM_TASK` handler, thêm task type mới `THREAD_ANALYSIS`:

```typescript
case 'THREAD_ANALYSIS': {
  const result = await generateThreadAnalysis(
    payload.summaryJson,
    payload.meta,
    payload.config,
    onProgress,
  );
  return JSON.stringify(result);
}
```

Pattern đã có từ F13 (fire-and-forget LLM task qua `useLLM`).

---

### Step 5 — `useSummarize.ts`: thêm state + handler

State mới:
```typescript
const threadAnalysis = ref<ThreadAnalysisJSON | null>(null);
const isAnalyzing = ref(false);
```

Load từ cache trong `loadTopicData()`:
```typescript
threadAnalysis.value = topic.threadAnalysis ?? null;
```

Hàm mới:
```typescript
async function handleGenerateAnalysis(): Promise<void>
```
- Guard: `if (!summaryJson.value)` → return (cần tóm tắt trước)
- Guard: `if (isAnalyzing.value)` → return
- Gọi `START_LLM_TASK` với `type: 'THREAD_ANALYSIS'`
- Sau khi có kết quả: parse → `threadAnalysis.value = result` → persist qua `SAVE_CACHED_TOPIC`

Expose ra SummaryView: `threadAnalysis`, `isAnalyzing`, `handleGenerateAnalysis`.

---

### Step 6 — Component `ThreadAnalysisContent.vue`

**Props:**
```typescript
defineProps<{
  analysis: ThreadAnalysisJSON;
  threadTitle: string;
  totalPages: number;
}>()
```

**Sections render:**

1. **TỔNG QUAN** — `overview.heat` badge + `coreConflict` + `keyFacts` list + `misconception` callout
2. **USER TIÊU BIỂU** — loop `userProfiles`: role header + description + note + quote block
3. **LUỒNG TRANH LUẬN** — loop `debateStreams`: heat icon (🔥/🧠/💬) + title + description
4. **COMBAT TIÊU BIỂU** — loop `combats`: title + two-column card (phe A VS phe B) + note
5. **TIMELINE** — loop `timeline`: phase header + pageRange badge + events bullet list
6. **COMMENT NỔI BẬT** — loop `notableComments`: type icon (🔥/🧠/💬) + author + text block
7. **KẾT LUẬN** — `breakdown` dạng progress bars + `insightPolicy` vs `insightPublic` + `finalNote`
8. **KIẾM HIỆP** — text block với font italic, border-left decoration

**Copy button:**
- Nằm ở top-right của component (sticky header hoặc floating)
- `formatAnalysisAsText(analysis, title, totalPages): string` — format markdown thuần theo EXAMPLE_SUMMARY.md template
- Dùng `navigator.clipboard.writeText()` + toast feedback "Đã copy!"

**Emit:** không cần, tự-contained.

---

### Step 7 — `SummaryView.vue`: thêm sub-tab UI

Thêm `activeSummaryView = ref<'summary' | 'analysis'>('summary')`.

Hiển thị sub-tab **chỉ khi `activeSegmentIndex === null`** (Tổng quan):

```vue
<!-- Sub-tab buttons — chỉ hiện khi xem Tổng quan -->
<div v-if="activeSegmentIndex === null" class="flex gap-1 border-b border-border">
  <button
    :class="activeSummaryView === 'summary' ? 'tab-active' : 'tab'"
    @click="activeSummaryView = 'summary'"
  >Tóm tắt</button>
  <button
    :class="activeSummaryView === 'analysis' ? 'tab-active' : 'tab'"
    @click="activeSummaryView = 'analysis'"
  >Phân tích</button>
</div>

<!-- Tab content -->
<template v-if="activeSegmentIndex === null">
  <SummaryContent v-if="activeSummaryView === 'summary'" ... />
  <div v-else>
    <ThreadAnalysisContent
      v-if="threadAnalysis"
      :analysis="threadAnalysis"
      :thread-title="store.selectedTopic.value?.title ?? ''"
      :total-pages="cachedTopic?.value?.totalPages ?? 0"
    />
    <div v-else class="flex flex-col items-center gap-3 py-8">
      <p class="text-sm text-muted">Chưa có phân tích cho thread này.</p>
      <button
        class="btn btn-primary"
        :disabled="!summaryJson || isAnalyzing"
        @click="handleGenerateAnalysis"
      >
        {{ isAnalyzing ? 'Đang phân tích...' : 'Phân tích thread' }}
      </button>
      <p v-if="!summaryJson" class="text-xs text-muted">Tóm tắt trước để có thể phân tích</p>
    </div>
  </div>
</template>

<!-- Segment tab: không có sub-tab, giữ nguyên như cũ -->
<template v-if="activeSegmentIndex !== null">
  <SummaryContent ... />
</template>
```

Reset `activeSummaryView` về `'summary'` khi chuyển topic (`loadTopicData`).

---

## Edge Cases

| Case | Xử lý |
|------|-------|
| Chưa có `summaryJson` | Disable nút "Phân tích thread", hiện ghi chú |
| LLM fail / parse error | Hiện `ErrorDisplay`, `isAnalyzing = false` |
| Chuyển topic giữa chừng | `handleGenerateAnalysis` dùng `activeAnalyzeId` pattern (như F23/F24) để invalidate |
| `wuxia` field chứa line breaks | Render với `whitespace-pre-line` |
| Copy trên thiết bị không hỗ trợ clipboard API | Fallback `prompt()` hoặc hiện text để select thủ công |
| Thread chỉ có 1 page | `timeline` vẫn generate nhưng range ngắn hơn |

---

## Test Plan

- [ ] Tóm tắt 1 thread → tab "Phân tích" hiện nút "Phân tích thread"
- [ ] Click nút → spinner → sau khi xong hiện `ThreadAnalysisContent` đầy đủ 8 sections
- [ ] Reload sidepanel → analysis vẫn còn (đã persist vào cache)
- [ ] Copy → paste vào text editor → check format đúng như EXAMPLE_SUMMARY.md
- [ ] Chuyển sang topic khác chưa có analysis → tab "Phân tích" hiện đúng trạng thái mới
- [ ] Chuyển tab "Tóm tắt" ↔ "Phân tích" → không mất state, không re-fetch
- [ ] Xem segment cụ thể → không hiện sub-tab (chỉ SummaryContent)
- [ ] Thread chưa tóm tắt → nút disabled + ghi chú đúng

---

## Rollback Plan

- Feature hoàn toàn additive: không sửa `SummaryJSON`, không sửa flow summarize hiện tại
- Xóa `threadAnalysis` field khỏi cache không crash — field là optional
- Rollback = xóa 2 file mới + revert SummaryView + revert useSummarize (chỉ remove added lines)

---

## Decision Log

### Quyết định 1: Input cho LLM là `summaryJson` (không phải raw posts)
- **Đã chọn:** Dùng `summaryJson` đã có + topic metadata làm input
- **Lý do:** Rẻ hơn nhiều (1 call nhỏ ~2-3K tokens vs re-process toàn bộ posts); `summaryJson` đã chứa đủ opinions/quotes/supporters để LLM tổng hợp thành 8 sections; tránh duplicate scraping
- **Đã cân nhắc nhưng loại:**
  - Raw posts → loại vì tốn token không cần thiết, đã có summaryJson
  - Re-summarize từ `summary` text → loại vì mất thông tin quotes/authors
- **Điều kiện thay đổi:** Nếu LLM không đủ context từ summaryJson (thiếu chi tiết) → cân nhắc bổ sung top quotes từ raw posts

### Quyết định 2: Sub-tab chỉ ở Tổng quan, không phải mỗi segment
- **Đã chọn:** Sub-tab "Tóm tắt / Phân tích" chỉ khi `activeSegmentIndex === null`
- **Lý do:** Thread analysis là phân tích toàn thread, không có ý nghĩa per-segment; giảm độ phức tạp UI
- **Đã cân nhắc nhưng loại:**
  - Per-segment analysis → loại vì scope quá lớn, UX không rõ ràng
- **Điều kiện thay đổi:** Nếu user request per-segment → F26 riêng

### Quyết định 3: On-demand trigger, không auto-generate
- **Đã chọn:** User phải click "Phân tích thread" để kích hoạt
- **Lý do:** Analysis là extra LLM call; không phải mọi user đều muốn; tránh cost không cần thiết
- **Đã cân nhắc nhưng loại:**
  - Auto-generate sau khi tóm tắt → loại vì tốn thêm 1 LLM call mà không hỏi user
- **Điều kiện thay đổi:** Nếu phần lớn user dùng feature → có thể auto-gen sau khi xong overall summary

### Quyết định 4: Copy dạng plain-text markdown (không rich text)
- **Đã chọn:** `formatAnalysisAsText()` → `navigator.clipboard.writeText()` → markdown thuần
- **Lý do:** Works everywhere (Telegram, Messenger, forum, notes app); không cần xử lý HTML/RTF
- **Đã cân nhắc nhưng loại:**
  - HTML copy → loại vì browser extension clipboard API phức tạp hơn, ít compatibility
- **Điều kiện thay đổi:** Nếu user muốn paste vào Word/Google Docs với formatting → thêm HTML mode sau
