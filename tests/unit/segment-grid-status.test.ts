import { describe, it, expect } from 'vitest';
import { deriveSummarySegmentStatus, mapKnowledgeSegmentStatus } from '@/lib/segment-grid-status';

describe('deriveSummarySegmentStatus', () => {
  it('running takes precedence over everything', () => {
    expect(deriveSummarySegmentStatus({ running: true, error: true, hasSummary: true, complete: true }))
      .toBe('running');
  });

  it('error takes precedence over done/partial when not running', () => {
    expect(deriveSummarySegmentStatus({ running: false, error: true, hasSummary: true, complete: true }))
      .toBe('error');
    // error even when there is no summary yet (failed first attempt)
    expect(deriveSummarySegmentStatus({ running: false, error: true, hasSummary: false, complete: undefined }))
      .toBe('error');
  });

  it('done when has a complete summary', () => {
    expect(deriveSummarySegmentStatus({ running: false, error: false, hasSummary: true, complete: true }))
      .toBe('done');
    // complete undefined is treated as complete (legacy segments)
    expect(deriveSummarySegmentStatus({ running: false, error: false, hasSummary: true, complete: undefined }))
      .toBe('done');
  });

  it('partial when has a summary but complete === false', () => {
    expect(deriveSummarySegmentStatus({ running: false, error: false, hasSummary: true, complete: false }))
      .toBe('partial');
  });

  it('pending when no summary, no error, not running', () => {
    expect(deriveSummarySegmentStatus({ running: false, error: false, hasSummary: false, complete: undefined }))
      .toBe('pending');
    // scraped-but-not-summarized also maps to pending
    expect(deriveSummarySegmentStatus({ running: false, error: false, hasSummary: false, complete: false }))
      .toBe('pending');
  });
});

describe('mapKnowledgeSegmentStatus', () => {
  it('maps extracting → running', () => {
    expect(mapKnowledgeSegmentStatus('extracting')).toBe('running');
  });

  it('passes through pending/done/partial unchanged', () => {
    expect(mapKnowledgeSegmentStatus('pending')).toBe('pending');
    expect(mapKnowledgeSegmentStatus('done')).toBe('done');
    expect(mapKnowledgeSegmentStatus('partial')).toBe('partial');
  });

  it('never produces an error status (knowledge has no error state)', () => {
    const statuses = (['pending', 'extracting', 'done', 'partial'] as const).map(mapKnowledgeSegmentStatus);
    expect(statuses).not.toContain('error');
  });
});
