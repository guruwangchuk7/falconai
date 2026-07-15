import { describe, it, expect } from "vitest";
import { normalizeTimestamp } from "../../src/lib/timestampNormalizer";

describe("normalizeTimestamp", () => {
  it("returns elapsed ms from meeting start", () => {
    expect(normalizeTimestamp(1_700_000_005_000, 1_700_000_000_000)).toBe(5000);
  });

  it("throws when timestamp precedes meeting start", () => {
    expect(() =>
      normalizeTimestamp(1_699_999_999_000, 1_700_000_000_000)
    ).toThrow("timestamp precedes meetingStartedAt");
  });
});
