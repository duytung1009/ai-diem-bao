<context>
# Overview
Tái cấu trúc thanh điều hướng (tab bar) của sidepanel để nhóm các chức năng phụ thuộc vào thớt (Tóm tắt, Kiến thức, Phân tích, Tra cứu) vào bên trong tab "Thớt". Giảm số lượng tab top-level từ 7 xuống 4, tránh gây rối cho người dùng và làm rõ rằng các chức năng này chỉ hoạt động khi đã chọn một thớt.

# Core Features
- **Top-level tabs**: Thớt, Sổ tay, Cài đặt, ? (Hướng dẫn)
- **Sub-tabs trong Thớt**: Tóm tắt, Kiến thức, Phân tích, Tra cứu — chỉ hiển thị khi đã chọn thớt
- **Phân tích** được tách thành tab riêng (hiện tại đang là sub-tab của Tóm tắt)

# User Experience
- Người dùng vào sidepanel → thấy 4 tab top-level rõ ràng
- Tab "Thớt" hiển thị danh sách thớt đã cache (TopicHubView)
- Khi chọn một thớt → tự động vào chế độ detail với 4 sub-tabs bên dưới
- Sub-tab bar có button "← Danh sách" để quay về hub
- Khi đang ở sub-tab detail mà chọn tab top-level khác (Sổ tay, Cài đặt) → sub-tab bar biến mất
</context>
<PRD>
# Technical Architecture

## Route Structure (updated)

| Route | View | Tab |
|-------|------|-----|
| `/` | TopicHubView | Thớt (hub mode) |
| `/summary` | SummaryView | Thớt (detail, sub: Tóm tắt) |
| `/knowledge` | KnowledgeView | Thớt (detail, sub: Kiến thức) |
| `/analysis` | AnalysisView (**new**) | Thớt (detail, sub: Phân tích) |
| `/research` | ResearchView | Thớt (detail, sub: Tra cứu) |
| `/notebook` | NotebookView | Sổ tay |
| `/settings` | SettingsView | Cài đặt |
| `/help` | HelpView | ? |

Routes giữ nguyên flat structure — không dùng nested routes để tránh refactor lớn. Sub-tab bar là UI thuần trong App.vue, không ảnh hưởng routing.

## Component Changes

### 1. App.vue — Top-level nav
- **Remove** 3 nút: Tóm tắt, Kiến thức, Tra cứu
- **Keep** 4 nút: Thớt, Sổ tay, Cài đặt, ?
- Logic active "Thớt": `route.name === 'hub' || isTopicDetailRoute`
- Logic active "Sổ tay": `route.name === 'notebook'`

### 2. App.vue — Sub-tab bar (new)
```html
<div v-if="isTopicDetailRoute && hasSelectedTopic" class="...">
  <button @click="navigateTo('/')" :class="route.name === 'hub' ? ...">← Danh sách</button>
  <button @click="navigateTo('/summary')" :class="route.name === 'summary' ? ...">Tóm tắt</button>
  <button @click="navigateTo('/knowledge')" :class="route.name === 'knowledge' ? ...">Kiến thức</button>
  <button @click="navigateTo('/analysis')" :class="route.name === 'analysis' ? ...">Phân tích</button>
  <button @click="navigateTo('/research')" :class="route.name === 'research' ? ...">Tra cứu</button>
</div>
```
- `isTopicDetailRoute` mở rộng thêm `'analysis'`
- Sub-tab bar render giữa top-nav và TopicMeta/router-view

### 3. main.ts — Add `/analysis` route
```typescript
{ path: '/analysis', name: 'analysis', component: () => import('./views/AnalysisView.vue') }
```

### 4. New: AnalysisView.vue
- View mới chứa nội dung "Phân tích thread"
- Sử dụng `ThreadAnalysisContent` component
- Tạo composable `useThreadAnalysis.ts` để quản lý state:
  - `threadAnalysis`: ref từ store hoặc local
  - `isAnalyzing`: trạng thái đang chạy
  - `generateAnalysis()`: gọi LLM, lưu vào store + IDB
  - Dependencies: cần `summaryJson` có sẵn → kiểm tra trước khi cho phép generate

