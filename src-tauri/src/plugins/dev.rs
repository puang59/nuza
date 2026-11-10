//! Plugins being worked on: a folder in `.nuza/plugins` that is a link to
//! where the plugin is built. Its window reloads it whenever its code or
//! styles are written again, so a change shows without a restart.

use super::{allowed_root, manifest, store};
use crate::state::{locked, vault_of};
use notify::{RecursiveMode, Watcher};
use std::path::Path;
use tauri::Emitter;

/// Told to the window when a linked plugin's code or styles are rebuilt.
pub(crate) const PLUGIN_REBUILT_EVENT: &str = "plugin-rebuilt";

/// The files whose change is a rebuild.
const BUILT: [&str; 2] = ["main.js", "styles.css"];

/// Whether `path` is one of a plugin's built files.
pub(crate) fn is_built(path: &Path) -> bool {
    path.file_name()
        .is_some_and(|name| BUILT.iter().any(|built| name == *built))
}

/// Starts or stops watching linked plugin `id` for rebuilds. Only a linked
/// one: an installed plugin changes when it is updated, which reloads it anyway.
#[tauri::command]
pub(crate) fn plugins_dev_watch(
    window: tauri::WebviewWindow,
    id: String,
    on: bool,
) -> Result<(), String> {
    if !manifest::is_valid_id(&id) {
        return Err(format!("\"{id}\" is not a plugin id"));
    }
    let vault = vault_of(&window);
    if !on {
        locked(&vault.dev_watchers).remove(&id);
        return Ok(());
    }

    let root = allowed_root(&window)?;
    let link = store::plugins_folder(&root).join(&id);
    if !link.is_symlink() {
        return Err(format!("{id} isn't linked"));
    }
    // Where it is built. The link itself does not change when what it points
    // to does, so that is what is watched.
    let folder = link.canonicalize().map_err(|e| e.to_string())?;

    let handle = window.clone();
    let rebuilt = id.clone();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return };
        if event.kind.is_access() || !event.paths.iter().any(|path| is_built(path)) {
            return;
        }
        let _ = handle.emit_to(handle.label(), PLUGIN_REBUILT_EVENT, &rebuilt);
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(&folder, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    locked(&vault.dev_watchers).insert(id, watcher);
    Ok(())
}
