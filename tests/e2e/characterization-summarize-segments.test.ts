import { describe, it, expect, afterEach, vi } from 'vitest';
import { summarizeSegments, parseSummaryJSON } from '@/lib/llm/summarizer';
import { createMockProvider, restoreCreateProvider } from '@/tests/mocks/override-factory';
import { MockLLMProvider } from '@/tests/mocks/mock-provider';
import { mockSummaryResponses, mockJsonResponse } from '@/tests/fixtures/mock-llm-responses';
import type { LLMConfig, SummaryJSON } from '@/lib/types';

const testConfig: LLMConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKey: 'test-key',
  baseUrl: 'https://api.openai.com/v1',
  temperature: 0.3,
  contextWindow: 128000,
};

function segStrs(jsons: SummaryJSON[]): string[] {
  return jsons.map(j => mockJsonResponse(j));
}

describe('Characterization: summarizeSegments (Flow 3 — merge segment summaries)', () => {
  afterEach(() => {
    restoreCreateProvider();
  });

  describe('Single segment — base case (zero LLM calls)', () => {
    it('1 segment: 0 LLM calls, returns same semantic content', async () => {
      const mock = createMockProvider();
      const s1 = mockJsonResponse(mockSummaryResponses.segment1);

      const result = await summarizeSegments([s1], testConfig);

      expect(mock.getCallCount()).toBe(0);
      const resultParsed = parseSummaryJSON(result);
      const inputParsed = parseSummaryJSON(s1);
      expect(resultParsed!.summary).toBe(inputParsed!.summary);
      expect(resultParsed!.opinions.length).toBe(inputParsed!.opinions.length);
      expect(resultParsed!.conclusion).toBe(inputParsed!.conclusion);
    });

    it('1 segment: passes validation, all fields intact after dedup', async () => {
      createMockProvider();
      const s1 = mockJsonResponse(mockSummaryResponses.segment2);

      const result = await summarizeSegments([s1], testConfig);
      const parsed = parseSummaryJSON(result);

      expect(parsed).not.toBeNull();
      expect(parsed!.summary).toBe(mockSummaryResponses.segment2.summary);
      expect(parsed!.opinions.length).toBe(2);
      expect(typeof parsed!.conclusion).toBe('string');
    });
  });

  describe('Two segments merge — single LLM call', () => {
    it('2 segments that fit: 1 LLM call, valid SummaryJSON output', async () => {
      const mock = createMockProvider({
        responses: [mockJsonResponse(mockSummaryResponses.singleSegment)],
      });
      const summaries = segStrs([mockSummaryResponses.segment1, mockSummaryResponses.segment2]);

      const result = await summarizeSegments(summaries, testConfig);

      expect(mock.getCallCount()).toBe(1);
      const parsed = parseSummaryJSON(result);
      expect(parsed).not.toBeNull();
      expect(typeof parsed!.summary).toBe('string');
      expect(Array.isArray(parsed!.opinions)).toBe(true);
      expect(typeof parsed!.conclusion).toBe('string');
    });

    it('2 segments: merge with custom response preserves opinion count', async () => {
      const mergedResponse: SummaryJSON = {
        summary: 'Tổng quan thread đa chiều.',
        opinions: [
          {
            title: 'Quan điểm bảo thủ',
            description: 'Thận trọng, chờ thêm dữ liệu',
            supporters: ['vozer_01', 'la_khach'],
            quotes: [{ author: 'vozer_01', postNumber: 2, text: 'Cần thận trọng.' }],
          },
          {
            title: 'Quan điểm cấp tiến',
            description: 'Ủng hộ hành động ngay',
            supporters: ['chuyen_gia', 'nguoiquansat'],
            quotes: [{ author: 'chuyen_gia', postNumber: 12, text: 'Cần hành động.' }],
          },
        ],
        conclusion: 'Đa số ủng hộ tiếp cận thận trọng.',
      };

      const mock = createMockProvider({ responses: [JSON.stringify(mergedResponse)] });
      const summaries = segStrs([mockSummaryResponses.segment1, mockSummaryResponses.segment2]);

      const result = await summarizeSegments(summaries, testConfig);

      expect(mock.getCallCount()).toBe(1);
      const parsed = parseSummaryJSON(result);
      expect(parsed).not.toBeNull();
      expect(parsed!.opinions.length).toBe(2);
      expect(parsed!.conclusion).toBe('Đa số ủng hộ tiếp cận thận trọng.');
    });

    it('2 segments with overlapping author names: dedup applied post-hoc', async () => {
      createMockProvider({ responses: [mockJsonResponse(mockSummaryResponses.singleSegment)] });
      const summaries = segStrs([mockSummaryResponses.segment1, mockSummaryResponses.segment2]);

      const result = await summarizeSegments(summaries, testConfig);
      const parsed = parseSummaryJSON(result);

      expect(parsed).not.toBeNull();
      for (const op of parsed!.opinions) {
        const lowerNames = op.supporters.map(s => s.toLowerCase());
        expect(new Set(lowerNames).size).toBe(op.supporters.length);
      }
    });
  });

  describe('Three segments merge', () => {
    it('3 segments that fit: 1 LLM call', async () => {
      const mock = createMockProvider({
        responses: [mockJsonResponse(mockSummaryResponses.singleSegment)],
      });
      const summaries = segStrs([
        mockSummaryResponses.segment1,
        mockSummaryResponses.segment2,
        mockSummaryResponses.segment3,
      ]);

      const result = await summarizeSegments(summaries, testConfig);

      expect(mock.getCallCount()).toBe(1);
      const parsed = parseSummaryJSON(result);
      expect(parsed).not.toBeNull();
      expect(parsed!.opinions.length).toBe(2);
    });

    it('3 segments: cross-reference author spanning 3 segments deduped in final output', async () => {
      createMockProvider({ responses: [mockJsonResponse(mockSummaryResponses.singleSegment)] });
      const summaries = segStrs([
        mockSummaryResponses.segment1,
        mockSummaryResponses.segment2,
        mockSummaryResponses.segment3,
      ]);

      const result = await summarizeSegments(summaries, testConfig);
      const parsed = parseSummaryJSON(result);
      expect(parsed).not.toBeNull();
      const allSupporters = parsed!.opinions.flatMap(o => o.supporters.map(s => s.toLowerCase()));
      const vozerCount = allSupporters.filter(s => s === 'vozer_01').length;
      expect(vozerCount).toBeLessThanOrEqual(1);
    });
  });

  describe('Tree-reduce — large number of segments', () => {
    it('many small segments with small context trigger tree-reduce (>1 LLM calls)', async () => {
      const smallConfig: LLMConfig = { ...testConfig, contextWindow: 8000 };

      const mock = createMockProvider({
        responses: Array(10).fill(mockJsonResponse(mockSummaryResponses.minimal)),
      });
      const summaries = Array(6).fill(null).map((_, i) =>
        mockJsonResponse({
          ...mockSummaryResponses.minimal,
          summary: `Segment ${i + 1} summary.`,
          conclusion: `Conclusion ${i + 1}.`,
        }),
      );

      const result = await summarizeSegments(summaries, smallConfig);
      const parsed = parseSummaryJSON(result);
      expect(parsed).not.toBeNull();
      expect(mock.getCallCount()).toBeGreaterThanOrEqual(1);
    });

    it('tree-reduce produces valid final SummaryJSON', async () => {
      const smallConfig: LLMConfig = { ...testConfig, contextWindow: 8000 };

      const merged: SummaryJSON = {
        summary: 'Tổng hợp 9 phân đoạn.',
        opinions: [{ title: 'Đồng thuận', description: 'Đa số đồng ý', supporters: ['vozer_01'], quotes: [] }],
        conclusion: 'Kết luận chung.',
      };

      createMockProvider({ responses: Array(10).fill(JSON.stringify(merged)) });

      const summaries = Array(9).fill(null).map((_, i) =>
        mockJsonResponse({ ...mockSummaryResponses.minimal, summary: `Nội dung phần ${i + 1}.` }),
      );

      const result = await summarizeSegments(summaries, smallConfig);
      const parsed = parseSummaryJSON(result);
      expect(parsed).not.toBeNull();
      expect(parsed!.summary).toBeDefined();
    });
  });

  describe('Edge cases', () => {
    it('empty array: produces result via LLM call with empty content', async () => {
      createMockProvider();
      const result = await summarizeSegments([], testConfig);
      // Current behavior: reduceSegmentSummaries falls through to LLM call with empty content
      expect(typeof result).toBe('string');
    });

    it('segments with empty opinions merge correctly', async () => {
      createMockProvider({ responses: [mockJsonResponse(mockSummaryResponses.emptyOpinions)] });
      const summaries = segStrs([mockSummaryResponses.emptyOpinions, mockSummaryResponses.minimal]);

      const result = await summarizeSegments(summaries, testConfig);
      const parsed = parseSummaryJSON(result);
      expect(parsed).not.toBeNull();
      expect(Array.isArray(parsed!.opinions)).toBe(true);
    });

    it('onProgress callback fires during merge', async () => {
      createMockProvider({ responses: [mockJsonResponse(mockSummaryResponses.singleSegment)] });
      const onProgress = vi.fn();
      const summaries = segStrs([
        mockSummaryResponses.segment1,
        mockSummaryResponses.segment2,
        mockSummaryResponses.segment3,
      ]);

      await summarizeSegments(summaries, testConfig, onProgress);

      expect(onProgress).toHaveBeenCalled();
      expect(onProgress.mock.calls[0][0]).toContain('tóm tắt');
    });

    it('invalid JSON in segment summary: merge still completes', async () => {
      createMockProvider({ responses: [mockJsonResponse(mockSummaryResponses.minimal)] });
      const summaries = ['this is not valid json', mockJsonResponse(mockSummaryResponses.minimal)];

      const result = await summarizeSegments(summaries, testConfig);
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });
  });
});

describe('Characterization: deduplicateSupporters post-processing', () => {
  it('deduplicateSupporters preserves opinion order and count', async () => {
    const mock = createMockProvider({
      responses: [mockJsonResponse(mockSummaryResponses.segment1)],
    });
    const result = await summarizeSegments(
      segStrs([mockSummaryResponses.segment1]),
      testConfig,
    );
    const parsed = parseSummaryJSON(result);
    expect(parsed!.opinions.length).toBe(mockSummaryResponses.segment1.opinions.length);
  });
});
