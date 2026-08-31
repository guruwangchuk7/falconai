# @falcon/desktop — Falcon pairing client (Tauri 2)

Phase 3 scaffold. Captures the owner's microphone (VAD-gated, raw audio never stored) and streams it
to the session worker over WebSocket; renders the shared transcript panel (React, shared with the
dashboard) and an always-visible capture indicator.

## ⚠️ Build prerequisites (one-time, not installed in CI or this dev box yet)

Building/running the desktop app needs the **Rust toolchain** — it is intentionally **not** built by
the Node monorepo (`pnpm build`/`typecheck`) and is scaffolded as code only:

1. **Rust** via [rustup](https://rustup.rs/).
2. **Platform build tools**: Windows → *Visual Studio Build Tools* (MSVC + Windows SDK) + WebView2;
   macOS → Xcode Command Line Tools; Linux → webkit2gtk + build-essential.
3. **Tauri CLI**: `pnpm add -D @tauri-apps/cli` in this package (or `cargo install tauri-cli`).

Then, from `apps/desktop`: `pnpm tauri dev` (build) / `pnpm tauri build` (bundle). macOS release
builds also need code-signing + notarization (T042).

## Status

- `src-tauri/` — Rust core (`main.rs`, `Cargo.toml`, `tauri.conf.json`) scaffolded; **cpal capture +
  Silero VAD + WS client are NOT yet wired** (task T020).
- `src/` — webview placeholder; the real panel (task T028) shares React components with `apps/web`.
