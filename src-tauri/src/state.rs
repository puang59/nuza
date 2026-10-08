use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;
use tauri::Manager;

/// What the app is allowed to touch: the folder that is open, and whatever the
/// user has pointed at directly through a save dialog.
///
/// Every filesystem command here takes a path from the frontend, and a note is
/// text from disk that a sync client, a collaborator or a generator could have
/// written. Without something in the way, the distance between a malformed note
/// rendering wrong and `delete_entry` being handed someone's home directory is
/// one bug in the markdown sanitiser. The asset protocol has been scoped to the
/// open folder since it was added, for exactly this reason; this is the rest of
/// it.
#[derive(Default)]
pub(crate) struct Vault {
    /// The open folder, resolved. Nothing is allowed before one is opened.
    pub(crate) root: Mutex<Option<PathBuf>>,
    /// Files outside it the user chose in a native dialog, which is consent -
    /// a scratch note saved to the desktop still has to be saved again.
    pub(crate) chosen: Mutex<HashSet<PathBuf>>,
    /// When each note the app has read was last written, as the filesystem
    /// sees it. This is what tells an edit made somewhere else apart from the
    /// app's own saves, in both directions: a write whose file has moved on is
    /// refused, and a change that is only the app's own is not announced.
    pub(crate) known: Mutex<HashMap<PathBuf, SystemTime>>,
    /// Kept alive for as long as its folder is open - dropping a watcher is
    /// how notify stops watching, so replacing this is how switching vaults
    /// stops listening to the old one.
    pub(crate) watcher: Mutex<Option<notify::RecommendedWatcher>>,
    /// Every file in the folder, and the text of the notes, kept current as
    /// the folder changes - what search, quick-open and the scans read.
    pub(crate) index: Arc<crate::index::VaultIndex>,
}

/// Every window's vault, by the window's label.
///
/// A vault is the state of one open folder, so each window gets its own: two
/// windows on two folders must not be able to see, or re-root, each other's.
/// An entry is made the first time a window asks, and starts out with nothing
/// open - which is what makes every filesystem command refuse until that
/// window has opened a folder of its own.
#[derive(Default)]
pub(crate) struct Windows(Mutex<HashMap<String, Arc<Vault>>>);

impl Windows {
    /// The vault of the window called `label`, made if it has none yet.
    pub(crate) fn vault(&self, label: &str) -> Arc<Vault> {
        locked(&self.0)
            .entry(label.to_string())
            .or_default()
            .clone()
    }

    /// The folder open in the window called `label`, if it has one. Unlike
    /// `vault`, this does not make an entry for a window that has none.
    pub(crate) fn root(&self, label: &str) -> Option<PathBuf> {
        let vault = locked(&self.0).get(label).cloned()?;
        let root = locked(&vault.root).clone();
        root
    }

    /// Forgets a window that has closed, which drops its watcher with it.
    pub(crate) fn remove(&self, label: &str) {
        locked(&self.0).remove(label);
    }
}

/// The vault of the window a command was called from.
pub(crate) fn vault_of<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> Arc<Vault> {
    window.state::<Windows>().vault(window.label())
}

/// What `write_file` says when the note it was asked to write has moved on
/// since it was read. The frontend matches on this to tell a conflict apart
/// from a disk that is full or a file that has gone read-only.
pub(crate) const CHANGED_ON_DISK: &str = "The note changed on disk";

pub(crate) fn modified_at(path: &Path) -> Option<SystemTime> {
    fs::metadata(path).and_then(|data| data.modified()).ok()
}

/// Records where a note stands now, after reading or writing it.
pub(crate) fn remember(vault: &Vault, path: &Path) {
    if let Some(at) = modified_at(path) {
        locked(&vault.known).insert(path.to_path_buf(), at);
    }
}

/// Carries what is known about `from` across to `to`, after a rename or a move:
/// the note itself, and for a folder every note that was read from inside it.
///
/// Without this the note at its new path is one the app has "never read", and a
/// note never read is never out of date - so a change made to it elsewhere
/// would not be noticed, and the next save from here would go over the top of
/// it. The time recorded is the one from the read, not a fresh one: a rename
/// does not move it, and taking it again would wave through a change that
/// arrived just before the rename did.
pub(crate) fn follow_move(vault: &Vault, from: &Path, to: &Path) {
    let mut known = locked(&vault.known);
    let moved: Vec<PathBuf> = known
        .keys()
        .filter(|path| path.starts_with(from))
        .cloned()
        .collect();

    for path in moved {
        let Some(recorded) = known.remove(&path) else {
            continue;
        };
        let landed = match path.strip_prefix(from) {
            Ok(rest) if !rest.as_os_str().is_empty() => to.join(rest),
            _ => to.to_path_buf(),
        };
        known.insert(landed, recorded);
    }
}

