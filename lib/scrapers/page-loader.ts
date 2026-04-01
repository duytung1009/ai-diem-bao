import type { ScrapedPost, XenForoVersion } from '../types';
import type { TopicScraper } from './types';
import { XF2Scraper } from './xf2-scraper';
import { XF1Scraper } from './xf1-scraper';

export interface MultiPageResult {
  posts: ScrapedPost[];
  totalPages: number;
  pagesScraped: number;
  errors: string[];
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

export async function scrapeAllPages(
  version: XenForoVersion,
  baseUrl: string,
  totalPages: number,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
  delayMs: number = 2000,
): Promise<MultiPageResult> {
  const scraper = createScraperForVersion(version);
  if (!scraper) throw new Error(`No scraper for version: ${version}`);

  const allPosts: ScrapedPost[] = [];
  const errors: string[] = [];
  let pagesScraped = 0;

  // ALL pages: fetch and parse (no live document dependency)
  for (let page = 1; page <= totalPages; page++) {
    if (signal?.aborted) break;

    const pageUrl = buildPageUrl(baseUrl, page);
    try {
      const res = await fetch(pageUrl, { credentials: 'include' });
      if (res.status === 401 || res.status === 403) {
        errors.push(`Trang ${page}: Không có quyền truy cập — diễn đàn có thể yêu cầu đăng nhập.`);
        continue;
      }
      if (!res.ok) {
        errors.push(`Trang ${page}: HTTP ${res.status}`);
        continue;
      }
      const html = await res.text();
      const parser = new DOMParser();
      // Strip <script> tags before parsing to prevent CSP violations when running
      // in extension page context (sidepanel). DOMParser is spec-inert but Chrome's
      // renderer evaluates src attributes for CSP checks, generating console warnings.
      const safeHtml = html.replace(/<script[\s\S]*?<\/script>/gi, '');
      const doc = parser.parseFromString(safeHtml, 'text/html');

      // Detect login redirect
      const isLoginPage =
        /login|sign.?in|đăng.nhập/i.test(res.url) ||
        doc.querySelector('form[action*="login"], input[name="password"]') !== null;
      if (isLoginPage) {
        errors.push(`Trang ${page}: Chuyển hướng đến trang đăng nhập — bỏ qua.`);
        continue;
      }

      const pageData = scraper.scrape(doc, pageUrl);
      allPosts.push(...pageData.posts);
      pagesScraped++;
      onProgress?.(page, totalPages, allPosts.length);
    } catch (err) {
      errors.push(`Page ${page}: ${String(err)}`);
    }

    // Rate limiting: configurable delay between requests
    if (page < totalPages && !signal?.aborted) {
      const jitter = Math.random() * Math.min(delayMs * 0.3, 500);
      await new Promise((r) => setTimeout(r, delayMs + jitter));
    }
  }

  // Deduplicate by postNumber (in case of overlap)
  const seen = new Set<number>();
  const uniquePosts = allPosts.filter((p) => {
    if (p.postNumber === 0) return true; // can't dedupe without number
    if (seen.has(p.postNumber)) return false;
    seen.add(p.postNumber);
    return true;
  });

  // Sort by postNumber
  uniquePosts.sort((a, b) => a.postNumber - b.postNumber);

  return {
    posts: uniquePosts,
    totalPages,
    pagesScraped,
    errors,
  };
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
      const safeHtml = html.replace(/<script[\s\S]*?<\/script>/gi, '');
      const doc = parser.parseFromString(safeHtml, 'text/html');

      const isLoginPage =
        /login|sign.?in|đăng.nhập/i.test(res.url) ||
        doc.querySelector('form[action*="login"], input[name="password"]') !== null;
      if (isLoginPage) {
        errors.push(`Trang ${page}: Chuyển hướng đến trang đăng nhập.`);
        continue;
      }

      const pageData = scraper.scrape(doc, pageUrl);
      allPosts.push(...pageData.posts);
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

  const seen = new Set<number>();
  const uniquePosts = allPosts.filter((p) => {
    if (p.postNumber === 0) return true;
    if (seen.has(p.postNumber)) return false;
    seen.add(p.postNumber);
    return true;
  });
  uniquePosts.sort((a, b) => a.postNumber - b.postNumber);

  return { posts: uniquePosts, totalPages: endPage, pagesScraped, errors };
}
