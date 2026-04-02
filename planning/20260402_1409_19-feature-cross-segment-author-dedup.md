# Feature 19: Cross-Segment Author Deduplication for Segment Mode Summarization

## Context

Khi tóm tắt chủ đề lớn bằng segment mode (ví dụ: 1238 trang / 10 trang mỗi segment = 124 segments), mỗi segment được tóm tắt riêng thành `SummaryJSON` chứa `opinions[].supporters[]`. Khi tạo tóm tắt tổng quan (`generateOverallSummary`), tất cả segment JSONs được gộp bởi LLM qua `REDUCE_SUMMARY_PROMPT`.

**Vấn đề:** LLM không dedup chính xác tác giả xuất hiện ở nhiều segment. Ví dụ:
- Segment 1: `"Vàng sẽ tăng" → supporters: ["NoiBuon2021", "Author2"]`
- Segment 5: `"Giá vàng tăng" → supporters: ["NoiBuon2021", "Author5"]`
- LLM output: đếm NoiBuon2021 là 2 người khác nhau, hoặc đếm 4 supporters thay vì 3 (duy nhất)

Vấn đề nghiêm trọng hơn khi segment count > 20: attention của LLM giảm, opinion title thay đổi nhẹ giữa các segment, cùng tác giả xuất hiện 10+ lần.

**Giải pháp:** Phân tách trách nhiệm:
- **LLM** → semantic grouping (nhóm opinion tương tự, viết summary coherent)
- **Code** → exact dedup (đếm tác giả duy nhất, xây bảng thống kê cross-segment)

---

## Affected Modules

| File | Thay đổi |
|------|----------|
| `lib/llm/summarizer.ts` | Thêm `buildAuthorCrossReference()`, `deduplicateSupporters()`, sửa `summarizeSegments()` |
| `lib/prompts.ts` | Cập nhật `REDUCE_SUMMARY_PROMPT` — thêm instruction sử dụng bảng tác giả |

Không cần sửa `useSummarize.ts`, `useLLM.ts`, hay `types.ts` — thay đổi nằm hoàn toàn trong summarizer layer.

---

## Implementation Steps

### Step 1: `buildAuthorCrossReference()` — helper mới trong `summarizer.ts`

Tạo bảng thống kê tác giả-quan điểm từ parsed segment JSONs:

```typescript
function buildAuthorCrossReference(segmentJsons: (SummaryJSON | null)[]): string {
  // Map: authorNameLowercase → [{segIdx: 1-based, title: opinion.title, originalName: string}]
  const authorMap = new Map<string, { segIdx: number; title: string; originalName: string }[]>();

  segmentJsons.forEach((json, i) => {
    if (!json?.opinions) return;
    for (const op of json.opinions) {
      for (const name of op.supporters) {
        const key = name.toLowerCase();
        if (!authorMap.has(key)) authorMap.set(key, []);
        authorMap.get(key)!.push({ segIdx: i + 1, title: op.title, originalName: name });
      }
    }
  });

  // Chỉ liệt kê tác giả xuất hiện ở ≥2 segment (cần dedup)
  const crossSegmentAuthors = [...authorMap.entries()]
    .filter(([, entries]) => {
      const segments = new Set(entries.map(e => e.segIdx));
      return segments.size >= 2;
    });

  if (crossSegmentAuthors.length === 0) return '';

  const lines = crossSegmentAuthors.map(([, entries]) => {
    const name = entries[0].originalName;
    const bySegment = entries.map(e => `Phần ${e.segIdx} ('${e.title}')`);
    return `- ${name}: ${bySegment.join(', ')}`;
  });

  return `=== TÁC GIẢ XUẤT HIỆN Ở NHIỀU PHẦN (cùng 1 người — chỉ đếm 1 lần) ===\n${lines.join('\n')}\n=== KẾT THÚC ===\n\n`;
}
```

**Tại sao chỉ liệt kê tác giả ≥2 segments:**
- Tác giả chỉ xuất hiện trong 1 segment không cần dedup → giữ bảng gọn
- Giảm token usage cho topics có nhiều tác giả
- LLM chỉ cần focus vào những tác giả thực sự cần dedup

### Step 2: `deduplicateSupporters()` — post-processor mới trong `summarizer.ts`

Sau khi LLM trả kết quả, programmatically dedup `supporters[]` arrays:

```typescript
export function deduplicateSupporters(json: SummaryJSON): SummaryJSON {
  return {
    ...json,
    opinions: json.opinions.map(op => {
      const seen = new Set<string>();
      const unique = op.supporters.filter(name => {
        const key = name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return { ...op, supporters: unique };
    }),
  };
}
```

**Tại sao cần post-process dù đã có cross-reference trong prompt:**
- LLM có thể vẫn dedup sai dù có instruction → post-process là safety net
- Deterministic: đảm bảo 100% không có duplicate
- Giữ casing gốc (first occurrence wins)

