# Falcon Roadmap

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

**Current blocker:** confirming the RTMS scopes actually unlock the auto-start toggle, then running an actual test meeting and confirming a webhook arrives (checked via `curl -s http://127.0.0.1:4040/api/requests/http` in WSL — no POST from Zoom has landed yet, only browser GETs from manual URL visits).

**Once a webhook does arrive**, next debugging steps if something's still wrong: check `docs/superpowers/notes/zoom-rtms-capability-findings.md` for the specific real-vs-assumed API details already discovered (webhook payload shape, `userId` type, event name spelling), and update `src/zoom/realWebhookSource.ts` / `realRtmsClient.ts` if reality differs from what's coded.

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
