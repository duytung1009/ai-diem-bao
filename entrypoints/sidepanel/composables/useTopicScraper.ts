import { ref } from 'vue';
import { sendMessage } from '@/lib/messaging';
import { scrapePageRange } from '@/lib/scrapers/page-loader';
// TODO(Feature 36): unused while SCRAPE_ARTICLE is disabled
// import { detectNewsThread } from '@/lib/scrapers/news-detector';
// TODO(Feature 36): ArticleContent import removed with SCRAPE_ARTICLE disable
import type { ScrapedPost, XenForoVersion } from '@/lib/types';

export interface ScrapeProgress {
  currentPage: number;
  totalPages: number;
  postsScraped: number;
}

export interface ScrapeRangeResult {
  posts: ScrapedPost[];
  errors: string[];
  threadDeleted?: boolean;
  threadLocked?: boolean;
}

export interface EnrichCallbacks {
  onStatus: (msg: string) => void;
  onInfo: (msg: string) => void;
}

export function useTopicScraper() {
  const isScraping = ref(false);
  const scrapeProgress = ref<ScrapeProgress | null>(null);
  const scrapingWarnings = ref<string[]>([]);
  const scrapingInfo = ref<string[]>([]);

  let scrapeAbortCtrl: AbortController | null = null;

  function countRealPosts(posts: ScrapedPost[]): number {
    return posts.filter(p => p.postNumber >= 0).length;
  }

  /**
   * Scrape a range of pages. Updates scrapeProgress reactively and supports AbortController.
   */
  async function scrapeRange(
    version: XenForoVersion,
    baseUrl: string,
    startPage: number,
    endPage: number,
    delayMs: number = 2000,
  ): Promise<ScrapeRangeResult> {
    scrapeAbortCtrl = new AbortController();
    const signal = scrapeAbortCtrl.signal;
    try {
      const result = await scrapePageRange(
        version,
        baseUrl,
        startPage,
        endPage,
        (current, _total, postsScraped) => {
          scrapeProgress.value = {
            currentPage: startPage + current - 1,
            totalPages: endPage,
            postsScraped,
          };
        },
        signal,
        delayMs,
      );
      if (signal.aborted) throw new DOMException('Scraping cancelled', 'AbortError');
      return {
        posts: result.posts,
        errors: result.errors,
        threadDeleted: result.threadDeleted,
        threadLocked: result.threadLocked,
      };
    } finally {
      scrapeAbortCtrl = null;
    }
  }

  /** Abort any running scrape operation. */
  function abortScrape(): void {
    scrapeAbortCtrl?.abort();
  }

  /** Get the current abort signal for coordinating with other operations. */
  function getAbortSignal(): AbortSignal | undefined {
    return scrapeAbortCtrl?.signal;
  }

  /**
   * TODO(Feature 36): Disabled - SCRAPE_ARTICLE requires cross-origin host_permissions
   * that were removed when switching to dynamic permissions.
   * Re-enable when a permission-safe approach is implemented.
   */
  async function enrichWithNewsArticles(
    posts: ScrapedPost[],
    _topicUrl: string,
    _callbacks?: EnrichCallbacks,
  ): Promise<ScrapedPost[]> {
    // try {
    //   const forumDomain = new URL(topicUrl).hostname;
    //   const newsCheck = detectNewsThread(posts, forumDomain);
    //   if (!newsCheck.isNews || !newsCheck.articleUrls.length) return posts;

    //   callbacks?.onStatus('Phát hiện thớt tin tức — đang tải bài báo gốc...');
    //   const articles = (await Promise.all(
    //     newsCheck.articleUrls.map(url =>
    //       sendMessage<ArticleContent | null>('SCRAPE_ARTICLE', { url }).catch(() => null),
    //     ),
    //   )).filter(Boolean) as ArticleContent[];

    //   if (!articles.length) return posts;

    //   const firstPostIndex = posts.findIndex(p => p.postNumber > 0);
    //   if (firstPostIndex === -1) return posts;

    //   const articleText = articles.map(a =>
    //     `[BÀI BÁO GỐC — ${a.source}]\nTiêu đề: ${a.title}\n\nNội dung:\n${a.content}`,
    //   ).join('\n\n---\n\n');

    //   const updatedPosts = [...posts];
    //   updatedPosts[firstPostIndex] = {
    //     ...updatedPosts[firstPostIndex],
    //     content: `${articleText}\n\n---\n\n${updatedPosts[firstPostIndex].content}`,
    //   };

    //   callbacks?.onInfo(`Đã tải ${articles.length} bài báo gốc: ${articles.map(a => a.source).join(', ')}`);
    //   return updatedPosts;
    // } catch { return posts; }
    return posts;
  }

  return {
    isScraping,
    scrapeProgress,
    scrapingWarnings,
    scrapingInfo,
    countRealPosts,
    scrapeRange,
    abortScrape,
    getAbortSignal,
    enrichWithNewsArticles,
  };
}
