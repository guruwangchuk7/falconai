# LiveKit Capability Findings

Date: 2026-07-19 — live spike run against a real LiveKit Cloud project
(`falcon-ai-vzhdw96i.livekit.cloud`, free tier), with a real human
participant joining via `meet.livekit.io` and speaking.

## Runtime environment (confirmed 2026-07-18)

`livekit-server-sdk` and `@livekit/rtc-node` were installed successfully via
`npm install livekit-server-sdk @livekit/rtc-node --force` on Windows. Neither
package itself restricts `os`/`cpu` (unlike `@zoom/rtms`) — the `--force` flag
was only needed because `npm install` re-validates the platform constraints of
every dependency already in `package.json`, including the pre-existing
`@zoom/rtms` entry, which does restrict `os` to `linux`/`darwin`. Confirmed by
direct inspection of the installed packages' `.d.ts` files (not guessed):

- `Room` (from `@livekit/rtc-node`, in `dist/audio_stream-DEG1JKge.d.ts`)
  extends a `TypedEventEmitter`-style base and exposes
  `connect(url: string, token: string, opts?: RoomOptions): Promise<void>`.
- `RoomEvent` enum includes `ParticipantConnected = "participantConnected"`,
  `ParticipantDisconnected = "participantDisconnected"`,
  `TrackSubscribed = "trackSubscribed"`, `Disconnected = "disconnected"`,
  `Reconnecting = "reconnecting"`, `Reconnected = "reconnected"`.
- `AudioStream extends ReadableStream<AudioFrame>` with overloaded
  constructors accepting `(track: Track)`, `(track, sampleRate)`, or
  `(track, sampleRate, numChannels)`.
- `AudioFrame` has `data: Int16Array`, `sampleRate: number`,
  `channels: number`, `samplesPerChannel: number`.
- `AccessToken` (from `livekit-server-sdk`, in `dist/AccessToken.d.ts`) has
  constructor `(apiKey?, apiSecret?, options?: AccessTokenOptions)`,
  `addGrant(grant: VideoGrant): void`, and `toJwt(): Promise<string>`.

All of the above match the assumptions the spike script
(`scripts/livekit-capability-check.ts`) and the rest of the implementation
plan are built on. This confirms the *type-level* API surface only — nothing
below this point has been exercised against a running LiveKit server.

## AudioStream stability

**Status: CONFIRMED** (2026-07-19)

Ran cleanly for the full session with no crashes. The bot subscribed to the
human participant's audio track on `RoomEvent.TrackSubscribed` (two
`trackSubscribed` events fired for the one participant — one per published
track kind, audio and video/camera), constructed an `AudioStream(track,
16000, 1)`, and received several thousand `AudioFrame`s continuously via
`for await` with no gaps or errors. Every frame matched the constructor's
requested format exactly: `sampleRate=16000 channels=1
samplesPerChannel=160` (i.e. 10ms PCM frames at 16kHz mono) — exactly what
`TranscriptionManager`/Deepgram expect. No sign of the crash a past GitHub
issue reported in earlier SDK versions.

## Disconnected reason values

**Status: PARTIALLY CONFIRMED** (2026-07-19)

**Key finding, and a correction to this doc's original framing**: a human
participant leaving the room (closing the `meet.livekit.io` tab) does
**not** fire the bot's own `RoomEvent.Disconnected` at all. Only
`RoomEvent.ParticipantDisconnected` fired
(`[participantDisconnected] human-tester`) — the bot's own `Room` stayed
connected throughout, exactly as `LiveKitBotAdapter`'s design assumes (see
`CLAUDE.md`'s "one adapter instance is reused across every meeting" note).
This confirms `RoomEvent.Disconnected` really is a distinct, bot's-own-
connection signal, not something a departing participant triggers as a
side effect — the assumption `handleDisconnected` is built on holds.

One `[audioFrame]` line was logged for the departed participant's track
*after* `participantDisconnected` (frame already in flight), then the
`AudioStream` went quiet — no runaway/infinite frame emission after a
participant leaves, though the for-await loop's own "audioStream ended"
log line was never reached within the observation window (the track
teardown apparently doesn't close the `ReadableStream` immediately/
synchronously with the `participantDisconnected` event).

**Still not observed**: an actual `RoomEvent.Disconnected` firing on the
bot's own connection (i.e. real reason-code values). The spike was ended
via `TaskStop` (a hard process kill), which is the same as the Ctrl+C case
this doc already called out as not counting — it never exercises a real
`RoomEvent.Disconnected`. Getting real reason codes would need something
like revoking the bot's LiveKit Cloud access mid-session or a genuine
network interruption, which wasn't attempted here.

## Reconnection behavior

**Status: PENDING** — not observed in this spike run

`RoomEvent.Reconnecting`/`Reconnected` never fired — no network
interruption occurred during the session. Confirming the SDK's own
reconnection logic actually activates at runtime (not just present in the
type signatures) still requires a genuine network interruption during a
live session, which this run didn't naturally produce.
