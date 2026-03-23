# Review Prompt Template

> Dùng cho cả Sonnet và Opus review. BẮT BUỘC output đúng format trong CLAUDE.md "Review Template".

## Instructions

Review code changes theo checklist. Output PHẢI theo format Review Template trong CLAUDE.md.

### Quy tắc chung
- Đánh giá từng category trong checklist (✅/❌/⚠️/N/A)
- List issues theo severity giảm dần: critical > major > minor > nit
- Critical/Major issues → `overall: request-changes`
- Chỉ minor/nit → `overall: approve`
- Nếu Sonnet review mà phát hiện issue vượt khả năng đánh giá → `overall: needs-opus-review`

### Theo tier
- **Tier 1 (Quick):** Focus logic correctness + consistency with patterns. Skip performance/security nếu không liên quan.
- **Tier 2 (Standard):** Đánh giá đầy đủ checklist. Chú ý error handling + edge cases.
- **Tier 3 (Deep/Opus):** Đánh giá toàn diện. Đặc biệt chú ý architecture impact, cross-module side effects, performance implications. Nếu có Self-review Results từ task report → skip những gì đã check, focus vào remaining issues + architecture.

### Context cần đọc trước khi review
1. `MEMORY.md` — project context, patterns, recent changes
2. Planning file liên quan — hiểu ý định, Decision Log
3. Self-review results trong task report (nếu có) — biết những gì đã check
