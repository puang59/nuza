use crate::launch::FILE_CHANGED_EVENT;
use crate::search::announce_files;
use crate::state::{changed_since_read, locked, vault_of};
use notify::event::{EventKind, ModifyKind, RenameMode};
use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use tauri::Emitter;

/// Every change in the folder, sent in batches while the window asks for them.
pub(crate) const VAULT_CHANGES_EVENT: &str = "vault-changes";

/// How long changes are gathered before they are sent.
const CHANGE_BATCH: Duration = Duration::from_millis(100);

/// A file in the vault that appeared, changed, went or moved.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct VaultChange {
    pub(crate) kind: &'static str,
    pub(crate) path: String,
    /// Where it was, for a rename.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) from: Option<String>,
    /// Whether this is only the app's own save of a note it holds.
    pub(crate) own: bool,
}

/// Watches the open folder and says so when a note in it changes.
///
/// Without this the app is the last to know. A `git pull`, a sync client or a
/// second editor moves a note on disk, the tab still shows what was read
/// minutes ago, and the first keystroke after that autosaves the stale buffer
/// over the newer file.
pub(crate) fn watch_vault<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    root: &Path,
) -> Result<(), String> {
    let handle = window.clone();
    let vault = vault_of(window);
    // Weak, because the vault owns this watcher: a callback holding the vault
    // itself would keep it alive after its window closed.
    let seen_by = std::sync::Arc::downgrade(&vault);

    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return };
        let Some(vault) = seen_by.upgrade() else {
            return;
        };
        // The watcher lost count of what happened - too many changes at once
        // for the OS to list - so the index cannot be patched, only read again.
        if event.need_rescan() {
            let announced = handle.clone();
            vault
                .index
                .rescan_in_background(move || announce_files(&announced, true));
            return;
        }
        if !event.kind.is_modify() && !event.kind.is_create() && !event.kind.is_remove() {
            return;
        }

        // Whether each path was listed before the index looks at it again, to
        // say what changed - only while the window asks to be told.
        let reporting = vault.reports_changes.load(Ordering::Relaxed);
        let before = if reporting {
            listings(&vault.index, &event.paths)
        } else {
            Vec::new()
        };

        let mut files_changed = false;
        for path in &event.paths {
            files_changed |= vault.index.refresh(path);
        }
        announce_files(&handle, files_changed);

        if reporting {
            let after = listings(&vault.index, &event.paths);
            let changes = changes_in(&event.kind, &before, &after, |path| {
                let path = Path::new(path);
                locked(&vault.known).contains_key(path) && !changed_since_read(&vault, path)
            });
            send_later(&handle, &vault, changes);
        }

        for path in event.paths {
            // Only notes the app is actually holding, and only when what is on
            // disk is no longer what it read - which is what keeps the app's
            // own saves from coming back as news.
            if changed_since_read(&vault, &path) {
                let _ = handle.emit_to(
                    handle.label(),
                    FILE_CHANGED_EVENT,
                    path.to_string_lossy().into_owned(),
                );
            }
        }
    })
    .map_err(|e| e.to_string())?;

    watcher
        .watch(root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    // Replacing the old watcher drops it, which is how it stops watching.
    *locked(&vault.watcher) = Some(watcher);
    // Linked plugins were the old folder's.
    locked(&vault.dev_watchers).clear();
    Ok(())
}

/// Starts or stops telling the window about every change in its folder.
#[tauri::command]
pub(crate) fn plugins_watch_vault(window: tauri::WebviewWindow, on: bool) {
    let vault = vault_of(&window);
    vault.reports_changes.store(on, Ordering::Relaxed);
    if !on {
        locked(&vault.unsent_changes).clear();
    }
}

/// Adds `changes` to what is waiting, and if nothing was, sends the lot once
/// the batch has had time to fill.
fn send_later<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    vault: &Arc<crate::state::Vault>,
    changes: Vec<VaultChange>,
) {
    if changes.is_empty() {
        return;
    }
    let first = {
        let mut unsent = locked(&vault.unsent_changes);
        let first = unsent.is_empty();
        unsent.extend(changes);
        first
    };
    if !first {
        return;
    }
    let window = window.clone();
    let vault = Arc::downgrade(vault);
    std::thread::spawn(move || {
        std::thread::sleep(CHANGE_BATCH);
        let Some(vault) = vault.upgrade() else { return };
        let mut batch = std::mem::take(&mut *locked(&vault.unsent_changes));
        // The same change twice in one batch - several writes to one file - is
        // said once.
        let mut said = std::collections::HashSet::new();
        batch.retain(|change| said.insert((change.kind, change.path.clone(), change.from.clone())));
        if !batch.is_empty() && vault.reports_changes.load(Ordering::Relaxed) {
            let _ = window.emit_to(window.label(), VAULT_CHANGES_EVENT, batch);
        }
    });
}

