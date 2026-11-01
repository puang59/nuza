use crate::slow::{run_all, run_one};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

#[derive(serde::Serialize, Debug, Clone, PartialEq)]
pub(crate) struct FileEntry {
    pub(crate) name: String,
    pub(crate) path: String,
    #[serde(rename = "isDirectory")] // this ensures the JSON key is camel case
    pub(crate) is_directory: bool,
    // Left off a file rather than sent as `null`: a large vault is mostly
    // files, and a listing crosses the bridge as one string. A folder with no
    // `children` is one that has not been read yet, not an empty one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) children: Option<Vec<FileEntry>>,
    /// Milliseconds since the epoch, for sorting the tree by date. Left off
    /// when the filesystem does not say - some do not record creation at all.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) modified: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) created: Option<u64>,
    /// Set when the filesystem did not answer for this entry in time: a file
    /// that is a placeholder for something offline, or a share that has gone
    /// quiet. The row is still listed, so it can be seen and retried, but
    /// nothing is known about it.
    #[serde(skip_serializing_if = "is_false")]
    pub(crate) unavailable: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

pub(crate) fn epoch_millis(time: std::io::Result<SystemTime>) -> Option<u64> {
    let since = time.ok()?.duration_since(SystemTime::UNIX_EPOCH).ok()?;
    u64::try_from(since.as_millis()).ok()
}

/// Entries that are never notes: the dot-directories tools keep their own state
/// in, and dependency folders. A vault that happens to sit inside a repository
/// or a project can carry far more of these than it does notes, and walking
/// them costs more than everything the sidebar is actually there to show.
pub(crate) fn is_ignored(name: &str) -> bool {
    name.starts_with('.') || name == "node_modules"
}

/// How many folders deep a vault is read. Past this a folder is listed with
/// nothing in it: no vault of notes goes this deep, and a walk that does has
/// found a way around in circles that the checks below did not catch.
pub(crate) const MAX_TREE_DEPTH: usize = 64;

/// How long a read waits on the filesystem before it stops waiting.
#[derive(Clone, Copy)]
pub(crate) struct Patience {
    /// For one entry's `stat`, counted from when its folder's were all asked
    /// for - so a folder of offline files costs this once, not once each.
    pub(crate) entry: Duration,
    /// For listing a folder at all.
    pub(crate) listing: Duration,
}

pub(crate) const PATIENCE: Patience = Patience {
    entry: Duration::from_millis(1500),
    listing: Duration::from_secs(8),
};

/// What asking the filesystem about one entry turns up.
#[derive(Default, Clone, Debug, PartialEq)]
pub(crate) struct Probe {
    pub(crate) modified: Option<u64>,
    pub(crate) created: Option<u64>,
    /// For a symlink, the folder it leads to - `None` for a link to a file, or
    /// one that leads nowhere.
    pub(crate) folder: Option<PathBuf>,
}

/// The calls that can block on a slow filesystem, for one entry.
pub(crate) fn probe(path: &Path, is_symlink: bool) -> Probe {
    // The entry's own times, not a link's target's: it is the row that is
    // being sorted. This describes the entry itself and does not follow a link.
    let metadata = fs::symlink_metadata(path).ok();
    let folder = if is_symlink {
        fs::canonicalize(path).ok().filter(|target| target.is_dir())
    } else {
        None
    };
    Probe {
        modified: metadata.as_ref().and_then(|m| epoch_millis(m.modified())),
        created: metadata.as_ref().and_then(|m| epoch_millis(m.created())),
        folder,
    }
}

/// How an entry is asked about; a parameter so a test can make one stall.
pub(crate) type Prober = Arc<dyn Fn(&Path, bool) -> Probe + Send + Sync>;

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    File,
    Folder,
    Link,
}

struct Listed {
    name: String,
    path: PathBuf,
    kind: Kind,
}