### Step 3: Sửa `summarizeSegments()` — logic chính

Thay thân hàm hiện tại (lines 344–366):

```typescript
export async function summarizeSegments(
  segmentSummaries: string[],
  config: LLMConfig,
  onProgress?: LLMProgressCallback,
): Promise<string> {
  const provider = createProvider(config);

  // 1. Parse segment JSONs
  const parsed = segmentSummaries.map(s => parseSummaryJSON(s));

  // 2. Build cross-reference (tác giả xuất hiện ở ≥2 segment)
  const crossRef = buildAuthorCrossReference(parsed);

  // 3. Build combined text
  const segmentText = segmentSummaries
    .map((s, i) => `--- Phần ${i + 1} ---\n${s}`)
    .join('\n\n');
  const combinedContent = crossRef + segmentText;

  // 4. Context check — recursive reduce nếu vượt context
  const inputTokens = estimateTokens(combinedContent) + estimateTokens(REDUCE_SUMMARY_PROMPT) + RESPONSE_BUFFER_TOKENS;
  const contextLimit = getContextLimit(config.model);

  let resultText: string;

  if (inputTokens > contextLimit && segmentSummaries.length > 2) {
    // Split vào groups, reduce mỗi group, rồi reduce lần cuối
    onProgress?.('Đang gộp tóm tắt (nhiều bước)...');
    const groupSize = Math.ceil(segmentSummaries.length / Math.ceil(inputTokens / contextLimit));
    const groups: string[][] = [];
    for (let i = 0; i < segmentSummaries.length; i += groupSize) {
      groups.push(segmentSummaries.slice(i, i + groupSize));
    }

    const intermediateResults: string[] = [];
    for (let g = 0; g < groups.length; g++) {
      onProgress?.(`Đang gộp nhóm ${g + 1}/${groups.length}...`, g + 1, groups.length + 1);
      const groupParsed = groups[g].map(s => parseSummaryJSON(s));
      const groupCrossRef = buildAuthorCrossReference(groupParsed);
      const groupText = groups[g].map((s, i) => `--- Phần ${i + 1} ---\n${s}`).join('\n\n');
      const groupContent = groupCrossRef + groupText;

      const groupPost: ScrapedPost[] = [{ author: 'PARTIAL_SUMMARIES', content: groupContent, timestamp: '', postNumber: 0 }];
      const response = await provider.summarize(groupPost, REDUCE_SUMMARY_PROMPT);
      const json = parseSummaryJSON(response.content);
      intermediateResults.push(json ? JSON.stringify(json) : response.content);

      if (g < groups.length - 1) await new Promise(r => setTimeout(r, MAP_REDUCE_CHUNK_DELAY_MS));
    }

    // Final reduce: gộp intermediate results (mỗi result đã là SummaryJSON)
    onProgress?.('Đang tạo tóm tắt tổng quan...', groups.length + 1, groups.length + 1);
    const finalParsed = intermediateResults.map(s => parseSummaryJSON(s));
    const finalCrossRef = buildAuthorCrossReference(finalParsed);
    const finalText = intermediateResults.map((s, i) => `--- Phần ${i + 1} ---\n${s}`).join('\n\n');
    const finalContent = finalCrossRef + finalText;

    const finalPost: ScrapedPost[] = [{ author: 'PARTIAL_SUMMARIES', content: finalContent, timestamp: '', postNumber: 0 }];
    const finalResponse = await provider.summarize(finalPost, REDUCE_SUMMARY_PROMPT);
    resultText = finalResponse.content;
  } else {
    // Fit trong 1 lần gọi
    onProgress?.('Đang tạo tóm tắt tổng quan...');
    const reducePost: ScrapedPost[] = [{ author: 'PARTIAL_SUMMARIES', content: combinedContent, timestamp: '', postNumber: 0 }];
    const response = await provider.summarize(reducePost, REDUCE_SUMMARY_PROMPT);
    resultText = response.content;
  }

  // 5. Post-process: dedup supporters
  const json = parseSummaryJSON(resultText);
  if (json) {
    const deduped = deduplicateSupporters(json);
    return JSON.stringify(deduped);
  }
  return resultText;
}
```

### Step 4: Cập nhật `REDUCE_SUMMARY_PROMPT` — thêm 1 dòng instruction

Thêm vào section BẮT BUỘC (sau dòng "Gộp supporters..."):

```
- Nếu có phần "TÁC GIẢ XUẤT HIỆN Ở NHIỀU PHẦN" ở đầu input, hãy dùng nó để đảm bảo mỗi tác giả chỉ xuất hiện MỘT LẦN trong supporters của mỗi nhóm quan điểm, dù họ được đề cập ở nhiều phần khác nhau
```

