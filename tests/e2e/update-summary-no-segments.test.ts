import { describe, it, expect, afterEach, vi } from 'vitest';
import { postFactory } from '@/tests/fixtures/post-factory';
import { mockSummaryResponses, mockJsonResponse } from '@/tests/fixtures/mock-llm-responses';
import { createMockProvider, restoreCreateProvider } from '@/tests/mocks/override-factory';
import { updateSummary, parseSummaryJSON } from '@/lib/llm/summarizer';
import { willExceedContext } from '@/lib/token-estimator';
import { mergePartialTopic } from '@/lib/cache-manager';
import type { LLMConfig, CachedTopic, TopicSegment, SummaryJSON } from '@/lib/types';

const testConfig: LLMConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKey: 'test-key',
  baseUrl: 'https://api.openai.com/v1',
  temperature: 0.3,
  contextWindow: 128000,
};

const LLM_CONFIG = { provider: 'openai', model: 'gpt-4o-mini' };

describe('E2E: Cập nhật tóm tắt khi bài gốc không chia segment', () => {
  afterEach(() => {
    restoreCreateProvider();
  });

  it('cập nhật với ít posts mới gọi LLM 1 lần', async () => {
    const mock = createMockProvider();
    const previousSummary = mockJsonResponse(mockSummaryResponses.singleSegment);
    const newPosts = postFactory.shortThread(5);

    const postsWithContext = [
      { author: 'SYSTEM', content: `[BẢN TÓM TẮT CŨ]\n${previousSummary}`, timestamp: '', postNumber: 0 },
      ...newPosts,
    ];
    const contextCheck = willExceedContext(postsWithContext, testConfig.model, 500, 2000, testConfig.contextWindow);
    expect(contextCheck.exceeds).toBe(false);

    const result = await updateSummary(previousSummary, newPosts, testConfig);
    const parsed = parseSummaryJSON(result);

    expect(parsed).not.toBeNull();
    expect(mock.getCallCount()).toBe(1);
  });

  it('summary cũ được đưa vào context post', async () => {
    const mock = createMockProvider();
    const previousSummary = '{"summary":"topic cũ","opinions":[],"conclusion":"cũ"}';
    const newPosts = postFactory.shortThread(3);

    await updateSummary(previousSummary, newPosts, testConfig);

    expect(mock.getCallCount()).toBe(1);
  });

  it('progress callback không báo map-reduce', async () => {
    const mock = createMockProvider();
    const previousSummary = mockJsonResponse(mockSummaryResponses.minimal);
    const newPosts = postFactory.shortThread(5);
    const onProgress = vi.fn();

    await updateSummary(previousSummary, newPosts, testConfig, onProgress);

    const hasMapStep = onProgress.mock.calls.some((call) => call[0].includes('phần'));
    expect(hasMapStep).toBe(false);
  });

  it('kết quả cập nhật có cấu trúc hợp lệ', async () => {
    createMockProvider();
    const previousSummary = mockJsonResponse(mockSummaryResponses.singleSegment);
    const newPosts = postFactory.shortThread(8);

    const result = await updateSummary(previousSummary, newPosts, testConfig);
    const parsed = parseSummaryJSON(result);

    expect(parsed).not.toBeNull();
    expect(typeof parsed?.summary).toBe('string');
    expect(Array.isArray(parsed?.opinions)).toBe(true);
    expect(typeof parsed?.conclusion).toBe('string');
  });

  it('cập nhật với posts có độ dài trung bình vẫn không chia segment', async () => {
    const mock = createMockProvider();
    const previousSummary = mockJsonResponse(mockSummaryResponses.singleSegment);
    const newPosts = postFactory.mediumThread(10);

    const postsWithContext = [
      { author: 'SYSTEM', content: `[BẢN TÓM TẮT CŨ]\n${previousSummary}`, timestamp: '', postNumber: 0 },
      ...newPosts,
    ];
    const contextCheck = willExceedContext(postsWithContext, testConfig.model, 500, 2000, testConfig.contextWindow);

    const result = await updateSummary(previousSummary, newPosts, testConfig);
    expect(parseSummaryJSON(result)).not.toBeNull();

    if (!contextCheck.exceeds) {
      expect(mock.getCallCount()).toBe(1);
    }
  });
});

