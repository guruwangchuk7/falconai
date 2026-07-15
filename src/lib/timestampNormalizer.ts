export function normalizeTimestamp(
  rawTimestampMs: number,
  meetingStartedAtMs: number
): number {
  const elapsed = rawTimestampMs - meetingStartedAtMs;
  if (elapsed < 0) {
    throw new Error("timestamp precedes meetingStartedAt");
  }
  return elapsed;
}
