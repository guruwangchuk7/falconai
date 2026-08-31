import WebSocket, { type RawData } from 'ws';
import { loadEnv, sttEnv } from '@falcon/config';
import type { SttEvent, SttProvider, SttStream } from './index.js';

// Deepgram Nova streaming. Audio in = linear16 (i16) PCM at 48kHz mono — the desktop client downmixes
// + converts before sending (T021). `endpointing` lets Deepgram mark end-of-utterance finals.
const DG_URL =
  'wss://api.deepgram.com/v1/listen?model=nova-2&encoding=linear16&sample_rate=48000&channels=1' +
  '&interim_results=true&smart_format=true&endpointing=300';

interface DgResult {
  type?: string;
  is_final?: boolean;
  channel?: { alternatives?: { transcript?: string; confidence?: number }[] };
}

class DeepgramStream implements SttStream {
  #ws: WebSocket;
  #open = false;
  #pending: Uint8Array[] = [];
  #queue: SttEvent[] = [];
  #waiters: ((r: IteratorResult<SttEvent>) => void)[] = [];
  #closed = false;
  #seq = 0;

  constructor(apiKey: string) {
    this.#ws = new WebSocket(DG_URL, { headers: { Authorization: `Token ${apiKey}` } });
    this.#ws.on('open', () => {
      this.#open = true;
      for (const f of this.#pending) this.#ws.send(f);
      this.#pending = [];
    });
    this.#ws.on('message', (data: RawData) => this.#onMessage(data));
    this.#ws.on('error', () => this.#push({ kind: 'degraded', reason: 'total_loss' }));
    this.#ws.on('close', () => this.#end());
  }

  #onMessage(data: RawData): void {
    let msg: DgResult;
    try {
      msg = JSON.parse(data.toString()) as DgResult;
    } catch {
      return;
    }
    if (msg.type !== 'Results') return;
    const alt = msg.channel?.alternatives?.[0];
    const text = alt?.transcript ?? '';
    if (!text) return;
    if (msg.is_final) {
      this.#seq += 1;
      const data2 = alt?.confidence === undefined
        ? { clientSeq: this.#seq, text }
        : { clientSeq: this.#seq, text, confidence: alt.confidence };
      this.#push({ kind: 'final', data: data2 });
    } else {
      this.#push({ kind: 'interim', data: { clientSeq: this.#seq + 1, text } });
    }
  }

  pushAudio(frame: Uint8Array, _clientSeq: number): void {
    if (this.#open) this.#ws.send(frame);
    else this.#pending.push(frame);
  }

  endUtterance(_clientSeqStart: number, _clientSeqEnd: number): void {
    if (this.#open) this.#ws.send(JSON.stringify({ type: 'Finalize' }));
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
    try {
      if (this.#open) this.#ws.send(JSON.stringify({ type: 'CloseStream' }));
      this.#ws.close();
    } catch {
      /* already closing */
    }
    this.#end();
    return Promise.resolve();
  }

  #push(ev: SttEvent): void {
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ value: ev, done: false });
    else this.#queue.push(ev);
  }

  #end(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const w of this.#waiters.splice(0)) w({ value: undefined, done: true });
  }
}

export class DeepgramSttProvider implements SttProvider {
  readonly name = 'deepgram-nova';
  #apiKey: string;
  constructor(apiKey?: string) {
    this.#apiKey = apiKey ?? loadEnv(sttEnv).DEEPGRAM_API_KEY;
  }
  openStream(_opts: { readonly userId: string }): SttStream {
    return new DeepgramStream(this.#apiKey);
  }
}
