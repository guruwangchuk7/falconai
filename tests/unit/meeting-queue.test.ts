import { describe, it, expect } from 'vitest';
import { meetingExtractJobId } from '@falcon/queue';

describe('meetingExtractJobId', () => {
  it('is stable + coalescing for the same (workspace, meeting)', () => {
    const a = meetingExtractJobId('ws-1', 'm-1');
    const b = meetingExtractJobId('ws-1', 'm-1');
    expect(a).toBe(b);
  });

  it('differs by workspace and by meeting', () => {
    expect(meetingExtractJobId('ws-1', 'm-1')).not.toBe(meetingExtractJobId('ws-2', 'm-1'));
    expect(meetingExtractJobId('ws-1', 'm-1')).not.toBe(meetingExtractJobId('ws-1', 'm-2'));
  });

  it('encodes both ids in the key', () => {
    expect(meetingExtractJobId('ws-1', 'm-1')).toContain('ws-1');
    expect(meetingExtractJobId('ws-1', 'm-1')).toContain('m-1');
  });
});
