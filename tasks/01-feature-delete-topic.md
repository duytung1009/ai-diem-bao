# Feature: Xóa topic khỏi cache — Implementation Summary

**Date:** 2026-03-19
**Feature:** Delete cached topics both individually and in bulk

---

## Overview
Implemented feature to allow users to delete cached topics from:
1. **TopicHubView** — Delete individual topics with inline confirmation
2. **SettingsView** — Delete all cached topics with confirmation

Both features use the existing `DELETE_CACHED_TOPIC` message handler in background.

---

## Changes Made

### 1. TopicHubView.vue — Individual Topic Deletion

**File:** `entrypoints/sidepanel/views/TopicHubView.vue`

#### Script Changes:
- Added `pendingDeleteUrl` ref to track deletion confirmation state
- Added three functions:
  - `confirmDelete(topic)` — Set pending deletion URL
  - `cancelDelete()` — Clear pending deletion
  - `executeDelete()` — Delete topic, remove from list, clear selection if active

#### Template Changes:
- Refactored topic card from `<button>` to `<div>` container with two children:
  - Clickable card body `<button>` that calls `selectTopic(topic)`
  - Delete button (X icon) on top-right corner with `@click.stop="confirmDelete(topic)"`
- Added `pr-6` to title to avoid text overlap with delete button
- Added inline confirmation UI below each card:
  - Shows only when `pendingDeleteUrl === topic.url`
  - Has "Xóa" (Delete) and "Hủy" (Cancel) buttons
  - Matches design from feature spec

**Key Implementation Details:**
- Delete button uses `@click.stop` to prevent triggering card selection
- Confirmation UI uses `@click.stop` on both buttons to prevent event bubbling
- If deleted topic is currently selected, `store.clearSelection()` clears selection
- Topic list updates immediately after deletion via ref filter
- Silently handles delete errors; list refreshes on next `onActivated`

### 2. SettingsView.vue — Delete All Cache

**File:** `entrypoints/sidepanel/views/SettingsView.vue`

#### Script Changes:
- Added `showClearConfirm` ref to manage confirmation state
- Added `CachedTopic` type to imports
- Added three functions:
  - `confirmClearAll()` — Show confirmation dialog
  - `executeClearAll()` — Delete all topics, set cache size to 0
  - `cancelClearAll()` — Hide confirmation dialog

#### Template Changes:
- Added "Xóa tất cả cache" button in Cache storage info section
- Shows only when `!showClearConfirm`
- Added confirmation UI below button:
  - Shows when `showClearConfirm` is true
  - Has "Xóa" (Delete) and "Hủy" (Cancel) buttons
  - Warning text: "Xóa tất cả cache?"
- Uses red color scheme matching individual delete UI

**Key Implementation Details:**
- Queries all topics via `GET_ALL_CACHED_TOPICS`
- Deletes each topic individually via `DELETE_CACHED_TOPIC`
- Sets `cacheSizeBytes` to 0 after deletion completes
- Silently handles delete errors
- Hides confirmation UI after operation completes (success or error)

---

## Message Usage

Both features rely on existing background message handlers:
- `GET_ALL_CACHED_TOPICS` → Returns array of all cached topics
- `DELETE_CACHED_TOPIC` → Deletes single topic by URL (payload: string)

No new message types were added; both exist in `entrypoints/background/index.ts` lines 134-152.

---

## Testing Checklist

✅ Type check passes (`npx vue-tsc --noEmit`)

**Manual testing required:**
- [ ] TopicHubView: Hover topic card, X button visible
- [ ] TopicHubView: Click X, inline confirmation appears
- [ ] TopicHubView: Click "Xóa", topic disappears from list
- [ ] TopicHubView: Selected topic gets deleted, selection clears
- [ ] SettingsView: "Xóa tất cả cache" button visible in Cache section
- [ ] SettingsView: Click button, confirmation UI appears
- [ ] SettingsView: Click "Xóa", all topics deleted, cache size → 0
- [ ] Build succeeds: `npm run build`

---

## UI/UX Details

Both deletion features match the feature spec exactly:

**Individual Delete:**
- Delete button: Gray X icon, top-right corner of card
- Hover: Icon changes to red (#ef4444)
- Confirmation: Inline below card, red background, two buttons

**Delete All:**
- Button position: Below cache progress bar in Cache storage info section
- Button style: Red border, red text, light red hover
- Confirmation: Modal-style inline UI with two buttons

---

## Notes for Future Work

- If performance needs optimization, `executeClearAll()` could be enhanced to batch delete via a single `DELETE_ALL_CACHED_TOPICS` message (not yet implemented)
- Error handling is silent (no user toast/alert); consider adding notification system if needed
- Consider adding undo functionality if users request reversibility

---

## Summary

Feature fully implemented with inline confirmations for safety. No breaking changes to existing code. All TypeScript checks pass.
