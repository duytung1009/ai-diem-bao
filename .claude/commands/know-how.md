# Know How — Chrome Extension Debug Lessons

Các bài học từ bug phức tạp trong dự án AI Điểm Báo. Gọi skill này khi gặp bug khó tái hiện, lỗi Chrome API, CORS, CSP, scraper, hay LLM map-reduce.

## Khi nào thêm entry mới

Thêm entry vào **cuối file này** khi gặp **cả 3 điều kiện**:
1. Bug tốn > 2 vòng debug (agent đoán sai root cause ít nhất 1 lần)
2. Root cause nằm ở hành vi platform/browser/framework, không hiển nhiên từ error message
3. Fix pattern có thể tái sử dụng

**Format entry mới:**

```markdown
### KH{n}: {tiêu đề ngắn gọn}

**Triệu chứng:**
- {dấu hiệu nhận biết}

**Root cause:**
- {tại sao xảy ra}

**Fix:**
- {pattern fix, kèm code nếu cần}

**Anti-pattern:**
- {pattern không được dùng}
```

Đặt entry mới ở **cuối**, đánh số tăng dần.

---

### KH1: CSP `script-src 'self'` Violation Khi `fetch()` HTML Từ Extension Page

**Triệu chứng:**
- Sidepanel console báo CSP violation: `Loading the script 'https://...' violates script-src 'self'`
- Lỗi xuất hiện tại dòng `await fetch(url)`, ngay cả khi chưa gọi `DOMParser.parseFromString()`
- URL trong error là external script từ trang đích (vd `voz.vn/js/...`)

**Root cause:**
- Chrome MV3 áp `script-src 'self'` lên **response body** của `fetch()` gọi từ extension page context (sidepanel, popup, options)
- CSP engine quét resource URL trong raw HTML response, không cần parse DOM
- Background service worker **không** bị kiểm tra này vì chạy không có renderer

**Fix:**
- Luôn route `fetch()` HTML qua background service worker bằng message `FETCH_HTML`
- Sidepanel nhận raw text, tự xử lý `DOMParser` + `safeHtml` sanitize

```typescript
// ❌ Sidepanel: CSP violation
const res = await fetch(pageUrl, { credentials: 'include' });

// ✅ Sidepanel gọi background
const { ok, status, html, finalUrl } = await sendMessage<FetchHtmlResult>(
  'FETCH_HTML', { url: pageUrl }
);
```

**Anti-pattern:**
- `fetch()` external HTML trực tiếp từ **bất kỳ** extension page context nào (sidepanel, popup, options)

---

### KH2: Mock `createProvider()` để test LLM orchestration mà không refactor production code

**Triệu chứng:**
- Cần test `summarizeTopic`, `updateSummary` nhưng không muốn gọi API thật
- `createProvider()` được gọi trực tiếp trong `summarizer.ts` — không có dependency injection
- Refactor để inject provider sẽ thay đổi nhiều file production code

**Root cause:**
- Factory pattern `createProvider()` hard-coded trong orchestrator functions
- Test cần override behavior nhưng không muốn thay đổi signature của production functions

**Fix:**
- Dùng `vi.spyOn(factoryModule, 'createProvider')` trong test để intercept calls
- `MockLLMProvider` implement `LLMProvider` interface — trả về configurable responses
- `overrideCreateProvider()` và `restoreCreateProvider()` wrapper để manage spy lifecycle
- Test predict behavior bằng `willExceedContext()` trước khi assert `mock.getCallCount()`

```typescript
// tests/mocks/override-factory.ts
export function overrideCreateProvider(provider: LLMProvider): void {
  vi.spyOn(factoryModule, 'createProvider').mockImplementation(() => provider);
}
export function restoreCreateProvider(): void {
  vi.restoreAllMocks();
}

// In test:
const mock = createMockProvider();
await summarizeTopic(posts, config);
expect(mock.getCallCount()).toBe(1);
```

**Anti-pattern:**
- Refactor production code chỉ để phục vụ testing (thêm DI, inject provider vào mọi function)
- Mock `fetch`/`browser.runtime` ở level quá thấp — nên mock ở `LLMProvider` interface level

---

### KH4: Thêm Debug Logs Sớm Khi Gặp Bug Phức Tạp — Đừng Suy Đoán Quá Nhiều

