# LiveKit-Based Meeting Ingestion (Falcon Meet) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let real people join a Falcon-hosted meeting room via a simple web page, capture each participant's audio via a bot that joins the same LiveKit room, and feed it into the existing, unmodified `TranscriptionManager` → `TranscriptPipeline` → Postgres/Redis Stream pipeline.

**Architecture:** `LiveKitBotAdapter` is the direct architectural sibling of the existing `ZoomBotAdapter` — same five-event surface (`meetingStarted`, `participantJoined`, `participantLeft`, `audioChunk`, `meetingEnded`), same webhook-source + client-like composition pattern, so `TranscriptionManager`/`TranscriptPipeline` need zero changes. A join page (plain HTML using LiveKit's browser SDK via CDN) lets real people connect over WebRTC; a small `node:http` server handles token minting, webhook receipt, and serving the join page.

**Tech Stack:** `livekit-server-sdk` (tokens + webhook verification), `@livekit/rtc-node` (bot joins the room server-side and reads audio), LiveKit Cloud free tier (no self-hosted server needed), plain `node:http` (no new HTTP framework dependency), LiveKit's browser SDK loaded via CDN in a static HTML page (no bundler).

## Global Constraints

- Reuses `TranscriptionManager`, `TranscriptPipeline`, `PostgresTranscriptStore`, `RedisTranscriptPublisher`, `SequenceNumberAllocator`, and the `TranscriptEvent`/`MeetingLifecycleEvent` contract from the meeting-ingestion sub-project **unchanged**.
- The only existing file this plan modifies is `src/server/wireTranscriptionPipeline.ts` (widening its parameter type) — everything else is new files.
- No role selection on the join page — name only (per spec's non-goals; role selection is deferred to the future Dynamic Agent Manager sub-project).
- Single meeting (one LiveKit room) at a time, matching the existing "single meeting at a time" constraint.
- New environment variables (add to `.env.example`): `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL` (e.g. `wss://your-project.livekit.cloud`), `LIVEKIT_ROOM_NAME` (fixed room name for v1, e.g. `falcon-meet`), `LIVEKIT_HTTP_PORT` (for the join page/token/webhook server).
- **External prerequisite**: a free LiveKit Cloud account (cloud.livekit.io) — API key/secret, project URL, and a webhook configured to point at this server's `/livekit-webhook` endpoint (needs a public URL — reuse the same ngrok approach already set up for Zoom if testing locally).

---

## Task 1: Install LiveKit dependencies + capability spike

**Files:**
- Modify: `package.json` (add `livekit-server-sdk`, `@livekit/rtc-node`; add `spike:livekit` npm script)
- Create: `scripts/livekit-capability-check.ts`
- Create: `docs/superpowers/notes/livekit-capability-findings.md`

**Interfaces:**
- Produces: verified confirmation (or documented deviation) of the exact `@livekit/rtc-node` APIs the rest of this plan depends on.

This mirrors Task 1 of the Zoom sub-project: verify third-party API assumptions against the actually-installed package before building on them. Already confirmed by direct inspection of the installed packages' `.d.ts` files (not guessed): `Room` (from `@livekit/rtc-node`) extends a `TypedEventEmitter`; `room.connect(url, token)` returns `Promise<void>`; `RoomEvent.ParticipantConnected`/`ParticipantDisconnected`/`TrackSubscribed`/`Disconnected`/`Reconnecting`/`Reconnected` exist; `RemoteParticipant.identity`/`.name` are getters; `AudioStream` extends `ReadableStream<AudioFrame>` and accepts `(track, sampleRate, numChannels)`; `AudioFrame.data` is an `Int16Array`. What still needs a **live** spike (can't be confirmed by reading types alone): whether `AudioStream` construction on `TrackSubscribed` is actually stable in practice (a past GitHub issue reported crashes in earlier SDK versions), and what `RoomEvent.Disconnected`'s `reason` values look like for a clean vs. unclean disconnect.

- [ ] **Step 1: Install dependencies**

```bash
npm install livekit-server-sdk @livekit/rtc-node
```

(No `--force` needed — unlike `@zoom/rtms`, neither package restricts `os`/`cpu`.)

- [ ] **Step 2: Add the npm script**

Add to `package.json`'s `"scripts"`:
```json
"spike:livekit": "tsx scripts/livekit-capability-check.ts"
```

- [ ] **Step 3: Add LiveKit env vars to `.env.example`**

Append to `.env.example`:
```
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
LIVEKIT_URL=
LIVEKIT_ROOM_NAME=falcon-meet
LIVEKIT_HTTP_PORT=8081
```

- [ ] **Step 4: Write the capability-check spike script**

```typescript
// scripts/livekit-capability-check.ts
import "dotenv/config";
import { Room, RoomEvent, AudioStream, RemoteAudioTrack } from "@livekit/rtc-node";
import { AccessToken } from "livekit-server-sdk";

async function main() {
  const apiKey = process.env.LIVEKIT_API_KEY!;
  const apiSecret = process.env.LIVEKIT_API_SECRET!;
  const url = process.env.LIVEKIT_URL!;
  const roomName = process.env.LIVEKIT_ROOM_NAME ?? "falcon-meet";

  const botToken = new AccessToken(apiKey, apiSecret, { identity: "falcon-bot" });
  botToken.addGrant({ roomJoin: true, room: roomName, canPublish: false, canSubscribe: true });
  const botJwt = await botToken.toJwt();

  const humanToken = new AccessToken(apiKey, apiSecret, { identity: "human-tester", name: "Human Tester" });
  humanToken.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
  const humanJwt = await humanToken.toJwt();

  const room = new Room();

  room.on(RoomEvent.ParticipantConnected, (participant) => {
    console.log("[participantConnected]", participant.identity, participant.name);
  });
  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    console.log("[participantDisconnected]", participant.identity);
  });
  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    console.log("[trackSubscribed]", participant.identity, publication.kind);
    if (track instanceof RemoteAudioTrack) {
      const stream = new AudioStream(track, 16000, 1);
      let frameCount = 0;
      void (async () => {
        for await (const frame of stream) {
          frameCount += 1;
          if (frameCount % 50 === 0) {
            console.log(
              `[audioFrame] from ${participant.identity}: count=${frameCount} sampleRate=${frame.sampleRate} channels=${frame.channels} samplesPerChannel=${frame.samplesPerChannel}`
            );
          }
        }
        console.log(`[audioStream ended] ${participant.identity}, total frames=${frameCount}`);
      })();
    }
  });
  room.on(RoomEvent.Reconnecting, () => console.log("[reconnecting]"));
  room.on(RoomEvent.Reconnected, () => console.log("[reconnected]"));
  room.on(RoomEvent.Disconnected, (reason) => console.log("[disconnected]", reason));

  console.log(`Connecting bot to room "${roomName}"...`);
  await room.connect(url, botJwt);
  console.log("Bot connected.");
  console.log("");
  console.log("Now join the same room as a human: go to https://meet.livekit.io, choose");
  console.log('"Manual" / custom connection, and enter:');
  console.log("  Server URL:", url);
  console.log("  Token:", humanJwt);
  console.log("");
  console.log("Speak for 10-20 seconds, then press Ctrl+C here to stop.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 5: Run the spike against a real LiveKit Cloud project**

Sign up at cloud.livekit.io (free), create a project, get the API key/secret/URL, fill them into `.env`, then run: `npm run spike:livekit`, and follow the printed instructions to join from `meet.livekit.io` and speak.

Expected: `[participantConnected]`, `[trackSubscribed]`, and repeated `[audioFrame]` lines with `sampleRate=16000 channels=1` and no crash. Record in the findings doc (Step 6):
- Whether `AudioStream` construction on `TrackSubscribed` was stable (no crash) across the whole test.
- The exact `reason` value(s) logged by `[disconnected]` when you close the `meet.livekit.io` tab (participant leaving) vs. stopping the bot script itself (Ctrl+C doesn't count — that's our own process exiting, not a `Disconnected` event).
- Whether `[reconnecting]`/`[reconnected]` ever fired during the test (confirms the SDK's own reconnection is active, not just present in the type signatures).

- [ ] **Step 6: Write the findings doc**

```markdown
<!-- docs/superpowers/notes/livekit-capability-findings.md -->
# LiveKit Capability Findings

Date: <fill in when run>

## AudioStream stability
<Record whether AudioStream + TrackSubscribed crashed or ran cleanly>

## Disconnected reason values
<Record the actual reason value(s) observed>

## Reconnection behavior
<Record whether Reconnecting/Reconnected fired and what triggered it>
```

- [ ] **Step 7: Commit**

```bash
git add package.json .env.example scripts/livekit-capability-check.ts docs/superpowers/notes/livekit-capability-findings.md package-lock.json
git commit -m "Add LiveKit dependencies and run capability spike"
```

---

## Task 2: Widen `wireTranscriptionPipeline` to accept any meeting-source adapter

**Files:**
- Modify: `src/server/wireTranscriptionPipeline.ts`
- Test: `tests/unit/wireTranscriptionPipeline.test.ts` (new — this file didn't exist before; the wiring was previously only exercised indirectly via `pipeline.integration.test.ts`)

**Interfaces:**
- Produces: `MeetingSourceAdapter` interface (exported from `wireTranscriptionPipeline.ts`), consumed by both `ZoomBotAdapter` (already satisfies it structurally, no changes needed there) and the new `LiveKitBotAdapter` (Task 3).

This is the one existing-code change this plan makes, and it's a pure type widening — no behavior change. `ZoomBotAdapter extends EventEmitter`, and `EventEmitter`'s real `.on(event: string | symbol, listener: (...args: any[]) => void)` signature is structurally compatible with a narrower, event-specific interface (a standard TypeScript pattern for typed EventEmitters) — so this compiles without touching `zoomBotAdapter.ts` at all.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/wireTranscriptionPipeline.test.ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { wireTranscriptionPipeline } from "../../src/server/wireTranscriptionPipeline";
import type { MeetingSourceAdapter } from "../../src/server/wireTranscriptionPipeline";

class FakeAdapter extends EventEmitter implements MeetingSourceAdapter {}

describe("wireTranscriptionPipeline", () => {
  it("accepts any MeetingSourceAdapter, not just ZoomBotAdapter", async () => {
    const adapter = new FakeAdapter();
    const pipeline = {
      handleMeetingStarted: vi.fn().mockResolvedValue(undefined),
      handleMeetingEnded: vi.fn().mockResolvedValue(undefined),
      handleTranscriptEvent: vi.fn().mockResolvedValue(undefined),
    };

    wireTranscriptionPipeline(adapter, {
      pipeline: pipeline as any,
      createSession: () => ({
        onTranscript: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        send: vi.fn(),
        finish: vi.fn(),
      }),
    });

    adapter.emit("meetingStarted", "m1", [{ participantId: "p1", displayName: "Alex" }]);

    expect(pipeline.handleMeetingStarted).toHaveBeenCalledWith("m1", 0, [
      { participantId: "p1", displayName: "Alex" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/wireTranscriptionPipeline.test.ts`
Expected: FAIL — `MeetingSourceAdapter` is not exported from `wireTranscriptionPipeline.ts` yet (TypeScript compile error surfaced by vitest).

- [ ] **Step 3: Add the interface and widen the parameter type**

In `src/server/wireTranscriptionPipeline.ts`, replace:
```typescript
import type { ZoomBotAdapter } from "../zoom/zoomBotAdapter";
```
with:
```typescript
import type { Participant } from "../types/transcriptEvent";
```

Add, just below the imports:
```typescript
/**
 * The event surface any meeting-source adapter must emit for wireTranscriptionPipeline
 * to drive TranscriptionManager/TranscriptPipeline from it. Both ZoomBotAdapter and
 * LiveKitBotAdapter satisfy this structurally (they extend EventEmitter and emit these
 * exact events) without needing to declare `implements MeetingSourceAdapter` themselves.
 */
export interface MeetingSourceAdapter {
  on(
    event: "meetingStarted",
    listener: (meetingId: string, participants: Participant[]) => void
  ): this;
  on(
    event: "audioChunk",
    listener: (participantId: string, buffer: Buffer, timestamp: number) => void
  ): this;
  on(
    event: "activeSpeaker",
    listener: (participantId: string, timestamp: number) => void
  ): this;
  on(event: "participantLeft", listener: (participantId: string) => void): this;
  on(
    event: "meetingEnded",
    listener: (status: "ended" | "ended_error") => void
  ): this;
}
```

Change the function signature from:
```typescript
export function wireTranscriptionPipeline(
  zoomBotAdapter: ZoomBotAdapter,
  deps: {
```
to:
```typescript
export function wireTranscriptionPipeline(
  meetingSourceAdapter: MeetingSourceAdapter,
  deps: {
```

And rename every remaining use of `zoomBotAdapter` inside the function body to `meetingSourceAdapter` (five `.on(...)` registrations — the logic itself is unchanged).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/wireTranscriptionPipeline.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Run the full suite to confirm nothing else broke**

Run: `npm test`
Expected: all previously-passing tests (including `pipeline.integration.test.ts`, which passes a real `ZoomBotAdapter`) still pass — confirming the widened type doesn't break the existing Zoom path.

- [ ] **Step 6: Commit**

```bash
git add src/server/wireTranscriptionPipeline.ts tests/unit/wireTranscriptionPipeline.test.ts
git commit -m "Widen wireTranscriptionPipeline to accept any MeetingSourceAdapter"
```

---

## Task 3: `LiveKitBotAdapter` — types + core (meetingStarted, participants, audio)

**Files:**
- Create: `src/livekit/liveKitBotAdapter.types.ts`
- Create: `src/livekit/liveKitBotAdapter.ts`
- Test: `tests/unit/liveKitBotAdapter.test.ts`

**Interfaces:**
- Produces: `LiveKitParticipant`, `LiveKitRoomLike`, `LiveKitWebhookSource` interfaces, and `LiveKitBotAdapter` (an `EventEmitter` satisfying `MeetingSourceAdapter` from Task 2, emitting `meetingStarted`, `participantJoined`, `participantLeft`, `audioChunk`) — consumed by Task 4 (meetingEnded handling, same class) and Task 9 (server wiring).

`LiveKitRoomLike` is a narrow interface, not the raw `@livekit/rtc-node` `Room` type — this task's tests use fakes; the real implementation (`realLiveKitRoom.ts`) is Task 5.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/liveKitBotAdapter.test.ts
import { describe, it, expect, vi } from "vitest";
import { LiveKitBotAdapter } from "../../src/livekit/liveKitBotAdapter";
import type {
  LiveKitRoomLike,
  LiveKitWebhookSource,
} from "../../src/livekit/liveKitBotAdapter.types";

function makeFakeWebhookSource() {
  const handlers: Record<string, Function> = {};
  const source: LiveKitWebhookSource = {
    onRoomStarted: (cb) => (handlers.roomStarted = cb),
    onRoomFinished: (cb) => (handlers.roomFinished = cb),
    onParticipantJoined: (cb) => (handlers.participantJoined = cb),
    onParticipantLeft: (cb) => (handlers.participantLeft = cb),
  };
  return { source, handlers };
}

function makeFakeRoom() {
  const handlers: Record<string, Function> = {};
  const room: LiveKitRoomLike = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    onAudioData: (cb) => (handlers.audio = cb),
    onDisconnected: (cb) => (handlers.disconnected = cb),
  };
  return { room, handlers };
}

