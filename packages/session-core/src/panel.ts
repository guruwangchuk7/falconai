import type { SessionEvent } from './eventlog.js';
import { mergedTranscript } from './merge.js';

/**
 * Panel (SSE) events for the shared-transcript view (spec 004-pairing, T027; contracts/sse-panel.md).
 * This union is deliberately **tracking-only**: it contains NO `card` / `nudge` / `escalation` type
 * (FR-023) — Phase 3 shows the transcript and honest coverage states, never an intervention. A gap is
 * always surfaced (never a silent hole, §12.6, Constitution IV).
 */
export type PanelEvent =
  | {
      event: 'transcript_append';
      data: { seq: number; userId: string; text: string; orderConfidence: number; ambiguousOrder: boolean };
    }
  | { event: 'transcript_gap'; data: { seq: number; userId: string; reason: string } }
  | { event: 'coverage_notice'; data: { kind: 'unpaired_speaker' | 'stt_degraded' | 'network_gap'; detail: string } };

/** The event names the panel stream is allowed to emit — used by the contract test to assert no
 *  intervention type ever appears (FR-023). */
export const PANEL_EVENT_TYPES = ['transcript_append', 'transcript_gap', 'coverage_notice'] as const;

/**
 * Project the session event log into ordered panel events. Utterances come out server-arrival-ordered
 * with their ambiguity/confidence marks (F5.3); each `transcript_gap` in the log becomes a visible
 * gap + a coverage notice (§7.3 degradation ladder). Pure fold (CX-1).
 */
export function projectPanel(events: readonly SessionEvent[]): PanelEvent[] {
  const { utterances, gaps } = mergedTranscript(events);
  const out: PanelEvent[] = utterances.map((u) => ({
    event: 'transcript_append',
    data: { seq: u.seq, userId: u.userId, text: u.text, orderConfidence: u.orderConfidence, ambiguousOrder: u.ambiguousOrder },
  }));
  for (const g of gaps) {
    out.push({ event: 'transcript_gap', data: { seq: g.seq, userId: g.userId, reason: g.reason } });
    out.push({ event: 'coverage_notice', data: { kind: 'stt_degraded', detail: `coverage gap from ${g.userId}` } });
  }
  return out;
}
