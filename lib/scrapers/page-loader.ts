import type { ScrapedPost, XenForoVersion } from '../types';
import type { TopicScraper } from './types';
import { XF2Scraper } from './xf2-scraper';
import { XF1Scraper } from './xf1-scraper';
import { isThreadDeleted, isThreadLocked } from './thread-status';

export interface MultiPageResult {
  posts: ScrapedPost[];
  totalPages: number;
  pagesScraped: number;
  errors: string[];
  threadDeleted?: boolean;
  threadLocked?: boolean;
}

export type ProgressCallback = (currentPage: number, totalPages: number, postsScraped: number) => void;

function createScraperForVersion(version: XenForoVersion): TopicScraper | null {
  if (version === 'xf2') return new XF2Scraper();
  if (version === 'xf1') return new XF1Scraper();
  return null;
}

function buildPageUrl(baseUrl: string, page: number): string {
  // Remove existing page-N and trailing slash
  const clean = baseUrl.replace(/\/page-\d+\/?$/, '').replace(/\/$/, '');
  return page === 1 ? clean : `${clean}/page-${page}`;
}

function deduplicateAndSort(posts: ScrapedPost[]): ScrapedPost[] {
  const seen = new Set<number>();
  const unique = posts.filter(p => {
    if (p.postNumber === 0) return true;
    if (seen.has(p.postNumber)) return false;
    seen.add(p.postNumber);
    return true;
  });
  return unique.sort((a, b) => a.postNumber - b.postNumber);
}

export async function scrapePageRange(
  version: XenForoVersion,
  baseUrl: string,
  startPage: number,
  endPage: number,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
  delayMs: number = 2000,
): Promise<MultiPageResult> {
  const scraper = createScraperForVersion(version);
  if (!scraper) throw new Error(`No scraper for version: ${version}`);

  const allPosts: ScrapedPost[] = [];
  const errors: string[] = [];
  let pagesScraped = 0;
  const totalPagesInRange = endPage - startPage + 1;

  for (let page = startPage; page <= endPage; page++) {
    if (signal?.aborted) break;

    const pageUrl = buildPageUrl(baseUrl, page);
    try {
      const res = await fetch(pageUrl, { credentials: 'include' });
      if (res.status === 401 || res.status === 403) {
        errors.push(`Trang ${page}: Không có quyền truy cập.`);
        continue;
      }
      if (!res.ok) {
        errors.push(`Trang ${page}: HTTP ${res.status}`);
        continue;
      }
      const html = await res.text();
      const parser = new DOMParser();
      // Strip <head> (removes <script>, <link rel="preload" as="script">, stylesheets, etc.)
      // then strip any stray <script> in <body>. DOMParser in extension page context triggers
      // CSP checks for resource-loading elements even in inert parsed documents.
      const safeHtml = html
        .replace(/<head\b[\s\S]*?<\/head>/gi, '')
        .replace(/<script\b[\s\S]*?<\/script>/gi, '')
        .replace(/<link\b[^>]*>/gi, '');  // Strip <link> in <body> (e.g. preload as="script")
      const doc = parser.parseFromString(safeHtml, 'text/html');

      const isLoginPage =
        /login|sign.?in|đăng.nhập/i.test(res.url) ||
        doc.querySelector('form[action*="login"], input[name="password"]') !== null;
      if (isLoginPage) {
        errors.push(`Trang ${page}: Chuyển hướng đến trang đăng nhập.`);
        continue;
      }

      if (isThreadDeleted(doc)) {
        return { posts: deduplicateAndSort(allPosts), totalPages: endPage, pagesScraped, errors, threadDeleted: true, threadLocked: false };
      }

      if (isThreadLocked(doc)) {
        return { posts: deduplicateAndSort(allPosts), totalPages: endPage, pagesScraped, errors, threadDeleted: false, threadLocked: true };
      }

      const pageData = scraper.scrape(doc, pageUrl);
      allPosts.push(...pageData.posts.map(p => ({ ...p, page })));
      pagesScraped++;
      onProgress?.(pagesScraped, totalPagesInRange, allPosts.length);
    } catch (err) {
      errors.push(`Page ${page}: ${String(err)}`);
    }

    if (page < endPage && !signal?.aborted) {
      const jitter = Math.random() * Math.min(delayMs * 0.3, 500);
      await new Promise((r) => setTimeout(r, delayMs + jitter));
    }
  }

  return { posts: deduplicateAndSort(allPosts), totalPages: endPage, pagesScraped, errors, threadDeleted: false, threadLocked: false };
}
