# Kế Hoạch Cải Thiện Workflow — AI Diểm Báo

> Mục tiêu: Giảm phụ thuộc vào Opus, tối ưu chi phí, giữ nguyên chất lượng output.  
> Áp dụng cho: Claude Code (Opus 4.6) + GitHub Copilot/VS Code (Sonnet 4.6)

---

## Điểm 1: Phân tầng review — Không phải review nào cũng cần Opus

### Vấn đề hiện tại
Mọi review đều đi qua Opus → tiêu tốn quota không cần thiết cho các thay đổi đơn giản.

### Giải pháp: Thêm Review Triage System

**Bước 1 — Định nghĩa 3 tier review trong CLAUDE.md:**

| Tier | Model | Khi nào dùng | Ví dụ |
|------|-------|-------------|-------|
| Tier 1 — Quick | Sonnet | Thay đổi < 50 LOC, single file, không đụng logic core | Fix typo, thêm field UI, update text |
| Tier 2 — Standard | Sonnet + checklist đầy đủ | Thay đổi 50-200 LOC, 2-3 files, logic không phức tạp | Thêm API endpoint CRUD, thêm filter/sort |
| Tier 3 — Deep | Opus | Thay đổi > 200 LOC, cross-module, architecture, security | Refactor data flow, thêm auth layer, đổi DB schema |

**Bước 2 — Thêm triage step vào workflow:**

Sau khi implement xong và tạo task report, chạy Sonnet qua diff với prompt:

```
Phân tích diff sau và xác định review tier:
- Tier 1 (Quick): < 50 LOC, single file, no core logic change
- Tier 2 (Standard): 50-200 LOC, 2-3 files, straightforward logic
- Tier 3 (Deep): > 200 LOC, cross-module, architecture/security impact

Output: tier, lý do, và danh sách concerns cần review.
```

Chỉ khi kết quả là Tier 3 mới chuyển sang Opus.

**Bước 3 — Cập nhật file naming cho review:**

```
review/yyyyMMdd_HHmm_tier1_tên_file.md
review/yyyyMMdd_HHmm_tier2_tên_file.md
review/yyyyMMdd_HHmm_tier3_tên_file.md
```

**Bước 4 — Track trong MEMORY.md:**

Thêm column `review_tier` vào bảng Review Files để theo dõi tỷ lệ tier theo thời gian. Mục tiêu: 60-70% review ở Tier 1-2.

---

## Điểm 2: Batch planning — Gom feature liên quan, plan một lượt

### Vấn đề hiện tại
Mỗi feature gọi Opus riêng lẻ → nhiều lần gọi, Opus không thấy được cross-cutting concerns.

### Giải pháp: Planning Sprint

**Bước 1 — Tạo file `planning/backlog.md`:**

Duy trì một backlog file liệt kê các feature/bugfix sắp làm, nhóm theo module hoặc mức độ liên quan:

```markdown
## Batch tiếp theo (target: tuần 13)

### Nhóm A — Search & Filter
- [ ] Feature 10: Full-text search opinions
- [ ] Feature 11: Filter by date range
- [ ] Fix: Search không trả kết quả khi có dấu

### Nhóm B — User notifications
- [ ] Feature 12: Email digest hàng ngày
- [ ] Feature 13: Push notification cho breaking news
```

**Bước 2 — Khi đủ 2-3 feature liên quan, gọi Opus 1 lần:**

Prompt template cho batch planning:

```
Lên kế hoạch implementation cho nhóm feature sau. 
Chú ý:
1. Shared dependencies giữa các feature
2. Thứ tự implement tối ưu (feature nào nên làm trước)
3. Shared components/utilities có thể tái sử dụng
4. Potential conflicts giữa các feature

[Danh sách feature + context từ MEMORY.md]
```

**Bước 3 — Output structure:**

Opus output 1 file planning chung + các section riêng cho từng feature:

```
planning/yyyyMMdd_HHmm_batch_nhomA_search_filter.md
```

Trong file có:
- Dependency graph giữa các feature
- Shared components cần tạo trước
- Implementation order
- Từng feature plan chi tiết (giữ nguyên Planning Template hiện tại)

**Bước 4 — Cập nhật MEMORY.md:**

Thêm section "Active Batches" để track nhóm feature nào đang được plan/implement cùng nhau.

---

## Điểm 3: Cache Opus output — Decision Log

### Vấn đề hiện tại
Khi Opus bị rate limit, Sonnet phải plan/review mà không có context về *tại sao* Opus chọn approach cụ thể → output kém hơn cần thiết.

### Giải pháp: Decision Log trong mỗi planning file

**Bước 1 — Mở rộng Planning Template:**

Thêm section `Decision Log` vào cuối mỗi planning file:

