# Review: Feature 18 — Move Scraping to Sidepanel

### Metadata
- **Files reviewed:** `entrypoints/sidepanel/views/SummaryView.vue`, `entrypoints/content/index.ts`, `lib/types.ts`, `entrypoints/background/index.ts`
- **Review tier:** tier2
- **Model used:** sonnet
- **Diff size:** ~200 LOC removed + ~100 LOC net new

---

### Checklist

| Category | Status | Notes |
|----------|--------|-------|
| Logic correctness | ⚠️ | `isScraping` not cleared on stale-guard early return in segment catch |
| Edge cases covered | ✅ | AbortError escalation pattern in `scrapeRange` is sound |
| Error handling | ⚠️ | See Issue 2 |
| Performance concerns | ✅ | Direct fetch removes IPC round-trip per chunk |
| Security implications | ✅ | `credentials: 'include'` + `<all_urls>` host_permissions — cookies sent correctly per MV3 spec |
| Consistency with patterns | ✅ | Module-level `scrapeAbortCtrl` matches `activeSummarizeId` pattern |
| Type safety | ✅ | |
| Test coverage | N/A | |

---

### Issues Found

| # | Severity | Category | Description | Suggestion |
|---|----------|----------|-------------|------------|
| 1 | major | Dead code | `SCRAPE_PROGRESS` + `CANCEL_SCRAPE` cases còn trong `background/index.ts` | Xóa 2 case (lines 139-145) |
| 2 | minor | Logic | `isScraping` không được clear trước stale-guard early return trong `handleSummarizeSegment` catch | Di chuyển `isScraping.value = false` và `scrapeProgress.value = null` lên trước guard |
| 3 | nit | Redundant code | `scrapeAbortCtrl = null` trong `handleCancel` thừa — `finally` của `scrapeRange` đã cover | Xóa dòng `scrapeAbortCtrl = null` khỏi `handleCancel` |

---

#### Issue 1 — Dead cases trong background (major)

File: `entrypoints/background/index.ts`, lines 139–145

```typescript
// Forward progress from content script to sidepanel
case 'SCRAPE_PROGRESS':
  browser.runtime.sendMessage(message).catch(() => {});
  return false;

case 'CANCEL_SCRAPE':
  return false;
```

`'SCRAPE_PROGRESS'` và `'CANCEL_SCRAPE'` đã bị xóa khỏi `MessageType` union trong `types.ts` nhưng cases vẫn còn trong background switch. Dead code, không thể được hit ở runtime. `SCRAPE_PROGRESS` case còn gọi `browser.runtime.sendMessage(message)` — một IPC send thừa nếu bằng cách nào đó được kích hoạt.

**Fix:** Xóa lines 139–145 khỏi `entrypoints/background/index.ts`.

---

#### Issue 2 — `isScraping` stuck trên stale path trong `handleSummarizeSegment` (minor)

File: `entrypoints/sidepanel/views/SummaryView.vue`, catch block của `handleSummarizeSegment`

```typescript
} catch (err) {
    if (thisId !== activeSummarizeId) return;  // ← early return — isScraping KHÔNG được clear
    isScraping.value = false;                   // ← không reach trên stale path
    scrapeProgress.value = null;
    ...
}
```

Nếu scraping segment throw error (kể cả AbortError) trong khi user đã navigate sang topic khác (`thisId !== activeSummarizeId`), `isScraping.value` ở lại `true`. `finally` chỉ clear `simpleLoadingText` và `llmTaskId`, không clear `isScraping`. Topic view mới có thể thấy loading indicator sai.

So sánh: `handleSummarize` catch đặt `isScraping.value = false` trước stale-guard — đúng.

**Fix:**
```typescript
} catch (err) {
    isScraping.value = false;
    scrapeProgress.value = null;
    if (thisId !== activeSummarizeId) return;
    if (err instanceof DOMException && err.name === 'AbortError') return;
    error.value = err instanceof Error ? err.message : String(err);
}
```

---

#### Issue 3 — Double null-clear `scrapeAbortCtrl` trong `handleCancel` (nit)

File: `entrypoints/sidepanel/views/SummaryView.vue`, `handleCancel`

```typescript
async function handleCancel() {
  scrapeAbortCtrl?.abort();
  scrapeAbortCtrl = null;  // ← thừa
  ...
}
```

Sau khi `.abort()`, `scrapeRange`'s `finally` block sẽ set `scrapeAbortCtrl = null`. `handleCancel` cũng set null trước đó — harmless nhưng thừa.

**Fix (optional):** Xóa `scrapeAbortCtrl = null` khỏi `handleCancel`.

---

### Summary

- **Overall:** approved (sau fix)
- **Key concern:** Dead `SCRAPE_PROGRESS`/`CANCEL_SCRAPE` cases trong background chưa được cleanup cùng với type system. `isScraping` cleanup order trong `handleSummarizeSegment` catch cần điều chỉnh để tránh stuck indicator trên stale path.

## Fix Applied

- Issue 1 ✅ — Xóa `SCRAPE_PROGRESS` + `CANCEL_SCRAPE` cases khỏi `background/index.ts`
- Issue 2 ✅ — Di chuyển `isScraping.value = false` + `scrapeProgress.value = null` trước stale-guard trong `handleSummarizeSegment` catch
- Issue 3 ✅ — Xóa `scrapeAbortCtrl = null` thừa khỏi `handleCancel`
