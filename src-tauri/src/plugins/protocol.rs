//! `nuza-plugin://localhost/<id>/<file>`: a plugin's code, styles and assets,
//! served only for a plugin that is installed and turned on in the vault of
//! the window asking - so a page can load what the person turned on, and
//! nothing else, from nowhere else.

use super::{manifest, store};
use crate::media::{media_status, requested_path};
use crate::state::{locked, Windows};
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::Manager;

pub(crate) const PLUGIN_PROTOCOL: &str = "nuza-plugin";

/// The most a single file served from a plugin may be.
const FILE_LIMIT: u64 = 10 * 1024 * 1024;

/// Answers one request for a plugin's file, or says why it will not.
pub(crate) fn serve_plugin_file(
    app_handle: &tauri::AppHandle,
    label: &str,
    request: &tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let vault = app_handle.state::<Windows>().vault(label);
    let Some(root) = locked(&vault.root).clone() else {
        return media_status(403);
    };
    if !app_handle
        .state::<super::trust::PluginTrust>()
        .allows(&root)
    {
        return media_status(403);
    }
    let path = match resolve(&root, &requested_path(request.uri())) {
        Ok(path) => path,
        Err(status) => return media_status(status),
    };

    let Ok(length) = fs::metadata(&path).map(|meta| meta.len()) else {
        return media_status(404);
    };
    if length > FILE_LIMIT {
        return media_status(413);
    }
    let Ok(body) = fs::read(&path) else {
        return media_status(404);
    };
    tauri::http::Response::builder()
        .status(200)
        .header("Content-Type", content_type(&path))
        // Every load asks again: the page adds the file's hash to the address,
        // so a plugin that has been updated is never served from memory.
        .header("Cache-Control", "no-store")
        .body(body)
        .unwrap_or_else(|_| media_status(500))
}

/// Where `requested` (`<id>/<file>`) is on disk, if it is a file the page may
/// have: one of a plugin's own, of a plugin that is turned on, in a vault
/// with community plugins on. Otherwise the status to answer with.
pub(crate) fn resolve(root: &Path, requested: &str) -> Result<PathBuf, u16> {
    let (id, file) = requested.split_once('/').ok_or(404u16)?;
    if !manifest::is_valid_id(id) || !is_servable(file) {
        return Err(404);
    }

    let config = store::read_config(root);
    if !config.community || !config.enabled.iter().any(|enabled| enabled == id) {
        return Err(403);
    }

    // The plugin's folder may itself be a link - a plugin being worked on,
    // linked in from where it is built - but nothing inside it may lead out.
    let folder = store::plugins_folder(root).join(id);
    let folder = folder.canonicalize().map_err(|_| 404u16)?;
    let path = folder.join(file).canonicalize().map_err(|_| 404u16)?;
    if !path.starts_with(&folder) || !path.is_file() {
        return Err(403);
    }
    Ok(path)
}

/// Whether `file` is something a plugin may serve: its code, its styles, or
/// a file under `assets/`, named plainly - no `..`, no absolute path. Its
/// `data.json` is not: that is its settings, read through a command.
fn is_servable(file: &str) -> bool {
    if file == "main.js" || file == "styles.css" {
        return true;
    }
    let Some(asset) = file.strip_prefix("assets/") else {
        return false;
    };
    !asset.is_empty()
        && Path::new(asset)
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
}

fn content_type(path: &Path) -> &'static str {
    let extension = path
        .extension()
        .map(|extension| extension.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        _ => "application/octet-stream",
    }
}
