import { detectXenForoVersion } from '@/lib/detector';
import { XF2Scraper } from '@/lib/scrapers/xf2-scraper';
import { XF1Scraper } from '@/lib/scrapers/xf1-scraper';
import { scrapeAllPages, scrapePageRange } from '@/lib/scrapers/page-loader';
import type { DetectResult, Message, TopicData } from '@/lib/types';

function isThreadPage(v: 'xf1' | 'xf2'): boolean {
  if (v === 'xf2') {
    return !!(
      document.querySelector('article.message') &&
      (document.querySelector('dl.count--replies') || document.querySelector('.p-title-value'))
    );
  }
  // XF1: only li.message .messageText is specific enough to thread pages
  return !!document.querySelector('li.message .messageText');
}

export default defineContentScript({
  matches: ['*://*/*'],
  main() {
    const version = detectXenForoVersion();
    let scrapeAbortController: AbortController | null = null;
    // Holds the sendResponse callback for the currently in-progress scrape message.
    // Called early on pagehide to close the channel cleanly before bfcache takes over.
    let pendingSendResponse: ((r: unknown) => void) | null = null;

    window.addEventListener('pagehide', () => {
      if (scrapeAbortController) {
        scrapeAbortController.abort();
        scrapeAbortController = null;
      }
      if (pendingSendResponse) {
        pendingSendResponse({ error: 'Trang đã điều hướng, hãy thử lại.' });
        pendingSendResponse = null;
      }
    });

    browser.runtime?.onMessage.addListener(
      (message: Message, _sender, sendResponse) => {
        if (version === 'unknown') {
          return false;
        }

        if (message.type === 'DETECT_XF') {
          // Only respond for individual thread pages, not forum/list pages
          if (!isThreadPage(version)) {
            sendResponse(undefined);
            return false;
          }
          const scraper = createScraper();
          const result: DetectResult = {
            version,
            title: document.title,
            postCount: scraper?.getPostCount() ?? 0,
            pageCount: scraper?.getPageCount() ?? 1,
          };
          // Try to get a better title from the page
          const titleEl = document.querySelector('h1.p-title-value, .titleBar h1');
          if (titleEl?.textContent?.trim()) {
            result.title = titleEl.textContent.trim();
          }
          sendResponse(result);
          return false;
        }

        if (message.type === 'SCRAPE_TOPIC') {
          const scraper = createScraper();
          if (!scraper) {
            sendResponse({ error: 'No scraper available for this page' });
            return false;
          }
          try {
            const data: TopicData = scraper.scrape();
            sendResponse(data);
          } catch (err) {
            sendResponse({ error: String(err) });
          }
          return false;
        }

        if (message.type === 'SCRAPE_ALL_PAGES') {
          const { totalPages, delayMs, baseUrl } = message.payload as { totalPages: number; delayMs?: number; baseUrl: string };

          scrapeAbortController = new AbortController();
          pendingSendResponse = sendResponse;
          const signal = scrapeAbortController.signal;

          const onProgress = (currentPage: number, tp: number, postsScraped: number) => {
            browser.runtime.sendMessage({
              type: 'SCRAPE_PROGRESS',
              payload: { currentPage, totalPages: tp, postsScraped },
            }).catch(() => { /* no listener yet or already done */ });
          };

          scrapeAllPages(version, baseUrl, totalPages, onProgress, signal, delayMs ?? 2000)
            .then((result) => {
              scrapeAbortController = null;
              pendingSendResponse = null;
              sendResponse(result);
            })
            .catch((err) => {
              scrapeAbortController = null;
              pendingSendResponse = null;
              sendResponse({ error: String(err) });
            });
          return true;
        }

        if (message.type === 'SCRAPE_PAGE_RANGE') {
          const { startPage, endPage, delayMs, baseUrl } = message.payload as { startPage: number; endPage: number; delayMs?: number; baseUrl: string };

          scrapeAbortController = new AbortController();
          pendingSendResponse = sendResponse;
          const signal = scrapeAbortController.signal;

          const onProgress = (current: number, total: number, postsScraped: number) => {
            browser.runtime.sendMessage({
              type: 'SCRAPE_PROGRESS',
              payload: {
                currentPage: startPage + current - 1,
                totalPages: endPage,
                postsScraped,
              },
            }).catch(() => {});
          };

          scrapePageRange(version, baseUrl, startPage, endPage, onProgress, signal, delayMs ?? 2000)
            .then((result) => {
              scrapeAbortController = null;
              pendingSendResponse = null;
              sendResponse(result);
            })
            .catch((err) => {
              scrapeAbortController = null;
              pendingSendResponse = null;
              sendResponse({ error: String(err) });
            });
          return true;
        }

        if (message.type === 'CANCEL_SCRAPE') {
          if (scrapeAbortController) {
            scrapeAbortController.abort();
            scrapeAbortController = null;
          }
          sendResponse({ cancelled: true });
          return false;
        }

        return false;
      },
    );

    function createScraper() {
      if (version === 'xf2') return new XF2Scraper();
      if (version === 'xf1') return new XF1Scraper();
      return null;
    }
  },
});
