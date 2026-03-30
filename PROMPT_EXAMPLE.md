## Ví dụ áp dụng Workflow mới — End-to-end

Giả sử ta cần làm **Feature 14 (Custom Chunk/Reduce Prompts)** + **Feature 15 (Export summary to clipboard)** — cùng nhóm "Prompt & Customization".

---

### Bước 1: Batch Planning (Điểm 2)

**Cập nhật `planning/backlog.md`:**

```markdown
## Batch tiếp theo

### Nhóm A — Prompt & Customization
- [ ] Feature 14: Tùy chỉnh CHUNK_SUMMARY_PROMPT và REDUCE_SUMMARY_PROMPT trong Settings
- [ ] Feature 15: Export summary ra clipboard (copy button)
```

**Khi đủ 2+ feature → gọi Opus 1 lần:**

> *Prompt cho Opus:*
> ```
> Lên kế hoạch implementation cho nhóm feature sau.
> Chú ý: shared dependencies, thứ tự tối ưu, shared components, potential conflicts.
>
> Feature 14: Thêm 2 tab "Tóm tắt phần" + "Gộp tóm tắt" vào Settings Prompt Templates
> Feature 15: Nút copy summary to clipboard ở SummaryView
>
> Context: [paste relevant MEMORY.md sections]
> ```

**Output: `planning/20260322_1000_batch_prompt_customization.md`:**

```markdown
# Batch Plan: Nhóm A — Prompt & Customization

## Dependency Graph
Feature 14 ← (không phụ thuộc Feature 15)
Feature 15 ← (không phụ thuộc Feature 14)
→ Có thể implement song song, nhưng nên làm 14 trước (đụng SettingsView nhiều hơn)

## Shared Components
- Không có shared component mới
- Cả 2 đều dùng `sendMessage()` pattern hiện có

## Implementation Order
1. Feature 14 (SettingsView + summarizer.ts)
2. Feature 15 (SummaryView — chỉ thêm 1 nút)

## Feature 14 — Chi tiết
- [ ] Objective: User tùy chỉnh CHUNK_SUMMARY_PROMPT, REDUCE_SUMMARY_PROMPT
- [ ] Affected modules: SettingsView.vue, lib/types.ts, background/index.ts, summarizer.ts
- [ ] Steps: ...
- [ ] Edge cases: User xóa hết custom prompt → fallback về default
- [ ] Test plan: ...
- [ ] Rollback plan: Xóa 2 tab mới trong SettingsView

## Feature 15 — Chi tiết
- [ ] Objective: Nút "Copy" bên cạnh summary content
- [ ] Affected modules: SummaryView.vue (chỉ 1 file)
- [ ] Steps: ...

## Decision Log

### Quyết định 1: Custom prompts lưu ở đâu?
- **Đã chọn:** `browser.storage.sync` cùng key `custom-prompts` (mở rộng object hiện có)
- **Lý do:** Đã có pattern `CustomPrompts` với `summary`, `opinions`, `research` — thêm `chunk`, `reduce` tự nhiên
- **Đã cân nhắc nhưng loại:**
  - Tạo key riêng `custom-map-reduce-prompts` — loại vì fragment storage, phải sửa nhiều chỗ load
  - Lưu trong IndexedDB cùng cache — loại vì prompts là settings, không phải data
- **Điều kiện thay đổi:** Nếu tổng custom prompts > 8KB (sync storage quota per key)

### Quyết định 2: Copy button dùng Clipboard API hay execCommand?
- **Đã chọn:** `navigator.clipboard.writeText()` (modern Clipboard API)
- **Lý do:** Extension sidepanel có permissions đủ, không cần fallback
- **Đã cân nhắc nhưng loại:**
  - `document.execCommand('copy')` — deprecated, không cần support legacy
- **Điều kiện thay đổi:** Nếu cần copy rich text (HTML) thay vì plain text
```

---

### Bước 2: Sonnet implement + tham chiếu Decision Log

> *Prompt cho Sonnet implement Feature 14:*
> ```
> Implement theo planning file planning/20260322_1000_batch_prompt_customization.md — phần Feature 14.
> Tham khảo Decision Log để hiểu lý do đằng sau mỗi approach.
> Nếu gặp tình huống không cover trong Decision Log, tag với [DECISION_NEEDED] và tiếp tục với best guess.
> ```

