import { describe, it, expect } from 'vitest';
import {
  DECISION_MEETING_MIN_CONFIDENCE, MEETING_RATIONALE_PASS_TOP_N,
  MEETING_WORKING_COPY_TTL_HOURS, MEETING_REVIEWER_ESCALATION_HOURS,
  MEETING_IDLE_GRACE_MS, MEETING_MAX_SESSION_MS, DECISION_MEETING_DAILY_BUDGET, MEETING_CHUNK_SIZE,
} from '@falcon/config';

it('meeting constants are conservative + provisional', () => {
  expect(DECISION_MEETING_MIN_CONFIDENCE).toBeGreaterThanOrEqual(0.7); // strict until calibrated
  expect(MEETING_RATIONALE_PASS_TOP_N).toBeGreaterThan(0);
  expect(MEETING_WORKING_COPY_TTL_HOURS).toBeGreaterThanOrEqual(24);
  expect(MEETING_WORKING_COPY_TTL_HOURS).toBeLessThanOrEqual(72);
  expect(MEETING_REVIEWER_ESCALATION_HOURS).toBeGreaterThan(0);
  expect(MEETING_IDLE_GRACE_MS).toBeGreaterThan(0);
  expect(MEETING_MAX_SESSION_MS).toBeGreaterThan(MEETING_IDLE_GRACE_MS);
  expect(DECISION_MEETING_DAILY_BUDGET).toBeGreaterThan(0);
  expect(MEETING_CHUNK_SIZE).toBeGreaterThan(0);
});
