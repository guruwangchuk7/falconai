import type { Redis } from 'ioredis';

/**
 * Append-only, event-sourced session log on a Redis Stream (§12.3). Every session transition
 * (member joined/left, utterance finalized, thread opened/matched, visibility recomputed) is
 * appended here **synchronously before** any downstream action proceeds.
 *
 * Derived state (merged transcript, membership, Open Threads) is a **fold** over the log — never a
 * mutated value (CX-1). Snapshots are a *discardable cache*: deleting every snapshot must be a
 * correctness no-op (only recovery latency grows), which is exactly what T011 asserts.
 */

/** One event in a session's log. `seq` is a per-session monotonic integer (from INCR); `id` is the
 *  underlying Redis stream entry id (used to bound tail replay). Payload carries NO raw audio (§12.3). */
export interface SessionEvent {
  id: string;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
}

/** A pure, deterministic fold: derive state by applying events in order (CX-1). */
export type Reducer<S> = (state: S, event: SessionEvent) => S;

/** A discardable snapshot of a fold — the last applied position plus the derived state. */
export interface Snapshot<S> {
  lastSeq: number;
  lastStreamId: string; // '' when no events have been applied yet
  state: S;
}

function fieldValue(fields: string[], key: string): string {
  const i = fields.indexOf(key);
  const v = i >= 0 ? fields[i + 1] : undefined;
  if (v === undefined) throw new Error(`session event missing field "${key}"`);
  return v;
}

export interface EventLog {
  append(type: string, payload: Record<string, unknown>): Promise<number>;
  readFrom(exclusiveStartId: string | null): Promise<SessionEvent[]>;
  writeSnapshot<S>(snap: Snapshot<S>): Promise<void>;
  readSnapshot<S>(): Promise<Snapshot<S> | null>;
  deleteSnapshot(): Promise<void>;
  replay<S>(initial: S, reducer: Reducer<S>): Promise<Snapshot<S>>;
}

export function createEventLog(redis: Redis, sessionId: string): EventLog {
  const stream = `session:${sessionId}:events`;
  const seqKey = `session:${sessionId}:seq`;
  const snapKey = `session:${sessionId}:snapshot`;

  const self: EventLog = {
    /** Append an event and return its seq. The append completes BEFORE the caller takes any side
     *  effect (waking an agent, updating a projection), so a crash can't lose a committed transition. */
    async append(type, payload) {
      const seq = await redis.incr(seqKey);
      await redis.xadd(stream, '*', 'seq', String(seq), 'type', type, 'payload', JSON.stringify(payload));
      return seq;
    },

    /** Read events after `exclusiveStartId` (or from the beginning when null), in stream order. */
    async readFrom(exclusiveStartId) {
      const start = exclusiveStartId ? `(${exclusiveStartId}` : '-';
      const entries = (await redis.xrange(stream, start, '+')) as [string, string[]][];
      return entries.map(([id, fields]) => ({
        id,
        seq: Number(fieldValue(fields, 'seq')),
        type: fieldValue(fields, 'type'),
        payload: JSON.parse(fieldValue(fields, 'payload')) as Record<string, unknown>,
      }));
    },

    async writeSnapshot(snap) {
      await redis.set(snapKey, JSON.stringify(snap));
    },

    async readSnapshot<S>() {
      const raw = await redis.get(snapKey);
      return raw ? (JSON.parse(raw) as Snapshot<S>) : null;
    },

    /** Delete the snapshot cache — must be a correctness no-op (CX-1). */
    async deleteSnapshot() {
      await redis.del(snapKey);
    },

    /**
     * Rebuild derived state: start from the snapshot (if any) else `initial`, then apply the tail of
     * events after it. With no snapshot this replays the whole log and yields an identical result —
     * that identity is the CX-1 invariant.
     */
    async replay<S>(initial: S, reducer: Reducer<S>) {
      const snap = await self.readSnapshot<S>();
      let state = snap ? snap.state : initial;
      let lastSeq = snap ? snap.lastSeq : 0;
      let lastStreamId = snap ? snap.lastStreamId : '';
      for (const ev of await self.readFrom(lastStreamId || null)) {
        state = reducer(state, ev);
        lastSeq = ev.seq;
        lastStreamId = ev.id;
      }
      return { lastSeq, lastStreamId, state };
    },
  };

  return self;
}
