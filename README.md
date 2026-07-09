<p align="center">
  <img src="assets/logo.png" alt="SatConverter" width="90">
</p>

<h1 align="center">SatConverter</h1>

<p align="center">
  Instant sats · BTC · EUR · USD conversions, with live Bitcoin prices.<br>
  A single 3 MB portable executable — Rust + Tauri, no runtime dependencies.
</p>

<p align="center">
  <img src="docs/screenshot.png" alt="SatConverter screenshot" width="380">
</p>

## Features

- Type in any field — the three others update instantly
- Live price, 24h change and sparkline, refreshed every minute
- One-click copy, quick EUR presets, always-on-top pin
- Works offline with the last known price
- Remembers its window position · single instance
- Number formats follow your system locale

## Build

Requires [Rust](https://rustup.rs/) (MSVC) and the WebView2 runtime (preinstalled on Windows 10/11).

```powershell
cd src-tauri
cargo run              # development
cargo build --release  # → target/release/satconverter.exe
```

The frontend (`ui/`) is plain HTML/CSS/JS — no Node, no build step.

## License

[Unlicense](LICENSE) — public domain.

Price data provided by [CoinGecko](https://www.coingecko.com/en/api).
