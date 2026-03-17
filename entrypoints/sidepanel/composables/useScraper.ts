import { ref } from 'vue';
import type { ScrapedPost, Message, PageProgress } from '@/lib/types';
import type { MultiPageResult } from '@/lib/scrapers/page-loader';

export function useScraper() {
  const isScripting = ref(false);
  const progress = ref('');

  function onRuntimeMessage(message: Message) {
    if (message.type === 'SCRAPE_PROGRESS') {
      const { currentPage, totalPages, postsScraped } = message.payload as PageProgress;
      progress.value = `Đang đọc trang ${currentPage}/${totalPages} (${postsScraped} bài)...`;
    }
  }

  function startListening() {
    browser.runtime.onMessage.addListener(onRuntimeMessage);
  }

  function stopListening() {
    browser.runtime.onMessage.removeListener(onRuntimeMessage);
  }

  async function cancel(tabId: number): Promise<void> {
    await browser.tabs.sendMessage(tabId, { type: 'CANCEL_SCRAPE' }).catch(() => {});
    isScripting.value = false;
    progress.value = '';
  }

  async function scrape(tabId: number, totalPages: number): Promise<{
    posts: ScrapedPost[];
    warnings: string[];
    error?: string;
  }> {
    isScripting.value = true;

    try {
      if (totalPages > 1) {
        progress.value = `Đang đọc trang 1/${totalPages}...`;
        const result = await browser.tabs.sendMessage(tabId, {
          type: 'SCRAPE_ALL_PAGES',
          payload: { totalPages },
        }) as MultiPageResult & { error?: string };

        if (result.error) return { posts: [], warnings: [], error: result.error };
        if (!result.posts?.length) return { posts: [], warnings: [], error: 'Không tìm thấy bài viết nào.' };

        return { posts: result.posts, warnings: result.errors ?? [] };
      } else {
        progress.value = 'Đang đọc bài viết...';
        const scraped = await browser.tabs.sendMessage(tabId, {
          type: 'SCRAPE_TOPIC',
        }) as { posts?: ScrapedPost[]; error?: string };

        if (scraped.error) return { posts: [], warnings: [], error: scraped.error };
        if (!scraped.posts?.length) return { posts: [], warnings: [], error: 'Không tìm thấy bài viết nào.' };

        return { posts: scraped.posts, warnings: [] };
      }
    } finally {
      isScripting.value = false;
      progress.value = '';
    }
  }

  return { isScripting, progress, scrape, cancel, startListening, stopListening };
}
