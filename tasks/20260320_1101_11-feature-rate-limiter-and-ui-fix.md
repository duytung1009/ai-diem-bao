# Feature 11: Rate limiter, Segment size config, Fix UI tràn dòng, Cursor pointer

## Task 1: Rate limiter cấu hình được cho scraping ✅

**Files thay đổi:**
- `lib/types.ts` — Thêm `scrapeDelayMs?: number` và `segmentSize?: number` vào `LLMConfig`
- `lib/constants.ts` — Thêm `DEFAULT_SCRAPE_DELAY_MS = 2000` và `DEFAULT_SEGMENT_SIZE = 20`
- `lib/scrapers/page-loader.ts` — Thêm `delayMs: number = 2000` parameter vào `scrapeAllPages` và `scrapePageRange`; delay công thức `delayMs + jitter` (jitter = random * min(30% of delay, 500ms))
- `entrypoints/content/index.ts` — Đọc `delayMs` từ message payload trong cả `SCRAPE_ALL_PAGES` và `SCRAPE_PAGE_RANGE` handlers
- `entrypoints/sidepanel/views/SummaryView.vue` — Thêm `delayMs` parameter vào `scrapeInChunks()`; truyền vào tất cả 3 call sites dùng `currentConfig.value?.scrapeDelayMs ?? 2000`; reload settings trong `onActivated`
- `entrypoints/sidepanel/views/SettingsView.vue` — Import defaults mới; `onMounted` apply defaults cho `scrapeDelayMs` và `segmentSize`; thêm section "Cấu hình Scraping" với 2 range sliders

## Task 2: Fix UI tràn dòng ở block summary info ✅

**Files thay đổi:**
- `entrypoints/sidepanel/views/SummaryView.vue` — Dòng 775: `flex` → `flex flex-wrap gap-y-1.5 gap-x-3`; thêm `min-w-0` + `shrink-0` + `truncate` cho inner elements
- `entrypoints/sidepanel/components/CacheIndicator.vue` — Container: `flex items-center gap-2` → `flex flex-wrap items-center gap-x-2 gap-y-1`

## Task 3: Cursor pointer cho buttons và links ✅

**Files thay đổi:**
- `assets/main.css` — Thêm `cursor: pointer` vào `@utility btn` và `@utility card-interactive`; thêm global rule `button:not(:disabled), a, [role="button"]:not(:disabled) { cursor: pointer; }`

## Task 4: Segment size cấu hình được (default 20 thay vì 100) ✅

**Files thay đổi:**
- `lib/types.ts` — `segmentSize?: number` trong `LLMConfig` (xem Task 1)
- `lib/constants.ts` — `DEFAULT_SEGMENT_SIZE = 20` (xem Task 1)
- `entrypoints/sidepanel/views/SummaryView.vue` — Xóa `const SEGMENT_SIZE = 100; const SEGMENT_THRESHOLD = 100;`; thay bằng `const segmentSize = ref(20)`; `isSegmentMode` và `segments` computed dùng `segmentSize.value`; load từ settings trong `onMounted` và `onActivated`; template dùng `{{ segmentSize }}`
- `entrypoints/sidepanel/views/SettingsView.vue` — Thêm segment size slider trong section "Cấu hình Scraping"

## Build
- `npx vue-tsc --noEmit` ✅
- `npm run build` ✅ → 320.17 kB
