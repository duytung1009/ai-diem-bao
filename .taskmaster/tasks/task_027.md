# Task ID: 27

**Title:** Refactor: ConfirmInline Common Component

**Status:** done

**Dependencies:** None

**Priority:** low

**Description:** Tạo ConfirmInline.vue dùng chung, thay 2 inline confirm pattern ở SummaryView (confirmingAutoSummarize) và KnowledgeView (confirmingExtract).

**Details:**

planning: planning/20260418_1131_refactor-confirm-dialog-common.md

Affected modules:
- entrypoints/sidepanel/components/ConfirmInline.vue — tạo mới, props: message, confirmLabel, cancelLabel
- entrypoints/sidepanel/views/SummaryView.vue — thay inline confirm
- entrypoints/sidepanel/views/KnowledgeView.vue — thay inline confirm

Design: block layout, dùng design tokens (btn, card). Không dùng modal overlay.

**Test Strategy:**

Verify behavior giống hệt inline confirm cũ. Test ở cả 2 views. Test keyboard/click cancel vs confirm.
