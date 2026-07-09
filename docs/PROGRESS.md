# Progress log

Development log for the Rust + Tauri port of SatConverter.

## 2026-07-09 — v1.0.0 port · DONE

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
- [x] End-to-end tests — **29/29 PASS**, run against debug AND release builds,
      driven through the WebView2 DevTools Protocol (real DOM events, real Tauri
      IPC, real OS effects — no synthetic desktop input):
      - live price + sparkline + 24h chip rendering
      - conversions both directions (EUR→sats/BTC/USD, sats→BTC/EUR), invariants
      - source rail, clear cascade, invalid input filtering, Escape
      - preset click, copy → real OS clipboard through Rust (`500.00`)
      - pin → real `WS_EX_TOPMOST` toggled + persisted
      - offline simulation (fetch sabotaged) → badge + cached price kept
      - minimize/restore (`IsIconic`), single instance (second process exits,
        first window refocused), clean close, position remembered exactly
- [x] Release build measurements (Windows 11, x64):
      - **binary: 3.13 MB** (assets + fonts embedded, single portable exe)
      - **startup: ~440 ms** to visible window
      - **RAM: ~28 MB** app process (+ shared WebView2 runtime)
- [x] README, screenshot, license (Unlicense).

### Design notes

- Window: 424×640 logical, fixed, undecorated, custom titlebar with
  `data-tauri-drag-region`.
- Release profile: `opt-level="s"`, LTO, `panic="abort"`, stripped.
- Strict CSP — no inline styles/scripts (copy-icon swap driven by CSS classes),
  `connect-src` limited to the CoinGecko API, self-hosted fonts.
- Edge cases covered: empty input clears all fields, invalid characters filtered,
  negative values rejected, huge numbers shrink font, API failure → offline badge
  with last cached price, sparkline failure keeps previous curve, Ctrl+R guarded
  against webview reload, Escape clears, off-screen saved position clamped back
  by the window-state plugin.

### Possible future work

- CI (GitHub Actions) building the release exe + NSIS installer per tag.
- Configurable fiat pairs beyond EUR/USD.
- Linux/macOS builds (the code is portable; only tested on Windows so far).

## 2026-07-09 — v1.0.1 polish

- Crisp rounded icons (per-size resize + sharpen from the 1254 px source).
- SATS/BTC units in brand orange; neutral source rail; currency symbols (satsymbol, B, EUR, USD) right of each value.
- CoinGecko free-tier attribution made compliant: prominent hyperlinked "Data provided by CoinGecko" in the footer (opener plugin, URL-scoped permission) + README credit.
- Auto-refresh 2 min -> 1 min.
- Simplified README; rounded logo + screenshot.
- Full E2E regression re-run on release: ALL PASS. Binary 3.24 MB.
