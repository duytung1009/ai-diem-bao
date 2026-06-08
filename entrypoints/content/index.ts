import { detectXenForoVersion } from '@/lib/detector';
import { XF2Scraper } from '@/lib/scrapers/xf2-scraper';
import { XF1Scraper } from '@/lib/scrapers/xf1-scraper';
import { isThreadDeleted, isThreadLocked } from '@/lib/scrapers/thread-status';
import type { DetectResult, Message } from '@/lib/types';

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
  registration: 'runtime',
  main() {
    const version = detectXenForoVersion();
    console.log('Detected XenForo version:', version);

    browser.runtime?.onMessage.addListener(
      (message: Message, _sender, sendResponse) => {
        // GET_PAGE_URL works on any page, no XF version needed
        if (message.type === 'GET_PAGE_URL') {
          sendResponse({ url: location.href });
          return false;
        }

        if (version === 'unknown') {
          return false;
        }

        if (message.type === 'DETECT_XF') {
          // Check for deleted/locked thread first — these pages may lack article.message
          // so the normal isThreadPage check would incorrectly reject them.
          const isDeleted = isThreadDeleted(document);
          const isLocked = isThreadLocked(document);
          if (!isDeleted && !isLocked && !isThreadPage(version)) {
            sendResponse(undefined);
            return false;
          }
          const scraper = createScraper();
          const result: DetectResult = {
            version,
            title: document.title,
            postCount: scraper?.getPostCount() ?? 0,
            pageCount: scraper?.getPageCount() ?? 1,
            threadDeleted: isDeleted,
            threadLocked: isLocked,
            // Trả về URL để sidepanel không cần tabs permission để đọc tab.url
            url: location.href,
          };
          // Try to get a better title from the page
          const titleEl = document.querySelector('h1.p-title-value, .titleBar h1');
          if (titleEl?.textContent?.trim()) {
            result.title = titleEl.textContent.trim();
          }
          sendResponse(result);
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
