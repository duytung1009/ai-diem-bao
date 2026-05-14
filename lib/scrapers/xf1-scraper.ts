import type { ScrapedPost, TopicData } from '../types';
import type { TopicScraper } from './types';
import { normalizeWhitespace } from '../text-utils';

export class XF1Scraper implements TopicScraper {
  scrape(doc: Document = document, url: string = window.location.href): TopicData {
    return {
      url: this.normalizeUrl(url),
      title: this.getTitle(doc),
      version: 'xf1',
      posts: this.scrapePosts(doc),
      totalPages: this.getPageCount(doc),
      currentPage: this.getCurrentPage(doc, url),
    };
  }

  getPostCount(doc: Document = document): number {
    const dd = doc.querySelector('.count--replies dd');
    return Number.parseInt(dd?.textContent?.trim()?.replaceAll(',', '') ?? '0', 10) + 1; // +1 for OP
  }

  getPageCount(doc: Document = document): number {
    // XF1 uses .PageNav with nav > a elements
    const lastPageLink = doc.querySelector('.PageNav nav > a:last-of-type');
    if (lastPageLink) {
      const num = parseInt(lastPageLink.textContent?.trim() || '1', 10);
      return isNaN(num) ? 1 : num;
    }
    // Fallback: check for .pageNavHeader "Page X of Y"
    const header = doc.querySelector('.PageNav .pageNavHeader');
    if (header) {
      const match = header.textContent?.match(/of\s+([\d,]+)/i);
      if (match) return parseInt(match[1].replace(/,/g, ''), 10);
    }
    return 1;
  }

  private getTitle(doc: Document): string {
    const el =
      doc.querySelector('.titleBar h1') ||
      doc.querySelector('h1');
    return el?.textContent?.trim() || doc.title;
  }

  private getCurrentPage(doc: Document, url: string): number {
    const currentPageEl = doc.querySelector('.PageNav .currentPage');
    if (currentPageEl) {
      const num = parseInt(currentPageEl.textContent?.trim() || '1', 10);
      return isNaN(num) ? 1 : num;
    }
    // Fallback: URL pattern /page-N
    const match = url.match(/\/page-(\d+)/);
    return match ? parseInt(match[1], 10) : 1;
  }

  scrapePosts(doc: Document = document): ScrapedPost[] {
    const posts: ScrapedPost[] = [];
    const messages = doc.querySelectorAll('li.message');

    messages.forEach((msg) => {
      const author = this.extractAuthor(msg);
      const content = this.extractContent(msg);
      const timestamp = this.extractTimestamp(msg);
      const postNumber = this.extractPostNumber(msg);

      posts.push({ author, content, timestamp, postNumber });
    });

    return posts;
  }

  private extractAuthor(msg: Element): string {
    // data-author attribute on li.message
    const dataAuthor = msg.getAttribute('data-author');
    if (dataAuthor) return dataAuthor;

    const authorEl =
      msg.querySelector('.username') ||
      msg.querySelector('.messageMeta .author a');
    return authorEl?.textContent?.trim() || 'Unknown';
  }

  private extractContent(msg: Element): string {
    const bodyEl =
      msg.querySelector('.messageContent .messageText') ||
      msg.querySelector('.messageContent');
    if (!bodyEl) return '';

    // Clone to avoid mutating the DOM
    const clone = bodyEl.cloneNode(true) as HTMLElement;

    // Remove quotes
    clone.querySelectorAll('.bbCodeQuote').forEach((el) => el.remove());
    // Remove signatures
    clone.querySelectorAll('.signature').forEach((el) => el.remove());
    // Remove embedded media
    clone.querySelectorAll('.bbMediaWrapper').forEach((el) => el.remove());

    return normalizeWhitespace(clone.textContent || '');
  }

  private extractTimestamp(msg: Element): string {
    const timeEl =
      msg.querySelector('.messageMeta .DateTime') ||
      msg.querySelector('.datePermalink time') ||
      msg.querySelector('time, abbr.DateTime');
    if (!timeEl) return '';
    return (
      timeEl.getAttribute('datetime') ||
      timeEl.getAttribute('data-time') ||
      timeEl.getAttribute('title') ||
      timeEl.textContent?.trim() ||
      ''
    );
  }

  private extractPostNumber(msg: Element): number {
    // XF1: post number in a.postNumber or data attribute
    const postNumEl = msg.querySelector('a.postNumber');
    if (postNumEl) {
      const text = postNumEl.textContent?.trim() || '';
      const match = text.match(/#?([\d,]+)/);
      if (match) return parseInt(match[1].replace(/,/g, ''), 10);
    }
    // Fallback: id="post-123"
    const id = msg.getAttribute('id');
    if (id) {
      const match = id.match(/post-(\d+)/);
      if (match) return parseInt(match[1], 10);
    }
    return 0;
  }

  normalizeUrl(url: string): string {
    try {
      const u = new URL(url);
      u.pathname = u.pathname.replace(/\/page-\d+$/, '');
      u.search = '';
      u.hash = '';
      return u.toString();
    } catch {
      return url;
    }
  }
}