### 5. SummaryView.vue — Remove sub-tabs
- Xóa `activeSummaryView` ref
- Xóa UI sub-tab "Tóm tắt / Phân tích"
- Xóa `<ThreadAnalysisContent>` block
- **Giữ nguyên** phần hiển thị summary content + segment tabs
- **Giữ nguyên** composable `useSummarize` — thread analysis generation sẽ do composable mới `useThreadAnalysis` đảm nhiệm

### 6. New composable: useThreadAnalysis.ts
- Read threadAnalysis from store: `computed(() => store.selectedTopic.value?.threadAnalysis ?? null)`
- `isAnalyzing`: local ref
- `summaryJson`: read from store's segments
- `generateAnalysis()`: uses `useLLM().threadAnalysisTask`, saves result via `SAVE_CACHED_TOPIC`, updates store
- Exported return: `{ threadAnalysis, isAnalyzing, generateAnalysis }`

### 7. Update keep-alive + route includes
- `isTopicDetailRoute` trong App.vue cần thêm `'analysis'`
- TopicMeta vẫn hiển thị cho `['summary', 'knowledge', 'analysis', 'research']`

### 8. Cross-navigation updates
- SummaryView: nút CTA knowledge → vẫn navigate `/knowledge?extract=true`
- KnowledgeView: nút "Xem sổ tay" → vẫn navigate `/notebook`
- NotebookView: "Mở trong thớt" → navigate `/knowledge?focus=<id>` → vẫn hoạt động
- Không cần thay đổi các cross-link này vì route structure giữ nguyên

## Data Flow (unchanged)
Store.selectedTopic vẫn là single source of truth. Các route không thay đổi, chỉ thay đổi UI navigation. Không refactor data flow.

# Development Roadmap

## Phase 1: Create AnalysisView + useThreadAnalysis
- [ ] Tạo `useThreadAnalysis.ts` composable
- [ ] Tạo `AnalysisView.vue`
- [ ] Thêm route `/analysis` trong main.ts
- [ ] Verify: AnalysisView hiển thị ThreadAnalysisContent + generate button

## Phase 2: Refactor SummaryView — remove sub-tabs
- [ ] Xóa `activeSummaryView` và sub-tab UI
- [ ] Xóa ThreadAnalysisContent render block
- [ ] Verify: SummaryView chỉ còn summary + segment tabs

## Phase 3: Refactor App.vue navigation
- [ ] Top-level nav: chỉ 4 tab (Thớt, Sổ tay, Cài đặt, ?)
- [ ] Sub-tab bar: hiển thị khi isTopicDetailRoute && hasSelectedTopic
- [ ] Cập nhật `isTopicDetailRoute` (thêm 'analysis')
- [ ] Verify: navigation hoạt động đúng, tab highlight đúng

## Phase 4: Cleanup & verify
- [ ] `npm run compile` pass
- [ ] `npm run test` pass
- [ ] Kiểm tra các cross-reference navigation không bị hỏng
- [ ] Manual test flow: hub → select topic → toggle sub-tabs → back to hub

# Logical Dependency Chain
1. AnalysisView + useThreadAnalysis (foundation — cần view này trước khi refactor SummaryView)
2. SummaryView cleanup (depends on AnalysisView existing)
3. App.vue navigation refactor (depends on both views ready)
4. Full verify

# Risks and Mitigations
- **Risk**: `useSummarize` hiện tại quản lý threadAnalysis state → tách ra có thể gây duplicate state
  - **Mitigation**: AnalysisView đọc threadAnalysis từ store (CachedTopic.threadAnalysis). Composable mới chỉ generate, không giữ state song song
- **Risk**: `<keep-alive>` có thể cache view không mong muốn sau restructure
  - **Mitigation**: Keep-alive giữ nguyên, chỉ thêm route mới. Chỉ include/exclude name-based nếu cần
- **Risk**: Không dùng nested routes có thể gây khó maintain sau này
  - **Mitigation**: Nếu cần nested routes, đây là bước đầu đơn giản. Có thể migrate sang nested routes ở phase sau
</PRD>
