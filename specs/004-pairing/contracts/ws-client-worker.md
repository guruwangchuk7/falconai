# Contract: Client ↔ Session Worker (WebSocket)

The desktop app's audio uplink + event channel to the stateful session worker (§13, §6.3). One WS
connection per client per session. **Raw audio frames are transient** — VAD-gated speech only, never
stored (§12.3). Transport: WebSocket; auth: device pairing token + Auth.js session (workspace scoped).

## Connection

```
WS  /session/{session_id}/connect
  headers: Authorization: Bearer <device+session token>
  → 101 Switching Protocols   (rejected 401 if token invalid; 403 if not a session member)
```

The worker owning `session_id` (consistent-hash pinned) accepts the socket. If this worker is not the
lease holder, it redirects/hands off (client retries) — never two writers (§12.5).

## Client → Worker messages

| Type | Fields | Semantics |
|------|--------|-----------|
| `audio_frame` | `client_seq` (int), `pcm` (VAD-gated frame), `captured_ts` (client monotonic) | Only speech frames (Silero VAD passed). Addressable by `client_seq` for failover re-send. |
| `utterance_boundary` | `client_seq_start`, `client_seq_end` | Client-side VAD end-of-utterance marker (F4). |
| `resync` | `from_client_seq` | After network loss: client re-sends buffered frames from this seq (§12.3). |
| `heartbeat` | `ts` | Liveness. |
| `leave` | — | Graceful leave → `member_left` (triggers visibility recompute). |

## Worker → Client messages

| Type | Fields | Semantics |
|------|--------|-----------|
| `stt_interim` | `client_seq`, `text` | Interim transcript for the client's own speech (panel feedback). |
| `stt_final` | `client_seq`, `text`, `arrival_ts`, `error_margin_ms`, `order_confidence` | Finalized utterance; appended to the event log **before** this ack. |
| `stt_degraded` | `reason` (`provider_failover` \| `total_loss`), `gap_from_seq` | STT breaker tripped; on total loss the client keeps buffering + a `transcript_gap` is marked (§12.9). |
| `fencing_token` | `token` (monotonic) | Current session ownership token; client rejects any later message with a lower token (split-brain guard, §12.5/R14). |
| `capture_ack` | `client_seq` | Flow-control / buffer-release signal. |

## Invariants (contract-tested)

1. **Attribution by construction**: every `stt_final` carries the `user_id` of the *connection owner*
   — the worker never attributes one client's socket to another user (G2, §6.1).
2. **No raw audio persisted**: `audio_frame.pcm` is consumed into the STT stream and dropped; it is
   never written to Redis/Postgres/disk (§12.3/R6). *(Storage-audit test, SC-006.)*
3. **Append-before-ack**: `stt_final` is not sent until its `utterance_final` event is durably
   appended to the Redis Stream (§12.3).
4. **Fencing monotonicity**: a client that has seen token N rejects any worker message with token < N
   (§12.5). A stale/zombie worker therefore cannot drive a client.
5. **Lossless failover**: on `resync`, frames from `from_client_seq` are re-ingested and reordered by
   `client_seq` — no utterance lost, gap marked only if truly unrecoverable (§12.6/§12.9).
