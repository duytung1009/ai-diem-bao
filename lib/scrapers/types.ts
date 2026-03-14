import type { TopicData } from '../types';

export interface TopicScraper {
  scrape(doc?: Document, url?: string): TopicData;
  getPostCount(doc?: Document): number;
  getPageCount(doc?: Document): number;
}
