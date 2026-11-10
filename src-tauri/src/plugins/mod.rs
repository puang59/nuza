//! Community plugins: finding the ones installed in a vault, and which of
//! them run. The page loads them; this decides what it is allowed to load.
//! See docs/plugins/.

pub(crate) mod dev;
pub(crate) mod manifest;
pub(crate) mod protocol;
pub(crate) mod store;
pub(crate) mod trust;

use crate::state::{locked, vault_of, Windows};
use crate::tasks::off_thread;
use serde::Serialize;
use std::path::PathBuf;
use store::{InstalledPlugin, PluginsConfig};
use tauri::{Emitter, Manager};
use trust::PluginTrust;

/// Told to the other windows on a vault when its plugins are changed in one.
pub(crate) const PLUGINS_CHANGED_EVENT: &str = "plugins-changed";

/// Told to the other windows on a vault when a plugin saves its data in one,
/// with the plugin's id.
pub(crate) const PLUGIN_DATA_CHANGED_EVENT: &str = "plugin-data-changed";

/// What the page needs to know to load a vault's plugins.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginsState {
    community: bool,
    /// Whether this machine has said the vault's plugins may run.
    trusted: bool,
    /// Started with `--no-plugins`: nothing runs in any window.
    no_plugins: bool,
    plugins: Vec<InstalledPlugin>,
}

/// The folder open in the window, or why there is nothing to do yet.
fn root_of(window: &tauri::WebviewWindow) -> Result<PathBuf, String> {
    let vault = vault_of(window);
    let root = locked(&vault.root).clone();
    root.ok_or_else(|| "Open a folder first".to_string())
}

/// The vault's folder, if plugins may run in it: trusted on this machine, and
/// not a run started with `--no-plugins`. Checked here as well as in the page,
/// so nothing a page gets wrong can run or reach an untrusted vault's plugins.
fn allowed_root(window: &tauri::WebviewWindow) -> Result<PathBuf, String> {
    let root = root_of(window)?;
    if !window.state::<PluginTrust>().allows(&root) {
        return Err("Plugins aren't allowed to run in this folder".to_string());
    }
    Ok(root)
}

/// Tells the other windows on the same folder that its plugins changed.
fn tell_others(window: &tauri::WebviewWindow, root: &std::path::Path) {
    let windows = window.state::<Windows>();
    for label in windows.others_on(root, window.label()) {
        let _ = window.emit_to(label.as_str(), PLUGINS_CHANGED_EVENT, ());
    }
}

/// The plugins installed in the window's vault, and whether community plugins
/// run there at all. A plugin that will not load is listed with why.
#[tauri::command]
pub(crate) async fn plugins_state(window: tauri::WebviewWindow) -> Result<PluginsState, String> {
    let root = root_of(&window)?;
    let app = window.app_handle().clone();
    off_thread(move || {
        let config = store::read_config(&root);
        let trust = app.state::<PluginTrust>();
        Ok(PluginsState {
            community: config.community,
            trusted: trust.is_trusted(&root),
            no_plugins: trust.no_plugins,
            plugins: store::installed(&root, &config),
        })
    })
    .await
}

/// Turns community plugins on or off for the window's vault. Turning them
/// on here is the person saying the vault's plugins may run, so it trusts it.
#[tauri::command]
pub(crate) async fn plugins_set_community(
    window: tauri::WebviewWindow,
    on: bool,
) -> Result<(), String> {
    let root = root_of(&window)?;
    let notify = window.clone();
    off_thread(move || {
        if on {
            notify.state::<PluginTrust>().trust(&root)?;
        }
        let config = PluginsConfig {
            community: on,
            ..store::read_config(&root)
        };
        store::write_config(&root, &config)?;
        tell_others(&notify, &root);
        Ok(())
    })
    .await
}

