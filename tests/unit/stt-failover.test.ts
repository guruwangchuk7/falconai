// Phase 3 (spec 004-pairing, T016) — the STT circuit breaker fails over from primary to secondary at
// the utterance boundary when the primary dies, and the abandoned stream does NOT become a permanent
// gap. Keyless + deterministic: the fault shim kills a fake primary; a second fake is the failover.
// (Placed under tests/unit for clean @falcon/stt + fault-shim resolution; no containers needed.)
import { it, expect } from 'vitest';
import { FakeSttProvider, createCircuitBrokenStt, type SttEvent } from '@falcon/stt';
import { withFaults } from '../support/stt-fault-shim.js';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function take(iterable: AsyncIterable<SttEvent>, n: number): Promise<SttEvent[]> {
  const out: SttEvent[] = [];
  for await (const ev of iterable) {
    out.push(ev);
    if (out.length >= n) break;
  }
  return out;
}

it('fails over to the secondary on primary total_loss — no permanent gap', async () => {
  const primaryFake = new FakeSttProvider();
  const failoverFake = new FakeSttProvider();
  const primary = withFaults(primaryFake, { killAfterFinals: 2 }); // dies after 2 finals
  const breaker = createCircuitBrokenStt(primary, failoverFake);

  const stream = breaker.openStream({ userId: 'u' });
  const collected = take(stream.events(), 4);

  // Two finals on the primary → the shim emits total_loss after the 2nd.
  const pf = primaryFake.streams.get('u')!;
  pf.feedFinal(1, 'alpha');
  pf.feedFinal(2, 'bravo');

  await delay(30); // let the breaker process total_loss + open the failover stream

  const ff = failoverFake.streams.get('u')!;
  ff.feedFinal(3, 'charlie');

  const events = await collected;
  expect(events.map((e) => e.kind)).toEqual(['final', 'final', 'degraded', 'final']);
  expect(events[2]).toMatchObject({ kind: 'degraded', reason: 'provider_failover' });

  // The primary's total_loss did NOT become a permanent gap — the failover final came through.
  const finals = events.filter((e): e is Extract<SttEvent, { kind: 'final' }> => e.kind === 'final');
  expect(finals.map((f) => f.data.text)).toEqual(['alpha', 'bravo', 'charlie']);
});
