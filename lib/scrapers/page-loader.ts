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
): Promise<MultiPageResult> {
  const scraper = createScraperForVersion(version);
  if (!scraper) throw new Error(`No scraper for version: ${version}`);

  const allPosts: ScrapedPost[] = [];
  const errors: string[] = [];
  let pagesScraped = 0;

  // Page 1: use the live document (already loaded)
  try {
    const page1Data = scraper.scrape(document, window.location.href);
    allPosts.push(...page1Data.posts);
    pagesScraped = 1;
    onProgress?.(1, totalPages, allPosts.length);
  } catch (err) {
    errors.push(`Page 1: ${String(err)}`);
  }

  // Pages 2..N: fetch and parse
  for (let page = 2; page <= totalPages; page++) {
    if (signal?.aborted) break;

    const pageUrl = buildPageUrl(baseUrl, page);
    try {
      const res = await fetch(pageUrl);
      if (!res.ok) {
        errors.push(`Page ${page}: HTTP ${res.status}`);
        continue;
      }
      const html = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const pageData = scraper.scrape(doc, pageUrl);
      allPosts.push(...pageData.posts);
      pagesScraped++;
      onProgress?.(page, totalPages, allPosts.length);
    } catch (err) {
      errors.push(`Page ${page}: ${String(err)}`);
    }

    // Rate limiting: 300-600ms delay between requests
    if (page < totalPages && !signal?.aborted) {
      await new Promise((r) => setTimeout(r, 300 + Math.random() * 300));
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