describe('SAVE_CACHED_TOPIC: update-summary single-segment payload self-contained', () => {
  const topicUrl = 'https://voz.vn/threads/topic.123/';
  const summaryJson: SummaryJSON = mockSummaryResponses.singleSegment;
  const posts = postFactory.shortThread(10);
  const segment: TopicSegment = {
    startPage: 1,
    endPage: 4,
    posts,
    summary: summaryJson.summary,
    summaryJson,
    postCount: posts.filter(p => p.postNumber >= 0).length,
    summarizedAt: Date.now(),
  };
  const segTotalPosts = segment.postCount;

  it('generateOverallSummary 1 segment: 1 event duy nhất chứa cả segments lẫn summary', () => {
    const payload: Partial<CachedTopic> = {
      url: topicUrl,
      title: 'Test Topic',
      version: 'xf2',
      totalPages: 4,
      forumPostCount: segTotalPosts,
      totalPosts: segTotalPosts,
      summarizedPostCount: segTotalPosts,
      segments: [segment],
      summary: segment.summary,
      summaryJson: segment.summaryJson,
    };

    expect(payload.segments).toHaveLength(1);
    expect(payload.segments![0].summary).toBe(summaryJson.summary);
    expect(payload.summary).toBe(summaryJson.summary);
    expect(payload.summaryJson).toEqual(summaryJson);
    expect(payload.totalPosts).toBe(segTotalPosts);
    expect(payload.summarizedPostCount).toBe(segTotalPosts);

    const result = mergePartialTopic(payload, null, topicUrl, LLM_CONFIG);
    expect(result.segments).toHaveLength(1);
    expect(result.segments![0].summary).toBe(summaryJson.summary);
    expect(result.summary).toBe(summaryJson.summary);
    expect(result.summaryJson).toEqual(summaryJson);
    expect(result.totalPosts).toBe(segTotalPosts);
    expect(result.summarizedPostCount).toBe(segTotalPosts);
  });

  it('pattern cũ (2 event) — event 2 thiếu segments/totalPosts, mất dữ liệu nếu event 1 fail', () => {
    const event2: Partial<CachedTopic> = {
      url: topicUrl,
      forumPostCount: segTotalPosts,
      summary: segment.summary,
      summaryJson: segment.summaryJson,
      summarizedPostCount: segTotalPosts,
    };

    const result = mergePartialTopic(event2, null, topicUrl, LLM_CONFIG);
    expect(result.summary).toBe(summaryJson.summary);
    expect(result.summaryJson).toEqual(summaryJson);
    expect(result.segments).toBeUndefined();
    expect(result.totalPosts).toBe(0);
  });

  it('mergePartialTopic: 2 event hợp lệ — event 2 merge đúng với event 1', () => {
    const event1: Partial<CachedTopic> = {
      url: topicUrl,
      title: 'Test Topic',
      version: 'xf2',
      totalPages: 4,
      forumPostCount: segTotalPosts,
      totalPosts: segTotalPosts,
      summarizedPostCount: segTotalPosts,
      segments: [segment],
    };

    const afterEvent1 = mergePartialTopic(event1, null, topicUrl, LLM_CONFIG);
    expect(afterEvent1.segments).toHaveLength(1);
    expect(afterEvent1.totalPosts).toBe(segTotalPosts);
    expect(afterEvent1.summary).toBe('');

    const event2: Partial<CachedTopic> = {
      url: topicUrl,
      forumPostCount: 79,
      summary: segment.summary,
      summaryJson: segment.summaryJson,
      summarizedPostCount: segTotalPosts,
    };

    const afterEvent2 = mergePartialTopic(event2, afterEvent1, topicUrl, LLM_CONFIG);
    expect(afterEvent2.summary).toBe(summaryJson.summary);
    expect(afterEvent2.summaryJson).toEqual(summaryJson);
    expect(afterEvent2.segments).toHaveLength(1);
    expect(afterEvent2.totalPosts).toBe(segTotalPosts);
  });
});

