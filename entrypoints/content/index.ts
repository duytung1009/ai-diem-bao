import { detectXenForoVersion } from '@/lib/detector';
import { XF2Scraper } from '@/lib/scrapers/xf2-scraper';
import type { DetectResult, Message, TopicData } from '@/lib/types';

export default defineContentScript({
  matches: ['*://*/*'],
  main() {
    const version = detectXenForoVersion();
    if (version === 'unknown') return;

    browser.runtime.onMessage.addListener(
      (message: Message, _sender, sendResponse) => {
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

        return false;
      },
    );

    function createScraper() {
      if (version === 'xf2') return new XF2Scraper();
      // XF1 scraper will be added in Phase 2
      return null;
    }
  },
});
