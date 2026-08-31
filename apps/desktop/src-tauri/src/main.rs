// Falcon desktop core (Phase 3, T020) — captures the owner's microphone and emits a live level to
// the panel (the always-visible capture indicator, §12.4). Raw audio is reduced to an RMS level and
// then DROPPED — never written to disk, never stored (§12.3/R6). Energy gate stands in for Silero VAD.
//
// NOTE: the panel can only RECEIVE these events because `capabilities/default.json` grants
// `core:event` to the "main" window — Tauri 2 denies event delivery by default.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use tauri::Emitter;

const SPEAKING_RMS: f32 = 0.02;

#[derive(Clone, serde::Serialize)]
struct MicLevel {
    rms: f32,
    speaking: bool,
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                // Let the webview attach its listeners before we start emitting.
                std::thread::sleep(Duration::from_millis(600));
                if let Err(e) = run_capture(handle.clone()) {
                    let msg = format!("{e}");
                    eprintln!("[falcon] mic capture unavailable: {msg}");
                    let _ = handle.emit("mic-status", format!("error: {msg}"));
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Falcon desktop app");
}

fn err_fn(e: cpal::StreamError) {
    eprintln!("[falcon] input stream error: {e}");
}

fn emit_rms(app: &tauri::AppHandle, samples: impl Iterator<Item = f32>) {
    let mut sum = 0.0f32;
    let mut n = 0u32;
    for s in samples {
        sum += s * s;
        n += 1;
    }
    if n == 0 {
        return;
    }
    let rms = (sum / n as f32).sqrt();
    // Raw samples are gone after this — only the level leaves this function (§12.3/R6).
    let _ = app.emit("mic-level", MicLevel { rms, speaking: rms > SPEAKING_RMS });
}

fn run_capture(app: tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or("no microphone found (check Windows mic privacy for desktop apps)")?;
    let supported = device.default_input_config()?;
    let fmt = supported.sample_format();
    let cfg: cpal::StreamConfig = supported.into();

    // Throttle emits (~1 in 3 callbacks) to keep the panel responsive without flooding the IPC.
    let count = Arc::new(AtomicU64::new(0));

    macro_rules! build_stream {
        ($t:ty, $conv:expr) => {{
            let a = app.clone();
            let c = count.clone();
            device.build_input_stream(
                &cfg,
                move |data: &[$t], _: &cpal::InputCallbackInfo| {
                    if c.fetch_add(1, Ordering::Relaxed) % 3 == 0 {
                        emit_rms(&a, data.iter().map($conv));
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
