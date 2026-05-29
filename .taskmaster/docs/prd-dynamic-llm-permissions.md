<context>
# Overview

Chuyển toàn bộ `host_permissions` tĩnh của các LLM provider (OpenAI, Anthropic, Gemini, OpenRouter) sang dynamic permissions thông qua `chrome.permissions.request()`. Sau khi hoàn thành, manifest sẽ không còn bất kỳ `host_permissions` nào liên quan đến LLM — chỉ còn `optional_host_permissions: ['https://*/*', 'http://*/*']` đóng vai trò whitelist pattern. Quyền được cấp khi user save hoặc test connection lần đầu với một provider.

Mục tiêu: loại bỏ toàn bộ `host_permissions` khỏi manifest để extension không bị Chrome Web Store gắn cờ "host permission warning" ngay khi cài đặt.

# Core Features

- **Zero host_permissions in manifest**: No LLM provider URLs in manifest.json
- **Dynamic permission request**: Permissions granted at user gesture (save/test)
- **Permission caching**: Skip dialog if already granted (chrome.permissions.contains)
- **Migration banner**: Notify existing users after update to re-grant permissions
- **DEV mode bypass**: Skip permission requests in dev server

# User Experience

- User opens extension → no "access to all websites" warning at install
- User goes to Settings → selects provider → clicks Save → Chrome permission dialog appears (first time only)
- After update: banner in Settings says "cần cấp quyền cho provider" with a button
- No dialogs on subsequent saves
</context>
<PRD>
# Technical Architecture

## Component A: `wxt.config.ts` — Remove static host_permissions

Remove all LLM provider URLs from `host_permissions`. Keep `optional_host_permissions: ['https://*/*', 'http://*/*']`.

## Component B: `lib/permissions.ts` — Permission utility module

New module with:
- `originFromUrl(url: string): string | null` — extract origin pattern from URL
- `requestOriginPermission(origin: string): Promise<boolean>` — request permission for origin; DEV mode returns true
- `hasOriginPermission(origin: string): Promise<boolean>` — check if origin already granted

Uses native `chrome.permissions.request` callback API (not `browser.permissions.request`).

## Component C: `lib/llm/provider-origins.ts` — Provider origin map

New module with:
- `PROVIDER_BASE_URLS: Record<LLMProvider, string>` — map provider to base URL
- `getProviderOrigin(provider: LLMProvider, baseUrl: string): string | null` — return origin to request

## Component D: SettingsView.vue — Refactor permission request

- Rename `requestCustomOriginPermission` → `requestProviderPermission`
- Generalize to handle all providers (not just custom)
- Check `hasOriginPermission` before requesting (skip dialog if already granted)
- Update both `save()` and `testConnection()` call sites

## Component E: Background — No code changes needed

Dynamic permissions propagate automatically to service worker. No fetch code changes needed.

## Component F: Migration handler + banner

- `chrome.runtime.onInstalled` listener in background: set `needs_permission_reauth` flag
- SettingsView reads flag on mount, shows banner with "Cấp quyền" button

# Development Roadmap

## Phase 1: Foundation (no dependencies)
- [ ] Component B: Create `lib/permissions.ts`
- [ ] Component C: Create `lib/llm/provider-origins.ts`
- [ ] Component A: Update `wxt.config.ts` — remove host_permissions

## Phase 2: UI + migration (depends on Phase 1)
- [ ] Component D: Refactor SettingsView.vue — generalize permission request (depends on: B, C)
- [ ] Component F: Migration handler + banner (depends on: B, D)

## Phase 3: Verification
- [ ] Build check: `npm run compile` pass
- [ ] Manifest check: No LLM `host_permissions`
- [ ] Test each provider save flow

# Test Plan

1. **Build clean:** `npm run compile` pass không có type error
2. **Manifest check:** `.output/chrome-mv3/manifest.json` không có `host_permissions` cho LLM provider
3. **OpenAI Save:** dialog hiện với api.openai.com → grant → test OK
4. **Save lần 2:** dialog KHÔNG hiện (permission cached)
5. **Gemini Save:** dialog hiện với generativelanguage.googleapis.com
6. **Custom URL:** dialog hiện với origin đúng
7. **Update migration:** reload extension → banner hiện nếu chưa grant
8. **DEV mode:** không có dialog
</PRD>
