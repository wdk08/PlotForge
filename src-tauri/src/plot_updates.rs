// Update metadata and verified installer bytes stay in the native process.
use serde_json::{json, Value};
use std::{sync::atomic::Ordering, time::Duration};
use tauri::{async_runtime::Mutex, AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

const DOWNLOAD_PATH: &str = "/wdk08/PlotForge/releases/download/";

#[derive(Default)]
pub struct Updates(Mutex<Pending>);

#[derive(Default)]
struct Pending {
    automatic_checked: bool,
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
    installed: bool,
}

fn enabled(app: &AppHandle) -> bool {
    !cfg!(debug_assertions)
        && cfg!(any(target_os = "macos", target_os = "windows"))
        && app.config().identifier == "com.plotforge.desktop"
}

#[tauri::command]
pub fn plot_update_info(app: AppHandle) -> Value {
    json!({
        "enabled": enabled(&app),
        "version": app.package_info().version.to_string(),
        "platform": std::env::consts::OS,
    })
}

#[tauri::command]
pub async fn plot_update_check(
    app: AppHandle,
    state: State<'_, Updates>,
    automatic: bool,
) -> Result<Value, String> {
    if !enabled(&app) {
        return Err("Updates are available in the distributed desktop app.".into());
    }
    let mut pending = state.0.lock().await;
    if pending.update.is_none() && !(automatic && pending.automatic_checked) {
        pending.automatic_checked = true;
        let update = app
            .updater_builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|error| error.to_string())?
            .check()
            .await
            .map_err(|error| error.to_string())?;
        if let Some(update) = &update {
            let url = &update.download_url;
            let prefix = format!("{DOWNLOAD_PATH}v{}/", update.version);
            if url.scheme() != "https"
                || url.host_str() != Some("github.com")
                || url.port().is_some()
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
                || !url.path().starts_with(&prefix)
                || update.signature.trim().is_empty()
            {
                return Err(
                    "The release references an unexpected installer or has no signature.".into(),
                );
            }
        }
        pending.update = update;
    }
    Ok(pending
        .update
        .as_ref()
        .map_or(Value::Null, |update| json!({
            "version": update.version,
            "notes": update.body,
            "phase": if pending.installed { "installed" } else if pending.bytes.is_some() { "downloaded" } else { "available" }
        })))
}

#[tauri::command]
pub async fn plot_update_download(app: AppHandle, state: State<'_, Updates>) -> Result<(), String> {
    let mut pending = state.0.lock().await;
    if pending.installed || pending.bytes.is_some() {
        return Ok(());
    }
    let update = pending
        .update
        .as_ref()
        .ok_or("Check for an update first.")?;
    let mut downloaded = 0u64;
    let bytes = update
        .download(
            |chunk, total| {
                downloaded = downloaded.saturating_add(chunk as u64);
                let _ = app.emit(
                    "plotforge-update-progress",
                    json!({ "downloaded": downloaded, "total": total }),
                );
            },
            || {},
        )
        .await
        .map_err(|error| error.to_string())?;
    pending.bytes = Some(bytes);
    Ok(())
}

#[tauri::command]
pub async fn plot_update_install(app: AppHandle, state: State<'_, Updates>) -> Result<(), String> {
    let mut pending = state.0.lock().await;
    if pending.installed {
        return Ok(());
    }
    let update = pending
        .update
        .as_ref()
        .ok_or("Check for an update first.")?
        .clone();
    let bytes = pending
        .bytes
        .take()
        .ok_or("Download and verify the update first.")?;
    // The webview holds a modal and flushes project storage before invoking install.
    let desktop = app.state::<super::DesktopState>();
    desktop.closing.store(true, Ordering::SeqCst);
    let result = tauri::async_runtime::spawn_blocking(move || {
        let result = update.install(&bytes);
        (bytes, result)
    })
    .await;
    desktop.closing.store(false, Ordering::SeqCst);
    let (bytes, result) = result.map_err(|error| error.to_string())?;
    if let Err(error) = result {
        pending.bytes = Some(bytes);
        return Err(error.to_string());
    }
    pending.installed = true;
    Ok(())
}

#[tauri::command]
pub async fn plot_update_restart(app: AppHandle, state: State<'_, Updates>) -> Result<(), String> {
    if !state.0.lock().await.installed {
        return Err("No installed update is ready for a restart.".into());
    }
    app.state::<super::DesktopState>()
        .closing
        .store(true, Ordering::SeqCst);
    app.restart();
}