/// The names in one folder and what kind of thing each is, without the ignored
/// ones. `file_type` describes the entry itself and does not follow a link, and
/// on most filesystems it comes with the listing and costs nothing.
fn list_names(directory: &Path) -> Result<Vec<Listed>, String> {
    let mut listed = Vec::new();
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        // An entry that cannot be read is one row missing, not a folder that
        // cannot be shown.
        let Ok(entry) = entry else { continue };
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_ignored(&name) {
            continue;
        }
        let kind = match entry.file_type() {
            Ok(kind) if kind.is_symlink() => Kind::Link,
            Ok(kind) if kind.is_dir() => Kind::Folder,
            _ => Kind::File,
        };
        listed.push(Listed {
            name,
            path: entry.path(),
            kind,
        });
    }
    Ok(listed)
}

/// One row of a folder, and the folder it stands for once links are resolved.
pub(crate) struct Level {
    pub(crate) entry: FileEntry,
    /// The resolved folder this row opens, for a row that is one.
    pub(crate) real: Option<PathBuf>,
}

/// Reads one folder: its rows, folders first and then by name, none of them
/// read any deeper.
///
/// `here` is the folder as the OS resolves it, which is what a link's target is
/// compared against. A link to a folder is only followed when `skip` says no
/// to its target - the caller's way of keeping a walk out of circles - and not
/// at all when it leads out of `root`, since every command here refuses a path
/// outside the vault and its notes could only ever fail to open.
///
/// Each entry's `stat` is waited on for `patience.entry` at most. An entry that
/// does not answer is still listed, marked `unavailable`.
pub(crate) fn read_level(
    directory: &Path,
    here: &Path,
    root: &Path,
    skip: &dyn Fn(&Path) -> bool,
    patience: Patience,
    prober: Prober,
) -> Result<Vec<Level>, String> {
    let owned = directory.to_path_buf();
    let (here_owned, root_owned) = (here.to_path_buf(), root.to_path_buf());
    let listed = match run_one(
        move || {
            // What the vault's .gitignore files leave out is left out here,
            // once, for the tree, the index and search alike.
            list_names(&owned).map(|mut listed| {
                listed.retain(|item| {
                    !crate::gitignore::ignores(
                        &root_owned,
                        &here_owned.join(&item.name),
                        item.kind == Kind::Folder,
                    )
                });
                listed
            })
        },
        patience.listing,
    ) {
        Some(listed) => listed?,
        None => {
            return Err(format!(
                "\"{}\" is not available right now",
                directory.display()
            ))
        }
    };

    let jobs: Vec<Box<dyn FnOnce() -> Probe + Send>> = listed
        .iter()
        .map(|item| {
            let path = item.path.clone();
            let is_link = item.kind == Kind::Link;
            let prober = prober.clone();
            Box::new(move || prober(&path, is_link)) as Box<dyn FnOnce() -> Probe + Send>
        })
        .collect();
    let probes = run_all(jobs, patience.entry);

    let mut levels = Vec::with_capacity(listed.len());
    for (item, probe) in listed.into_iter().zip(probes) {
        let unavailable = probe.is_none();
        let probe = probe.unwrap_or_default();

        let real = match item.kind {
            Kind::Folder => Some(here.join(&item.name)),
            Kind::Link => match probe.folder {
                Some(target) if !target.starts_with(root) || skip(&target) => continue,
                Some(target) => Some(target),
                // A link to a file, or one that leads nowhere, is listed as
                // the file it names - as it always was.
                None => None,
            },
            Kind::File => None,
        };

        levels.push(Level {
            entry: FileEntry {
                name: item.name,
                path: item.path.to_string_lossy().into_owned(),
                is_directory: real.is_some(),
                children: None,
                modified: probe.modified,
                created: probe.created,
                unavailable,
            },
            real,
        });
    }

    // Sort so directories appear first, then alphabetically
    levels.sort_by(|a, b| {
        b.entry.is_directory.cmp(&a.entry.is_directory).then(
            a.entry
                .name
                .to_lowercase()
                .cmp(&b.entry.name.to_lowercase()),
        )
    });

    Ok(levels)
}

