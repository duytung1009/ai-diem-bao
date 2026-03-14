import { detectXenForoVersion } from '@/lib/detector';
import { XF2Scraper } from '@/lib/scrapers/xf2-scraper';
import { XF1Scraper } from '@/lib/scrapers/xf1-scraper';
import { scrapeAllPages } from '@/lib/scrapers/page-loader';
import type { DetectResult, Message, TopicData } from '@/lib/types';

export default defineContentScript({
  matches: ['*://*/*'],
  main() {
    const version = detectXenForoVersion();
    let scrapeAbortController: AbortController | null = null;

    browser.runtime.onMessage.addListener(
      (message: Message, _sender, sendResponse) => {
        if (version === 'unknown') {
          return false;
        }

        if (message.type === 'DETECT_XF') {
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
          const { totalPages } = message.payload as { totalPages: number };
          const scraper = createScraper();
          if (!scraper) {
            sendResponse({ error: 'No scraper available for this page' });
            return true;
          }
          const baseUrl = scraper.scrape().url;

          // Create new abort controller for this scrape session
          scrapeAbortController = new AbortController();
          const signal = scrapeAbortController.signal;

          const onProgress = (currentPage: number, tp: number, postsScraped: number) => {
            // Fire-and-forget: send progress to sidepanel via runtime messaging
            browser.runtime.sendMessage({
              type: 'SCRAPE_PROGRESS',
              payload: { currentPage, totalPages: tp, postsScraped },
            }).catch(() => { /* no listener yet or already done */ });
          };

          scrapeAllPages(version, baseUrl, totalPages, onProgress, signal)
            .then((result) => {
              scrapeAbortController = null;
              sendResponse(result);
            })
            .catch((err) => {
              scrapeAbortController = null;
              sendResponse({ error: String(err) });
            });
          return true; // async response
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
