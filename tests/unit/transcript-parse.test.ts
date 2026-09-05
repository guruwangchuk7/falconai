import { describe, it, expect } from 'vitest';
import { parseTranscript } from '@falcon/core';

describe('parseTranscript', () => {
  it('parses "Speaker: text" lines into indexed utterances', () => {
    const out = parseTranscript('Guru: Let us keep the original checkout flow.\nSarah: Agreed, remove guest checkout.');
    expect(out).toEqual([
      { idx: 0, speaker: 'Guru', userId: null, text: 'Let us keep the original checkout flow.', tsMs: 0 },
      { idx: 1, speaker: 'Sarah', userId: null, text: 'Agreed, remove guest checkout.', tsMs: 1000 },
    ]);
  });

  it('inherits the previous speaker for continuation lines with no prefix', () => {
    const out = parseTranscript('Guru: First point.\nStill me, second line.');
    expect(out.map((u) => [u.speaker, u.text])).toEqual([
      ['Guru', 'First point.'],
      ['Guru', 'Still me, second line.'],
    ]);
  });

  it('leaves speaker null when a line has no prefix and no prior speaker', () => {
    const out = parseTranscript('Just some pasted notes with no speaker.');
    expect(out).toEqual([
      { idx: 0, speaker: null, userId: null, text: 'Just some pasted notes with no speaker.', tsMs: 0 },
    ]);
  });

  it('skips blank and whitespace-only lines and reindexes contiguously', () => {
    const out = parseTranscript('Guru: One.\n\n   \nSarah: Two.');
    expect(out.map((u) => u.idx)).toEqual([0, 1]);
    expect(out.map((u) => u.speaker)).toEqual(['Guru', 'Sarah']);
  });

  it('does NOT treat a mid-sentence colon as a speaker label', () => {
    // "we decided:" precedes a colon but reads as prose, not a name — keep it as text.
    const out = parseTranscript('We decided: use Postgres for the primary store.');
    expect(out[0]!.speaker).toBeNull();
    expect(out[0]!.text).toBe('We decided: use Postgres for the primary store.');
  });

  it('trims surrounding whitespace and returns [] for empty input', () => {
    expect(parseTranscript('   \n  \n')).toEqual([]);
    expect(parseTranscript('')).toEqual([]);
  });

  it('caps an over-long speaker label — treats the line as prose', () => {
    const longLabel = 'x'.repeat(60);
    const out = parseTranscript(`${longLabel}: hello`);
    expect(out[0]!.speaker).toBeNull();
  });
});
