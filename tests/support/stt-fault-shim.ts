import type { SttEvent, SttFinal, SttProvider, SttStream } from '@falcon/stt';

export interface FaultConfig {
  /** After this many finals, emit a `total_loss` degraded event and end the stream (kill socket). */
  killAfterFinals?: number;
  /** Delay every emitted event by this many ms (latency-as-degradation, §12.9). */
  latencyMs?: number;
  /** Corrupt final transcripts (keep every other word) to exercise downstream tolerance. */
  garbleFinals?: boolean;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const garble = (text: string): string =>
  text.split(/\s+/).filter((_word, i) => i % 2 === 0).join(' ');

/**
 * Wraps an SttProvider to inject faults (kill socket / inject latency / garble finals) so the
 * failover + circuit-breaker path (task T016, §12.9) is exercised in tests — "the failover path isn't
 * first exercised in a live meeting." Works over ANY provider, including the deterministic fake.
 */
export function withFaults(inner: SttProvider, cfg: FaultConfig): SttProvider {
  return {
    name: `${inner.name}+faults`,
    openStream: (opts) => wrapStream(inner.openStream(opts), cfg),
  };
}

function wrapStream(inner: SttStream, cfg: FaultConfig): SttStream {
  return {
    pushAudio: (frame, seq) => inner.pushAudio(frame, seq),
    endUtterance: (start, end) => inner.endUtterance(start, end),
    close: () => inner.close(),
    events(): AsyncIterable<SttEvent> {
      return {
        async *[Symbol.asyncIterator](): AsyncGenerator<SttEvent> {
          let finals = 0;
          for await (const ev of inner.events()) {
            if (cfg.latencyMs) await delay(cfg.latencyMs);
            if (ev.kind !== 'final') {
              yield ev;
              continue;
            }
            finals++;
            const text = cfg.garbleFinals ? garble(ev.data.text) : ev.data.text;
            const data: SttFinal =
              ev.data.confidence === undefined
                ? { clientSeq: ev.data.clientSeq, text }
                : { clientSeq: ev.data.clientSeq, text, confidence: ev.data.confidence };
            yield { kind: 'final', data };
            if (cfg.killAfterFinals !== undefined && finals >= cfg.killAfterFinals) {
              yield { kind: 'degraded', reason: 'total_loss' };
              return;
            }
          }
        },
      };
    },
  };
}
