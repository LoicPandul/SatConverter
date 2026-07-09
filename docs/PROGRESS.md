# Progress log

Development log for the Rust + Tauri port of SatConverter.

## 2026-07-09 — v1.0.0 port

- [x] Requirements analysis: feature parity with the original Python/pywebview app
      (live prices, 24h change, sparkline, 4-way conversion, copy, presets,
      always-on-top pin, offline cache, window position memory, single instance,
      frameless custom titlebar, silent launch).
- [x] Architecture: thin Rust shell (window, clipboard, single-instance,
      position persistence) + vanilla HTML/CSS/JS frontend, no bundler, no Node.
      Prices fetched directly from the webview (CoinGecko is CORS-open) — no HTTP
      stack in Rust. Cache in `localStorage`.
- [x] Scaffold: Tauri v2 layout (`src-tauri/` + `ui/`), strict CSP, capability-scoped
      window permissions.
- [x] Brand assets: icons generated from the official logotype (#FC5B02),
      UI accent aligned with the brand. Fonts self-hosted (offline-ready).
- [x] Rust backend: `copy_text` command (arboard), single-instance plugin
      (refocus on relaunch), window-state plugin (position only).
- [x] Frontend port: locale-aware number formatting/parsing (Intl), EN microcopy.
- [ ] Debug build + end-to-end tests (typing, conversion, copy, pin, single instance).
- [ ] Size-optimized release build + measurements.
- [ ] README, screenshot, final review.

### Design notes

- Window: 424×684 logical, fixed, undecorated, custom titlebar with
  `data-tauri-drag-region`.
- Release profile: `opt-level="s"`, LTO, `panic="abort"`, stripped.
- Edge cases covered: empty input clears all fields, invalid characters filtered,
  negative values rejected, huge numbers shrink font, API failure → offline badge
  with last cached price, sparkline failure keeps previous curve, Ctrl+R guarded
  against webview reload, Escape clears.
