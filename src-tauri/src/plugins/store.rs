//! Where plugins live in a vault, and which of them are turned on:
//!
//! ```text
//! <vault>/.nuza/plugins.json        { "community": true, "enabled": ["word-goal"] }
//! <vault>/.nuza/plugins/<id>/       manifest.json, main.js, styles.css, data.json
//! ```

use super::manifest::{self, PluginManifest, MANIFEST_LIMIT};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

/// The app's own folder in a vault. Hidden from the sidebar and the index,
/// like every folder whose name starts with a dot.
pub(crate) const APP_FOLDER: &str = ".nuza";

/// Folders an install is being written to, before it is moved into place.
const STAGING_PREFIX: &str = ".staging-";

/// Which plugins a vault runs.
#[derive(Deserialize, Serialize, Default, Clone, Debug, PartialEq)]
pub(crate) struct PluginsConfig {
    /// Whether community plugins run in this vault at all.
    #[serde(default)]
    pub(crate) community: bool,
    /// The ids of the plugins turned on, in the order they were.
    #[serde(default)]
    pub(crate) enabled: Vec<String>,
}

/// A plugin found in the vault, and whether it will load.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstalledPlugin {
    /// The folder's name, which is its id.
    pub(crate) id: String,
    /// None when there is no manifest that can be read.
    pub(crate) manifest: Option<PluginManifest>,
    pub(crate) enabled: bool,
    pub(crate) has_styles: bool,
    /// The start of main.js's SHA-256, so the page fetches a new copy after an update.
    pub(crate) hash: String,
    /// Why it will not load, if it will not.
    pub(crate) problem: Option<String>,
    /// Whether the folder is a link to somewhere else - a plugin being worked on.
    pub(crate) linked: bool,
}

pub(crate) fn app_folder(root: &Path) -> PathBuf {
    root.join(APP_FOLDER)
}

pub(crate) fn plugins_folder(root: &Path) -> PathBuf {
    app_folder(root).join("plugins")
}

fn config_path(root: &Path) -> PathBuf {
    app_folder(root).join("plugins.json")
}

/// The vault's plugin settings: everything off when there are none, or none
/// that can be read - a broken file runs nothing rather than guessing.
pub(crate) fn read_config(root: &Path) -> PluginsConfig {
    fs::read_to_string(config_path(root))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub(crate) fn write_config(root: &Path, config: &PluginsConfig) -> Result<(), String> {
    fs::create_dir_all(app_folder(root)).map_err(|e| e.to_string())?;
    let mut text = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    text.push('\n');
    crate::files::write_atomically(&config_path(root), text.as_bytes())
}

/// Every plugin folder in the vault, read and checked, by name. Installs that
/// were cut short are cleared away on the way.
pub(crate) fn installed(root: &Path, config: &PluginsConfig) -> Vec<InstalledPlugin> {
    let folder = plugins_folder(root);
    let Ok(entries) = fs::read_dir(&folder) else {
        return Vec::new();
    };

    let mut found: Vec<InstalledPlugin> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with(STAGING_PREFIX) {
                let _ = fs::remove_dir_all(entry.path());
                return None;
            }
            if name.starts_with('.') {
                return None;
            }
            let path = entry.path();
            let linked =
                fs::symlink_metadata(&path).is_ok_and(|meta| meta.file_type().is_symlink());
            path.is_dir()
                .then(|| read_plugin(&path, &name, linked, config))
        })
        .collect();

    found.sort_by(|a, b| {
        display_name(a)
            .to_lowercase()
            .cmp(&display_name(b).to_lowercase())
    });
    found
}

fn display_name(plugin: &InstalledPlugin) -> &str {
    plugin
        .manifest
        .as_ref()
        .map_or(&plugin.id, |manifest| &manifest.name)
}

fn read_plugin(folder: &Path, id: &str, linked: bool, config: &PluginsConfig) -> InstalledPlugin {
    let mut plugin = InstalledPlugin {
        id: id.to_string(),
        manifest: None,
        enabled: config.enabled.iter().any(|enabled| enabled == id),
        has_styles: folder.join("styles.css").is_file(),
        hash: String::new(),
        problem: None,
        linked,
    };

    match read_limited(&folder.join("manifest.json"), MANIFEST_LIMIT) {
        Err(_) => plugin.problem = Some("It has no manifest.json".to_string()),
        Ok(text) => match manifest::parse(&text) {
            Err(problem) => plugin.problem = Some(problem),
            Ok(manifest) => {
                plugin.problem = manifest::problem(&manifest, id);
                plugin.manifest = Some(manifest);
            }
        },
    }

    match hash_of(&folder.join("main.js")) {
        Some(hash) => plugin.hash = hash,
        None => {
            plugin
                .problem
                .get_or_insert_with(|| "It has no main.js".to_string());
        }
    }
    plugin
}

/// A file's text, refusing one longer than `limit` bytes.
pub(crate) fn read_limited(path: &Path, limit: u64) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut text = String::new();
    file.take(limit + 1)
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    if text.len() as u64 > limit {
        return Err(format!("{} is too big", path.display()));
    }
    Ok(text)
}

/// The first 12 hex characters of a file's SHA-256.
fn hash_of(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    let digest = Sha256::digest(&bytes);
    Some(
        digest
            .iter()
            .take(6)
            .map(|byte| format!("{byte:02x}"))
            .collect(),
    )
}
