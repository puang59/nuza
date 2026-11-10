//! What the open vault holds, kept in memory.
//!
//! Quick-open, the content search, the tags and the backlinks all need to know
//! which notes there are, and the last three need what is in them. Each of them
//! used to walk the vault and read every note from scratch on every request,
//! which is a cost that grows with the vault and is paid again on each
//! keystroke that ends in a pause.
//!
//! The index is built once when a folder is opened, off the thread that opens
//! it, and then patched as the filesystem watcher reports changes - so what it
//! holds is a picture of the vault that is kept current rather than taken
//! again. A note's text is read the first time something asks for it and kept
//! until the note changes, so a vault that is never searched never has its
//! notes read.

use crate::slow::run_all;
use crate::tree::{is_ignored, read_dir_recursive, read_folder_in, FileEntry, PATIENCE};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

/// Notes larger than this are not read - they are not notes anyone typed.
pub(crate) const SEARCHABLE_BYTES: u64 = 4 * 1024 * 1024;

/// How much note text is kept at once. Past this a note is read again each
/// time it is wanted, rather than held: the index is a convenience, and is not
/// worth a gigabyte of someone's memory for a very large vault.
const TEXT_BUDGET: usize = 256 * 1024 * 1024;

/// How long a request waits for the index to finish being built before it
/// answers from what there is. A vault on a slow share can take a while, and
/// part of an answer is better than none.
const BUILD_PATIENCE: Duration = Duration::from_secs(10);

/// How long all the notes a request needs are waited on, in all.
const READ_PATIENCE: Duration = Duration::from_secs(20);

/// Said to the window when the set of files in its vault has changed, or the
/// index has finished being built.
pub(crate) const INDEX_CHANGED_EVENT: &str = "index-changed";

struct Entry {
    name: String,
    /// The filesystem did not answer for this file in time.
    unavailable: bool,
    /// Bumped each time the file is seen to change, so text that was read
    /// before the change is not mistaken for text read after it.
    version: u64,
    text: Option<Arc<str>>,
}

#[derive(Default)]
struct Inner {
    /// Which folder this is the index of; a build for an earlier one is dropped.
    generation: u64,
    ready: bool,
    /// The folder as the frontend knows it, which is how paths are reported...
    display_root: PathBuf,
    /// ...and as the OS resolves it, which is how the watcher reports them.
    resolved_root: PathBuf,
    files: BTreeMap<PathBuf, Entry>,
    /// Changes the watcher reported while the index was still being built.
    pending: Vec<PathBuf>,
    text_bytes: usize,
    versions: u64,
}

#[derive(Default)]
pub(crate) struct VaultIndex {
    inner: Mutex<Inner>,
    built: Condvar,
}

/// A note, as the scans see it.
pub(crate) struct Note {
    pub(crate) path: String,
    pub(crate) name: String,
    pub(crate) text: Arc<str>,
}

pub(crate) fn is_note(name: &str) -> bool {
    Path::new(name)
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
}

fn read_note(path: &Path) -> Option<Arc<str>> {
    if fs::metadata(path).map_or(true, |meta| meta.len() > SEARCHABLE_BYTES) {
        return None;
    }
    // Unreadable, or not text: nothing in it to find.
    fs::read_to_string(path).ok().map(Arc::from)
}

enum Seen {
    Gone,
    File,
    Folder,
}

fn look_at(path: &Path) -> Seen {
    match fs::symlink_metadata(path) {
        Err(_) => Seen::Gone,
        Ok(meta) if meta.is_dir() => Seen::Folder,
        Ok(meta) if meta.file_type().is_symlink() => {
            if fs::metadata(path).is_ok_and(|target| target.is_dir()) {
                Seen::Folder
            } else {
                Seen::File
            }
        }
        Ok(_) => Seen::File,
    }
}

fn lock(inner: &Mutex<Inner>) -> std::sync::MutexGuard<'_, Inner> {
    inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Inner {
    fn drop_text(&mut self, path: &Path) {
        if let Some(entry) = self.files.get_mut(path) {
            if let Some(text) = entry.text.take() {
                self.text_bytes = self.text_bytes.saturating_sub(text.len());
            }
        }
    }

    /// Forgets `path` and, when it was a folder, everything under it.
    fn remove_under(&mut self, path: &Path) -> bool {
        let doomed: Vec<PathBuf> = self
            .files
            .range(path.to_path_buf()..)
            .take_while(|(key, _)| key.starts_with(path))
            .map(|(key, _)| key.clone())
            .collect();
        for key in &doomed {
            self.drop_text(key);
            self.files.remove(key);
        }
        !doomed.is_empty()
    }

    fn put(&mut self, path: PathBuf, name: String, unavailable: bool) -> bool {
        self.drop_text(&path);
        self.versions += 1;
        let entry = Entry {
            name,
            unavailable,
            version: self.versions,
            text: None,
        };
        self.files.insert(path, entry).is_none()
    }

    fn put_all(&mut self, entries: &[FileEntry]) {
        for entry in entries {
            match &entry.children {
                Some(children) => self.put_all(children),
                None if !entry.is_directory => {
                    self.put(
                        PathBuf::from(&entry.path),
                        entry.name.clone(),
                        entry.unavailable,
                    );
                }
                None => {}
            }
        }
    }
}

