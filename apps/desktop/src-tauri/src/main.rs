// Falcon desktop core (Phase 3, T020 + T021) — captures the owner's mic, drives the always-visible
// capture indicator (§12.4), and streams the audio to the session worker over WebSocket, showing the
// transcript the worker sends back. Raw audio is converted to 16-bit PCM frames in flight and never
// stored (§12.3/R6). Panel event delivery requires the core:event capability (capabilities/default.json).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use futures_util::{SinkExt, StreamExt};
use tauri::Emitter;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use tokio_tungstenite::tungstenite::Message;

const SPEAKING_RMS: f32 = 0.008;

#[derive(Clone, serde::Serialize)]
struct MicLevel {
    rms: f32,
    speaking: bool,
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            // PCM frames: audio callback → WebSocket task. The task always runs (so this window
            // receives the shared transcript); capture is skipped in viewer mode (FALCON_NO_MIC),
            // letting a second window just watch without contending for the mic.
            let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
            tauri::async_runtime::spawn(ws_task(handle.clone(), rx));

            if std::env::var("FALCON_NO_MIC").is_err() {
                let h = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(600));
                    if let Err(e) = run_capture(h.clone(), tx) {
                        let msg = format!("{e}");
                        eprintln!("[falcon] mic capture unavailable: {msg}");
                        let _ = h.emit("mic-status", format!("error: {msg}"));
                    }
                });
            } else {
                let _ = handle.emit("mic-status", "viewer (no mic)");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Falcon desktop app");
}

fn err_fn(e: cpal::StreamError) {
    eprintln!("[falcon] input stream error: {e}");
}

fn emit_rms(app: &tauri::AppHandle, samples: &[f32]) {
    if samples.is_empty() {
        return;
    }
    let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
    let _ = app.emit("mic-level", MicLevel { rms, speaking: rms > SPEAKING_RMS });
}

/// Downmix interleaved f32 samples to mono and pack as little-endian 16-bit PCM (Deepgram linear16).
fn downmix_pcm(samples: &[f32], channels: usize) -> Vec<u8> {
    let ch = channels.max(1);
    let mut out = Vec::with_capacity(samples.len() / ch * 2);
    for frame in samples.chunks(ch) {
        let avg = frame.iter().sum::<f32>() / ch as f32;
        let v = (avg.clamp(-1.0, 1.0) * 32767.0) as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

fn run_capture(
    app: tauri::AppHandle,
    tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
) -> Result<(), Box<dyn std::error::Error>> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or("no microphone found (check Windows mic privacy for desktop apps)")?;
    let supported = device.default_input_config()?;
    let fmt = supported.sample_format();
    let ch = supported.channels() as usize;
    let cfg: cpal::StreamConfig = supported.into();

    let count = Arc::new(AtomicU64::new(0));

    macro_rules! build_stream {
        ($t:ty, $conv:expr) => {{
            let a = app.clone();
            let c = count.clone();
            let tx = tx.clone();
            device.build_input_stream(
                &cfg,
                move |data: &[$t], _: &cpal::InputCallbackInfo| {
                    let f: Vec<f32> = data.iter().map($conv).collect();
                    let _ = tx.send(downmix_pcm(&f, ch)); // stream audio up (never stored)
                    if c.fetch_add(1, Ordering::Relaxed) % 3 == 0 {
                        emit_rms(&a, &f);
                    }
                },
                err_fn,
                None,
            )?
        }};
    }

    let stream = match fmt {
        cpal::SampleFormat::F32 => build_stream!(f32, |&s| s),
        cpal::SampleFormat::I16 => build_stream!(i16, |&s| s as f32 / 32768.0),
        cpal::SampleFormat::U16 => build_stream!(u16, |&s| (s as f32 - 32768.0) / 32768.0),
        cpal::SampleFormat::I32 => build_stream!(i32, |&s| s as f32 / 2_147_483_648.0),
        other => return Err(format!("unsupported mic sample format: {other:?}").into()),
    };

    stream.play()?;
    let _ = app.emit("mic-status", "capturing");

    // Keep the stream (and capture) alive for the life of the app.
    loop {
        std::thread::sleep(Duration::from_secs(3600));
    }
}

/// Connect to the session worker, stream PCM frames up, and forward transcript messages to the panel.
/// Auto-reconnects, so the worker and desktop can be started in any order.
async fn ws_task(app: tauri::AppHandle, mut rx: UnboundedReceiver<Vec<u8>>) {
    let url = std::env::var("FALCON_WORKER_WS")
        .unwrap_or_else(|_| "ws://127.0.0.1:8787/session/demo/connect?userId=me".to_string());

    loop {
        match tokio_tungstenite::connect_async(&url).await {
            Ok((ws, _)) => {
                let _ = app.emit("mic-status", "connected");
                let (mut sink, mut stream) = ws.split();

                // Reader: transcript messages from the worker → the panel.
                let app2 = app.clone();
                let reader = tauri::async_runtime::spawn(async move {
                    while let Some(Ok(msg)) = stream.next().await {
                        if let Message::Text(t) = msg {
                            let _ = app2.emit("transcript", t.to_string());
                        }
                    }
                });

                // Writer: PCM frames → the worker while audio is available.
                while let Some(pcm) = rx.recv().await {
                    if sink.send(Message::Binary(pcm.into())).await.is_err() {
                        break;
                    }
                }
                // In viewer mode the audio channel is closed (no mic), so the loop above exits at
                // once — but the socket is healthy, so keep RECEIVING the shared transcript until the
                // worker actually closes the connection. (For a talker, the socket only ends here on a
                // send failure, and the reader ends immediately too.)
                let _ = reader.await;
                let _ = app.emit("mic-status", "reconnecting…");
            }
            Err(_) => {
                let _ = app.emit("mic-status", "worker offline — retrying");
            }
        }
        // Drop audio buffered while disconnected, then wait before reconnecting.
        while rx.try_recv().is_ok() {}
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

// Silence the unused warning for the sender type alias in some build configs.
#[allow(dead_code)]
type _PcmSender = UnboundedSender<Vec<u8>>;
