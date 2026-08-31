// Falcon desktop core (Phase 3 scaffold).
//
// NOT YET WIRED (Foundational task T020): cpal mic capture + Silero VAD (ONNX Runtime) → stream only
// VAD-gated frames to the session worker over WebSocket. Raw audio is never written to disk and never
// leaves the device except as the transcription stream (§12.3/R6). Drive an always-visible capture
// indicator (§12.4). Building requires the Rust toolchain — see ../README.md.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running the Falcon desktop app");
}