```markdown
## Decision Log

### Quyết định 1: [Tên quyết định]
- **Đã chọn:** [Approach được chọn]
- **Lý do:** [Tại sao chọn cái này]
- **Đã cân nhắc nhưng loại:** 
  - [Alternative A] — loại vì [lý do]
  - [Alternative B] — loại vì [lý do]
- **Điều kiện thay đổi:** [Khi nào nên xem xét lại quyết định này]

### Quyết định 2: ...
```

**Bước 2 — Thêm vào prompt khi gọi Opus planning:**

Bổ sung instruction:

```
Ngoài planning steps, hãy tạo Decision Log cho mỗi quyết định kiến trúc quan trọng.
Mỗi entry cần: approach đã chọn, lý do, alternatives đã loại, và điều kiện xem xét lại.
Decision Log này sẽ được dùng làm context khi model khác thực hiện implement.
```

**Bước 3 — Sonnet tham chiếu Decision Log khi implement:**

Khi dùng Copilot/Sonnet để implement, include Decision Log vào context:

```
Implement theo planning file [tên file].
Tham khảo Decision Log để hiểu lý do đằng sau mỗi approach.
Nếu gặp tình huống không cover trong Decision Log, tag với [DECISION_NEEDED] và tiếp tục với best guess.
```

**Bước 4 — Cập nhật Degraded Mode:**

```markdown
## Degraded Mode (khi Opus bị rate limit)
- Dùng Sonnet với template đầy đủ
- BẮT BUỘC đọc Decision Log từ planning file liên quan
- Tag file với `[DRAFT_PENDING_OPUS]`
- Với decisions mới chưa có trong log: tag `[DECISION_NEEDED]` kèm reasoning
- Ghi vào MEMORY.md section `Pending Opus Review`
```

---

## Điểm 4: Pre-review tự động bằng Sonnet

### Vấn đề hiện tại
Opus review phải xử lý cả lỗi cơ bản lẫn logic phức tạp → lãng phí token Opus vào việc bắt lỗi mà Sonnet làm được.

### Giải pháp: 2-pass review

**Bước 1 — Thêm phase "Self-review" ngay sau implement:**

Trong GitHub Copilot (Sonnet), sau khi implement xong và TRƯỚC khi commit:

```
Review code vừa implement theo checklist sau:
1. Error handling: mọi async call có try-catch? API response có validate?
2. Null safety: biến nào có thể null mà chưa check?
3. Naming consistency: có theo convention hiện tại của project?
4. Missing imports/exports
5. Console.log/debug code còn sót
6. Hardcoded values nên là constant/config
7. TypeScript types có đầy đủ? Có dùng `any` không?

Output: danh sách issues tìm thấy + đã fix / chưa fix.
```

**Bước 2 — Tích hợp vào workflow:**

Workflow mới:

```
Implement (Sonnet) 
  → Self-review (Sonnet, cùng session) 
  → Fix issues found 
  → Commit + Task report 
  → Triage review tier 
  → Nếu Tier 1-2: Sonnet review (đủ) 
  → Nếu Tier 3: Opus review (chỉ focus architecture/logic)
```

**Bước 3 — Cập nhật task report template:**

Thêm section vào task report:

```markdown
## Self-review Results
- Issues found: [số lượng]
- Issues fixed: [số lượng]  
- Remaining (cần Opus review): [danh sách nếu có]
```

**Bước 4 — Opus review nhận được context sạch hơn:**

Khi Opus review, include self-review results để Opus biết:
- Những gì đã được check → skip
- Remaining issues → focus vào đây
- Giảm ~30-40% thời gian review của Opus

---

## Điểm 5: Chuẩn hóa Review Checklist

### Vấn đề hiện tại
Sonnet và Opus output review ở format khác nhau → khó so sánh chất lượng, khó track patterns.

### Giải pháp: Unified Review Template

**Bước 1 — Thêm Review Template vào CLAUDE.md:**

```markdown
## Review Template (BẮT BUỘC cho mọi review file)

### Metadata
- **File reviewed:** [path]
- **Review tier:** tier1 | tier2 | tier3
- **Model used:** sonnet | opus
- **Diff size:** [LOC changed]

### Checklist
| Category | Status | Notes |
|----------|--------|-------|
| Logic correctness | ✅/❌/⚠️/N/A | |
| Edge cases covered | ✅/❌/⚠️/N/A | |
| Error handling | ✅/❌/⚠️/N/A | |
| Performance concerns | ✅/❌/⚠️/N/A | |
| Security implications | ✅/❌/⚠️/N/A | |
| Consistency with patterns | ✅/❌/⚠️/N/A | |
| Type safety | ✅/❌/⚠️/N/A | |
| Test coverage | ✅/❌/⚠️/N/A | |

### Issues Found
| # | Severity | Category | Description | Suggestion |
|---|----------|----------|-------------|------------|
| 1 | critical/major/minor/nit | [category] | [mô tả] | [gợi ý fix] |

### Summary
- **Overall:** approve / request-changes / needs-opus-review
- **Key concern:** [1 dòng tóm tắt concern chính nếu có]
```

