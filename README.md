<p align="center">
  <img src="assets/logo.png" alt="SatConverter" width="90">
</p>

<h1 align="center">SatConverter</h1>

<p align="center">
  Converts sats, BTC, EUR and USD instantly, with live Bitcoin prices.<br>
  A single 3 MB portable executable, built with Rust and Tauri, no runtime dependencies.
</p>

<p align="center">
  <img src="assets/screenshot.png" alt="SatConverter, dark and light themes" width="720">
</p>

## Download

Grab the latest installer from the [Releases](https://github.com/LoicPandul/SatConverter/releases) page. These builds are not signed (code signing certificates cost money and add nothing to the code), so your OS will warn you on first launch:

| Platform | File | First launch |
|---|---|---|
| Windows | `*-setup.exe` or `.msi` | SmartScreen warns: click "More info", then "Run anyway" |
| macOS | `.dmg` | Right-click the app, then "Open" |
| Linux | `.AppImage` (portable), `.deb` or `.rpm` | Nothing special, `chmod +x` the AppImage |

## Features

- Type in any field: the 3 others update instantly
- Live price, 24h change and sparkline, refreshed every minute
- Copy any value in a click, pin the window always on top
- Dark and light themes, your choice is persisted
- Works offline with the last known price
- Remembers its window position, runs as a single instance
- Number formats follow your system locale

## Build from source

Requires [Rust](https://rustup.rs/).

```powershell
cd src-tauri
cargo run              # development
cargo build --release  # target/release/satconverter(.exe)
```

The frontend (`ui/`) is plain HTML, CSS and JavaScript: no Node, no build step.

## License

Released into the public domain under the [Unlicense](LICENSE).

Price data provided by [CoinGecko](https://www.coingecko.com/en/api).
