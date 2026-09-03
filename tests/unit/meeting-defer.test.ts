import { it, expect } from 'vitest';
import { msUntilNextUtcMidnight } from '../../apps/worker/src/handlers.js';

it('returns ms until the next UTC midnight', () => {
  // 2026-09-02T22:00:00Z -> 2h to next UTC midnight
  const now = new Date('2026-09-02T22:00:00.000Z');
  expect(msUntilNextUtcMidnight(now)).toBe(2 * 3600_000);
});

it('at exactly UTC midnight, returns a full day', () => {
  const now = new Date('2026-09-02T00:00:00.000Z');
  expect(msUntilNextUtcMidnight(now)).toBe(24 * 3600_000);
});
