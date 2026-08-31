# Contract: Worker → Panel (SSE)

One-way server-push of session state to every paired participant's panel (§13 "SSE panel push"). The
panel renders the **shared transcript + membership + thread view** only — **no cards, no nudges**
(Phase 3 is strictly plumbing, FR-023/FR-026).

## Stream

```
GET  /session/{session_id}/stream        Accept: text/event-stream
  auth: Auth.js session; must be a current session member (403 otherwise)
  → 200 text/event-stream   (heartbeat comment every ~15s)
```

Each event carries the current `fencing_token`; the panel ignores any event with a token lower than
the highest seen (split-brain guard, §12.5/R14).

## Events

| `event:` | `data` (JSON) | Semantics |
|----------|---------------|-----------|
| `session_state` | `{ status, members[], membership_version, fencing_token }` | Sent on connect + on any membership change. `members[]` = `{ user_id, display, role_profile, present }`. Drives the "Paired with X · N others" indicator (§7.2). |
| `transcript_append` | `{ seq, user_id, text, order_confidence, ambiguous_order }` | A finalized, attributed utterance joined into the merged feed (F5). `ambiguous_order: true` when error margins overlap (F5.3/R5) — rendered without a forced order. |
| `transcript_gap` | `{ user_id, from_seq, to_seq, reason }` | Explicit coverage gap — shown as a marked gap, never silently omitted (§12.6, Constitution IV). |
| `thread_update` | `{ thread_id, action: opened\|matched\|merged\|split, utterance_seq }` | Live Open Threads view (tracking only — no gate/escalation state, F6.1a). |
| `coverage_notice` | `{ kind: unpaired_speaker\|stt_degraded\|network_gap, detail }` | Honest degraded-state banner (§7.3). |
| `capture_indicator` | `{ capturing: bool }` | Reinforces the always-visible capture indicator (§12.4). |

## Invariants (contract-tested)

1. **No intervention events exist** in this contract — there is no `card`, `nudge`, or `escalation`
   event type in Phase 3 (FR-023). *(Schema/contract test asserts the event enum contains none.)*
2. **Membership-gated**: a non-member (or a departed member after `left_at`) receives 403 / stream
   close — no transcript leaks to non-participants.
3. **Gap visibility**: every `transcript_gap` in the log produces a `transcript_gap` SSE event — the
   panel can never show a seamless transcript over a real gap (Constitution IV).
4. **Fencing filter**: events below the highest-seen token are dropped by the client (§12.5).