Sonnet đọc Decision Log → biết dùng `browser.storage.sync` cùng key `custom-prompts` → implement đúng hướng mà không cần hỏi lại Opus.

---

### Bước 3: Self-review (Điểm 4)

Sau khi implement xong, **TRƯỚC khi commit**, Sonnet tự review:

> *Prompt (hoặc Sonnet agent tự chạy theo `template/self_review_checklist.md`):*
> ```
> Review code vừa implement theo checklist:
> 1. Error handling: mọi async call có try-catch?
> 2. Null safety: biến nào có thể null mà chưa check?
> 3. Naming consistency: có theo convention?
> 4. Missing imports/exports
> 5. Console.log/debug code còn sót
> 6. Hardcoded values nên là constant
> 7. TypeScript types đầy đủ? Có dùng `any`?
> 8. Reactive patterns (Vue): readonly, computed?
> ```

**Kết quả tìm được:**

```
1. ❌ `getCustomPrompts()` trong background — thiếu try-catch khi đọc `chunk` field mới từ storage cũ (undefined)
2. ⚠️ `customChunkPrompt` ref có thể null khi user chưa set — fallback thiếu
3. ✅ Naming OK
4. ❌ Thiếu import `CHUNK_SUMMARY_PROMPT` trong summarizer.ts
5. ✅ Không có console.log
6. ✅ OK
7. ⚠️ Dùng `as any` ở 1 chỗ cast CustomPrompts
8. ✅ OK
```

Sonnet fix ngay → commit.

---

### Bước 4: Task report (có Self-review Results)

**File: `tasks/20260322_1100_task_14-feature-custom-chunk-reduce-prompts.md`:**

```markdown
# Task: Feature 14 — Custom Chunk/Reduce Prompts

## Changes
- `lib/types.ts`: Thêm `chunk?: string` + `reduce?: string` vào `CustomPrompts`
- `SettingsView.vue`: Thêm 2 tab "Tóm tắt phần" + "Gộp tóm tắt"
- `background/index.ts`: Thread custom chunk/reduce prompts qua `processLLMTask`
- `summarizer.ts`: `summaryChunks()` nhận optional `customChunkPrompt`, `customReducePrompt`

## Self-review Results
- Issues found: 4
- Issues fixed: 4
- Remaining (cần review thêm): Không
```

---

### Bước 5: Review Triage (Điểm 1)

> *Sonnet phân tích diff:*
> ```
> Phân tích diff sau và xác định review tier:
> - Tier 1 (Quick): < 50 LOC, single file, no core logic change
> - Tier 2 (Standard): 50-200 LOC, 2-3 files, straightforward logic
> - Tier 3 (Deep): > 200 LOC, cross-module, architecture/security impact
> ```

**Output:**

```
Tier: 2 (Standard)
Lý do: ~120 LOC changed, 4 files, logic straightforward (thêm 2 fields vào existing pattern)
Concerns cần review:
- Custom prompt injection vào summarizer pipeline — có đúng chỗ không?
- Fallback logic khi custom prompt rỗng
- Storage migration: users cũ mở Settings lần đầu có bị lỗi không?
```

**→ Tier 2 → Sonnet review đủ, KHÔNG cần Opus.**

---

### Bước 6: Sonnet Review (theo Unified Template — Điểm 5)

**File: `review/20260322_1130_tier2_14-feature-custom-chunk-reduce-prompts.md`:**

```markdown
# Review: Feature 14 — Custom Chunk/Reduce Prompts

### Metadata
- **File reviewed:** lib/types.ts, SettingsView.vue, background/index.ts, summarizer.ts
- **Review tier:** tier2
- **Model used:** sonnet
- **Diff size:** ~120 LOC

### Checklist
| Category | Status | Notes |
|----------|--------|-------|
| Logic correctness | ✅ | Custom prompt threaded correctly through pipeline |
| Edge cases covered | ✅ | Empty string fallback to default prompt |
| Error handling | ✅ | Self-review đã fix try-catch |
| Performance concerns | N/A | Không thay đổi performance-sensitive code |
| Security implications | ⚠️ | Custom prompt injection — user-controlled string sent to LLM. Low risk vì user tự gây hại cho chính mình |
| Consistency with patterns | ✅ | Giống pattern `customPrompts.summary` hiện có |
| Type safety | ✅ | Self-review đã fix `as any` |
| Test coverage | N/A | No unit tests in project |

### Issues Found
| # | Severity | Category | Description | Suggestion |
|---|----------|----------|-------------|------------|
| 1 | minor | Edge case | Tab "Gộp tóm tắt" hiện note "chỉ dùng khi map-reduce" nhưng không disable khi topic nhỏ | Thêm disabled state hoặc tooltip |

### Summary
- **Overall:** approve
- **Key concern:** Minor UX issue với tab visibility, không block merge
```