/// What is directly inside `directory`, for the sidebar to show when a folder
/// is opened. `directory` is the path as the frontend knows it, and `here` the
/// same folder resolved; `root` is the vault's resolved root.
///
/// A folder is never read to find out what is in the ones inside it: they come
/// back with no `children`, and are read when they are opened.
///
/// A link back up the tree - `ln -s . loop` - is left out, since it would only
/// ever show the folder being looked at, again.
pub(crate) fn list_folder(
    directory: &Path,
    here: &Path,
    root: &Path,
) -> Result<Vec<FileEntry>, String> {
    list_folder_with(directory, here, root, PATIENCE, Arc::new(probe) as Prober)
}

pub(crate) fn list_folder_with(
    directory: &Path,
    here: &Path,
    root: &Path,
    patience: Patience,
    prober: Prober,
) -> Result<Vec<FileEntry>, String> {
    let levels = read_level(
        directory,
        here,
        root,
        &|target| here.starts_with(target),
        patience,
        prober,
    )?;
    Ok(levels.into_iter().map(|level| level.entry).collect())
}

/// The vault's tree, read in full. This is what the index is built from; the
/// sidebar reads a folder at a time with `list_folder`.
///
/// A symlink is not followed the way a folder is. `Path::is_dir` follows
/// links, so a link back up the tree - `ln -s . loop` - was walked forever,
/// until the stack ran out and took the app with it. A link to a folder is
/// only followed when it lands inside the vault and not on a folder the walk
/// is already inside.
pub(crate) fn read_dir_recursive(path: &Path) -> Result<Vec<FileEntry>, String> {
    read_dir_recursive_with(path, PATIENCE, Arc::new(probe) as Prober)
}

pub(crate) fn read_dir_recursive_with(
    path: &Path,
    patience: Patience,
    prober: Prober,
) -> Result<Vec<FileEntry>, String> {
    let root = path.canonicalize().map_err(|e| e.to_string())?;
    let mut ancestors = vec![root.clone()];
    read_tree(path, &root, &mut ancestors, patience, &prober)
}

/// `path`'s entries, with `ancestors` holding the resolved folders the walk
/// is inside, `path`'s own last.
fn read_tree(
    path: &Path,
    root: &Path,
    ancestors: &mut Vec<PathBuf>,
    patience: Patience,
    prober: &Prober,
) -> Result<Vec<FileEntry>, String> {
    let here = ancestors
        .last()
        .cloned()
        .unwrap_or_else(|| root.to_path_buf());
    let levels = {
        let seen: &[PathBuf] = ancestors;
        read_level(
            path,
            &here,
            root,
            &|target| seen.contains(&target.to_path_buf()),
            patience,
            prober.clone(),
        )?
    };

    let mut entries = Vec::with_capacity(levels.len());
    for Level { mut entry, real } in levels {
        if let Some(folder) = real {
            entry.children = Some(if entry.unavailable || ancestors.len() >= MAX_TREE_DEPTH {
                Vec::new()
            } else {
                ancestors.push(folder);
                let read = read_tree(Path::new(&entry.path), root, ancestors, patience, prober);
                ancestors.pop();
                // A folder that cannot be read is one row marked so, not a
                // vault that cannot be opened.
                read.unwrap_or_else(|_| {
                    entry.unavailable = true;
                    Vec::new()
                })
            });
        }
        entries.push(entry);
    }
    Ok(entries)
}

/// The tree under one folder of the vault, read in full - for the index to
/// take account of a folder that has appeared or moved. Empty for a folder that
/// does not resolve to somewhere inside `root`.
pub(crate) fn read_folder_in(path: &Path, root: &Path) -> Result<Vec<FileEntry>, String> {
    let resolved = path.canonicalize().map_err(|e| e.to_string())?;
    let mut ancestors: Vec<PathBuf> = resolved
        .ancestors()
        .take_while(|ancestor| ancestor.starts_with(root))
        .map(Path::to_path_buf)
        .collect();
    if ancestors.is_empty() {
        return Ok(Vec::new());
    }
    ancestors.reverse();
    let prober: Prober = Arc::new(probe);
    read_tree(path, root, &mut ancestors, PATIENCE, &prober)
}
