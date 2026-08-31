// Falcon desktop core (Phase 3, T020) — captures the owner's microphone and emits a live level to
// the panel (the always-visible capture indicator, §12.4). Raw audio is computed into an RMS level
// and then DROPPED — never written to disk, never stored (§12.3/R6). A simple energy gate stands in
// for Silero VAD for this MVP (the ONNX upgrade is future work). Streaming VAD-gated frames to the
// session worker over WebSocket (T021) is wired next.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use tauri::Emitter;

/// Speech energy gate — RMS above this counts as "speaking" (drives the capture indicator + will
/// gate what gets streamed to STT, keeping COGS down per §12.2).
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
            // Capture runs on its own thread; if there's no input device we simply don't emit levels.
            std::thread::spawn(move || {
                if let Err(e) = run_capture(handle) {
                    eprintln!("[falcon] mic capture unavailable: {e}");
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Falcon desktop app");
}

fn run_capture(app: tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let host = cpal::default_host();
    let device = host.default_input_device().ok_or("no default input device")?;
    let config = device.default_input_config()?;

    if config.sample_format() != cpal::SampleFormat::F32 {
        return Err(format!("expected f32 input samples, got {:?}", config.sample_format()).into());
    }

    let stream = device.build_input_stream(
        &config.into(),
        move |data: &[f32], _: &cpal::InputCallbackInfo| {
            if data.is_empty() {
                return;
            }
            // Compute the RMS level, then let `data` drop — the raw audio is never stored (§12.3/R6).
            let sum_sq: f32 = data.iter().map(|s| s * s).sum();
            let rms = (sum_sq / data.len() as f32).sqrt();
            let _ = app.emit("mic-level", MicLevel { rms, speaking: rms > SPEAKING_RMS });
        },
        move |err| eprintln!("[falcon] input stream error: {err}"),
        None,
    )?;
    stream.play()?;

    // Keep the stream (and thus capture) alive for the life of the app.
    loop {
        std::thread::sleep(std::time::Duration::from_secs(3600));
    }
}
