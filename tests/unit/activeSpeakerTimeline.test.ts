import { describe, it, expect } from "vitest";
import { ActiveSpeakerTimeline } from "../../src/transcription/activeSpeakerTimeline";

describe("ActiveSpeakerTimeline", () => {
  it("resolves a segment to the participant active during that window", () => {
    const timeline = new ActiveSpeakerTimeline();
    timeline.recordActiveSpeaker("p1", 0);
    timeline.recordActiveSpeaker("p2", 1000);

    expect(timeline.resolveParticipant(0, 900)).toBe("p1");
    expect(timeline.resolveParticipant(1000, 1500)).toBe("p2");
  });

  it("picks the participant with the largest overlap for a segment spanning a speaker change", () => {
    const timeline = new ActiveSpeakerTimeline();
    timeline.recordActiveSpeaker("p1", 0);
    timeline.recordActiveSpeaker("p2", 900);
    timeline.recordActiveSpeaker("p2", 1500);

    expect(timeline.resolveParticipant(0, 1000)).toBe("p1");
  });

  it("returns undefined when no window overlaps the segment", () => {
    const timeline = new ActiveSpeakerTimeline();
    timeline.recordActiveSpeaker("p1", 5000);

    expect(timeline.resolveParticipant(0, 100)).toBeUndefined();
  });
});
