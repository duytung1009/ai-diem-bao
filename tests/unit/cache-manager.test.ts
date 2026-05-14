import { describe, it, expect } from 'vitest';
import { normalizeUrl, isSameTopicUrl } from '@/lib/cache-manager';

describe('cache-manager', () => {
  describe('normalizeUrl', () => {
    it('removes page number from path', () => {
      const result = normalizeUrl('https://voz.vn/threads/topic.123/page-3/');
      expect(result).toBe('https://voz.vn/threads/topic.123/');
    });

    it('removes page number without trailing slash', () => {
      const result = normalizeUrl('https://voz.vn/threads/topic.123/page-3');
      expect(result).toBe('https://voz.vn/threads/topic.123/');
    });

    it('removes query parameters', () => {
      const result = normalizeUrl('https://voz.vn/threads/topic.123/?utm_source=google');
      expect(result).toBe('https://voz.vn/threads/topic.123/');
    });

    it('removes hash fragment', () => {
      const result = normalizeUrl('https://voz.vn/threads/topic.123/#post-456');
      expect(result).toBe('https://voz.vn/threads/topic.123/');
    });

    it('normalizes URLs with multiple components', () => {
      const result = normalizeUrl('https://voz.vn/threads/topic.123/page-5/?ref=twitter#post-100');
      expect(result).toBe('https://voz.vn/threads/topic.123/');
    });

    it('adds trailing slash if missing', () => {
      const result = normalizeUrl('https://voz.vn/threads/topic.123');
      expect(result).toBe('https://voz.vn/threads/topic.123/');
    });

    it('preserves already normalized URLs', () => {
      const url = 'https://voz.vn/threads/topic.123/';
      expect(normalizeUrl(url)).toBe(url);
    });

    it('returns original for invalid URLs', () => {
      const invalid = 'not-a-url';
      expect(normalizeUrl(invalid)).toBe(invalid);
    });

    it('handles different protocols', () => {
      const result = normalizeUrl('http://voz.vn/threads/topic.123/page-2/');
      expect(result).toBe('http://voz.vn/threads/topic.123/');
    });

    it('handles URLs with subdomains', () => {
      const result = normalizeUrl('https://forum.voz.vn/threads/topic.123/page-1/');
      expect(result).toBe('https://forum.voz.vn/threads/topic.123/');
    });
  });

  describe('isSameTopicUrl', () => {
    it('returns true for identical URLs', () => {
      expect(isSameTopicUrl('https://voz.vn/threads/topic.123/', 'https://voz.vn/threads/topic.123/')).toBe(true);
    });

    it('returns true for same topic with different pages', () => {
      expect(isSameTopicUrl('https://voz.vn/threads/topic.123/page-1/', 'https://voz.vn/threads/topic.123/page-5/')).toBe(true);
    });

    it('returns true for same topic with different query params', () => {
      expect(isSameTopicUrl('https://voz.vn/threads/topic.123/?a=1', 'https://voz.vn/threads/topic.123/?b=2')).toBe(true);
    });

    it('returns false for different topics', () => {
      expect(isSameTopicUrl('https://voz.vn/threads/topic.123/', 'https://voz.vn/threads/topic.456/')).toBe(false);
    });

    it('returns false when one URL is null', () => {
      expect(isSameTopicUrl(null, 'https://voz.vn/threads/topic.123/')).toBe(false);
      expect(isSameTopicUrl('https://voz.vn/threads/topic.123/', null)).toBe(false);
    });

    it('returns false when both URLs are null', () => {
      expect(isSameTopicUrl(null, null)).toBe(false);
    });

    it('handles mixed page and no-page URLs', () => {
      expect(isSameTopicUrl('https://voz.vn/threads/topic.123/', 'https://voz.vn/threads/topic.123/page-1/')).toBe(true);
    });

    it('URL constructor normalizes hostname case', () => {
      expect(isSameTopicUrl('https://voz.vn/threads/topic.123/', 'https://VOZ.VN/threads/topic.123/')).toBe(true);
    });

    it('handles URLs with trailing slash differences before normalization', () => {
      expect(isSameTopicUrl('https://voz.vn/threads/topic.123', 'https://voz.vn/threads/topic.123/')).toBe(true);
    });
  });
});