**Triệu chứng:**
- Bug không tái hiện được trong test environment
- Agent spending nhiều vòng phân tích code tĩnh, suy đoán root cause mà không verify được
- Multiple hypotheses đều plausible nhưng không confirm được cái nào đúng

**Root cause:**
- Khi bug chỉ xảy ra ở runtime (real extension, scraper parsing, network) — code analysis tĩnh không đủ
- Agent có xu hướng "dry-debug" — đọc code, suy luận, hypothesize — thay vì add logs để capture thực tế
- Mỗi vòng hypothesize tốn context window mà không tiến gần hơn đến root cause

**Fix:**
- Khi bug phức tạp (> 2 vòng đoán sai hoặc không reproduce được trong test), **NGAY LẬP TỨC** thêm `console.log` strategic ở các điểm data flow quan trọng
- Log format: `[functionName]` prefix + structured data (counts, distributions, key values)
- Đặt logs ở: (1) input/output của function suspected, (2) mỗi bước transform data, (3) ngay trước khi data gửi đi
- Giữ logs trong code cho đến khi bug confirmed fix — không xóa sớm

```typescript
// ✅ Strategic logging tại data flow checkpoints
console.log('[runSummarizeJob] Scrape complete:', {
  newPostsCount: newPosts.length,
  allPostsCount: allPosts.length,
  pageDistribution: Object.entries(allPosts.reduce(...)).join(', '),
});
```

**Anti-pattern:**
- Spending > 2 vòng đọc code suy đoán root cause mà không add logs
- Xóa debug logs ngay sau khi test pass — cần giữ cho user verify ở runtime
- Add logs quá chi tiết (logging từng post) — nên log aggregated data

---

### KH3: Scraper filter `content.trim()` gây mất bài viết khi tóm tắt

**Triệu chứng:**
- FETCH_HTML trả về số post ít hơn thực tế (thiếu 1 post, thường là post cuối của trang trước)
- Số post bị thiếu không cố định — phụ thuộc vào nội dung HTML của từng post

**Root cause:**
- XF1/XF2 scraper filter `if (content.trim())` loại bỏ post có content rỗng sau khi strip quote, signature, media wrapper
- Một số post chỉ chứa image, emoji, hoặc embed media — sau khi `extractContent()` strip các thẻ HTML thì `content.trim()` trả về `""` → post bị loại hoàn toàn

**Fix:**
- Xóa filter `content.trim()` trong cả `xf1-scraper.ts` và `xf2-scraper.ts` — scrapers phải trả về TẤT CẢ posts, để LLM quyết định nội dung nào quan trọng

```typescript
// ❌ Trước: filter content rỗng — loại bỏ post image-only, emoji-only
if (content.trim()) {
  posts.push({ author, content, timestamp, postNumber });
}

// ✅ Sau: giữ tất cả posts, để LLM xử lý
posts.push({ author, content, timestamp, postNumber });
```

**Anti-pattern:**
- Bất kỳ filter nào trong scraper loại bỏ post theo content — scraper phải neutral, chỉ thu thập
- Sau khi thay đổi scraper/filter, luôn verify tổng số post phải khớp với số trên trang web thật

---

### KH5: `reduce_knowledge_chunks` completion_tokens vượt max_tokens

**Triệu chứng:**
- `reduce_knowledge_chunks` task thường xuyên bị `INCOMPLETE_RESPONSE` (`finish_reason: 'length'` / `stop_reason: 'max_tokens'`)
- `truncationWarning` tăng bất thường trong Knowledge view
- Lỗi xảy ra cả khi chưa bật thinking mode

**Root cause:**
- `calcMaxOutputEntries()` (`useKnowledge.ts:212`) dùng `Math.max(10, ...)` làm floor: với `maxOutputTokens = 4096` → cap=10, nhưng model chỉ đủ ~4 entries (700 tokens/entry × 4 = 2800 < 4096) → model cố output 10 → overflow
- Pre-reduce split theo chunk count thay vì entry count: mỗi chunk có 0-20+ entries, split theo `allPartial.length` → mỗi group có thể chứa 20-50 entries; không truyền `entryCap` → default cap=20