pub fn menu(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind};
    let menu = Menu::default(app)?;
    for item in menu.items()? {
        if let MenuItemKind::Submenu(submenu) = item {
            if submenu.text()? == "Help" {
                submenu.append(&MenuItem::with_id(
                    app,
                    "plotforge-check",
                    "Check for Updates",
                    true,
                    None::<&str>,
                )?)?;
                submenu.append(&MenuItem::with_id(
                    app,
                    "plotforge-about",
                    "About PlotForge",
                    true,
                    None::<&str>,
                )?)?;
            }
            #[cfg(target_os = "macos")]
            if submenu.text()? == app.package_info().name {
                submenu.remove_at(0)?;
                submenu.insert(
                    &MenuItem::with_id(
                        app,
                        "plotforge-app-about",
                        "About PlotForge",
                        true,
                        None::<&str>,
                    )?,
                    0,
                )?;
            }
        }
    }
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let action = match event.id().as_ref() {
            "plotforge-check" => "check",
            "plotforge-about" | "plotforge-app-about" => "about",
            _ => return,
        };
        let _ = app.emit("plotforge-help", action);
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };
    // Public throwaway signature vector from tauri-plugin-updater 2.14.0 offline_tests.
    // No private key is used or embedded. Payload: `test`, signed version: 2.0.0.
    const KEY:&str="untrusted comment: minisign public key: A49EF4746FA6E6D7\nRWTX5qZvdPSepDGWg2bz8n6ArQnBMwgQK1geVosorcbLzcunD+KJ+cYe";
    const SIG:&str="untrusted comment: signature from tauri secret key\nRUTX5qZvdPSepPF2zsjvP/L/TQtBLRnWRvaq+4omK1UEugtQp/USrGiI1v762sDy3id3aor7bRC9ETyeot6lMHHrWoZ5hjUM1Qc=\ntrusted comment: timestamp:1791649051\tfile:payload\tversion:2.0.0\nDDq2CLOEl5cQmC2eJRHlnZPVViOZsu1CjpPKQoei4A/XBfkDqGO0B+QMrcrHgEQ5qV3mne75tdFWhJpqUXh9AA==";
    fn app() -> tauri::App<tauri::test::MockRuntime> {
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().plugins.0.insert("updater".into(),json!({"pubkey":STANDARD.encode(KEY),"endpoints":["https://example.invalid/update"],"requireSignedVersion":true,"dangerousInsecureTransportProtocol":true}));
        tauri::test::mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(context)
            .unwrap()
    }
    fn metadata(url: &str) -> Value {
        json!({"version":"2.0.0","notes":"Test release notes","pub_date":"2026-10-19T00:00:00Z","platforms":{"test-target":{"url":url,"signature":STANDARD.encode(SIG)}}})
    }
    #[test]
    fn official_plugin_checks_signed_payload_version_and_rejects_tampering() {
        let app = app();
        let updater = app.updater_builder().target("test-target").build().unwrap();
        let update = updater
            .restore_update(metadata("https://example.invalid/payload"))
            .unwrap()
            .unwrap();
        update.verify(b"test").unwrap();
        assert!(update.verify(b"tampered").is_err());
        let mut mismatched = metadata("https://example.invalid/payload");
        mismatched["version"] = json!("3.0.0");
        assert!(updater
            .restore_update(mismatched)
            .unwrap()
            .unwrap()
            .verify(b"test")
            .is_err());
        let mut missing = metadata("https://example.invalid/payload");
        missing["platforms"]["test-target"]["signature"] = json!("");
        assert!(updater
            .restore_update(missing)
            .unwrap()
            .unwrap()
            .verify(b"test")
            .is_err());
        assert!(updater.restore_update(json!({"version":"bad"})).is_err());
        let mut older = metadata("https://example.invalid/payload");
        older["version"] = json!("0.0.0");
        assert!(updater.restore_update(older).unwrap().is_none());
    }
    #[test]
    fn official_check_download_progress_and_signature_verification_over_test_transport() {
        for payload in [b"test".as_slice(), b"tampered".as_slice()] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let base = format!("http://{}", listener.local_addr().unwrap());
            let manifest = metadata(&format!("{base}/payload"))
                .to_string()
                .into_bytes();
            let data = payload.to_vec();
            let server = thread::spawn(move || {
                for body in [manifest, data] {
                    let (mut socket, _) = listener.accept().unwrap();
                    let mut request = [0; 8192];
                    let _ = socket.read(&mut request);
                    write!(
                        socket,
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    )
                    .unwrap();
                    socket.write_all(&body).unwrap();
                }
            });
            let app = app();
            let updater = app
                .updater_builder()
                .target("test-target")
                .timeout(std::time::Duration::from_secs(3))
                .no_proxy()
                .endpoints(vec![format!("{base}/latest").parse().unwrap()])
                .unwrap()
                .build()
                .unwrap();
            tauri::async_runtime::block_on(async {
                let update = updater.check().await.unwrap().unwrap();
                assert_eq!(update.body.as_deref(), Some("Test release notes"));
                let mut downloaded = 0;
                let bytes = update
                    .download(
                        |chunk, total| {
                            downloaded += chunk;
                            assert_eq!(total, Some(payload.len() as u64));
                        },
                        || {},
                    )
                    .await;
                if payload == b"test" {
                    assert_eq!(bytes.unwrap(), b"test");
                } else {
                    assert!(bytes.is_err());
                }
                assert_eq!(downloaded, payload.len());
            });
            server.join().unwrap();
        }
    }
}
