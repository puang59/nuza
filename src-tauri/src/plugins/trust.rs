//! Which vaults may run their plugins on this machine. Kept in the app's own
//! data folder, never in a vault, so a vault someone shares cannot vouch for
//! itself: it can arrive with plugins turned on, and none of them runs until
//! they are allowed here.
//!
//! ```text
//! <app data>/trusted-vaults.json    { "/Users/me/notes": { "trustedAt": 1762732800 } }
//! ```

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// The flag that starts every window of this run without plugins.
pub(crate) const NO_PLUGINS_FLAG: &str = "--no-plugins";

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Trusted {
    /// When, in seconds since 1970.
    trusted_at: u64,
}

/// The trusted vaults, and whether this run is to load plugins at all.
pub(crate) struct PluginTrust {
    /// None when the app has no data folder, which trusts nothing.
    file: Option<PathBuf>,
    /// Started with `--no-plugins`.
    pub(crate) no_plugins: bool,
    /// One change to the file at a time.
    writing: Mutex<()>,
}

impl PluginTrust {
    pub(crate) fn new(app_data: Option<&Path>, no_plugins: bool) -> Self {
        Self {
            file: app_data.map(|dir| dir.join("trusted-vaults.json")),
            no_plugins,
            writing: Mutex::new(()),
        }
    }

    fn read(&self) -> BTreeMap<String, Trusted> {
        self.file
            .as_ref()
            .and_then(|file| fs::read_to_string(file).ok())
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    /// Whether the vault at `root` was trusted here. Moving or renaming the
    /// folder asks again, which is the safe way round.
    pub(crate) fn is_trusted(&self, root: &Path) -> bool {
        key(root).is_some_and(|key| self.read().contains_key(&key))
    }

    /// Whether plugins may run in `root` in this run.
    pub(crate) fn allows(&self, root: &Path) -> bool {
        !self.no_plugins && self.is_trusted(root)
    }

    pub(crate) fn trust(&self, root: &Path) -> Result<(), String> {
        let file = self
            .file
            .as_ref()
            .ok_or("There is nowhere to keep which folders are trusted")?;
        let key = key(root).ok_or("That folder isn't there")?;
        let _writing = crate::state::locked(&self.writing);
        let mut trusted = self.read();
        if trusted.contains_key(&key) {
            return Ok(());
        }
        let trusted_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |since| since.as_secs());
        trusted.insert(key, Trusted { trusted_at });
        if let Some(folder) = file.parent() {
            fs::create_dir_all(folder).map_err(|e| e.to_string())?;
        }
        let mut text = serde_json::to_string_pretty(&trusted).map_err(|e| e.to_string())?;
        text.push('\n');
        crate::files::write_atomically(file, text.as_bytes())
    }
}

/// The folder as it is on disk, links followed, so one folder reached two
/// ways is trusted once.
fn key(root: &Path) -> Option<String> {
    root.canonicalize()
        .ok()
        .map(|path| path.to_string_lossy().into_owned())
}

/// Whether Shift is held down right now, which opens a vault without its
/// plugins. Only macOS can say before the window has a key event to read.
#[cfg(target_os = "macos")]
pub(crate) fn shift_held() -> bool {
    use objc2_app_kit::{NSEvent, NSEventModifierFlags};
    NSEvent::modifierFlags_class().contains(NSEventModifierFlags::Shift)
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn shift_held() -> bool {
    false
}
