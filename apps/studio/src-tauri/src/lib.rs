/// OneTaxonomy desktop: file dialogs and file access for the files the user picks,
/// settings storage, printing, and updates from our GitHub releases (user can turn them off).

/// The system print dialog for the window (the web view's own `window.print()` does nothing on macOS).
#[tauri::command]
fn print_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![print_window])
        .run(tauri::generate_context!())
        .expect("error while running OneTaxonomy");
}
