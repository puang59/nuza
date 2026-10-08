use crate::files::write_privately;
use crate::tasks::off_thread;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::Manager;

/// Edits that were in a tab and nowhere else when the app went away.
///
/// A note that changed on disk while it had unsaved edits is held: neither
/// copy is written until someone answers the bar. That is the right answer
/// while the app is running and the wrong one on the way out, because the
/// edits only ever existed in the editor's own state - leaving took them with
/// it, with no warning at any point.
///
/// So the buffer is kept here instead, outside the vault, in the app's own
/// data directory. Nothing in anyone's notes is touched and no copy is
/// declared the winner; the question is simply still answerable the next time
/// that note is opened.
///
/// The note's own path is stored alongside the text because the file is named
/// after a hash of that path - a path is not a filename - and a hash can in
/// principle collide. A file whose recorded path is not the one being asked
/// about is not that note's, and is treated as though it were not there.
#[derive(serde::Serialize, serde::Deserialize)]
pub(crate) struct Recovery {
    pub(crate) path: String,
    pub(crate) content: String,
}

/// Where those buffers live, created if this is the first one.
pub(crate) fn recovery_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("recovery");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// FNV-1a, 64 bits. Written out here because the name of a kept file has to
/// come out the same from every build there will ever be: the standard
/// library's hasher makes no such promise from one Rust release to the next,
/// and a build that named the files differently would walk straight past the
/// edits the last one kept - across an update, of all moments.
pub(crate) fn stable_hash(text: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// The file `note` would be kept in: its path, hashed, since the path itself
/// has separators in it and is very often longer than a name may be.
pub(crate) fn recovery_file(dir: &Path, note: &str) -> PathBuf {
    dir.join(format!("{:016x}.json", stable_hash(note)))
}

/// Where a build from before `stable_hash` kept the same note. Still looked
/// in, so that what such a build kept is found by this one.
pub(crate) fn legacy_recovery_file(dir: &Path, note: &str) -> PathBuf {
    use std::hash::{Hash, Hasher};

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    note.hash(&mut hasher);
    dir.join(format!("{:016x}.json", hasher.finish()))
}

/// The buffer in `file`, if it can be read as one. A file that cannot is
/// half-written or from an older shape of this file: nothing can be done with
/// it and nothing should be said about it.
fn read_kept(file: &Path) -> Option<Recovery> {
    serde_json::from_slice(&fs::read(file).ok()?).ok()
}

/// What was kept for `note`, if anything was and it really is that note's.
pub(crate) fn kept_for(dir: &Path, note: &str) -> Option<String> {
    [recovery_file(dir, note), legacy_recovery_file(dir, note)]
        .iter()
        .filter_map(|file| read_kept(file))
        .find(|kept| kept.path == note)
        .map(|kept| kept.content)
}

/// Lets go of what was kept for `note`, under either name.
pub(crate) fn drop_kept(dir: &Path, note: &str) -> Result<(), String> {
    // The old name is only this note's if the file says so: two builds' worth
    // of names share the directory, and one's name for a note could be the
    // other's name for a different one.
    let legacy = legacy_recovery_file(dir, note);
    if read_kept(&legacy).is_some_and(|kept| kept.path == note) {
        let _ = fs::remove_file(&legacy);
    }

    match fs::remove_file(recovery_file(dir, note)) {
        Ok(()) => Ok(()),
        // Already gone is the state being asked for.
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

/// Where `path` is once `from` has become `to`, if it was `from` or inside it.
pub(crate) fn moved_path(path: &str, from: &str, to: &str) -> Option<String> {
    let rest = path.strip_prefix(from)?;
    (rest.is_empty() || rest.starts_with(['/', '\\'])).then(|| format!("{}{}", to, rest))
}

/// Re-keys what was kept for `from`, and for every note inside it if it is a
/// folder, after a rename or a move to `to`. The paths are the ones the
/// frontend knows the notes by, since those are what it will ask with.
///
/// Left where it was, a buffer is named after a path no note has any more,
/// and the offer to restore it never comes back.
pub(crate) fn move_kept(dir: &Path, from: &str, to: &str) {
    let Ok(files) = fs::read_dir(dir) else {
        return;
    };

    for file in files.flatten().map(|entry| entry.path()) {
        let Some(mut kept) = read_kept(&file) else {
            continue;
        };
        let Some(landed) = moved_path(&kept.path, from, to) else {
            continue;
        };

        kept.path = landed;
        let Ok(json) = serde_json::to_vec(&kept) else {
            continue;
        };
        // Written before the old one goes: a failure leaves the buffer under
        // its old name, which loses the offer but not the edits.
        let renamed = recovery_file(dir, &kept.path);
        if write_privately(&renamed, &json).is_ok() && renamed != file {
            let _ = fs::remove_file(&file);
        }
    }
}

/// `move_kept`, for the app's own recovery directory.
pub(crate) fn follow_move<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    from: &str,
    to: &str,
) {
    if let Ok(dir) = app_handle.path().app_data_dir() {
        // Not created for the asking: no directory is no buffers to move.
        move_kept(&dir.join("recovery"), from, to);
    }
}

/// How long a buffer for a note that no longer exists is held on to.
pub(crate) const ORPHAN_AGE: Duration = Duration::from_secs(60 * 60 * 24 * 60);

/// Removes the buffers nobody will ever be asked about: ones that cannot be
/// read, and ones whose note is gone, once they are older than `age`. A buffer
/// whose note is still there is never touched, however old - the question it
/// holds is still open.
pub(crate) fn prune_kept(dir: &Path, age: Duration) {
    let Ok(files) = fs::read_dir(dir) else {
        return;
    };

    for file in files.flatten().map(|entry| entry.path()) {
        if file.extension().is_none_or(|extension| extension != "json") {
            continue;
        }
        let old = fs::metadata(&file)
            .and_then(|data| data.modified())
            .ok()
            .and_then(|at| at.elapsed().ok())
            .is_some_and(|elapsed| elapsed >= age);
        if !old {
            continue;
        }

        let note_is_there = read_kept(&file).is_some_and(|kept| Path::new(&kept.path).exists());
        if !note_is_there {
            let _ = fs::remove_file(&file);
        }
    }
}

/// `prune_kept`, off the main thread, once at launch.
pub(crate) fn prune_in_background(app_handle: &tauri::AppHandle) {
    let Ok(dir) = app_handle.path().app_data_dir() else {
        return;
    };
    std::thread::spawn(move || prune_kept(&dir.join("recovery"), ORPHAN_AGE));
}

/// Puts the unsaved edits in `path` somewhere they will survive the window
/// closing. Written on every flush while the conflict is unanswered, so what
/// is kept is what was last typed rather than what was there when the bar
/// first appeared.
#[tauri::command]
pub(crate) async fn keep_recovery(
    app_handle: tauri::AppHandle,
    path: String,
    content: String,
) -> Result<(), String> {
    off_thread(move || {
        let dir = recovery_dir(&app_handle)?;
        let kept = Recovery {
            path: path.clone(),
            content,
        };
        let json = serde_json::to_vec(&kept).map_err(|e| e.to_string())?;
        write_privately(&recovery_file(&dir, &path), &json)
    })
    .await
}

/// The edits being held for `path`, if there are any.
///
/// Reading does not throw them away: until someone has said what to do with
/// them, an app that goes away again should still have them to offer.
#[tauri::command]
pub(crate) async fn take_recovery(
    app_handle: tauri::AppHandle,
    path: String,
) -> Result<Option<String>, String> {
    off_thread(move || {
        let dir = recovery_dir(&app_handle)?;
        Ok(kept_for(&dir, &path))
    })
    .await
}

/// Forgets them, once the question has been answered either way.
#[tauri::command]
pub(crate) async fn drop_recovery(
    app_handle: tauri::AppHandle,
    path: String,
) -> Result<(), String> {
    off_thread(move || {
        let dir = recovery_dir(&app_handle)?;
        drop_kept(&dir, &path)
    })
    .await
}