Backward-compatible: nếu không có phần đó (ví dụ map-reduce bình thường), instruction vô hại.

---

## Data Flow (sau khi implement)

```
Segment 1: {opinions: [{title: "Vàng tăng", supporters: ["NoiBuon2021", "A2"]}]}
Segment 5: {opinions: [{title: "Giá vàng tăng", supporters: ["NoiBuon2021", "A5"]}]}
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
            buildAuthorCrossReference()
                    │
  "=== TÁC GIẢ XUẤT HIỆN Ở NHIỀU PHẦN ===
   - NoiBuon2021: Phần 1 ('Vàng tăng'), Phần 5 ('Giá vàng tăng')
   === KẾT THÚC ==="
                    │
                    ▼  (prepend to combined text)
          LLM + REDUCE_SUMMARY_PROMPT
                    │
                    ▼  (LLM groups + dedup, nhưng có thể vẫn sai)
            {opinions: [{title: "Vàng sẽ tăng",
              supporters: ["NoiBuon2021", "A2", "NoiBuon2021", "A5"]}]}
                    │
                    ▼  deduplicateSupporters()
            {opinions: [{title: "Vàng sẽ tăng",
              supporters: ["NoiBuon2021", "A2", "A5"]}]}
                                     ↑
                              3 người (chính xác!)
```

---

## Edge Cases

1. **Không có tác giả cross-segment**: `buildAuthorCrossReference` trả `''` → fallback behavior hiện tại
2. **Segment chưa parse được JSON**: `parseSummaryJSON` trả `null` → bỏ qua trong cross-reference, vẫn include raw text cho LLM
3. **Cross-reference quá dài** (100+ tác giả × 60+ segments): Chỉ liệt kê tác giả ≥2 segments nên compact. Worst case ~200 dòng ≈ 400 tokens — chấp nhận được
4. **Case sensitivity**: `toLowerCase()` cho comparison, giữ casing gốc (first occurrence) trong output
5. **Recursive reduce**: Mỗi reduce level build cross-reference riêng từ inputs của nó → dedup luôn chính xác

---

## Test Plan

1. `npx vue-tsc --noEmit` — no new errors
2. `npm run build` — pass
3. **Test thủ công:**
   - Topic lớn (100+ segment), kiểm tra:
     - Cross-reference hiển thị đúng tác giả xuất hiện ở nhiều segments
     - Overall summary có supporter count chính xác (không duplicate)
     - Recursive reduce hoạt động khi quá nhiều segments
   - Topic nhỏ (2-3 segments): hoạt động bình thường, cross-reference có thể rỗng

---

## Rollback Plan

Revert 2 files (`lib/llm/summarizer.ts`, `lib/prompts.ts`). Không ảnh hưởng types hay UI.

---

## Decision Log

### QD1: Pre-processing + post-processing hybrid (thay vì chỉ 1 trong 2)
- **Đã chọn:** Cả hai: cross-reference prepend VÀ programmatic dedup sau LLM
- **Lý do:** Cross-reference giúp LLM group tốt hơn (knows NoiBuon2021 = same person across segments). Post-process đảm bảo 100% correctness.
- **Đã cân nhắc nhưng loại:**
  - Chỉ post-process → LLM vẫn sai ở bước grouping (gộp opinions tương tự), khó sửa programmatically
  - Chỉ cross-reference → LLM vẫn có thể duplicate dù có instruction, không deterministic

### QD2: Chỉ liệt kê tác giả ≥2 segments (thay vì tất cả)
- **Đã chọn:** Filter ≥2 segments trong cross-reference
- **Lý do:** Tác giả chỉ ở 1 segment không cần dedup → giảm noise cho LLM, tiết kiệm tokens
- **Điều kiện thay đổi:** Nếu muốn LLM đếm tổng supporters chính xác hơn → bao gồm tất cả

### QD3: Implement recursive reduce trong `summarizeSegments` (thay vì dùng `summaryChunks`)
- **Đã chọn:** Implement trực tiếp trong `summarizeSegments` vì cần inject cross-reference ở mỗi reduce level
- **Lý do:** `summaryChunks` dùng map+reduce với 2 prompts khác nhau. Segment reduce chỉ cần reduce (đã có JSON). Cross-reference phải rebuild mỗi level.
- **Đã cân nhắc nhưng loại:** Reuse `summaryChunks` → phải hack input format, không sạch

### QD4: Không thay đổi segment-level prompts
- **Đã chọn:** Chỉ sửa reduce level, không đụng `SUMMARY_PROMPT` hay `CHUNK_SUMMARY_PROMPT`
- **Lý do:** Segment-level đã đúng (kết quả chính xác trong phạm vi 1 segment). Vấn đề chỉ ở cross-segment merge.
