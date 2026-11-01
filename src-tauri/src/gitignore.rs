//! What a vault's `.gitignore` files leave out of the sidebar, the file index
//! and search.
//!
//! A vault that is a code repository - or has one inside it - otherwise fills
//! the tree with build output and dependencies. Only the `.gitignore` files in
//! the vault count, from the vault's root down to the folder being read, and
//! the repository's own `.git/info/exclude` when the vault is the repository.
//! Rules from a repository the vault merely sits inside are not followed: a
//! pattern written for a project should not be able to hide someone's notes.
//!
//! Each file is parsed once and kept until it changes on disk.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::SystemTime;

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use ignore::Match;

/// Parsed ignore files, by path, with the modified time they were parsed at.
type Parsed = HashMap<PathBuf, (SystemTime, Arc<Gitignore>)>;
static PARSED: LazyLock<Mutex<Parsed>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// The rules in `file`, read relative to `base`, or none if there is no file.
fn rules(file: &Path, base: &Path) -> Option<Arc<Gitignore>> {
    let modified = fs::metadata(file).and_then(|meta| meta.modified()).ok()?;
    let mut parsed = PARSED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some((when, rules)) = parsed.get(file) {
        if *when == modified {
            return Some(Arc::clone(rules));
        }
    }
    let mut builder = GitignoreBuilder::new(base);
    // A line that does not parse is skipped, as git skips it.
    let _ = builder.add(file);
    let built = Arc::new(builder.build().ok()?);
    parsed.insert(file.to_path_buf(), (modified, Arc::clone(&built)));
    Some(built)
}

/// Whether `path` - a file, or a folder when `is_dir` - is ignored by the
/// `.gitignore` files between its folder and `root`. The nearest file with
/// anything to say about it decides, as in git; a `!pattern` brings it back.
pub(crate) fn ignores(root: &Path, path: &Path, is_dir: bool) -> bool {
    let Some(mut folder) = path.parent() else {
        return false;
    };
    if !folder.starts_with(root) {
        return false;
    }
    loop {
        if let Some(rules) = rules(&folder.join(".gitignore"), folder) {
            match rules.matched(path, is_dir) {
                Match::Ignore(_) => return true,
                Match::Whitelist(_) => return false,
                Match::None => {}
            }
        }
        if folder == root {
            break;
        }
        match folder.parent() {
            Some(parent) => folder = parent,
            None => break,
        }
    }
    rules(&root.join(".git").join("info").join("exclude"), root)
        .is_some_and(|rules| rules.matched(path, is_dir).is_ignore())
}

/// Whether `path`, or any folder between it and `root`, is ignored: for a
/// change reported from somewhere inside an ignored folder, which the tree
/// never lists and so has nothing to update.
pub(crate) fn ignores_within(root: &Path, path: &Path) -> bool {
    if ignores(root, path, false) || ignores(root, path, true) {
        return true;
    }
    path.ancestors()
        .skip(1)
        .take_while(|folder| *folder != root && folder.starts_with(root))
        .any(|folder| ignores(root, folder, true))
}
