<context>
# Overview

Gộp `gemini-free` provider vào `gemini` — cả hai đều trỏ cùng API endpoint, dùng cùng GeminiAdapter, chỉ khác default model. Xóa `gemini-free` khỏi codebase.

# Core Features

- Remove `'gemini-free'` from `LLMProvider` type
- Remove `'gemini-free'` from factory, provider-origins, SettingsView, HelpView
- Simplify `isGemini` computed
- Zero breaking changes to behavior

# User Experience

- Provider dropdown in Settings: chỉ còn "Google Gemini" (không còn "Google Gemini (Free Tier)")
- User chọn "Google Gemini" rồi chọn model `gemini-2.5-flash-lite` nếu muốn free tier
- HelpView: cập nhật text hướng dẫn
</context>
<PRD>
# Technical Architecture

## Component A: `lib/types.ts`
Remove `'gemini-free'` from `LLMProvider` union type.

## Component B: `lib/llm/factory.ts`
Remove `case 'gemini-free':` — chỉ còn `case 'gemini':`

## Component C: `lib/llm/provider-origins.ts`
Remove `'gemini-free'` entry from `PROVIDER_BASE_URLS`.

## Component D: `entrypoints/sidepanel/views/SettingsView.vue`
- Remove `'gemini-free'` from `providerDefaults`
- Simplify `isGemini` computed to `config.value.provider === 'gemini'`
- Remove `gemini-free` option from dropdown

## Component E: `entrypoints/sidepanel/views/HelpView.vue`
Update text: replace "Google Gemini (Free Tier)" → "Google Gemini", add note about model selection.

# Development Roadmap

## Phase 1: Type + code (one phase, no deps)
- [ ] Component A: Remove from types.ts
- [ ] Component B: Remove from factory.ts
- [ ] Component C: Remove from provider-origins.ts
- [ ] Component D: Remove from SettingsView.vue
- [ ] Component E: Update HelpView.vue

## Phase 2: Verification
- [ ] Build: npm run compile pass, zero TS errors
- [ ] QA: Select Gemini, test connection

# Test Plan
1. `npm run compile` — zero errors
2. Select Google Gemini, model gemini-2.5-flash-lite → test connection works
3. HelpView: no "Free Tier" provider reference
</PRD>
