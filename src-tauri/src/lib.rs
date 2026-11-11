#[cfg(feature = "native-smoke")]
mod native_smoke;
mod plot_storage;
mod plot_updates;

use plot_storage::{storage_root, text, Failure, Result, Store};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    Emitter, Manager,
};
use tauri_plugin_dialog::DialogExt;

struct DesktopState {
    store: Store,
    closing: AtomicBool,
    #[cfg(feature = "native-smoke")]
    smoke: Option<std::path::PathBuf>,
}

#[tauri::command]
async fn plot_storage(
    app: tauri::AppHandle,
    state: tauri::State<'_, DesktopState>,
    action: String,
    body: Value,
) -> Result<Value> {
    #[cfg(feature = "native-smoke")]
    if action == "smokeResult" {
        if let Some(root) = &state.smoke {
            let success = body["success"] == true;
            std::fs::write(root.join("report.json"), serde_json::to_vec_pretty(&body)?)?;
            state.closing.store(true, Ordering::SeqCst);
            app.exit(if success { 0 } else { 1 });
            return Ok(Value::Null);
        }
    }
    if action != "beginExport" {
        return state.store.run(&action, &body);
    }
    let name = text(&body, "name")?;
    let extension = name
        .rsplit_once('.')
        .map(|(_, ext)| ext)
        .unwrap_or_default();
    if name.contains(['/', '\\']) || !matches!(extension, "plf" | "pdf" | "png") {
        return Err(Failure::new("StorageError", "Invalid export filename."));
    }
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Export PlotForge copy")
        .set_file_name(name)
        .add_filter("PlotForge export", &[extension]);
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }
    let path = dialog
        .blocking_save_file()
        .ok_or_else(|| Failure::new("AbortError", "Export cancelled."))?
        .into_path()
        .map_err(|error| Failure::new("StorageError", error.to_string()))?;
    state
        .store
        .start_export(path, body["size"].as_u64().unwrap_or(0))
}

#[tauri::command]
fn plot_chunk(request: Request<'_>, state: tauri::State<'_, DesktopState>) -> Result<()> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(Failure::new("StorageError", "Expected binary upload data."));
    };
    let token = request
        .headers()
        .get("x-plotforge-upload")
        .and_then(|token| token.to_str().ok())
        .ok_or_else(|| Failure::new("StorageError", "Missing upload session."))?;
    state.store.chunk(token, bytes)
}

#[tauri::command]
async fn plot_asset_chunk(
    state: tauri::State<'_, DesktopState>,
    id: String,
    offset: u64,
    length: usize,
) -> Result<Response> {
    Ok(Response::new(state.store.asset_chunk(&id, offset, length)?))
}

#[tauri::command]
fn desktop_close(app: tauri::AppHandle, state: tauri::State<'_, DesktopState>) {
    state.closing.store(true, Ordering::SeqCst);
    app.exit(0);
}

pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(feature = "native-smoke")]
    let builder = builder.on_page_load(native_smoke::run_page);
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(plot_updates::Updates::default())
        .setup(|app| {
            let root = storage_root(&app.path().app_data_dir()?, cfg!(debug_assertions));
            #[cfg(feature = "native-smoke")]
            let smoke = native_smoke::directory()?;
            #[cfg(feature = "native-smoke")]
            let root = smoke
                .as_ref()
                .map(|path| path.join("app-data"))
                .unwrap_or(root);
            let store = Store::new(root).map_err(|error| error.message)?;
            app.manage(DesktopState {
                store,
                closing: AtomicBool::new(false),
                #[cfg(feature = "native-smoke")]
                smoke,
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if !window
                    .state::<DesktopState>()
                    .closing
                    .load(Ordering::SeqCst)
                {
                    api.prevent_close();
                    let _ = window.emit("plotforge-close-requested", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            plot_storage,
            plot_chunk,
            plot_asset_chunk,
            desktop_close,
            plot_updates::plot_update_info,
            plot_updates::plot_update_check,
            plot_updates::plot_update_download,
            plot_updates::plot_update_install,
            plot_updates::plot_update_restart
        ])
        .build(tauri::generate_context!())
        .expect("PlotForge could not start")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !app.state::<DesktopState>().closing.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    let _ = app.emit("plotforge-close-requested", ());
                }
            }
        });
}
