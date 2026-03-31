# Bug Fix: Settings tab hiển thị prompt "Ý kiến" thay vì "Kiến thức"

**Date:** 2026-03-31 16:40
**Severity:** Low
**Files changed:**
- `entrypoints/sidepanel/views/SettingsView.vue`

## Bug Description

Sau khi implement Feature 19 (Knowledge Base tab thay thế Opinions tab), tab Prompt Templates trong SettingsView vẫn giữ nguyên tab cũ "Ý kiến" trỏ đến `OPINION_ANALYSIS_PROMPT`. Tab "Kiến thức" với `KNOWLEDGE_EXTRACT_PROMPT` chưa được thêm vào.

## Root Cause

Feature 19 chỉ update router (`main.ts`) và navigation (`App.vue`), nhưng bỏ sót SettingsView — nơi có UI riêng để customize prompt theo từng tab.

## Fix

5 thay đổi trong `SettingsView.vue`:

| Line | Before | After |
|------|--------|-------|
| import | `OPINION_ANALYSIS_PROMPT` | `KNOWLEDGE_EXTRACT_PROMPT` |
| `activePromptTab` type | `'summary' \| 'opinions' \| 'research'` | `'summary' \| 'knowledge' \| 'research'` |
| `defaultPrompts` | `opinions: OPINION_ANALYSIS_PROMPT` | `knowledge: KNOWLEDGE_EXTRACT_PROMPT` |
| `promptTabLabels` | `opinions: 'Ý kiến'` | `knowledge: 'Kiến thức'` |
| template `v-for` tabs | `['summary', 'opinions', 'research']` | `['summary', 'knowledge', 'research']` |

## Self-review Results
- Issues found: 0
- Issues fixed: 0
- Remaining: none

| Category | Status | Notes |
|----------|--------|-------|
| Logic correctness | ✅ | Đúng key match với `CustomPrompts.knowledge` trong types.ts |
| Edge cases covered | ✅ | `customPrompts[tab]` vẫn hoạt động (key thay đổi nhất quán) |
| Error handling | N/A | |
| Performance concerns | N/A | |
| Security implications | N/A | |
| Consistency with patterns | ✅ | Nhất quán với thay đổi ở main.ts và App.vue |
| Type safety | ✅ | `activePromptTab` type union cập nhật đúng |
| Test coverage | N/A | |

## MEMORY.md Update

Thêm vào section Tasks/Bugfix gần nhất:

```
- [x] Bug: Settings tab "Ý kiến" → "Kiến thức" — tasks/20260331_1640_bug_fix-settings-knowledge-tab.md
```

Cập nhật entry Feature 19 (Knowledge Base): thêm ghi chú "Settings prompt tab đã đồng bộ".
