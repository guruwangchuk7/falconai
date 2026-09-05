import { randomUUID } from 'node:crypto';
import type { CoreDeps } from './deps.js';
import { createMeeting, persistWorkingCopy, type Attendee, type Utterance } from './meeting.js';

/**
 * Parse a pasted meeting transcript into the same `Utterance[]` shape the shipped in-meeting
 * extractor consumes (feature 005) — the ONLY new logic in the transcript-paste capture path
 * (C1). Everything downstream (createMeeting → persistWorkingCopy → extractMeetingDecisions →
 * unconfirmed cited Decision Records) is reused unchanged.
 *
 * Text only, no audio (R6). Speaker labels are best-effort metadata: the extractor grounds on the
 * decision TEXT, so a mis-parsed speaker is low-risk. `userId` is always null — a pasted transcript
 * is free speaker labels, not Falcon-authenticated identities. `tsMs` is a synthetic monotonic clock
 * (idx * 1000) so ordering is preserved without real timestamps.
 */

const MAX_SPEAKER_LEN = 40;

/** A leading "Label: body" split. Label capped so a runaway prefix can't swallow the line. */
const SPEAKER_RE = /^([^:\n]{1,40}):\s+(\S.*)$/;

/** Is the pre-colon label a NAME (accept "Guru", "Sarah Lee", "Speaker 1") rather than PROSE
 *  ("We decided:", "Note:")? Every word must be capitalized or a bare number, ≤3 words. This is what
 *  keeps a mid-sentence colon from being misread as a speaker. */
function isNameLike(label: string): boolean {
  const l = label.trim();
  if (!l || l.length > MAX_SPEAKER_LEN) return false;
  const words = l.split(/\s+/);
  if (words.length > 3) return false;
  return words.every((w) => /^[A-Z][\w.'-]*$/.test(w) || /^\d+$/.test(w));
}

export function parseTranscript(text: string): Utterance[] {
  const out: Utterance[] = [];
  let lastSpeaker: string | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue; // skip blank / whitespace-only lines

    let speaker: string | null;
    let body: string;
    const m = SPEAKER_RE.exec(line);
    if (m && isNameLike(m[1]!)) {
      speaker = m[1]!.trim();
      body = m[2]!.trim();
      lastSpeaker = speaker;
    } else {
      speaker = lastSpeaker; // continuation line → inherit the current speaker (null if none yet)
      body = line;
    }

    const idx = out.length;
    out.push({ idx, speaker, userId: null, text: body, tsMs: idx * 1000 });
  }
  return out;
}

/** Pasted transcripts have no paired session, so the durable working copy needs its own TTL before
 *  extraction runs. 72h is comfortably longer than the queue's turnaround; `handleMeetingExtract`
 *  then extends or deletes it per the workspace's retention setting (D6/D7). */
const WORKING_COPY_TTL_MS = 72 * 3_600_000;

export interface PastedTranscriptInput {
  /** The pasting user — becomes the sole meeting attendee, so raw spans stay attendee-gated to them. */
  userId: string;
  displayName: string | null;
  title?: string | null;
  text: string;
}

/**
 * Ingest a pasted transcript into the shipped meeting-extraction pipeline (C1). Parses the text, creates
 * a meeting with a SYNTHETIC session id (pasted transcripts have no paired session; `meeting.session_id`
 * carries no FK), snapshots the pasting user as the sole attendee, and persists the durable working copy.
 * Returns the meetingId + utterance count, or null when the transcript has no usable lines. The CALLER
 * enqueues the extract job (`meetingExtractQueue`) so core stays queue-free — everything downstream is
 * the unchanged live path (extract → unconfirmed, cited Decision Records in the /decisions queue).
 */
export async function ingestPastedTranscript(
  deps: CoreDeps,
  workspaceId: string,
  input: PastedTranscriptInput,
  now: Date = new Date(),
): Promise<{ meetingId: string; utteranceCount: number } | null> {
  const utterances = parseTranscript(input.text);
  if (utterances.length === 0) return null;

  const attendee: Attendee = { userId: input.userId, displayName: input.displayName, isMember: true, isFalconUser: true };
  const { meetingId } = await createMeeting(deps, workspaceId, {
    sessionId: randomUUID(),
    title: input.title?.trim() || 'Pasted transcript',
    startedAt: now,
    endedAt: now,
    attendees: [attendee],
    designatedReviewerUserId: input.userId,
  });
  await persistWorkingCopy(deps, workspaceId, meetingId, utterances, new Date(now.getTime() + WORKING_COPY_TTL_MS));
  return { meetingId, utteranceCount: utterances.length };
}