describe("LiveKitBotAdapter", () => {
  it("joins the room and emits meetingStarted when the room-started webhook fires", async () => {
    const { source, handlers } = makeFakeWebhookSource();
    const { room } = makeFakeRoom();
    const adapter = new LiveKitBotAdapter({
      webhookSource: source,
      createRoom: () => room,
      url: "wss://example.livekit.cloud",
    });

    const onStarted = vi.fn();
    adapter.on("meetingStarted", onStarted);

    await handlers.roomStarted({
      meetingId: "falcon-meet",
      botToken: "bot-jwt",
      participants: [{ participantId: "alex", displayName: "Alex" }],
    });

    expect(room.connect).toHaveBeenCalledWith("wss://example.livekit.cloud", "bot-jwt");
    expect(onStarted).toHaveBeenCalledWith("falcon-meet", [
      { participantId: "alex", displayName: "Alex" },
    ]);
  });

  it("emits audioChunk with the participant id from the room-like audio callback", async () => {
    const { source, handlers: webhookHandlers } = makeFakeWebhookSource();
    const { room, handlers: roomHandlers } = makeFakeRoom();
    const adapter = new LiveKitBotAdapter({
      webhookSource: source,
      createRoom: () => room,
      url: "wss://example.livekit.cloud",
    });

    const onAudioChunk = vi.fn();
    adapter.on("audioChunk", onAudioChunk);

    await webhookHandlers.roomStarted({
      meetingId: "falcon-meet",
      botToken: "bot-jwt",
      participants: [],
    });

    const buf = Buffer.from([1, 2, 3]);
    roomHandlers.audio("alex", buf, 5000);

    expect(onAudioChunk).toHaveBeenCalledWith("alex", buf, 5000);
  });

  it("emits participantJoined/participantLeft from the webhook source", () => {
    const { source, handlers } = makeFakeWebhookSource();
    const { room } = makeFakeRoom();
    const adapter = new LiveKitBotAdapter({
      webhookSource: source,
      createRoom: () => room,
      url: "wss://example.livekit.cloud",
    });

    const onJoined = vi.fn();
    const onLeft = vi.fn();
    adapter.on("participantJoined", onJoined);
    adapter.on("participantLeft", onLeft);

    handlers.participantJoined({
      meetingId: "falcon-meet",
      participant: { participantId: "sam", displayName: "Sam" },
    });
    handlers.participantLeft({ meetingId: "falcon-meet", participantId: "sam" });

    expect(onJoined).toHaveBeenCalledWith({ participantId: "sam", displayName: "Sam" });
    expect(onLeft).toHaveBeenCalledWith("sam");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/liveKitBotAdapter.test.ts`
Expected: FAIL with "Cannot find module '../../src/livekit/liveKitBotAdapter'"

- [ ] **Step 3: Write the types and the implementation**

```typescript
// src/livekit/liveKitBotAdapter.types.ts
export interface LiveKitParticipant {
  participantId: string;
  displayName: string;
}

export interface LiveKitRoomLike {
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
  onAudioData(
    cb: (participantId: string, buffer: Buffer, timestamp: number) => void
  ): void;
  onDisconnected(cb: (reason: string) => void): void;
}

export interface LiveKitWebhookSource {
  onRoomStarted(
    cb: (payload: {
      meetingId: string;
      botToken: string;
      participants: LiveKitParticipant[];
    }) => void | Promise<void>
  ): void;
  onRoomFinished(cb: (payload: { meetingId: string }) => void): void;
  onParticipantJoined(
    cb: (payload: { meetingId: string; participant: LiveKitParticipant }) => void
  ): void;
  onParticipantLeft(
    cb: (payload: { meetingId: string; participantId: string }) => void
  ): void;
}
```

```typescript
// src/livekit/liveKitBotAdapter.ts
import { EventEmitter } from "node:events";
import type {
  LiveKitParticipant,
  LiveKitRoomLike,
  LiveKitWebhookSource,
} from "./liveKitBotAdapter.types";

export interface LiveKitBotAdapterDeps {
  webhookSource: LiveKitWebhookSource;
  createRoom: () => LiveKitRoomLike;
  url: string;
}

export class LiveKitBotAdapter extends EventEmitter {
  private meetingId?: string;
  private room?: LiveKitRoomLike;

  constructor(private readonly deps: LiveKitBotAdapterDeps) {
    super();
    this.deps.webhookSource.onRoomStarted((payload) => this.handleRoomStarted(payload));
    this.deps.webhookSource.onRoomFinished((payload) => this.handleRoomFinished(payload));
    this.deps.webhookSource.onParticipantJoined(({ participant }) =>
      this.emit("participantJoined", participant)
    );
    this.deps.webhookSource.onParticipantLeft(({ participantId }) =>
      this.emit("participantLeft", participantId)
    );
  }

  private async handleRoomStarted(payload: {
    meetingId: string;
    botToken: string;
    participants: LiveKitParticipant[];
  }): Promise<void> {
    this.meetingId = payload.meetingId;
    const room = this.deps.createRoom();
    room.onAudioData((participantId, buffer, timestamp) => {
      this.emit("audioChunk", participantId, buffer, timestamp);
    });
    room.onDisconnected((reason) => this.handleDisconnected(reason));
    await room.connect(this.deps.url, payload.botToken);
    this.room = room;
    this.emit("meetingStarted", payload.meetingId, payload.participants);
  }

  private handleRoomFinished(payload: { meetingId: string }): void {
    if (payload.meetingId !== this.meetingId) return;
    void this.room?.disconnect();
    this.room = undefined;
    this.emit("meetingEnded", "ended");
  }

  private handleDisconnected(_reason: string): void {
    // @livekit/rtc-node's Room handles reconnection internally (Reconnecting/Reconnected
    // fire for transient issues); Disconnected only fires once the SDK has given up, so
    // this is already the terminal signal -- no separate retry loop needed here, unlike
    // ZoomBotAdapter's manual reconnectAttempt/backoff (verify this against Task 1's
    // findings before relying on it in production).
    this.room = undefined;
    this.emit("meetingEnded", "ended_error");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/liveKitBotAdapter.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/livekit/liveKitBotAdapter.types.ts src/livekit/liveKitBotAdapter.ts tests/unit/liveKitBotAdapter.test.ts
git commit -m "Add LiveKitBotAdapter core: meetingStarted, participants, audio"
```

---

## Task 4: `LiveKitBotAdapter` — meetingEnded test coverage (clean vs. disconnected)

**Files:**
- Modify: `tests/unit/liveKitBotAdapter.test.ts`

**Interfaces:**
- Exercises the `handleRoomFinished`/`handleDisconnected` logic already written in Task 3, locking in both the "ended" (clean, webhook-driven) and "ended_error" (unclean, room-disconnected) paths with explicit tests — mirroring how the Zoom plan's Task 13 added regression coverage for logic Task 12 already implemented.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/liveKitBotAdapter.test.ts`:

```typescript
it("emits a clean meetingEnded when the room-finished webhook fires", async () => {
  const { source, handlers } = makeFakeWebhookSource();
  const { room } = makeFakeRoom();
  const adapter = new LiveKitBotAdapter({
    webhookSource: source,
    createRoom: () => room,
    url: "wss://example.livekit.cloud",
  });

  await handlers.roomStarted({ meetingId: "falcon-meet", botToken: "bot-jwt", participants: [] });

  const onEnded = vi.fn();
  adapter.on("meetingEnded", onEnded);
  handlers.roomFinished({ meetingId: "falcon-meet" });

  expect(room.disconnect).toHaveBeenCalled();
  expect(onEnded).toHaveBeenCalledWith("ended");
});

it("emits meetingEnded with ended_error when the room disconnects unexpectedly", async () => {
  const { source, handlers: webhookHandlers } = makeFakeWebhookSource();
  const { room, handlers: roomHandlers } = makeFakeRoom();
  const adapter = new LiveKitBotAdapter({
    webhookSource: source,
    createRoom: () => room,
    url: "wss://example.livekit.cloud",
  });

  await webhookHandlers.roomStarted({
    meetingId: "falcon-meet",
    botToken: "bot-jwt",
    participants: [],
  });

  const onEnded = vi.fn();
  adapter.on("meetingEnded", onEnded);
  roomHandlers.disconnected("SIGNAL_CLOSE");

  expect(onEnded).toHaveBeenCalledWith("ended_error");
});

it("ignores a room-finished webhook for a different meeting", async () => {
  const { source, handlers } = makeFakeWebhookSource();
  const { room } = makeFakeRoom();
  const adapter = new LiveKitBotAdapter({
    webhookSource: source,
    createRoom: () => room,
    url: "wss://example.livekit.cloud",
  });

  await handlers.roomStarted({ meetingId: "falcon-meet", botToken: "bot-jwt", participants: [] });

  const onEnded = vi.fn();
  adapter.on("meetingEnded", onEnded);
  handlers.roomFinished({ meetingId: "some-other-room" });

  expect(onEnded).not.toHaveBeenCalled();
  expect(room.disconnect).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/unit/liveKitBotAdapter.test.ts`
Expected: PASS (6 tests total) — this logic was already written in Task 3, so these should pass immediately; if the third test fails, it means the `payload.meetingId !== this.meetingId` guard in `handleRoomFinished` is missing or wrong — check `src/livekit/liveKitBotAdapter.ts`.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/liveKitBotAdapter.test.ts
git commit -m "Add meetingEnded regression coverage for LiveKitBotAdapter"
```

---

## Task 5: Real LiveKit room adapter (`realLiveKitRoom.ts`)

**Files:**
- Create: `src/livekit/realLiveKitRoom.ts`

**Interfaces:**
- Consumes: `@livekit/rtc-node`'s `Room`, `RoomEvent`, `AudioStream`, `RemoteAudioTrack`.
- Produces: `createRealLiveKitRoom(): LiveKitRoomLike` — consumed by Task 9's server wiring. Not unit-tested (needs a live LiveKit connection), matching how `realRtmsClient.ts` is excluded from unit coverage.

- [ ] **Step 1: Write the implementation**

```typescript
// src/livekit/realLiveKitRoom.ts
import { Room, RoomEvent, AudioStream, RemoteAudioTrack } from "@livekit/rtc-node";
import type { LiveKitRoomLike } from "./liveKitBotAdapter.types";

const AUDIO_SAMPLE_RATE = 16000;
const AUDIO_CHANNELS = 1;

export function createRealLiveKitRoom(): LiveKitRoomLike {
  const room = new Room();
  const audioDataCallbacks: Array<
    (participantId: string, buffer: Buffer, timestamp: number) => void
  > = [];
  const disconnectedCallbacks: Array<(reason: string) => void> = [];

  room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
    if (!(track instanceof RemoteAudioTrack)) return;
    const stream = new AudioStream(track, AUDIO_SAMPLE_RATE, AUDIO_CHANNELS);
    void (async () => {
      for await (const frame of stream) {
        const buffer = Buffer.from(
          frame.data.buffer,
          frame.data.byteOffset,
          frame.data.byteLength
        );
        const timestamp = Date.now();
        for (const cb of audioDataCallbacks) cb(participant.identity, buffer, timestamp);
      }
    })();
  });

  room.on(RoomEvent.Disconnected, (reason) => {
    for (const cb of disconnectedCallbacks) cb(String(reason));
  });

  return {
    async connect(url, token) {
      await room.connect(url, token);
    },
    async disconnect() {
      await room.disconnect();
    },
    onAudioData(cb) {
      audioDataCallbacks.push(cb);
    },
    onDisconnected(cb) {
      disconnectedCallbacks.push(cb);
    },
  };
}
```

Cross-check this against Task 1's findings doc before relying on it in production — specifically whether `AudioStream` construction on `TrackSubscribed` needed any adjustment, and whether `RemoteAudioTrack` was the correct class to check against (vs. some other exported name) in the actually-installed version.

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/livekit/realLiveKitRoom.ts
git commit -m "Add real LiveKit room adapter wrapping @livekit/rtc-node"
```

---

## Task 6: Real LiveKit webhook source (`realLiveKitWebhookSource.ts`)

**Files:**
- Create: `src/livekit/realLiveKitWebhookSource.ts`

**Interfaces:**
- Consumes: `livekit-server-sdk`'s `WebhookReceiver`, `AccessToken`.
- Produces: `createRealLiveKitWebhookSource(deps): { source: LiveKitWebhookSource; handleWebhookRequest: (req, res) => Promise<void> }` — the `source` half is consumed by `LiveKitBotAdapter` (Task 3); the `handleWebhookRequest` half is consumed by Task 9's HTTP router. Not unit-tested (needs real signed webhook payloads), matching `realWebhookSource.ts`'s exclusion.

This module owns both webhook signature verification/parsing (via `WebhookReceiver`) *and* minting the bot's own join token when a room starts (since the `room_started` event doesn't carry a token — we mint one ourselves for the bot to join with).

- [ ] **Step 1: Write the implementation**

```typescript
// src/livekit/realLiveKitWebhookSource.ts
import type { IncomingMessage, ServerResponse } from "node:http";
import { WebhookReceiver, AccessToken } from "livekit-server-sdk";
import type { LiveKitWebhookSource, LiveKitParticipant } from "./liveKitBotAdapter.types";

export interface RealLiveKitWebhookSourceDeps {
  apiKey: string;
  apiSecret: string;
  botIdentity: string;
}

export function createRealLiveKitWebhookSource(
  deps: RealLiveKitWebhookSourceDeps
): { source: LiveKitWebhookSource; handleWebhookRequest: (req: IncomingMessage, res: ServerResponse) => Promise<void> } {
  const receiver = new WebhookReceiver(deps.apiKey, deps.apiSecret);

  const roomStartedHandlers: Array<
    (payload: { meetingId: string; botToken: string; participants: LiveKitParticipant[] }) => void
  > = [];
  const roomFinishedHandlers: Array<(payload: { meetingId: string }) => void> = [];
  const participantJoinedHandlers: Array<
    (payload: { meetingId: string; participant: LiveKitParticipant }) => void
  > = [];
  const participantLeftHandlers: Array<
    (payload: { meetingId: string; participantId: string }) => void
  > = [];

  async function handleWebhookRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString("utf-8");

    let event;
    try {
      event = await receiver.receive(body, req.headers.authorization);
    } catch (err) {
      res.writeHead(401).end("invalid webhook signature");
      console.error("LiveKit webhook signature verification failed", err);
      return;
    }

    if (event.event === "room_started" && event.room) {
      const botToken = new AccessToken(deps.apiKey, deps.apiSecret, {
        identity: deps.botIdentity,
      });
      botToken.addGrant({
        roomJoin: true,
        room: event.room.name,
        canPublish: false,
        canSubscribe: true,
      });
      const jwt = await botToken.toJwt();
      for (const cb of roomStartedHandlers) {
        cb({ meetingId: event.room.name, botToken: jwt, participants: [] });
      }
    } else if (event.event === "room_finished" && event.room) {
      for (const cb of roomFinishedHandlers) cb({ meetingId: event.room.name });
    } else if (event.event === "participant_joined" && event.room && event.participant) {
      for (const cb of participantJoinedHandlers) {
        cb({
          meetingId: event.room.name,
          participant: {
            participantId: event.participant.identity,
            displayName: event.participant.name || event.participant.identity,
          },
        });
      }
    } else if (event.event === "participant_left" && event.room && event.participant) {
      for (const cb of participantLeftHandlers) {
        cb({ meetingId: event.room.name, participantId: event.participant.identity });
      }
    }

    res.writeHead(200).end("ok");
  }

  return {
    source: {
      onRoomStarted: (cb) => roomStartedHandlers.push(cb),
      onRoomFinished: (cb) => roomFinishedHandlers.push(cb),
      onParticipantJoined: (cb) => participantJoinedHandlers.push(cb),
      onParticipantLeft: (cb) => participantLeftHandlers.push(cb),
    },
    handleWebhookRequest,
  };
}
```

Note: `event.event === "room_started"` initially reports zero participants (the payload doesn't enumerate them) — real participant discovery happens via the separate `participant_joined` webhook events that follow, which `LiveKitBotAdapter` already forwards as `participantJoined`. This matches the spec's data flow.

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/livekit/realLiveKitWebhookSource.ts
git commit -m "Add real LiveKit webhook source with signature verification"
```

---

## Task 7: Token minting for the join page

**Files:**
- Create: `src/livekit/mintToken.ts`
- Test: `tests/unit/mintToken.test.ts`

**Interfaces:**
- Produces: `mintParticipantToken(deps, name: string): Promise<{ token: string; url: string }>` — consumed by Task 9's HTTP router's `/token` endpoint.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/mintToken.test.ts
import { describe, it, expect } from "vitest";
import { AccessToken, TokenVerifier } from "livekit-server-sdk";
import { mintParticipantToken } from "../../src/livekit/mintToken";

describe("mintParticipantToken", () => {
  it("mints a token that grants join access to the configured room under the given name", async () => {
    const deps = {
      apiKey: "test-key",
      apiSecret: "test-secret-that-is-long-enough",
      roomName: "falcon-meet",
      url: "wss://example.livekit.cloud",
    };

    const { token, url } = await mintParticipantToken(deps, "Alex");

    expect(url).toBe("wss://example.livekit.cloud");
    const verifier = new TokenVerifier(deps.apiKey, deps.apiSecret);
    const claims = await verifier.verify(token);
    expect(claims.video?.room).toBe("falcon-meet");
    expect(claims.video?.roomJoin).toBe(true);
    expect(claims.sub).toBe("Alex");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/mintToken.test.ts`
Expected: FAIL with "Cannot find module '../../src/livekit/mintToken'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/livekit/mintToken.ts
import { AccessToken } from "livekit-server-sdk";

export interface MintTokenDeps {
  apiKey: string;
  apiSecret: string;
  roomName: string;
  url: string;
}

export async function mintParticipantToken(
  deps: MintTokenDeps,
  name: string
): Promise<{ token: string; url: string }> {
  const accessToken = new AccessToken(deps.apiKey, deps.apiSecret, {
    identity: name,
    name,
  });
  accessToken.addGrant({
    roomJoin: true,
    room: deps.roomName,
    canPublish: true,
    canSubscribe: true,
  });
  const token = await accessToken.toJwt();
  return { token, url: deps.url };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/mintToken.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add src/livekit/mintToken.ts tests/unit/mintToken.test.ts
git commit -m "Add participant token minting for the join page"
```

---

## Task 8: Join page

**Files:**
- Create: `public/join.html`

**Interfaces:**
- Consumes: `GET /token?name=<name>` (Task 9's HTTP router), LiveKit's browser SDK (loaded via CDN, global `LivekitClient`).
- No role field, no other inputs — per spec's non-goals.

- [ ] **Step 1: Write the join page**

```html
<!-- public/join.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Falcon Meet</title>
  <script src="https://cdn.jsdelivr.net/npm/livekit-client/dist/livekit-client.umd.min.js"></script>
</head>
<body>
  <h1>Falcon Meet</h1>
  <div id="form">
    <label for="name">Your name</label>
    <input id="name" type="text" placeholder="Alex" />
    <button id="joinButton">Join</button>
  </div>
  <p id="status"></p>

  <script>
    const statusEl = document.getElementById("status");
    const joinButton = document.getElementById("joinButton");

    joinButton.addEventListener("click", async () => {
      const name = document.getElementById("name").value.trim();
      if (!name) {
        statusEl.textContent = "Enter a name first.";
        return;
      }

      joinButton.disabled = true;
      statusEl.textContent = "Requesting token...";

      const response = await fetch(`/token?name=${encodeURIComponent(name)}`);
      if (!response.ok) {
        statusEl.textContent = "Failed to get a join token.";
        joinButton.disabled = false;
        return;
      }
      const { token, url } = await response.json();

      statusEl.textContent = "Connecting...";
      const room = new LivekitClient.Room();
      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);

      statusEl.textContent = `Connected as ${name}.`;
    });
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add public/join.html
git commit -m "Add Falcon Meet join page"
```

---

## Task 9: Server wiring — HTTP router + composition root

**Files:**
- Create: `src/server/livekitIndex.ts`
- Modify: `package.json` (add `"dev:livekit"` script)

**Interfaces:**
- Consumes: everything from Tasks 2-8.
- Produces: `startLiveKitServer(): Promise<void>` — the real production entry point for Falcon Meet, run via `npm run dev:livekit`.

This is the composition root, analogous to `src/server/index.ts` for Zoom. It runs a plain `node:http` server with three routes: serving the join page, minting tokens, and receiving LiveKit webhooks.

- [ ] **Step 1: Write the implementation**

```typescript
// src/server/livekitIndex.ts
import "dotenv/config";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LiveKitBotAdapter } from "../livekit/liveKitBotAdapter";
import { createRealLiveKitRoom } from "../livekit/realLiveKitRoom";
import { createRealLiveKitWebhookSource } from "../livekit/realLiveKitWebhookSource";
import { mintParticipantToken } from "../livekit/mintToken";
import { createDeepgramSession } from "../transcription/deepgramClient";
import { TranscriptPipeline } from "../pipeline/transcriptPipeline";
import { PostgresTranscriptStore } from "../pipeline/postgresTranscriptStore";
import { RedisTranscriptPublisher } from "../pipeline/redisTranscriptPublisher";
import { SequenceNumberAllocator } from "../pipeline/sequenceNumberAllocator";
import { wireTranscriptionPipeline } from "./wireTranscriptionPipeline";

export async function startLiveKitServer(): Promise<void> {
  const apiKey = process.env.LIVEKIT_API_KEY!;
  const apiSecret = process.env.LIVEKIT_API_SECRET!;
  const url = process.env.LIVEKIT_URL!;
  const roomName = process.env.LIVEKIT_ROOM_NAME ?? "falcon-meet";
  const port = Number(process.env.LIVEKIT_HTTP_PORT ?? 8081);

  const { source: webhookSource, handleWebhookRequest } = createRealLiveKitWebhookSource({
    apiKey,
    apiSecret,
    botIdentity: "falcon-bot",
  });

  const liveKitBotAdapter = new LiveKitBotAdapter({
    webhookSource,
    createRoom: createRealLiveKitRoom,
    url,
  });

  const pipeline = new TranscriptPipeline({
    store: new PostgresTranscriptStore(),
    publisher: new RedisTranscriptPublisher(),
    allocator: new SequenceNumberAllocator(),
    onAlert: (message, err) => console.error(message, err),
  });

  wireTranscriptionPipeline(liveKitBotAdapter, {
    pipeline,
    createSession: (opts) => createDeepgramSession(process.env.DEEPGRAM_API_KEY!, opts),
  });

  const joinPageHtml = readFileSync(path.join(__dirname, "../../public/join.html"), "utf-8");

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/join.html")) {
      res.writeHead(200, { "Content-Type": "text/html" }).end(joinPageHtml);
      return;
    }

    if (req.method === "GET" && url.pathname === "/token") {
      const name = url.searchParams.get("name");
      if (!name) {
        res.writeHead(400).end("missing name query param");
        return;
      }
      mintParticipantToken({ apiKey, apiSecret, roomName, url }, name)
        .then(({ token, url: lkUrl }) => {
          res
            .writeHead(200, { "Content-Type": "application/json" })
            .end(JSON.stringify({ token, url: lkUrl }));
        })
        .catch((err) => {
          console.error("failed to mint token", err);
          res.writeHead(500).end("failed to mint token");
        });
      return;
    }

    if (req.method === "POST" && url.pathname === "/livekit-webhook") {
      void handleWebhookRequest(req, res);
      return;
    }

    res.writeHead(404).end("not found");
  });

  server.listen(port, () => {
    console.log(`Falcon Meet listening on http://localhost:${port} (join page + webhook)`);
  });
}