---

### Bước 7: User test → QA 2 Phase (Điểm 6)

**Phase A — Bug Hunting (Sonnet):**

User test và ghi notes:
> "Custom chunk prompt hoạt động OK. Nhưng khi xóa hết text trong textarea rồi blur, nó không revert về default mà giữ string rỗng. Nút copy ở Feature 15 không hoạt động khi summary có emoji."

Sonnet tạo bug report:

**File: `tasks/20260322_1400_bug_batch_prompt_customization.md`:**

```markdown
# Bug Batch: Prompt & Customization

### BUG-20260322-01: Custom prompt textarea không revert về default khi xóa hết
- **Severity:** minor
- **Affected module:** SettingsView.vue
- **Steps to reproduce:**
  1. Mở Settings → Prompt Templates → tab "Tóm tắt phần"
  2. Xóa hết text trong textarea
  3. Click ra ngoài (blur)
- **Expected:** Textarea hiện lại default prompt hoặc placeholder
- **Actual:** Textarea trống, lưu empty string
- **Suggested fix direction:** `watch` textarea value, nếu `.trim() === ''` → set về `undefined` (sẽ fallback default)

### BUG-20260322-02: Copy button lỗi khi summary chứa emoji
- **Severity:** minor
- **Affected module:** SummaryView.vue
- **Steps to reproduce:**
  1. Tóm tắt topic có emoji trong nội dung
  2. Click nút Copy
- **Expected:** Copy full text
- **Actual:** Text bị cắt tại vị trí emoji
- **Suggested fix direction:** Kiểm tra encoding khi `navigator.clipboard.writeText()`
```

---

**Phase B — Strategic Review (Opus):**

> *Prompt cho Opus:*
> ```
> Dựa trên Feature 14+15 vừa hoàn thành và bug list tasks/20260322_1400_bug_batch_prompt_customization.md,
> đánh giá:
> 1. Improvement cho feature hiện tại
> 2. Feature mới phát sinh
> 3. Technical debt cần address
> 4. Priority ranking
> ```

**Output: `tasks/20260322_1500_improvement_prompt_customization.md`:**

```markdown
# Strategic Review: Prompt & Customization

## Improvements
1. **Prompt preview:** Cho user test custom prompt với sample data trước khi save
2. **Prompt versioning:** Lưu history custom prompts để user revert

## Feature mới phát sinh
3. **Export/Import settings:** User share prompt presets cho nhau
4. **Prompt marketplace:** Community-contributed prompt templates

## Technical debt
5. **CustomPrompts type sprawl:** 5 optional fields, nên group thành sub-objects
6. **Settings storage approaching sync quota:** Cần monitor tổng size

## Priority ranking
1. [P1] Bug fixes từ Phase A (minor, nhưng polish)
2. [P2] Prompt preview (#1) — UX improvement rõ ràng
3. [P3] Export/Import settings (#3) — nice-to-have
4. [P4] Prompt versioning (#2) — low priority
5. [Backlog] Items #4, #5, #6 — future consideration
```

**→ Items P2, P3 feed vào `planning/backlog.md` cho batch tiếp theo.**

---

### So sánh: Opus calls cũ vs mới

| Workflow cũ | Workflow mới |
|------------|-------------|
| Opus plan Feature 14 | ~~Opus plan~~ → **Opus batch plan 14+15** (1 call) |
| Opus plan Feature 15 | ~~Opus plan~~ → (gộp ở trên) |
| Opus review Feature 14 | ~~Opus review~~ → **Sonnet review Tier 2** (0 Opus) |
| Opus review Feature 15 | ~~Opus review~~ → **Sonnet review Tier 1** (0 Opus) |
| Opus log bugs + improvements | **Sonnet Phase A** + **Opus Phase B** (1 call) |
| **Tổng: 5 Opus calls** | **Tổng: 2 Opus calls (giảm 60%)** |