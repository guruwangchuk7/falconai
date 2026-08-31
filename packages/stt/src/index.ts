/**
 * Thin, swappable streaming-STT provider interface — mirrors the `@falcon/llm` provider pattern so
 * a vendor swap is config + a canary, not a rewrite (PRD §12.8/§12.9, research R3).
 *
 * Phase 3 real providers — Deepgram Nova (primary) + AssemblyAI (failover) behind a circuit breaker,
 * with utterance-boundary failover and per-vendor confidence calibration — are NOT YET IMPLEMENTED
 * (they land in Foundational task T015). A deterministic in-memory **fake** drives the keyless
 * two-client test harness via the `FALCON_FAKE_STT` seam, mirroring `@falcon/llm`'s `FALCON_FAKE_LLM`.
 *
 * Invariant: a stream consumes VAD-gated audio frames and emits transcript events; it NEVER persists
 * raw audio (§12.3/R6).
 */

/** A finalized utterance for one client. `confidence` is per-vendor calibrated — never compare it
 *  across providers (§12.9). */
export interface SttFinal {
  clientSeq: number;
  text: string;
  confidence?: number;
}

export interface SttInterim {
  clientSeq: number;
  text: string;
}

export type SttEvent =
  | { readonly kind: 'interim'; readonly data: SttInterim }
  | { readonly kind: 'final'; readonly data: SttFinal }
  | { readonly kind: 'degraded'; readonly reason: 'provider_failover' | 'total_loss' };

/** A live transcription stream for ONE client's microphone. */
export interface SttStream {
  /** Push a VAD-gated PCM frame (transient — consumed into the provider stream, never stored). */
  pushAudio(frame: Uint8Array, clientSeq: number): void;
  /** Client-side VAD end-of-utterance marker (F4). */
  endUtterance(clientSeqStart: number, clientSeqEnd: number): void;
  /** Transcript events (interim / final / degraded) for this client's speech. */
  events(): AsyncIterable<SttEvent>;
  /** Stop the stream and release resources. */
  close(): Promise<void>;
}

export interface SttProvider {
  readonly name: string;
  openStream(opts: { readonly userId: string }): SttStream;
}

/**
 * Deterministic, keyless fake stream. Tests/harness script transcripts explicitly via `feedFinal`
 * (and `feedDegraded`); pushed audio bytes are ignored, so runs are reproducible with no API keys.
 */
export class FakeSttStream implements SttStream {
  #queue: SttEvent[] = [];
  #waiters: ((r: IteratorResult<SttEvent>) => void)[] = [];
  #closed = false;

  pushAudio(_frame: Uint8Array, _clientSeq: number): void {
    // no-op: the fake ignores audio bytes for determinism
  }

  endUtterance(_clientSeqStart: number, _clientSeqEnd: number): void {
    // no-op: the fake emits finals explicitly via feedFinal()
  }

  /** TEST HELPER — emit a final transcript for this client. */
  feedFinal(clientSeq: number, text: string, confidence?: number): void {
    const data: SttFinal = confidence === undefined ? { clientSeq, text } : { clientSeq, text, confidence };
    this.#push({ kind: 'final', data });
  }

  /** TEST HELPER — emit an interim transcript. */
  feedInterim(clientSeq: number, text: string): void {
    this.#push({ kind: 'interim', data: { clientSeq, text } });
  }

  /** TEST HELPER — simulate a degraded provider state. */
  feedDegraded(reason: 'provider_failover' | 'total_loss'): void {
    this.#push({ kind: 'degraded', reason });
  }

  #push(ev: SttEvent): void {
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ value: ev, done: false });
    else this.#queue.push(ev);
  }

  events(): AsyncIterable<SttEvent> {
    const self = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<SttEvent> {
        return {
          next(): Promise<IteratorResult<SttEvent>> {
            const next = self.#queue.shift();
            if (next !== undefined) return Promise.resolve({ value: next, done: false });
            if (self.#closed) return Promise.resolve({ value: undefined, done: true });
            return new Promise((resolve) => self.#waiters.push(resolve));
          },
        };
      },
    };
  }

  close(): Promise<void> {
    this.#closed = true;
    for (const w of this.#waiters.splice(0)) w({ value: undefined, done: true });
    return Promise.resolve();
  }
}

/** Fake provider (FALCON_FAKE_STT). Keeps a handle to each opened stream by userId so the harness
 *  can script transcripts. */
export class FakeSttProvider implements SttProvider {
  readonly name = 'fake';
  readonly streams = new Map<string, FakeSttStream>();

  openStream(opts: { readonly userId: string }): SttStream {
    const stream = new FakeSttStream();
    this.streams.set(opts.userId, stream);
    return stream;
  }
}

/** Placeholder for a real provider until Deepgram/AssemblyAI land in T015 (mirrors the secrets-store
 *  Infisical stub pattern: fail loudly rather than silently no-op). */
class UnimplementedSttProvider implements SttProvider {
  constructor(readonly name: string) {}
  openStream(_opts: { readonly userId: string }): SttStream {
    throw new Error(
      `STT provider "${this.name}" not implemented — configure Deepgram Nova + AssemblyAI failover (research R3, §12.9).`,
    );
  }
}

/**
 * Factory: `FALCON_FAKE_STT` → deterministic fake (keyless, for tests/harness); otherwise the real
 * provider (Deepgram Nova primary, AssemblyAI failover) — NOT YET IMPLEMENTED (throws on use).
 */
export function createSttProvider(): SttProvider {
  if (process.env.FALCON_FAKE_STT) return new FakeSttProvider();
  return new UnimplementedSttProvider('deepgram-nova');
}