impl VaultIndex {
    /// An index of `folder`, built before this returns.
    #[cfg(test)]
    pub(crate) fn for_folder(folder: &Path) -> Result<Arc<VaultIndex>, String> {
        let resolved = folder.canonicalize().map_err(|e| e.to_string())?;
        let index = Arc::new(VaultIndex::default());
        let generation = index.reset(folder, &resolved);
        index.build(generation);
        Ok(index)
    }

    /// The folder as it was opened, which every note's path starts with.
    pub(crate) fn display_root(&self) -> PathBuf {
        lock(&self.inner).display_root.clone()
    }

    /// Starts over for another folder, and says which build belongs to it.
    pub(crate) fn reset(&self, display_root: &Path, resolved_root: &Path) -> u64 {
        let mut inner = lock(&self.inner);
        inner.generation += 1;
        inner.ready = false;
        inner.display_root = display_root.to_path_buf();
        inner.resolved_root = resolved_root.to_path_buf();
        inner.files.clear();
        inner.pending.clear();
        inner.text_bytes = 0;
        inner.generation
    }

    /// Reads the whole folder into the index. Takes as long as the walk does,
    /// so it is run off whatever opened the folder; requests made meanwhile wait
    /// a little for it, and then answer from what they have.
    pub(crate) fn build(&self, generation: u64) {
        let display_root = {
            let inner = lock(&self.inner);
            if inner.generation != generation {
                return;
            }
            inner.display_root.clone()
        };

        // A folder that cannot be read leaves an index with nothing in it, and
        // that is the right answer for it.
        let tree =
            crate::slow::in_background(|| read_dir_recursive(&display_root)).unwrap_or_default();

        let pending = {
            let mut inner = lock(&self.inner);
            if inner.generation != generation {
                return;
            }
            inner.files.clear();
            inner.put_all(&tree);
            inner.ready = true;
            std::mem::take(&mut inner.pending)
        };
        self.built.notify_all();

        // Whatever changed while the walk was under way may have been passed
        // before the walk got to it.
        for path in pending {
            self.refresh(&path);
        }
    }

    /// Builds the index on a thread of its own, and runs `done` when it has.
    pub(crate) fn build_in_background(
        self: &Arc<Self>,
        generation: u64,
        done: impl FnOnce() + Send + 'static,
    ) {
        let index = self.clone();
        let spawned = std::thread::Builder::new()
            .name("nuza-index".into())
            .spawn(move || {
                index.build(generation);
                done();
            });
        if let Err(error) = spawned {
            log::warn!("could not start indexing the vault: {}", error);
        }
    }

    /// Reads the folder in again from scratch, in the background.
    pub(crate) fn rescan_in_background(self: &Arc<Self>, done: impl FnOnce() + Send + 'static) {
        let (display, resolved) = {
            let inner = lock(&self.inner);
            (inner.display_root.clone(), inner.resolved_root.clone())
        };
        let generation = self.reset(&display, &resolved);
        self.build_in_background(generation, done);
    }

    fn wait_until_built(&self) {
        let inner = lock(&self.inner);
        let _ = self
            .built
            .wait_timeout_while(inner, BUILD_PATIENCE, |inner| !inner.ready);
    }