/// Lets the plugins turned on in the window's vault run on this machine.
#[tauri::command]
pub(crate) async fn plugins_trust_vault(window: tauri::WebviewWindow) -> Result<(), String> {
    let root = root_of(&window)?;
    let notify = window.clone();
    off_thread(move || {
        notify.state::<PluginTrust>().trust(&root)?;
        tell_others(&notify, &root);
        Ok(())
    })
    .await
}

/// Whether Shift is held as the window opens its vault, which opens it
/// without plugins.
#[tauri::command]
pub(crate) fn plugins_shift_held() -> bool {
    trust::shift_held()
}

/// Turns one plugin on or off for the window's vault. Turning one on trusts
/// the vault, as turning community plugins on does.
#[tauri::command]
pub(crate) async fn plugins_set_enabled(
    window: tauri::WebviewWindow,
    id: String,
    on: bool,
) -> Result<(), String> {
    if !manifest::is_valid_id(&id) {
        return Err(format!("\"{id}\" is not a plugin id"));
    }
    let root = root_of(&window)?;
    let notify = window.clone();
    off_thread(move || {
        // Turned on by the person, in this window: they are saying it may run.
        if on {
            notify.state::<PluginTrust>().trust(&root)?;
        }
        let mut config = store::read_config(&root);
        config.enabled.retain(|enabled| enabled != &id);
        if on {
            config.enabled.push(id);
        }
        store::write_config(&root, &config)?;
        tell_others(&notify, &root);
        Ok(())
    })
    .await
}

/// The most a plugin may keep in its data.json.
const DATA_LIMIT: u64 = 5 * 1024 * 1024;

/// What a plugin saved with `saveData`, as the JSON text it saved, or None if
/// it has saved nothing yet.
#[tauri::command]
pub(crate) async fn plugin_load_data(
    window: tauri::WebviewWindow,
    id: String,
) -> Result<Option<String>, String> {
    let file = data_file(&window, &id)?;
    off_thread(move || match store::read_limited(&file, DATA_LIMIT) {
        Ok(text) => Ok(Some(text)),
        Err(_) if !file.exists() => Ok(None),
        Err(error) => Err(error),
    })
    .await
}

/// Keeps a plugin's settings in its folder, written whole or not at all, and
/// tells the plugin in the vault's other windows.
#[tauri::command]
pub(crate) async fn plugin_save_data(
    window: tauri::WebviewWindow,
    id: String,
    data: String,
) -> Result<(), String> {
    if data.len() as u64 > DATA_LIMIT {
        return Err("A plugin's saved data can't be more than 5 MB".to_string());
    }
    serde_json::from_str::<serde_json::Value>(&data)
        .map_err(|e| format!("That isn't JSON: {e}"))?;
    let file = data_file(&window, &id)?;
    let root = root_of(&window)?;
    off_thread(move || {
        if !file.parent().is_some_and(|folder| folder.is_dir()) {
            return Err("That plugin isn't installed".to_string());
        }
        crate::files::write_atomically(&file, data.as_bytes())?;
        let windows = window.state::<Windows>();
        for label in windows.others_on(&root, window.label()) {
            let _ = window.emit_to(label.as_str(), PLUGIN_DATA_CHANGED_EVENT, &id);
        }
        Ok(())
    })
    .await
}

/// Where plugin `id` keeps its data in the window's vault.
fn data_file(window: &tauri::WebviewWindow, id: &str) -> Result<PathBuf, String> {
    if !manifest::is_valid_id(id) {
        return Err(format!("\"{id}\" is not a plugin id"));
    }
    Ok(store::plugins_folder(&allowed_root(window)?)
        .join(id)
        .join("data.json"))
}

/// Opens the vault's plugins folder in the file manager, making it if need be.
#[tauri::command]
pub(crate) async fn plugins_open_folder(window: tauri::WebviewWindow) -> Result<(), String> {
    let root = root_of(&window)?;
    off_thread(move || {
        let folder = store::plugins_folder(&root);
        std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        tauri_plugin_opener::open_path(&folder, None::<&str>).map_err(|e| e.to_string())
    })
    .await
}

#[cfg(test)]
mod tests;
