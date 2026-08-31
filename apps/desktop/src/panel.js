// Falcon desktop panel (Phase 3, T028). Plain JS via the global Tauri API (withGlobalTauri) — no
// build step. Renders the always-visible capture indicator from the Rust "mic-level" events (§12.4)
// and the live shared transcript from the session SSE stream (contracts/sse-panel.md). Strictly
// tracking: it only ever renders transcript/gap/coverage events — never a card or nudge (FR-023).

const bar = document.getElementById('bar');
const dot = document.getElementById('dot');
const capLabel = document.getElementById('capLabel');
const transcript = document.getElementById('transcript');
const empty = document.getElementById('empty');
const pair = document.getElementById('pair');

// --- Capture indicator: driven by the Rust cpal capture thread (emits { rms, speaking }). ---
// Event delivery requires the `core:event` capability (see src-tauri/capabilities/default.json).
const g = window.__TAURI__;
const listen = g && g.event && g.event.listen;
if (listen) {
  listen('mic-level', (evt) => {
    const { rms, speaking } = evt.payload;
    // Amplify generously so quiet mics still show a clearly moving bar.
    bar.style.width = Math.min(100, Math.round(rms * 2500)) + '%';
    dot.classList.toggle('on', !!speaking);
    capLabel.textContent = speaking ? 'Speaking' : 'Mic on';
  });
  // Status/errors from the capture + worker-connection threads.
  listen('mic-status', (evt) => {
    const s = String(evt.payload || '');
    if (s === 'capturing' || s === 'connected') {
      if (capLabel.textContent === 'Mic off') capLabel.textContent = 'Mic on';
      if (s === 'connected') pair.textContent = 'Connected';
    } else {
      capLabel.textContent = `Mic: ${s.slice(0, 40)}`;
      capLabel.title = s;
    }
  });
  // Live transcript the worker sends back over the WebSocket (T021).
  listen('transcript', (evt) => {
    let m;
    try {
      m = JSON.parse(evt.payload);
    } catch {
      return;
    }
    if (m.type === 'stt_final' && m.text) addFinal(m.userId, m.text);
    else if (m.type === 'stt_interim' && m.text) showInterim(m.text);
  });
} else {
  capLabel.textContent = 'Mic (browser)';
}

// --- transcript rendering (from the worker's stt events) ---
let interimEl = null;
function showInterim(text) {
  empty.style.display = 'none';
  if (!interimEl) {
    interimEl = document.createElement('p');
    interimEl.className = 'utt';
    interimEl.style.opacity = '0.55';
    transcript.appendChild(interimEl);
  }
  interimEl.textContent = text;
  transcript.parentElement.scrollTop = transcript.parentElement.scrollHeight;
}
function addFinal(userId, text) {
  empty.style.display = 'none';
  if (interimEl) { interimEl.remove(); interimEl = null; }
  const p = document.createElement('p');
  p.className = 'utt';
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = userId;
  p.appendChild(who);
  p.appendChild(document.createTextNode(text));
  transcript.appendChild(p);
  transcript.parentElement.scrollTop = transcript.parentElement.scrollHeight;
}

// --- Live transcript via SSE. The base URL + session id come from the pairing flow (wired with the
//     WS client, T021). Exposed on window so the shell can start it once a session is joined. ---
function renderAppend(d) {
  empty.style.display = 'none';
  const p = document.createElement('p');
  p.className = 'utt' + (d.ambiguousOrder ? ' ambiguous' : '');
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = d.userId;
  p.appendChild(who);
  p.appendChild(document.createTextNode(d.text));
  transcript.appendChild(p);
  transcript.parentElement.scrollTop = transcript.parentElement.scrollHeight;
}

function renderGap(d) {
  empty.style.display = 'none';
  const p = document.createElement('p');
  p.className = 'gap';
  p.textContent = `— gap in ${d.userId}'s audio (${d.reason}) —`;
  transcript.appendChild(p);
}

export function connectSession({ baseUrl, sessionId, members }) {
  pair.textContent = members ? `Paired with ${members}` : `Session ${sessionId.slice(0, 8)}`;
  const es = new EventSource(`${baseUrl}/api/session/${sessionId}/stream`, { withCredentials: true });
  es.addEventListener('transcript_append', (e) => renderAppend(JSON.parse(e.data)));
  es.addEventListener('transcript_gap', (e) => renderGap(JSON.parse(e.data)));
  es.addEventListener('coverage_notice', (e) => renderGap(JSON.parse(e.data)));
  es.onerror = () => { pair.textContent = 'Reconnecting…'; };
  return es;
}

window.falconConnectSession = connectSession;