**Fix:**
- Bỏ `Math.max(10, ...)`, thay bằng `Math.max(2, ...)` — để multi-call split path xử lý workload lớn
- Pre-reduce: flatten entry arrays → split theo entry count (2×maxPerCall per group)
- Luôn truyền `entryCap = maxPerCall` cho mọi pre-reduce call

```typescript
// ❌ Trước: floor quá cao, split theo chunk count, không có entryCap
function calcMaxOutputEntries(maxOutputTokens: number): number {
  return Math.max(10, Math.floor(maxOutputTokens * 0.8 / TOKENS_PER_ENTRY_REDUCE));
}

// ✅ Sau: floor thấp, split theo entry count, luôn có entryCap
function calcMaxOutputEntries(maxOutputTokens: number): number {
  return Math.max(2, Math.floor(maxOutputTokens * 0.8 / TOKENS_PER_ENTRY_REDUCE));
}
const maxPerCall = calcMaxOutputEntries(maxOutputTokens);
const allFlat = allPartial.flat();
for (let i = 0; i < allFlat.length; i += maxPerCall * 2) {
  reduceKnowledgeChunksTask([allFlat.slice(i, i + maxPerCall * 2)], maxPerCall);
}
```

**Anti-pattern:**
- Floor `Math.max(10, ...)` cho entry cap — bỏ qua budget thực tế của model nhỏ
- Split theo chunk count thay vì entry count — chunk count không phản ánh khối lượng công việc thực tế
- Gọi reduce mà không truyền `entryCap` — default 20 thường quá cao

---

### KH6: Background Service Worker Không Tự Động Bypass CORS

**Triệu chứng:**
- `fetch()` từ sidepanel hoặc background đến XenForo forum bị CORS block
- Lỗi chỉ xảy ra với một số forum (otofun.net), không xảy ra với forum khác (voz.vn có CORS headers)

**Root cause:**
- Chrome MV3 service workers **cần** `host_permissions` để bypass CORS khi `fetch()` cross-origin — không giống MV2
- Một số forum (voz.vn) trả `Access-Control-Allow-Origin: *` nên hoạt động dù không có `host_permissions`

**Fix:**
- `optional_host_permissions: ['https://*/*', 'http://*/*']` trong manifest → xin quyền động
- Background handler `FETCH_HTML`/`FETCH_FORUM_LIST`: kiểm tra `chrome.permissions.contains()` trước fetch, trả `{ needPermission: true, origin }` nếu chưa có
- Sidepanel: nhận `needPermission` → hiển thị prompt → user click "Cấp quyền" → retry

```typescript
// Background handler pattern:
case 'FETCH_HTML': {
  const { url } = message.payload;
  const origin = new URL(url).origin + '/*';
  chrome.permissions.contains({ origins: [origin] }, (hasPerm) => {
    if (!hasPerm) {
      sendResponse({ needPermission: true, origin });
      return;
    }
    // proceed with fetch...
  });
}
```

**Anti-pattern:**
- Giả định background service worker tự động bypass CORS — sai cho Chrome MV3
- Gọi `fetch()` cross-origin từ sidepanel/popup/options page trực tiếp — luôn route qua background
- Dùng `host_permissions: ['*://*/*']` cứng trong manifest

---

### KH7: Cross-Browser Firefox — MV2 Build + Mất User-Activation + `DataCloneError` Vue Proxy

Migrate `chrome.*` → `browser.*` chỉ giải quyết **API surface**. Firefox còn 3 khác biệt platform độc lập làm extension chạy ngon trên Chrome nhưng fail. Cả 3 cùng xuất hiện ở luồng Settings nên dễ tưởng là một bug — thực ra phải fix riêng từng cái.

**Triệu chứng:**
- `browser.permissions.request({ origins })` luôn trả `false` / reject trên Firefox, Chrome bình thường. UI báo "Chưa cấp quyền...", "Permission denied for provider host"
- Sau khi sửa build, **một số** luồng cấp quyền chạy (nút "Thêm forum") nhưng luồng khác vẫn fail (lưu provider ở Settings)
- Sau khi sửa activation, luồng lưu lại báo `DataCloneError: Proxy object could not be cloned` (Chrome không bao giờ thấy lỗi này)

