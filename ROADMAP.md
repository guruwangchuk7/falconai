# Falcon Roadmap

## Verified 2026-07-16: real Deepgram/Postgres/Redis pipeline works end-to-end

Since RTMS itself is blocked by billing (below), verified everything downstream of the Zoom bot-join layer against a real recorded voice clip instead: `scripts/live-audio-verification.ts` (`npm run verify:live-audio -- <audio-file>`) streamed real audio through the real `TranscriptionManager` → real Deepgram → real `TranscriptPipeline` → real Postgres/Redis. Result: correct live transcription ("Hi. My name is Guru Wanchuk.", confidence 0.998) landed in both.

Along the way this found and fixed a **real, previously-unknown bug**: `@deepgram/sdk@5.5.0`'s `listen.v1.connect()` wrapper never reached `OPEN` in this environment even with valid credentials (`readyState` stuck at `CLOSED`, no error/close event, no debug output). Isolated via the `ws` package succeeding immediately with an identical URL/headers — the fault was in the SDK wrapper itself. A second bug compounded it: Deepgram's real auth header is `Authorization: Token <apiKey>`, not the bare key. `src/transcription/deepgramClient.ts` now talks to Deepgram via `ws` directly; `@deepgram/sdk` is no longer a dependency. See `CLAUDE.md`'s "Real vs. fake adapters" section for the full detail.

## Right now: live-verifying the transcription pipeline (Task 16)

Sub-project 1 (meeting ingestion & transcription) is fully built, reviewed, and merged to `master` — 42/42 automated tests pass. The one thing left is Task 16: proving it actually works against a real Zoom meeting, since `@zoom/rtms` can't run on Windows and had never been executed until this session.

**Environment set up so far:**
- WSL2 (Ubuntu 26.04) installed on this machine, with Node 22 and the project cloned natively at `~/falconai` (not the slower Windows-mounted path).
- Postgres (Windows-hosted, via Scoop) reconfigured to accept connections from the WSL subnet (`172.31.208.0/20`) — `listen_addresses='*'` + a `pg_hba.conf` trust rule, both approved by the user.
- Redis (Windows-hosted, via Scoop) had its protected mode disabled so WSL can actually issue commands, not just complete the TCP handshake — approved by the user.
- `ngrok` installed in WSL, tunnel running: forwards a public HTTPS URL to the server's port 8080 (URL changes each time the tunnel restarts — check current one with `curl -s http://127.0.0.1:4040/api/tunnels`).
- The Falcon server (`npm run dev`) runs in the background in WSL, credentials loaded from `.env`.

**Zoom Marketplace app ("General app 861", user-managed) configured so far:**
- Client ID / Secret, Webhook Secret Token — all in `.env`.
- Event Subscription: webhook endpoint set to the ngrok URL, subscribed to "RTMS Started In Meeting" / "RTMS Stopped In Meeting".
- OAuth authorized/installed to the developer's own Zoom account (via Local Test → Add app).
- Surface tab: "Meetings" selected as a supported product (required — RTMS features were disabled without a product selection).
- Scopes: adding `rtms:read:rtms_started`, `rtms:read:rtms_stopped`, `zoomapp:inmeeting` (in progress) — needed to unlock the "Allow auto-start for RTMS apps" toggle, which was blocked with "This feature requires RTMS scopes."

**Root cause found (2026-07-16):** the "Allow auto-start for RTMS apps" toggle stayed permanently blocked ("This feature requires RTMS scopes") no matter what scopes were added, and no webhook ever arrived even while actively speaking in a real meeting. Confirmed via Zoom's own RTMS docs and developer forum: **RTMS requires purchasing "Developer Pack" credits** (a paid add-on, not included in any plan by default), and **Basic/free-tier meeting hosts get an explicit "App could not reach meeting content" error** when attempting to start RTMS. This account is on Zoom **Basic (free)** — that is almost certainly the actual blocker, not a configuration mistake. Every app-side setting (events, scopes, OAuth, product selection) was configured correctly.

