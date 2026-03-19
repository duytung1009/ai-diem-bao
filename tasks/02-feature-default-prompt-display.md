# Feature: Default Prompt Display in Settings — COMPLETED

## Summary
Implemented ability to view full default prompts in Settings → Prompt Templates section, replacing truncated 120-character placeholder with an expandable viewer.

## Changes Made

### File: `entrypoints/sidepanel/views/SettingsView.vue`

**1. Import Update (Line 2)**
- Added `watch` to imports: `import { ref, computed, onMounted, watch } from 'vue';`

**2. New State Ref (Line 23)**
- Added: `const showDefaultPrompt = ref(false);`
- Controls visibility of default prompt viewer panel

**3. Watch Hook (Lines 66-68)**
- Automatically closes default prompt viewer when user switches between prompt tabs
- Ensures clean UX when navigating between Summary/Opinions/Research tabs

**4. Updated Textarea Placeholder (Line 350)**
- Changed from: `:placeholder="defaultPrompts[activePromptTab].slice(0, 120) + '...'"`
- Changed to: `placeholder="Nhập prompt tuỳ chỉnh... (bấm 'Xem prompt mặc định' để xem prompt gốc)"`
- Now provides clear hint to users about viewing full default prompts

**5. New UI Elements (Lines 352-365)**
- **Toggle Button (Lines 353-359)**
  - Text: "▸ Xem prompt mặc định" → "▾ Ẩn prompt mặc định" (expandable arrow)
  - Styling: `text-xs text-blue-600 hover:text-blue-700` (subtle blue link style)
  - Toggles `showDefaultPrompt` state on click

- **Default Prompt Display Panel (Lines 360-365)**
  - Only renders when `showDefaultPrompt === true` using `v-if`
  - Shows full default prompt in scrollable container: `max-h-48 overflow-y-auto`
  - Uses `<pre>` tag with:
    - `whitespace-pre-wrap` — preserves formatting
    - `font-mono` — monospace font for better code readability
    - `text-xs text-gray-600` — subtle gray text

## Verification Completed ✓

1. ✅ Vue TypeScript compilation: `npx vue-tsc --noEmit` — No errors
2. ✅ Build: `npm run build` — Success (299.52 kB)
3. ✅ All 3 prompt tabs have toggle functionality
4. ✅ Prompt viewer auto-closes on tab switch
5. ✅ Placeholder now guides users to use the viewer

## User Flow

1. Open Settings → Prompt Templates
2. In any tab (Summary/Opinions/Research), textarea shows helpful placeholder
3. Click "▸ Xem prompt mặc định" to expand viewer below textarea
4. Scroll through full default prompt in the bordered panel
5. Click "▾ Ẩn prompt mặc định" to collapse
6. Switch tabs → viewer automatically closes, ready for next tab's prompt
7. Enter custom prompt in textarea and click "Lưu Prompts" (existing functionality unchanged)

## No Breaking Changes
- All existing Settings functionality preserved
- Backward compatible with cached custom prompts
- No changes to message handlers or business logic
