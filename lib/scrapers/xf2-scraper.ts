import type { ScrapedPost, TopicData } from '../types';
import type { TopicScraper } from './types';
import { normalizeWhitespace } from '../text-utils';

export class XF2Scraper implements TopicScraper {
  scrape(doc: Document = document, url: string = window.location.href): TopicData {
    return {
      url: this.normalizeUrl(url),
      title: this.getTitle(doc),
      version: 'xf2',
      posts: this.scrapePosts(doc),
      totalPages: this.getPageCount(doc),
      currentPage: this.getCurrentPage(doc, url),
    };
  }

  getPostCount(doc: Document = document): number {
    // Primary: standard XF2 replies counter
    const dd = doc.querySelector('dl.count--replies dd');
    const primary = Number.parseInt(dd?.textContent?.trim()?.replaceAll(',', '') ?? '', 10) + 1; // +1 for OP
    if (!isNaN(primary) && primary > 0) return primary;

    // Fallback 1: JSON-LD structured data (always available on thread page)
    const jsonLd = this.parseJsonLd(doc);
    if (jsonLd !== null) return jsonLd;

    // Fallback 2: Last post number — only if on the last page
    if (this.isLastPage(doc)) {
      const lastPostNum = this.getLastPostNumber(doc);
      if (lastPostNum > 0) return lastPostNum;
    }

    return 0;
  }

  getPageCount(doc: Document = document): number {
    const lastPageLink = doc.querySelector('.pageNav-main .pageNav-page:last-child a');
    if (lastPageLink) {
      const num = parseInt(lastPageLink.textContent?.trim() || '1', 10);
      return isNaN(num) ? 1 : num;
    }
    return 1;
  }

  private getTitle(doc: Document): string {
    const el =
      doc.querySelector('h1.p-title-value') ||
      doc.querySelector('.p-title-value');
    return el?.textContent?.trim() || doc.title;
  }

  private getCurrentPage(doc: Document, url: string): number {
    const currentPageEl = doc.querySelector('.pageNav-page--current');
    if (currentPageEl) {
      const num = parseInt(currentPageEl.textContent?.trim() || '1', 10);
      return isNaN(num) ? 1 : num;
    }
    const match = url.match(/\/page-(\d+)/);
    return match ? parseInt(match[1], 10) : 1;
  }

  scrapePosts(doc: Document = document): ScrapedPost[] {
    const posts: ScrapedPost[] = [];
    const articles = doc.querySelectorAll('article.message');
    const seenUsers = new Set<string>();

    articles.forEach((article) => {
      const author = this.extractAuthor(article);
      const content = this.extractContent(article);
      const timestamp = this.extractTimestamp(article);
      const postNumber = this.extractPostNumber(article);

      const userMeta = seenUsers.has(author) ? undefined : this.extractUserMeta(article);
      if (userMeta !== undefined) seenUsers.add(author);

      posts.push({ author, content, timestamp, postNumber, userMeta });
    });

    return posts;
  }

  private extractUserMeta(article: Element): import('../types').UserMeta | undefined {
    try {
      // VOZ uses div.message-userDetails inside section.message-user (not aside)
      const details = article.querySelector('.message-userDetails');
      if (!details) return undefined;

      // Always extract the rank/title — this is the primary signal on VOZ
      // which doesn't show message counts / join dates in thread HTML.
      const userTitle =
        details.querySelector('h5.userTitle, .message-userTitle')?.textContent?.trim() || undefined;

      const dl = details.querySelector('dl.pairs--justified, dl.pairs');

      if (!dl) {
        // VOZ only exposes the rank title in thread view — use it as the sole signal.
        return userTitle ? { userTitle } : undefined;
      }

      const dts = dl.querySelectorAll('dt');
      const dds = dl.querySelectorAll('dd');
      let messageCount: number | undefined;
      let reactionScore: number | undefined;
      let joinDate: string | undefined;

      dts.forEach((dt, i) => {
        const key = dt.textContent?.trim().toLowerCase() ?? '';
        const dd = dds[i];
        if (!dd) return;
        const val = dd.textContent?.trim() ?? '';

        // Support English, VOZ-localised, and OtoFun-localised XF2 labels
        if (key === 'messages' || key === 'tin nhắn' || key === 'số km') {
          // OtoFun: "Số km" = post count (themed as kilometres driven)
          const n = parseInt(val.replace(/[,.\s]/g, ''), 10);
          if (!isNaN(n)) messageCount = n;
        } else if (
          key === 'reaction score' || key === 'likes received' ||
          key === 'điểm phản ứng' || key === 'động cơ'
        ) {
          // OtoFun: "Động cơ" = "X Mã lực" (horsepower = reputation score)
          // parseInt("576319Mãlực", 10) correctly stops at non-digit → 576319
          const n = parseInt(val.replace(/[,.\s]/g, ''), 10);
          if (!isNaN(n)) reactionScore = n;
        } else if (key === 'joined' || key === 'tham gia' || key === 'ngày cấp bằng') {
          // OtoFun: "Ngày cấp bằng" = licence issue date = join date (d/m/yy format)
          const timeEl = dd.querySelector('time');
          joinDate = timeEl?.getAttribute('datetime') || val || undefined;
        }
      });

      if (messageCount === undefined && reactionScore === undefined && joinDate === undefined && !userTitle) {
        return undefined;
      }
      return { messageCount, reactionScore, joinDate, userTitle };
    } catch {
      return undefined;
    }
  }

