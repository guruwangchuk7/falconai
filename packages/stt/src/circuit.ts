import type { SttEvent, SttProvider, SttStream } from './index.js';

/**
 * Circuit-broken STT composition (§12.9, research R3): a **primary** provider (Deepgram Nova) with
 * failover to a **secondary** (AssemblyAI). Failover fires at the **utterance boundary** on a
 * degraded signal and is **one-way within a stream** (no failback → no flapping/hysteresis). The
 * abandoned utterance's audio is re-sent from the client's addressable buffer in the live system, so
 * a permanent marked gap is the failure-of-the-failover, not the expected path.
 *
 * The concrete vendor adapters (Deepgram/AssemblyAI streaming SDKs) need API keys + network and are
 * wired separately; THIS module is the vendor-agnostic breaker/failover orchestration, exercised in
 * tests against the deterministic fake + the fault-injection shim (T016). Confidence scores are
 * NOT comparable across vendors — calibrate per-provider or don't threshold on them (see
 * `calibrateConfidence`).
 */

export interface CircuitOptions {
  /** Which degraded reasons from the primary trigger failover. Default: both. */
  failoverOn?: readonly ('provider_failover' | 'total_loss')[];
}

/** Per-provider confidence calibration seam. Vendor confidence scales differ (§12.9); map to a
 *  common [0,1] before any thresholding. Identity by default — replace per vendor when wiring real
 *  adapters. */
export function calibrateConfidence(_provider: string, confidence: number | undefined): number | undefined {
  return confidence;
}

class CircuitBrokenStream implements SttStream {
  private current: SttStream;
  private failedOver = false;

  constructor(
    private readonly primary: SttProvider,
    private readonly failover: SttProvider,
    private readonly opts: { readonly userId: string },
    private readonly triggers: ReadonlySet<string>,
  ) {
    this.current = primary.openStream(opts);
  }

  pushAudio(frame: Uint8Array, clientSeq: number): void {
    this.current.pushAudio(frame, clientSeq);
  }

  endUtterance(clientSeqStart: number, clientSeqEnd: number): void {
    this.current.endUtterance(clientSeqStart, clientSeqEnd);
  }

  async *events(): AsyncGenerator<SttEvent> {
    for await (const ev of this.current.events()) {
      if (!this.failedOver && ev.kind === 'degraded' && this.triggers.has(ev.reason)) {
        // Utterance-boundary failover (one-way): mark the switch, then continue on the secondary.
        this.failedOver = true;
        yield { kind: 'degraded', reason: 'provider_failover' };
        const secondary = this.failover.openStream(this.opts);
        this.current = secondary;
        for await (const fev of secondary.events()) yield fev;
        return;
      }
      yield ev;
    }
  }

  close(): Promise<void> {
    return this.current.close();
  }
}

export function createCircuitBrokenStt(
  primary: SttProvider,
  failover: SttProvider,
  opts: CircuitOptions = {},
): SttProvider {
  const triggers = new Set<string>(opts.failoverOn ?? ['total_loss', 'provider_failover']);
  return {
    name: `${primary.name}->${failover.name}`,
    openStream: (o) => new CircuitBrokenStream(primary, failover, o, triggers),
  };
}
