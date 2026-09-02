import { describe, it, expect } from 'vitest';
import {
  DECISION_MEETING_MIN_CONFIDENCE, MEETING_RATIONALE_PASS_TOP_N,
  MEETING_WORKING_COPY_TTL_HOURS, MEETING_REVIEWER_ESCALATION_HOURS,
} from '@falcon/config';

it('meeting constants are conservative + provisional', () => {
  expect(DECISION_MEETING_MIN_CONFIDENCE).toBeGreaterThanOrEqual(0.7); // strict until calibrated
  expect(MEETING_RATIONALE_PASS_TOP_N).toBeGreaterThan(0);
  expect(MEETING_WORKING_COPY_TTL_HOURS).toBeGreaterThanOrEqual(24);
  expect(MEETING_WORKING_COPY_TTL_HOURS).toBeLessThanOrEqual(72);
  expect(MEETING_REVIEWER_ESCALATION_HOURS).toBeGreaterThan(0);
});
