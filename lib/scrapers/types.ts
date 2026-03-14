import type { TopicData } from '../types';

export interface TopicScraper {
  scrape(): TopicData;
  getPostCount(): number;
  getPageCount(): number;
}