    /// Takes account of a change the watcher saw at `path`: reads what is
    /// there now, and brings the index into line with it. Says whether the set
    /// of files changed - a note being edited does not change it, only the text
    /// it holds - which is what is worth telling the window about.
    pub(crate) fn refresh(&self, path: &Path) -> bool {
        let (generation, display, display_root, resolved_root) = {
            let mut inner = lock(&self.inner);
            let display = if let Ok(inside) = path.strip_prefix(&inner.resolved_root) {
                inner.display_root.join(inside)
            } else if path.starts_with(&inner.display_root) {
                path.to_path_buf()
            } else {
                return false;
            };
            // Tools' own folders are never listed, so what happens in them is
            // not news - and `.git` alone can report thousands of changes a second.
            let hidden = display
                .strip_prefix(&inner.display_root)
                .is_ok_and(|inside| {
                    inside
                        .components()
                        .any(|part| is_ignored(&part.as_os_str().to_string_lossy()))
                });
            if hidden {
                return false;
            }
            if !inner.ready {
                inner.pending.push(path.to_path_buf());
                return false;
            }
            (
                inner.generation,
                display,
                inner.display_root.clone(),
                inner.resolved_root.clone(),
            )
        };

        // Nor is anything inside what the vault's .gitignore files leave out:
        // a build folder reports a great deal, and none of it is listed. Asked
        // outside the lock, since it may read those files.
        if let Ok(inside) = display.strip_prefix(&display_root) {
            if crate::gitignore::ignores_within(&resolved_root, &resolved_root.join(inside)) {
                return false;
            }
        }

        // A stat on a share that has gone quiet is waited on like any other.
        let owned = display.clone();
        let jobs: Vec<Box<dyn FnOnce() -> Seen + Send>> = vec![Box::new(move || look_at(&owned))];
        let Some(seen) = run_all(jobs, PATIENCE.entry).pop().flatten() else {
            return false;
        };

        match seen {
            Seen::Gone => {
                let mut inner = lock(&self.inner);
                inner.generation == generation && inner.remove_under(&display)
            }
            Seen::File => {
                let name = display
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_default();
                let mut inner = lock(&self.inner);
                inner.generation == generation && inner.put(display, name, false)
            }
            Seen::Folder => {
                let resolved = lock(&self.inner).resolved_root.clone();
                let entries = read_folder_in(&display, &resolved).unwrap_or_default();
                let mut inner = lock(&self.inner);
                if inner.generation != generation {
                    return false;
                }
                // Replaced rather than merged: what is gone from the folder is
                // as much a change as what is new in it.
                inner.remove_under(&display);
                inner.put_all(&entries);
                true
            }
        }
    }

    /// `path` as the index names it, and whether it is listed: a file in the
    /// vault, outside its tools' folders. None for anything outside the vault.
    pub(crate) fn listing(&self, path: &Path) -> Option<(PathBuf, bool)> {
        let inner = lock(&self.inner);
        let display = if let Ok(inside) = path.strip_prefix(&inner.resolved_root) {
            inner.display_root.join(inside)
        } else if path.starts_with(&inner.display_root) {
            path.to_path_buf()
        } else {
            return None;
        };
        let listed = inner.files.contains_key(&display);
        Some((display, listed))
    }

    /// Every file in the vault, for quick-open, in path order.
    pub(crate) fn files(&self) -> Vec<FileEntry> {
        self.wait_until_built();
        lock(&self.inner)
            .files
            .iter()
            .map(|(path, entry)| FileEntry {
                name: entry.name.clone(),
                path: path.to_string_lossy().into_owned(),
                is_directory: false,
                children: None,
                modified: None,
                created: None,
                unavailable: entry.unavailable,
            })
            .collect()
    }

    /// Every note in the vault with its text, in path order. A note whose text
    /// has not been read yet is read now - on the pool, so one that never
    /// answers is left out rather than waited on - and kept for next time.
    pub(crate) fn notes(&self) -> Vec<Note> {
        self.wait_until_built();

        struct Want {
            path: PathBuf,
            name: String,
            version: u64,
            text: Option<Arc<str>>,
            unavailable: bool,
        }

        let (generation, wanted) = {
            let inner = lock(&self.inner);
            let wanted: Vec<Want> = inner
                .files
                .iter()
                .filter(|(_, entry)| is_note(&entry.name))
                .map(|(path, entry)| Want {
                    path: path.clone(),
                    name: entry.name.clone(),
                    version: entry.version,
                    text: entry.text.clone(),
                    unavailable: entry.unavailable,
                })
                .collect();
            (inner.generation, wanted)
        };

        let reads: Vec<usize> = wanted
            .iter()
            .enumerate()
            .filter(|(_, want)| want.text.is_none() && !want.unavailable)
            .map(|(position, _)| position)
            .collect();
        let jobs: Vec<Box<dyn FnOnce() -> Option<Arc<str>> + Send>> = reads
            .iter()
            .map(|&position| {
                let path = wanted[position].path.clone();
                Box::new(move || read_note(&path)) as Box<dyn FnOnce() -> Option<Arc<str>> + Send>
            })
            .collect();
        let mut read = crate::slow::in_background(|| run_all(jobs, READ_PATIENCE));

        let mut wanted = wanted;
        for (position, text) in reads.into_iter().zip(read.drain(..)) {
            wanted[position].text = text.flatten();
        }

        // Kept - unless the note has changed again since it was read, in which
        // case what was read is already out of date, and is used once and let go.
        let mut inner = lock(&self.inner);
        let mut notes = Vec::with_capacity(wanted.len());
        for want in wanted {
            let Some(text) = want.text else { continue };
            if inner.generation == generation && inner.text_bytes + text.len() <= TEXT_BUDGET {
                let fresh = inner.files.get(&want.path).map(|entry| entry.version);
                if fresh == Some(want.version) {
                    let entry = inner.files.get_mut(&want.path).expect("just looked it up");
                    if entry.text.is_none() {
                        entry.text = Some(text.clone());
                        inner.text_bytes += text.len();
                    }
                }
            }
            notes.push(Note {
                path: want.path.to_string_lossy().into_owned(),
                name: want.name,
                text,
            });
        }
        notes
    }
}
