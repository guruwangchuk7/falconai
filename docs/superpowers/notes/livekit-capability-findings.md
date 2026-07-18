# LiveKit Capability Findings

Date: PENDING — requires live LiveKit Cloud account, not yet run

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

**Status: PENDING** — requires live LiveKit Cloud account, not yet run

This section will record whether constructing an `AudioStream` from a
`RemoteAudioTrack` on `RoomEvent.TrackSubscribed` runs cleanly for the
duration of a real session (a past GitHub issue reported crashes in earlier
SDK versions), or whether it crashes/throws, and under what conditions.

To be filled in by running `npm run spike:livekit` against a real LiveKit
Cloud project with a human participant joined via `meet.livekit.io`,
speaking for 10-20 seconds, and observing whether `[audioFrame]` lines
continue to log without the process crashing.

## Disconnected reason values

**Status: PENDING** — requires live LiveKit Cloud account, not yet run

This section will record the actual `reason` value(s) logged by
`[disconnected]` for:
- A clean disconnect (human participant closes the `meet.livekit.io` tab).
- An unclean/unexpected disconnect (if observable during the test).

Ctrl+C on the spike script itself does not count — that only ends our own
process and is not a `RoomEvent.Disconnected` event.

To be filled in by running the live spike and closing the human
participant's tab while the bot script is still running and observing the
console output.

## Reconnection behavior

**Status: PENDING** — requires live LiveKit Cloud account, not yet run

This section will record whether `RoomEvent.Reconnecting`/`Reconnected` ever
fired during the test (confirming the SDK's own reconnection logic is
actually active at runtime, not just present in the type signatures), and
what triggered it (e.g. a brief network interruption).

To be filled in during the live spike run; if no reconnection is naturally
triggered, this section should note that explicitly rather than being left
blank.
