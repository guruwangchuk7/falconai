// Falcon desktop core (Phase 3, T020) — captures the owner's microphone and emits a live level to
// the panel (the always-visible capture indicator, §12.4). Raw audio is reduced to an RMS level and
// then DROPPED — never written to disk, never stored (§12.3/R6). A simple energy gate stands in for
// Silero VAD for this MVP. Streaming VAD-gated frames to the session worker (T021) is wired next.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use tauri::Emitter;

/// RMS above this counts as "speaking" (drives the capture indicator; will gate STT streaming, §12.2).
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
                // Give the webview a moment to attach its event listeners before we emit.
                std::thread::sleep(std::time::Duration::from_millis(600));
                if let Err(e) = run_capture(handle.clone()) {
                    let msg = format!("{e}");
                    eprintln!("[falcon] mic capture unavailable: {msg}");
                    let _ = handle.emit("mic-status", msg); // surface the reason in the panel
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
    // The raw samples are gone after this — only the level leaves this function (§12.3/R6).
    let _ = app.emit("mic-level", MicLevel { rms, speaking: rms > SPEAKING_RMS });
}

fn run_capture(app: tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or("no microphone found (check Windows mic privacy: Settings → Privacy → Microphone → allow desktop apps)")?;
    let supported = device.default_input_config()?;
    let fmt = supported.sample_format();
    let cfg: cpal::StreamConfig = supported.into();

    // Handle the common Windows sample formats; convert each to f32 for the RMS level.
    macro_rules! build_stream {
        ($t:ty, $conv:expr) => {{
            let a = app.clone();
            device.build_input_stream(
                &cfg,
                move |data: &[$t], _: &cpal::InputCallbackInfo| emit_rms(&a, data.iter().map($conv)),
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
        std::thread::sleep(std::time::Duration::from_secs(3600));
    }
}