**Root cause (BA bug độc lập):**
1. **Firefox build ra MV2:** WXT mặc định build Firefox ở Manifest V2. Key `optional_host_permissions` là **MV3-only** → bị rớt hoàn toàn khỏi manifest MV2 (WXT không tự dịch sang `optional_permissions`). Manifest kết thúc với 0 optional permission → Firefox reject mọi `permissions.request` vì origin không được khai báo. Chrome chạy vì build MV3, key hợp lệ.
2. **Mất user-activation qua `await`:** Firefox xóa cờ user-activation sau **mỗi** `await`. Gọi `await permissions.contains()` (pre-check) *trước* `permissions.request()` → lúc `request()` chạy activation đã mất → reject. Chrome khoan dung hơn. Đây là lý do "Thêm forum" (gọi `request` ngay) chạy, còn Settings (check `contains` trước) fail.
3. **`DataCloneError` khi gửi Vue proxy qua message:** `config.value` / store state là Vue reactive (hoặc readonly) Proxy. Structured-clone của Firefox **không** clone được Proxy → throw. Chrome tự clone target bên dưới nên im. Lỗi xảy ra cả khi spread proxy vào object phẳng (`{ url, ...partial }`) vì giá trị lồng vẫn là proxy.

**Fix:**
- **Bug 1 — ép MV3 mọi target** trong `wxt.config.ts`:
  ```typescript
  export default defineConfig({
    manifestVersion: 3,   // WXT mặc định Firefox = MV2, làm rớt optional_host_permissions
    manifest: (env) => ({ ... }),
  });
  ```
  Verify: `cat .output/firefox-mv3/manifest.json` → phải có `"manifest_version":3` + `"optional_host_permissions":[...]`. Firefox 128+ hỗ trợ MV3 + `optional_host_permissions` (từ FF 127) + `scripting` + `sidebar_action`.
- **Bug 2 — `permissions.request()` là await đầu tiên** trong gesture chain. Bỏ pre-check `contains()` (request idempotent, không hiện dialog nếu đã cấp):
  ```typescript
  // ❌ contains() trước request() → mất activation trên Firefox
  const already = await hasOriginPermission(origin);
  if (already) return true;
  return requestOriginPermission(origin);
  // ✅ request() là await đầu tiên
  return requestOriginPermission(origin);
  ```
- **Bug 3 — unwrap Vue proxy thành plain object trước khi `sendMessage`.** Fix tập trung trong `lib/messaging.ts`, áp cho mọi payload (deep `toRaw`, giữ nguyên class-instance/Date/Map/Set để structured clone xử lý native):
  ```typescript
  import { isRef, toRaw, unref } from 'vue';
  function toPlain<T>(input: T): T {
    const value = isRef(input) ? unref(input) : input;
    if (Array.isArray(value)) return value.map(toPlain) as unknown as T;
    if (value !== null && typeof value === 'object') {
      const raw = toRaw(value as object) as Record<string, unknown>;
      const proto = Object.getPrototypeOf(raw);
      if (proto !== Object.prototype && proto !== null) return raw as unknown as T;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(raw)) out[k] = toPlain(raw[k]);
      return out as unknown as T;
    }
    return value as unknown as T;
  }
  // sendMessage: browser.runtime.sendMessage({ type, payload: toPlain(payload) })
  ```

**Anti-pattern:**
- Để WXT build Firefox ở MV2 mặc định khi config dùng key MV3 (`optional_host_permissions`, `strict_min_version: 128`) — luôn set `manifestVersion: 3` và verify manifest sinh ra
- Đặt **bất kỳ** `await` nào (kể cả `permissions.contains`, `storage.get`) trước `permissions.request()` trong cùng handler — Firefox mất user-activation. Request phải là async op đầu tiên sau user gesture
- Gửi reactive/readonly proxy (`config.value`, `store.*.value`, hay spread của chúng) trực tiếp qua `browser.runtime.sendMessage` — Chrome chịu, Firefox `DataCloneError`. Luôn unwrap về plain object trước
- Tin rằng "migrate `chrome.*` → `browser.*` là đủ để cross-browser" — polyfill chỉ giải quyết API surface, không xử lý manifest version, user-activation semantics, hay structured-clone của Proxy
