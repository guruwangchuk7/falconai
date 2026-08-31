import type { SessionEvent } from './eventlog.js';

/**
 * Transcript merge (spec 004-pairing, T023; AD-1 resolved → server-arrival ordering, research R1).
 * Combines the per-client utterance streams into ONE ordered transcript, ordered by when the worker
 * received each finalized utterance. Two utterances whose arrival times fall within the sum of their
 * error margins have an **ambiguous** relative order — marked, never guessed (F5.3/R5) — and their
 * `order_confidence` drops so downstream never infers "who responded to whom" from timing alone.
 * Coverage before correctness: an utterance is never dropped; a stream gap is a marked event, not a
 * silent hole (§12.6, Constitution IV).
 *
 * The heavy distributed clock-sync subsystem is deliberately NOT built (AD-1). If real meetings later
 * show confident mis-orders the confidence signal misses, upgrade then — not before.
 */

/** A finalized utterance as ingested, before ordering. `arrivalTs` = server-receive time (the
 *  ordering key); `errorMarginMs` = uncertainty from client jitter / RTT variance (F5.3). */
export interface RawUtterance {
  seq: number;
  userId: string;
  clientSeq: number;
  text: string;
  arrivalTs: number;
  errorMarginMs: number;
}

export interface MergedUtterance extends RawUtterance {
  /** 0..1 — low when a neighbor's error margin overlaps this one (contested ordering, §12.5). */
  orderConfidence: number;
  /** true when this utterance's position relative to a neighbor can't be trusted (R5). */
  ambiguousOrder: boolean;
}

export interface GapMark {
  seq: number;
  userId: string;
  reason: string;
}

/** Merge per-client utterances into one server-arrival-ordered transcript with ambiguity marks. */
export function mergeUtterances(utts: readonly RawUtterance[]): MergedUtterance[] {
  const ordered = [...utts].sort((a, b) => a.arrivalTs - b.arrivalTs || a.seq - b.seq);
  const overlaps = (a: RawUtterance, b: RawUtterance | undefined): boolean =>
    b !== undefined && Math.abs(a.arrivalTs - b.arrivalTs) <= a.errorMarginMs + b.errorMarginMs;
  return ordered.map((u, i) => {
    const ambiguousOrder = overlaps(u, ordered[i - 1]) || overlaps(u, ordered[i + 1]);
    return { ...u, ambiguousOrder, orderConfidence: ambiguousOrder ? 0.5 : 1 };
  });
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' ? v : fallback);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Fold the event log into the merged transcript: collect `utterance_final` events → order them, and
 * keep `transcript_gap` events as coverage marks (never dropped). A pure fold (CX-1).
 */
export function mergedTranscript(events: readonly SessionEvent[]): {
  utterances: MergedUtterance[];
  gaps: GapMark[];
} {
  const raw: RawUtterance[] = [];
  const gaps: GapMark[] = [];
  for (const ev of events) {
    if (ev.type === 'utterance_final') {
      raw.push({
        seq: ev.seq,
        userId: str(ev.payload.userId),
        clientSeq: num(ev.payload.clientSeq, 0),
        text: str(ev.payload.text),
        arrivalTs: num(ev.payload.arrivalTs, ev.seq), // fall back to append order if unstamped
        errorMarginMs: num(ev.payload.errorMarginMs, 0),
      });
    } else if (ev.type === 'transcript_gap') {
      gaps.push({ seq: ev.seq, userId: str(ev.payload.userId), reason: str(ev.payload.reason) });
    }
  }
  return { utterances: mergeUtterances(raw), gaps };
}
