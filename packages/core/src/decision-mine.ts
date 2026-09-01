import { createHash } from 'node:crypto';
import type { DecisionSegment } from './decision-extract.js';

/** Hash of the exact segments handed to the extractor. Widens automatically if the adapter later
 *  includes more segment types (e.g. PR comments), so "content changed" re-mining just works. */
export function contentHash(segments: DecisionSegment[]): string {
  const SEP = String.fromCharCode(0); // NUL — never appears in human PR/issue text
  const payload = segments.map((s) => [s.speaker ?? '', s.text].join(SEP)).join(SEP);
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/** Normalized title for suggest-time dedup/dismissal matching: lowercase, collapse whitespace,
 *  strip trailing punctuation. Deliberately lossy so trivial reworders match. */
export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.!?,;:\s]+$/g, '');
}
