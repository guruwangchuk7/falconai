// Phase 3 (spec 004-pairing, T027/T029) — the panel projection is STRICTLY tracking: transcript +
// honest coverage states, never an intervention (FR-023). Gaps are always surfaced (§12.6). Pure.
import { it, expect } from 'vitest';
import { projectPanel, PANEL_EVENT_TYPES, type SessionEvent } from '@falcon/session-core';

const uttEvent = (seq: number, userId: string, text: string, arrivalTs: number, errorMarginMs = 5): SessionEvent => ({
  id: `${seq}-0`,
  seq,
  type: 'utterance_final',
  payload: { userId, clientSeq: 1, text, arrivalTs, errorMarginMs },
});

it('projects to tracking-only events — no card/nudge/escalation ever (FR-023)', () => {
  const events: SessionEvent[] = [
    uttEvent(1, 'a', 'hi', 100),
    { id: '2-0', seq: 2, type: 'transcript_gap', payload: { userId: 'b', reason: 'stt_total_loss' } },
    uttEvent(3, 'b', 'yo', 200),
  ];
  const panel = projectPanel(events);

  const allowed = new Set<string>(PANEL_EVENT_TYPES);
  expect(panel.every((p) => allowed.has(p.event))).toBe(true);
  expect(panel.some((p) => ['card', 'nudge', 'escalation'].includes(p.event as string))).toBe(false);

  const appends = panel.filter((p) => p.event === 'transcript_append');
  expect(appends.map((p) => (p.data as { userId: string }).userId).sort()).toEqual(['a', 'b']);

  // The gap is surfaced (never a silent hole) — as transcript_gap + a coverage notice (§7.3).
  expect(panel.some((p) => p.event === 'transcript_gap')).toBe(true);
  expect(panel.some((p) => p.event === 'coverage_notice')).toBe(true);
});

it('carries ambiguous-order marks when arrivals are close (F5.3)', () => {
  const events: SessionEvent[] = [uttEvent(1, 'a', 'x', 100, 30), uttEvent(2, 'b', 'y', 110, 30)];
  const appends = projectPanel(events).filter((p) => p.event === 'transcript_append');
  expect(appends.every((p) => (p.data as { ambiguousOrder: boolean }).ambiguousOrder)).toBe(true);
});
