// SatConverter — sats / BTC / EUR / USD desktop converter.
//
// The Rust side stays deliberately thin: window shell, OS clipboard,
// single-instance lock and window-position persistence. Everything else
// (conversion logic, price fetching, rendering) lives in the webview,
// which keeps the binary small and the UI instant.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri_plugin_window_state::StateFlags;

/// Copy machine-readable values (dot decimal, no grouping) to the OS clipboard.
#[tauri::command]
fn copy_text(text: String) -> Result<(), String> {
    arboard::Clipboard::new()
        .and_then(|mut clipboard| clipboard.set_text(text))
        .map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        // Single instance: relaunching focuses the existing window instead
        // of spawning a duplicate. Must be the first registered plugin.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        // Remember window position between sessions (position only: the
        // window is fixed-size). The plugin clamps to visible monitors.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::POSITION)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![copy_text])
        .run(tauri::generate_context!())
        .expect("failed to run SatConverter");
}