**To unblock Task 16 live verification:** the account needs (1) a paid Zoom plan (Pro or above) for the meeting host, and (2) RTMS Developer Pack credits purchased via [Zoom's developer pricing page](https://developers.zoom.us/pricing/). This is a cost/access decision for the user, not something to route around in code — the exact credit threshold/price wasn't available in what was checked; the pricing page or Zoom sales would have current numbers.

**Environment is otherwise fully ready to go** the moment plan/credits are sorted: WSL2 + Node + project clone, Postgres/Redis reachable from WSL, ngrok tunnel, and the Zoom app itself (events, scopes, OAuth) are all already configured. Nothing else should need touching — just start a meeting and speak once RTMS is actually entitled on the account.

**Once a webhook does arrive**, next debugging steps if something's still wrong: check `docs/superpowers/notes/zoom-rtms-capability-findings.md` for the specific real-vs-assumed API details already discovered (webhook payload shape, `userId` type, event name spelling), and update `src/zoom/realWebhookSource.ts` / `realRtmsClient.ts` if reality differs from what's coded.

## In progress: LiveKit-based meeting ingestion ("Falcon Meet") — Tasks 1-10 complete, Task 11 pending

Second meeting-source, built as an alternative to Zoom RTMS (blocked on billing, above): `LiveKitBotAdapter` is a drop-in sibling of `ZoomBotAdapter` (same five-event surface via a shared `MeetingSourceAdapter` interface), feeding the same unmodified `TranscriptionManager`/`TranscriptPipeline`/Postgres/Redis pipeline. See `docs/superpowers/specs/2026-07-16-livekit-meeting-ingestion-design.md` and `docs/superpowers/plans/2026-07-16-livekit-meeting-ingestion.md` (11-task plan).

**Tasks 1-10 complete and reviewed** (per-task review + a final whole-branch review), 54/54 automated tests passing. Three plan-mandated bugs found during per-task review were fixed: stale-meetingId leakage on `participantJoined`/`participantLeft` in `LiveKitBotAdapter`, unhandled `room.connect()`/`disconnect()` rejections, and an unhandled-rejection crash risk in the real audio-stream iteration loop.

**The final whole-branch review surfaced one new issue not visible at the single-task level**, before this was tested live:
- **Likely double-emit of `meetingEnded` on every clean meeting end**: `handleRoomFinished` emits `meetingEnded("ended")` after calling `room.disconnect()`, but the real LiveKit SDK's own `RoomEvent.Disconnected` almost certainly then fires (self-disconnects are typically observable via the client's own event emitter), and `handleDisconnected` has no guard against this — it would unconditionally emit a second, spurious `meetingEnded("ended_error")`, corrupting the Redis Stream (the intentional public contract) and flipping the stored meeting status. Recommended fix: guard `handleDisconnected` with `if (!this.room) return;` (cheap, provably correct for the clean-finish case since `handleRoomFinished` clears `this.room` synchronously before the async `Disconnected` event fires). **Not yet applied** — needs a decision before Task 11.
- Also noted: LiveKit meetings' `meeting_lifecycle: started` event always carries an empty participant roster (the `participantJoined` webhook event isn't wired to anything) — a known v1 gap, not a bug; transcript attribution itself is unaffected.
- The `handleDisconnected` "only fires once the SDK has given up" assumption is unverified — Task 1's live capability spike is still marked PENDING (no LiveKit Cloud account set up yet).

**Task 11 (manual test with real participants) requires**: (1) the user to sign up for a free LiveKit Cloud account and add `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`/`LIVEKIT_URL` to `.env`, (2) running Task 1's live capability spike (`npm run spike:livekit`) to confirm real `AudioStream`/`Disconnected`/reconnection behavior — findings doc at `docs/superpowers/notes/livekit-capability-findings.md` is currently all PENDING, (3) then `npm run dev:livekit` with two real people joining via browser and speaking. Deferred — user will do this later.

## What's next for the full Falcon vision

Sub-project 1 is only the "ears" — real-time listening, transcription, and publishing to a Redis Stream. Everything below is **not built yet**; each needs its own brainstorm → spec → plan → implementation cycle, same as sub-project 1 did. This list is the long-term architecture already captured in the design spec (`docs/superpowers/specs/2026-07-15-meeting-ingestion-transcription-pipeline-design.md`, "Long-term Falcon architecture" section) as context, not a design.

```
Redis Stream (done)
  │
  ▼
Knowledge Graph Builder      <- turns raw transcript events into structured decisions/entities
  │
  ▼
Decision Extractor           <- identifies concrete decisions made during discussion
  │
  ▼
Entity Resolver              <- resolves people/features/tickets mentioned to stable identities
  │
  ▼
Knowledge Graph              <- the shared, queryable store everything below reads from
  │
  ▼
Dynamic Agent Manager        <- creates one Falcon agent per meeting participant, seeded with
  │                              their role, meeting agenda, prior work, GitHub PRs, Jira/Linear
  │                              tickets, and past engineering decisions
  ▼
Engineer / PM / QA / Designer / Architect / DevOps / Security / Data Agents (one per participant,
  │                                                                          role-based, no fixed limit)
  ▼
Main Falcon Coordinator      <- has been listening from the start; mediates when agents' perspectives
                                 conflict (e.g. SD says Feature A, PM says Feature B) rather than only
                                 reacting when asked
```

Realistic order to tackle these (each is its own sub-project, brainstormed separately when we get there):

1. **Knowledge Graph Builder** — the natural next step once the transcript stream is proven live; without it, agents have no structured context to reason over.
2. **Dynamic Agent Manager** — creates the actual per-role agents; depends on the Knowledge Graph existing (even a minimal version) to seed agents with real context.
3. **Main Falcon Coordinator** — the mediation/debate logic; depends on multiple agents already existing to have something to coordinate between.

None of these have a UI either, by the same reasoning as sub-project 1 — unless we decide participants need to *see* agent output live in the meeting, which would be its own design decision when we get there.
