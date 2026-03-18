import type { ScrapedPost, TopicData } from '../types';
import type { TopicScraper } from './types';

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
    return doc.querySelectorAll('article.message').length;
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

    articles.forEach((article) => {
      const author = this.extractAuthor(article);
      const content = this.extractContent(article);
      const timestamp = this.extractTimestamp(article);
      const postNumber = this.extractPostNumber(article);

      if (content.trim()) {
        posts.push({ author, content, timestamp, postNumber });
      }
    });

    return posts;
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

    return clone.textContent?.trim() || '';
  }

  private extractTimestamp(article: Element): string {
    const timeEl = article.querySelector('time');
    return timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '';
  }

  private extractPostNumber(article: Element): number {
    // XF2 stores post number in the header link like #post-123 or "Post #5"
    const headerLink = article.querySelector('.message-attribution-opposite a');
    if (headerLink) {
      const text = headerLink.textContent?.trim() || '';
      const match = text.match(/#?([\d,]+)/);
      if (match) return parseInt(match[1].replace(/,/g, ''), 10);
    }
    // Fallback: data-content attribute
    const dataContent = article.getAttribute('data-content');
    if (dataContent) {
      const match = dataContent.match(/post-(\d+)/);
      if (match) return parseInt(match[1], 10);
    }
    return 0;
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
