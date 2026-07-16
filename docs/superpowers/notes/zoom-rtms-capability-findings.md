# Zoom RTMS Capability Findings

Date: Pending live run against a real Zoom sandbox meeting

## Runtime environment (confirmed 2026-07-16)

`@zoom/rtms` has no Windows build (its `package.json` restricts `os` to
`linux`/`darwin`) — `npm run dev` fails immediately on Windows with
`Error: Could not locate the bindings file`. Confirmed working on WSL2
(Ubuntu 26.04, Node 22): `npm install` (no `--force` needed on Linux),
`npm run build`, `npm test` (42/42), and `npm run dev` all succeed —
the server starts, `@zoom/rtms`'s native binding loads, and the webhook
HTTP server binds and logs `Listening for webhook events at
http://localhost:8080/`. Still not exercised end-to-end: no real Zoom
Marketplace app/credentials have been configured yet, so no actual
`meeting.rtms_started` webhook has ever been delivered to this server.
Everything below remains unverified until that happens.

## Per-participant audio

**Status: PENDING** - Awaiting live run with real meeting participants

This section documents whether `metadata` on `onAudioData` contains a stable per-participant identifier (e.g. `userId`/`userName`) for each participant, confirming that `AUDIO_MULTI_STREAMS` mode delivers isolated per-participant audio as designed.

To be filled in by running the spike script against a real Zoom meeting with at least two participants speaking.

## meeting.rtms_started payload shape

**Status: PENDING** - Awaiting live run against a real Zoom sandbox meeting

This section will contain the actual JSON payload structure of the `meeting.rtms_started` webhook event, including whether it provides an initial participant roster and its exact shape.

To be filled in by capturing the webhook payload during a real meeting.

## Active speaker events

**Status: PENDING** - Awaiting live run against a real Zoom sandbox meeting

This section documents the observed cadence and reliability of `onActiveSpeakerEvent` callbacks as speakers change during a meeting. This is critical for the diarized-mode fallback behavior when `AUDIO_MULTI_STREAMS` is not available.

To be filled in by monitoring event frequency and reliability during real speaker transitions.

## Join/leave reason codes

**Status: PENDING** - Awaiting live run against a real Zoom sandbox meeting

This section records the actual `reason` codes observed from `onJoinConfirm()` and `onLeave()` callbacks for both normal and abnormal meeting termination scenarios.

To be filled in by observing actual termination codes during live test runs.