/// How each path stands in the index: its name there, and whether it is
/// listed (a file in the vault, outside tools' folders such as `.nuza` and
/// what .gitignore leaves out). None for a path outside the vault.
type Listing = Option<(String, bool)>;

fn listings(index: &crate::index::VaultIndex, paths: &[std::path::PathBuf]) -> Vec<Listing> {
    paths
        .iter()
        .map(|path| {
            index
                .listing(path)
                .map(|(name, listed)| (name.to_string_lossy().into_owned(), listed))
        })
        .collect()
}

/// What one watcher event did, as changes to report, judged by whether each of
/// its paths was listed in the index before and after it. What the platform
/// says happened is not to be trusted on its own: macOS repeats a file's
/// earlier flags in later events, so an edit can arrive saying "created", and
/// a deletion twice. A path listed on neither side - a folder, `.nuza`,
/// anything outside the vault - is not reported.
pub(crate) fn changes_in(
    kind: &EventKind,
    before: &[Listing],
    after: &[Listing],
    own: impl Fn(&str) -> bool,
) -> Vec<VaultChange> {
    let listed = |seen: &[Listing], at: usize| {
        seen.get(at)
            .and_then(|entry| entry.as_ref())
            .is_some_and(|(_, listed)| *listed)
    };
    let name = |at: usize| {
        after
            .get(at)
            .or(before.get(at))
            .and_then(|entry| entry.as_ref())
            .map(|(path, _)| path.clone())
    };

    // A rename the platform could pair, from a file that was listed to one
    // that now is: one change rather than a deletion and a creation.
    let paired = matches!(kind, EventKind::Modify(ModifyKind::Name(RenameMode::Both)));
    if paired
        && before.len() == 2
        && listed(before, 0)
        && !listed(after, 0)
        && !listed(before, 1)
        && listed(after, 1)
    {
        if let (Some(from), Some(path)) = (name(0), name(1)) {
            return vec![VaultChange {
                kind: "rename",
                path,
                from: Some(from),
                own: false,
            }];
        }
    }

    (0..before.len())
        .filter_map(|at| {
            let path = name(at)?;
            let kind = match (listed(before, at), listed(after, at)) {
                (false, true) => "create",
                (true, false) => "delete",
                (true, true) => "modify",
                (false, false) => return None,
            };
            let own = kind == "modify" && own(&path);
            Some(VaultChange {
                kind,
                path,
                from: None,
                own,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, DataChange};

    fn seen(path: &str, listed: bool) -> Listing {
        Some((path.to_string(), listed))
    }

    fn kinds(changes: &[VaultChange]) -> Vec<(&str, &str)> {
        changes.iter().map(|c| (c.kind, c.path.as_str())).collect()
    }

    const EDIT: EventKind = EventKind::Modify(ModifyKind::Data(DataChange::Content));

    #[test]
    fn what_changed_is_read_from_the_index_not_the_platform() {
        let none = |_: &str| false;
        // macOS says "created" again for a file that was already there.
        let created = EventKind::Create(CreateKind::File);
        let was = [seen("/v/a.md", true)];
        let was_not = [seen("/v/a.md", false)];
        assert_eq!(
            kinds(&changes_in(&created, &was, &was, none)),
            vec![("modify", "/v/a.md")]
        );
        assert_eq!(
            kinds(&changes_in(&created, &was_not, &was, none)),
            vec![("create", "/v/a.md")]
        );
        assert_eq!(
            kinds(&changes_in(&EDIT, &was, &was_not, none)),
            vec![("delete", "/v/a.md")]
        );
    }

    #[test]
    fn a_deletion_reported_twice_is_one_change() {
        let gone = [seen("/v/a.md", false)];
        assert!(changes_in(&EDIT, &gone, &gone, |_| false).is_empty());
    }

    #[test]
    fn what_the_index_does_not_list_is_not_reported() {
        assert!(changes_in(&EDIT, &[None], &[None], |_| false).is_empty());
        let tools = [seen("/v/.nuza/plugins.json", false)];
        assert!(changes_in(&EDIT, &tools, &tools, |_| false).is_empty());
    }

    #[test]
    fn a_paired_rename_is_one_change() {
        let changes = changes_in(
            &EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
            &[seen("/v/a.md", true), seen("/v/b.md", false)],
            &[seen("/v/a.md", false), seen("/v/b.md", true)],
            |_| false,
        );
        assert_eq!(
            changes,
            vec![VaultChange {
                kind: "rename",
                path: "/v/b.md".into(),
                from: Some("/v/a.md".into()),
                own: false,
            }]
        );
    }

    #[test]
    fn only_a_modification_can_be_the_apps_own() {
        let own = |_: &str| true;
        let was = [seen("/v/a.md", true)];
        assert!(changes_in(&EDIT, &was, &was, own)[0].own);
        assert!(!changes_in(&EDIT, &[seen("/v/a.md", false)], &was, own)[0].own);
    }
}