startLiveKitServer().catch((err) => {
  console.error("failed to start LiveKit server", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

Add to `package.json`'s `"scripts"`:
```json
"dev:livekit": "tsx src/server/livekitIndex.ts"
```

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/livekitIndex.ts package.json
git commit -m "Wire LiveKitBotAdapter, HTTP router, and join page into a server entry point"
```

---

## Task 10: End-to-end integration test with a synthetic `LiveKitBotAdapter`

**Files:**
- Create: `tests/integration/livekitPipeline.integration.test.ts`

**Interfaces:**
- Consumes: real `TranscriptPipeline`, `PostgresTranscriptStore`, `RedisTranscriptPublisher`, `SequenceNumberAllocator`, `TranscriptionManager` (via `wireTranscriptionPipeline`), and a synthetic `LiveKitBotAdapter` (real class, fake `LiveKitRoomLike`/`LiveKitWebhookSource`).

Directly mirrors `tests/integration/pipeline.integration.test.ts`'s pattern and its `waitFor` condition-based-polling approach (see `CLAUDE.md`'s testing gotcha section) — fire-and-forget delivery into Postgres/Redis means this test must poll for the data, not sleep a fixed duration.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/livekitPipeline.integration.test.ts
import "dotenv/config";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { EventEmitter } from "node:events";
import { migrate } from "../../src/db/migrate";
import { getPool, closePool } from "../../src/db/pool";
import { closeRedisClient, getRedisClient } from "../../src/redis/client";
import { LiveKitBotAdapter } from "../../src/livekit/liveKitBotAdapter";
import { wireTranscriptionPipeline } from "../../src/server/wireTranscriptionPipeline";
import { TranscriptPipeline } from "../../src/pipeline/transcriptPipeline";
import { PostgresTranscriptStore } from "../../src/pipeline/postgresTranscriptStore";
import { RedisTranscriptPublisher } from "../../src/pipeline/redisTranscriptPublisher";
import { SequenceNumberAllocator } from "../../src/pipeline/sequenceNumberAllocator";
import type {
  LiveKitRoomLike,
  LiveKitWebhookSource,
} from "../../src/livekit/liveKitBotAdapter.types";
import type { DeepgramLiveConnectionLike } from "../../src/transcription/deepgramLiveConnection.types";

async function waitFor<T>(
  condition: () => Promise<T | undefined | null | false> | T | undefined | null | false,
  timeoutMs = 3000
): Promise<T> {
  const start = Date.now();
  while (true) {
    const result = await condition();
    if (result) return result as T;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("end-to-end LiveKit pipeline wiring", () => {
  beforeAll(async () => {
    await migrate();
  });

  afterAll(async () => {
    await closePool();
    await closeRedisClient();
  });

  it("carries a synthetic LiveKit meeting from room events to the Redis Stream and Postgres", async () => {
    const meetingId = "livekit-integration-test-1";

    const pool = getPool();
    await pool.query("DELETE FROM transcript_events WHERE meeting_id = $1", [meetingId]);
    await pool.query("DELETE FROM meetings WHERE meeting_id = $1", [meetingId]);
    const redisForCleanup = await getRedisClient();
    await redisForCleanup.del(`meeting:${meetingId}:transcript`);
    await redisForCleanup.del(`meeting:${meetingId}:seq`);

    const webhookEmitter = new EventEmitter();
    const webhookSource: LiveKitWebhookSource = {
      onRoomStarted: (cb) => webhookEmitter.on("roomStarted", cb),
      onRoomFinished: (cb) => webhookEmitter.on("roomFinished", cb),
      onParticipantJoined: (cb) => webhookEmitter.on("participantJoined", cb),
      onParticipantLeft: (cb) => webhookEmitter.on("participantLeft", cb),
    };

    let audioCallback: ((participantId: string, buffer: Buffer, timestamp: number) => void) | undefined;
    const fakeRoom: LiveKitRoomLike = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      onAudioData: (cb) => {
        audioCallback = cb;
      },
      onDisconnected: vi.fn(),
    };

    const liveKitBotAdapter = new LiveKitBotAdapter({
      webhookSource,
      createRoom: () => fakeRoom,
      url: "wss://example.livekit.cloud",
    });

    const pipeline = new TranscriptPipeline({
      store: new PostgresTranscriptStore(),
      publisher: new RedisTranscriptPublisher(),
      allocator: new SequenceNumberAllocator(),
      onAlert: (msg, err) => console.error(msg, err),
      postgresRetry: { retries: 1, baseDelayMs: 1 },
      redisRetry: { retries: 1, baseDelayMs: 1 },
    });

    let deepgramEmitter: EventEmitter | undefined;
    wireTranscriptionPipeline(liveKitBotAdapter, {
      pipeline,
      createSession: (): DeepgramLiveConnectionLike => {
        deepgramEmitter = new EventEmitter();
        return {
          onTranscript: (cb) => deepgramEmitter!.on("transcript", cb),
          onError: (cb) => deepgramEmitter!.on("error", cb),
          onClose: (cb) => deepgramEmitter!.on("close", cb),
          send: vi.fn(),
          finish: vi.fn(),
        };
      },
      inactivityTimeoutMs: 60_000,
    });

    webhookEmitter.emit("roomStarted", {
      meetingId,
      botToken: "bot-jwt",
      participants: [{ participantId: "p1", displayName: "Alex" }],
    });
    await new Promise((r) => setTimeout(r, 50));

    const audioTs = Date.now();
    audioCallback!("p1", Buffer.from([1, 2, 3]), audioTs);
    await new Promise((r) => setTimeout(r, 10));

    deepgramEmitter!.emit("transcript", {
      text: "hello from livekit integration test",
      isFinal: true,
      durationMs: 20,
      confidence: 0.9,
    });

    const rows = await waitFor(async () => {
      const { rows } = await pool.query(
        "SELECT text FROM transcript_events WHERE meeting_id = $1",
        [meetingId]
      );
      return rows.length > 0 ? rows : false;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("hello from livekit integration test");

    webhookEmitter.emit("roomFinished", { meetingId });

    const redis = await getRedisClient();
    const entries = await waitFor(async () => {
      const es = await redis.xRange(`meeting:${meetingId}:transcript`, "-", "+");
      return es.length >= 3 ? es : false;
    });
    const kinds = entries.map((e) => e.message.kind);
    expect(kinds).toEqual(["meeting_lifecycle", "transcript", "meeting_lifecycle"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/livekitPipeline.integration.test.ts`
Expected: FAIL if any import path is wrong; otherwise this should mostly work already since every dependency it wires already exists from Tasks 2-4 — check the failure is an assertion mismatch, not a missing-module error, before moving to Step 3.

- [ ] **Step 3: Run test to verify it passes**

Run: `DATABASE_URL=postgres://localhost:5432/falcon_transcription REDIS_URL=redis://localhost:6379 npx vitest run tests/integration/livekitPipeline.integration.test.ts`
Expected: PASS (1 test)

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: all tests pass, including the pre-existing Zoom-based `pipeline.integration.test.ts` (proving both meeting sources coexist through the same shared `TranscriptionManager`/`TranscriptPipeline`).

- [ ] **Step 5: Commit**

```bash
git add tests/integration/livekitPipeline.integration.test.ts
git commit -m "Add end-to-end integration test for the LiveKit pipeline"
```

---

## Task 11: Manual/live test with real participants

**Files:** none (manual QA pass, no code changes)

**Interfaces:** exercises the full system built in Tasks 1-10 against a real LiveKit Cloud room with real people.

- [ ] **Step 1: Configure the LiveKit Cloud webhook**

In the LiveKit Cloud project dashboard, set the webhook URL to point at this server's `/livekit-webhook` endpoint. If testing locally, reuse the same `ngrok` tunnel approach already set up for the Zoom sub-project (`ngrok http 8081`, using this server's port).

- [ ] **Step 2: Start the service**

Run: `npm run migrate && npm run dev:livekit` (with `.env` populated: `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL`, `LIVEKIT_ROOM_NAME`, `DEEPGRAM_API_KEY`, `DATABASE_URL`, `REDIS_URL`).

- [ ] **Step 3: Join with two real people**

Open `http://localhost:8081` (or the ngrok URL) in two separate browser tabs/devices, enter different names, click Join on each.

- [ ] **Step 4: Speak and verify transcript accuracy**

Have both people speak, including some back-and-forth. Check:
```sql
SELECT participant_id, speaker_name, text, sequence_number FROM transcript_events WHERE meeting_id = 'falcon-meet' ORDER BY sequence_number;
```
Confirm each row's `participant_id` matches who actually spoke, and `text` is a reasonably accurate transcription.

- [ ] **Step 5: Verify the Redis Stream carries the full session**

Run: `redis-cli XRANGE meeting:falcon-meet:transcript - +` — confirm it starts with a `meeting_lifecycle: started` entry, contains interleaved `transcript` entries for both speakers, and ends with `meeting_lifecycle: ended` after both people leave (room becomes empty).

- [ ] **Step 6: Record any deviations from the capability findings doc**

If real behavior differs from Task 1's findings (e.g. different webhook payload shape, different `Disconnected` reason semantics), update `docs/superpowers/notes/livekit-capability-findings.md` and adjust `src/livekit/realLiveKitRoom.ts`/`realLiveKitWebhookSource.ts` accordingly, re-running Tasks 3-10's automated tests to confirm nothing regressed.

- [ ] **Step 7: Commit any fixes made in Step 6**

```bash
git add -A
git commit -m "Fix LiveKit wiring based on live meeting verification"
```