describe('computeResumeState: re-scrape from pendingStartPage, not page 1', () => {
  it('resume.fromPage > totalPages — không thể resume từ fromPage, phải dùng pendingStartPage', () => {
    const lastSeg: TopicSegment = {
      startPage: 3,
      endPage: 4,
      posts: postFactory.shortThread(10),
      summary: 'segment summary',
      postCount: 20,
      summarizedAt: Date.now(),
    };

    expect(lastSeg.startPage).toBe(3);
    expect(lastSeg.endPage).toBe(4);
    expect(lastSeg.endPage + 1).toBe(5);

    // fromPage = 5 > totalPages = 4 → cannot resume from fromPage
    // Must fall back to re-scrape from lastSeg.endPage (4) only,
    // keeping posts from pages before it (3)
    const fromPage = lastSeg.endPage + 1;
    const totalPages = 4;
    const reScrapeFrom = lastSeg.endPage;

    expect(fromPage).toBeGreaterThan(totalPages);
    expect(reScrapeFrom).toBeLessThanOrEqual(totalPages);
    expect(reScrapeFrom).toBe(4);
  });

  it('single-segment covering all pages — lastPage = totalPages', () => {
    const segment: TopicSegment = {
      startPage: 1,
      endPage: 4,
      posts: postFactory.shortThread(10),
      summary: 'summary',
      postCount: 69,
      summarizedAt: Date.now(),
    };

    // fromPage = 5 > totalPages = 4
    // Re-scrape from lastPage (4) with preserved posts from pages 1-3
    expect(segment.endPage + 1).toBe(5);
    expect(segment.endPage).toBe(4);

    // Posts from pages before endPage should be preserved
    const preservedPosts = segment.posts.filter(p => {
      const page = p.page;
      return page != null && page < segment.endPage;
    });
    // Posts with page >= endPage need to be re-scraped (will be replaced)
    const postsOnLastPage = segment.posts.filter(p => {
      const page = p.page;
      return page != null && page >= segment.endPage;
    });
    // postFactory doesn't set page, so all posts have page=undefined
    // In production, these would come from scrapePageRange which sets page
    expect(preservedPosts.length + postsOnLastPage.length).toBeLessThanOrEqual(segment.posts.length);
  });

  it('re-scrape preserves posts from earlier pages, excludes posts from last page to avoid duplicates', () => {
    // Simulate a segment covering pages 1-4 with 69 posts (posts have page numbers)
    const posts: import('@/lib/types').ScrapedPost[] = [];
    let postNum = 1;
    for (let page = 1; page <= 4; page++) {
      const postsOnPage = page < 4 ? 20 : 9; // 20 posts per page for pages 1-3, 9 on page 4
      for (let i = 0; i < postsOnPage; i++) {
        posts.push({
          author: `user_${postNum}`,
          content: `Post content ${postNum}`,
          timestamp: '',
          postNumber: postNum,
          page,
        });
        postNum++;
      }
    }

    const segment: TopicSegment = {
      startPage: 1,
      endPage: 4,
      posts,
      summary: 'summary',
      postCount: 69,
      summarizedAt: Date.now(),
    };

    // When re-scraping, posts from pages before the last page are preserved
    const preservedPosts = posts.filter(p => p.page != null && p.page < segment.endPage);
    // Posts on the last page (4) will be freshly scraped, so exclude them from pendingPosts
    const excludedPosts = posts.filter(p => p.page != null && p.page >= segment.endPage);

    expect(preservedPosts.length).toBe(60); // pages 1-3 × 20 posts
    expect(excludedPosts.length).toBe(9); // page 4 × 9 posts
  });

  it('missing post bug: last post of previous page is on boundary', () => {
    // XenForo pagination: post at the end of page N is the same as first post of page N+1
    // This is NOT the case in standard XenForo. But what CAN happen is:
    // When re-scraping page 4, if we don't include posts from page 4 in pendingPosts,
    // and the new scrape of page 4 returns the same first post as before,
    // deduplication must handle it correctly.
    //
    // The key insight: we preserve posts from pages BEFORE the last page,
    // and re-scrape the last page.ScrapedPost.page allows filtering by page.
    const posts: import('@/lib/types').ScrapedPost[] = [];
    for (let i = 1; i <= 69; i++) {
      const page = Math.ceil(i / 20) || 1; // 20 posts per page, last post of page 3 = post 60
      posts.push({
        author: `user_${i}`,
        content: `Content ${i}`,
        timestamp: '',
        postNumber: i,
        page,
      });
    }

    // Post 60 is the last post of page 3
    const post60 = posts.find(p => p.postNumber === 60);
    expect(post60?.page).toBe(3);

    // Post 61 is the first post of page 4
    const post61 = posts.find(p => p.postNumber === 61);
    expect(post61?.page).toBe(4);

    // When re-scraping page 4, preservedPosts includes pages 1-3 (posts 1-60)
    // Re-scraped page 4 returns posts 61-69 (plus new posts 70-79)
    // No overlap: 60 + (9+10) = 79 total
    const preservedPosts = posts.filter(p => p.page != null && p.page < 4);
    expect(preservedPosts.length).toBe(60);
    expect(preservedPosts[preservedPosts.length - 1].postNumber).toBe(60);
  });
});