**Bước 2 — Tạo prompt snippet cho cả Sonnet và Opus:**

Lưu prompt template ở `templates/review_prompt.md`:

```markdown
Review code changes theo template sau. BẮT BUỘC output đúng format.
- Đánh giá từng category trong checklist
- List issues theo severity: critical > major > minor > nit
- Critical/Major issues → request-changes
- Chỉ minor/nit → approve
- Nếu Sonnet review mà phát hiện issue cần Opus → overall = needs-opus-review
```

**Bước 3 — Dùng data review để cải thiện workflow:**

Sau 2-3 tuần, xem lại review files:
- Tỷ lệ tier 1/2/3?
- Sonnet review có bao nhiêu lần cần escalate lên Opus?
- Category nào hay có issue nhất? → thêm vào self-review checklist

---

## Điểm 6: Tách Bug Log và Improvement thành 2 phase

### Vấn đề hiện tại
Bước cuối (check dưới tư cách user + log bug/improvement/feature mới) gộp nhiều loại output → tốn 1 session Opus dài.

### Giải pháp: 2-phase QA

**Bước 1 — Phase A: Bug Hunting (dùng Sonnet)**

Tùng test feature dưới tư cách user, ghi notes. Sau đó vào Copilot/Sonnet:

```
Dựa trên notes testing sau, tạo bug report cho từng issue:

[Notes của Tùng]

Format mỗi bug:
- **Bug ID:** BUG-yyyyMMdd-NN
- **Severity:** critical | major | minor
- **Steps to reproduce:**
- **Expected vs Actual:**
- **Affected module:**
- **Suggested fix direction:** (nếu rõ ràng)
```

Output: file `tasks/yyyyMMdd_HHmm_bug_batch_tên.md`

**Bước 2 — Phase B: Strategic Review (dùng Opus)**

Sau khi bugs đã được log, gọi Opus với context khác:

```
Dựa trên feature vừa hoàn thành [tên feature] và bug list [file], 
đánh giá:
1. Improvement cho feature hiện tại (UX, performance, maintainability)
2. Feature mới phát sinh từ feature này
3. Technical debt cần address
4. Priority ranking cho tất cả items trên

Tham khảo MEMORY.md để đánh giá impact lên roadmap tổng thể.
```

**Bước 3 — Cập nhật file structure:**

```
tasks/
├── yyyyMMdd_HHmm_bug_batch_tên.md          ← Phase A (Sonnet)
├── yyyyMMdd_HHmm_improvement_tên.md        ← Phase B (Opus)
```

**Bước 4 — Cập nhật MEMORY.md:**

Thêm 2 sections mới:
- "Active Bugs" — từ Phase A
- "Improvement Backlog" — từ Phase B, feed ngược vào backlog cho batch planning (Điểm 2)

---

## Tổng kết: Workflow Mới (Before vs After)

### Before (hiện tại)
```
Opus plan → Sonnet implement → Commit → Opus review → Sonnet fix → Tùng test → Opus log bugs/improvements
```
Số lần gọi Opus: 3 per feature

### After (cải thiện)
```
Opus batch plan (2-3 features/lần, có Decision Log)
  → Sonnet implement (tham chiếu Decision Log)
  → Sonnet self-review + fix
  → Commit + task report (có self-review results)
  → Sonnet triage review tier
    → Tier 1-2: Sonnet review (unified template)
    → Tier 3: Opus review (unified template, skip đã self-review)
  → Sonnet fix bugs from review
  → Tùng test
  → Sonnet log bugs (Phase A)
  → Opus strategic review (Phase B — improvements + new features → feed vào backlog)
```
Số lần gọi Opus: 1-2 per feature (batch plan + chỉ tier 3 review hoặc strategic review)

### Ước tính giảm tải Opus: ~50-60%

---

## Action Items — Thứ tự triển khai

Nên triển khai theo thứ tự sau (từ thay đổi nhỏ đến lớn):

| Thứ tự | Điểm | Effort | Thay đổi cần làm |
|--------|-------|--------|-------------------|
| 1 | Điểm 5 | Thấp | Thêm Review Template vào CLAUDE.md + tạo `templates/review_prompt.md` |
| 2 | Điểm 3 | Thấp | Thêm Decision Log vào Planning Template + cập nhật Degraded Mode |
| 3 | Điểm 4 | Trung bình | Thêm self-review step + cập nhật task report template |
| 4 | Điểm 1 | Trung bình | Thêm Review Triage System + cập nhật file naming |
| 5 | Điểm 6 | Trung bình | Tách QA thành 2 phase + cập nhật MEMORY.md structure |
| 6 | Điểm 2 | Cao | Tạo backlog system + batch planning workflow |