  private extractAuthor(article: Element): string {
    const authorEl =
      article.querySelector('.message-name a') ||
      article.querySelector('[data-author]');
    if (authorEl?.hasAttribute('data-author')) {
      return authorEl.getAttribute('data-author') || 'Unknown';
    }
    return authorEl?.textContent?.trim() || 'Unknown';
  }

  private extractContent(article: Element): string {
    const bodyEl = article.querySelector('.message-body .bbWrapper');
    if (!bodyEl) return '';

    // Clone to avoid mutating the DOM
    const clone = bodyEl.cloneNode(true) as HTMLElement;

    // Remove quotes
    clone.querySelectorAll('.bbCodeBlock--quote').forEach((el) => el.remove());
    // Remove signatures
    clone.querySelectorAll('.message-signature').forEach((el) => el.remove());
    // Remove embedded media placeholders
    clone.querySelectorAll('.bbMediaWrapper').forEach((el) => el.remove());

    // Extract URLs from unfurl/embed blocks (stored in data-url, not visible as text)
    const unfurlUrls: string[] = [];
    clone.querySelectorAll('[data-url]').forEach((el) => {
      const url = el.getAttribute('data-url');
      if (url) unfurlUrls.push(url);
    });

    const text = normalizeWhitespace(clone.textContent || '');
    return unfurlUrls.length > 0 ? `${text}\n${unfurlUrls.join('\n')}` : text;
  }

  private extractTimestamp(article: Element): string {
    const timeEl = article.querySelector('time');
    return timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '';
  }

  private extractPostNumber(article: Element): number {
    // Primary: data-content="post-41558917" on the <article> element — real post ID
    const dataContent = article.getAttribute('data-content');
    if (dataContent) {
      const match = dataContent.match(/post-(\d+)/);
      if (match) return parseInt(match[1], 10);
    }
    // Fallback: href of the attribution link, e.g. href=".../post-41558917"
    const headerLink = article.querySelector('.message-attribution-opposite a');
    if (headerLink) {
      const href = headerLink.getAttribute('href') || '';
      const hrefMatch = href.match(/#post-(\d+)/);
      if (hrefMatch) return parseInt(hrefMatch[1], 10);
      // Last resort: text content shows sequential "#5" — less reliable
      const text = headerLink.textContent?.trim() || '';
      const textMatch = text.match(/#?([\d,]+)/);
      if (textMatch) return parseInt(textMatch[1].replace(/,/g, ''), 10);
    }
    return 0;
  }

  private parseJsonLd(doc: Document): number | null {
    const el = doc.querySelector('script[type="application/ld+json"]');
    if (!el?.textContent) return null;
    try {
      const data = JSON.parse(el.textContent);
      const replies = data.interactionStatistic?.userInteractionCount;
      if (typeof replies === 'number') return replies + 1; // +1 for OP
    } catch {}
    return null;
  }

  private isLastPage(doc: Document): boolean {
    // "336 of 336" — current equals total
    const currentEl = doc.querySelector('.pageNavSimple-el--current');
    const text = currentEl?.textContent?.trim() || '';
    const m = text.match(/(\d+)\s+of\s+(\d+)/);
    if (m) return m[1] === m[2];

    // No "Next" button means last page
    return !doc.querySelector('.pageNav-jump--next');
  }

  private getLastPostNumber(doc: Document): number {
    const lastArticle = doc.querySelector('article.message--post:last-of-type');
    if (!lastArticle) return 0;
    const link = lastArticle.querySelector('.message-attribution-opposite a');
    const text = link?.textContent?.trim() || '';
    const m = text.match(/#?([\d,]+)/);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
  }

  normalizeUrl(url: string): string {
    try {
      const u = new URL(url);
      // Remove page-N from path
      u.pathname = u.pathname.replace(/\/page-\d+$/, '');
      u.search = '';
      u.hash = '';
      return u.toString();
    } catch {
      return url;
    }
  }
}