/// The paths out of `paths` that are files inside the vault right now, in the
/// order they were given.
pub(crate) fn files_present(vault: &Vault, paths: Vec<String>) -> Vec<String> {
    paths
        .into_iter()
        .filter(|path| within_vault(vault, Path::new(path)).is_ok_and(|found| found.is_file()))
        .collect()
}

/// Whether `path` has moved on since the app last read or wrote it.
///
/// A note the app has never read is not "changed" - there is nothing to be
/// out of date with, and nothing on screen that could be overwritten.
pub(crate) fn changed_since_read(vault: &Vault, path: &Path) -> bool {
    let Some(recorded) = locked(&vault.known).get(path).copied() else {
        return false;
    };
    // Gone, or no longer readable, counts: either way what the app holds is
    // no longer what is there.
    modified_at(path) != Some(recorded)
}

/// A lock, with a poisoned one read anyway: the data behind it is a path and a
/// set of paths, and a panic elsewhere leaves both perfectly readable.
pub(crate) fn locked<T>(lock: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// `resolved` itself, if it is somewhere the app is allowed to be.
pub(crate) fn allow(vault: &Vault, resolved: PathBuf) -> Result<PathBuf, String> {
    let inside = match locked(&vault.root).as_ref() {
        Some(root) => resolved.starts_with(root),
        None => false,
    };

    if inside || locked(&vault.chosen).contains(&resolved) {
        Ok(resolved)
    } else {
        Err("That is outside the open folder".to_string())
    }
}

/// `path`, resolved, if it is inside the open folder.
///
/// Resolved rather than compared as text: `..` and a symlink pointing out of
/// the vault both read as vault paths right up until the OS has had its say.
pub(crate) fn within_vault(vault: &Vault, path: &Path) -> Result<PathBuf, String> {
    let resolved = path.canonicalize().map_err(|e| e.to_string())?;
    allow(vault, resolved)
}

/// A note on its way back to disk: resolved outright when it is there, and
/// through its parent when it is not, so a note deleted from under the app is
/// still one the app may write back. Anything that *is* there - a dangling
/// symlink included - goes the strict way and has to resolve into the vault.
pub(crate) fn within_vault_to_write(vault: &Vault, path: &Path) -> Result<PathBuf, String> {
    if path.symlink_metadata().is_ok() {
        within_vault(vault, path)
    } else {
        within_vault_to_create(vault, path)
    }
}

/// The same for somewhere that is about to exist: there is nothing yet to
/// resolve, so the parent is resolved and the name put back on afterwards.
/// This is also what stops a "name" of `../../elsewhere` from being one.
pub(crate) fn within_vault_to_create(vault: &Vault, path: &Path) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Cannot write to this path".to_string())?;
    let name = path
        .file_name()
        .ok_or_else(|| "Invalid file name".to_string())?;

    let resolved = parent.canonicalize().map_err(|e| e.to_string())?;
    allow(vault, resolved.join(name))
}

/// What each window has been asked to open, until it has asked for it.
///
/// The first window is started on what the command line named, and a window
/// opened for a path is started on that path: either way the window is not yet
/// listening when the target is decided, so it is held here for it to collect
/// as it comes up - once, by label, so a second window never picks up the first's.
#[derive(Default)]
pub(crate) struct LaunchTarget(pub(crate) Mutex<HashMap<String, crate::cli::OpenTarget>>);

impl LaunchTarget {
    pub(crate) fn queue(&self, label: &str, target: crate::cli::OpenTarget) {
        locked(&self.0).insert(label.to_string(), target);
    }

    pub(crate) fn take(&self, label: &str) -> Option<crate::cli::OpenTarget> {
        locked(&self.0).remove(label)
    }

    /// What the window has yet to collect, without collecting it.
    pub(crate) fn pending(&self, label: &str) -> Option<crate::cli::OpenTarget> {
        locked(&self.0).get(label).cloned()
    }
}
