// F44: shared segment status model for the SegmentGrid common component.
// Pure helpers so the status derivation is unit-testable without mounting Vue.

export type SegmentStatus = 'pending' | 'running' | 'done' | 'partial' | 'error';

/**
 * Derive a summary segment's grid status from its runtime + persisted state.
 *
 * Precedence: running > error > done > partial > pending.
 * - running: this segment is currently being summarized.
 * - error:   the last summarize attempt for this segment failed (in-memory).
 * - done:    has a summary and is complete.
 * - partial: has a summary but `complete === false` (more posts may be appended).
 * - pending: no summary yet (incl. scraped-but-not-summarized).
 */
export function deriveSummarySegmentStatus(p: {
  running: boolean;
  error: boolean;
  hasSummary: boolean;
  complete: boolean | undefined;
}): SegmentStatus {
  if (p.running) return 'running';
  if (p.error) return 'error';
  if (p.hasSummary) return p.complete === false ? 'partial' : 'done';
  return 'pending';
}

/**
 * Map the knowledge per-segment extraction status onto the shared grid status.
 * Knowledge has no error state of its own; failed chunks surface as `partial`.
 */
export function mapKnowledgeSegmentStatus(
  status: 'pending' | 'extracting' | 'done' | 'partial',
): SegmentStatus {
  return status === 'extracting' ? 'running' : status;
}
