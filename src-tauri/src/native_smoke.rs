// Compiled only into the opt-in native smoke harness.
use std::{env, path::PathBuf};
use tauri::{webview::PageLoadEvent, Manager};

pub fn directory() -> std::io::Result<Option<PathBuf>> {
    let Some(root) = env::var_os("PLOTFORGE_NATIVE_SMOKE_DIR") else {
        return Ok(None);
    };
    let root = PathBuf::from(root).canonicalize()?;
    if root.parent() != Some(env::temp_dir().canonicalize()?.as_path())
        || !root.file_name().is_some_and(|name| {
            name.to_string_lossy()
                .starts_with("plotforge-native-smoke-")
        })
    {
        return Err(std::io::Error::other(
            "The smoke test requires an isolated temporary directory.",
        ));
    }
    Ok(Some(root))
}

pub fn run_page(
    webview: &tauri::Webview<tauri::Wry>,
    payload: &tauri::webview::PageLoadPayload<'_>,
) {
    if payload.event() == PageLoadEvent::Finished
        && webview
            .try_state::<super::DesktopState>()
            .is_some_and(|state| state.smoke.is_some())
    {
        let _ = webview.eval(include_str!("../../scripts/plot/native-smoke.js"));
    }
}
