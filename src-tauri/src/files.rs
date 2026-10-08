use crate::search::note_changes;
use crate::state::{
    changed_since_read, files_present, follow_move, locked, remember, vault_of, within_vault,
    within_vault_to_create, within_vault_to_write, Vault, CHANGED_ON_DISK,
};
use crate::tasks::{off_thread, wait_for_picker};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub(crate) async fn create_file(
    window: tauri::WebviewWindow,
    parent_path: String,
    name: String,
) -> Result<(), String> {
    off_thread(move || {
        let vault = vault_of(&window);
        let name = exact_file_name(&name)?;
        let path = within_vault_to_create(&vault, &Path::new(&parent_path).join(&name))?;

        // `create_new` rather than a check and then a create: the check is a
        // statement about a moment that has passed by the time the file is
        // made, and `File::create` truncates whatever it finds. Together those
        // are a note emptied by someone else creating it first.
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|error| match already_exists(&error) {
                true => format!("\"{}\" already exists", name),
                false => error.to_string(),
            })?;
        note_changes(&window, &[&path]);
        Ok(())
    })
    .await
}

#[tauri::command]
pub(crate) async fn create_folder(
    window: tauri::WebviewWindow,
    parent_path: String,
    name: String,
) -> Result<(), String> {
    off_thread(move || {
        let vault = vault_of(&window);
        let name = exact_file_name(&name)?;
        let path = within_vault_to_create(&vault, &Path::new(&parent_path).join(&name))?;

        // `create_dir` is already all-or-nothing; it just needed to be the
        // thing that decides, rather than a check in front of it.
        fs::create_dir(&path).map_err(|error| match already_exists(&error) {
            true => format!("\"{}\" already exists", name),
            false => error.to_string(),
        })?;
        note_changes(&window, &[&path]);
        Ok(())
    })
    .await
}

/// Renames a file or folder in place, keeping it in the same parent
/// directory. Returns the new full path.
#[tauri::command]
pub(crate) async fn rename_entry(
    window: tauri::WebviewWindow,
    path: String,
    new_name: String,
) -> Result<String, String> {
    off_thread(move || {
        let vault = vault_of(&window);
        let new_name = exact_file_name(&new_name)?;
        let old = within_vault(&vault, Path::new(&path))?;
        let parent = old
            .parent()
            .ok_or_else(|| "Cannot rename this item".to_string())?;
        let new_path = within_vault_to_create(&vault, &parent.join(&new_name))?;

        rename_no_replace(&old, &new_path).map_err(|error| match already_exists(&error) {
            true => format!("\"{}\" already exists", new_name),
            false => error.to_string(),
        })?;
        follow_move(&vault, &old, &new_path);
        note_changes(&window, &[&old, &new_path]);
        let moved_to = new_path.to_string_lossy().into_owned();
        // Edits kept for it, or for anything inside it, go where it went.
        crate::recovery::follow_move(window.app_handle(), &path, &moved_to);
        Ok(moved_to)
    })
    .await
}

/// Moves a file or folder into `target_dir` (e.g. from a drag-and-drop),
/// keeping its name. Returns the new full path.
#[tauri::command]
pub(crate) async fn move_entry(
    window: tauri::WebviewWindow,
    path: String,
    target_dir: String,
) -> Result<String, String> {
    off_thread(move || {
        let vault = vault_of(&window);
        let (old, new_path) = move_destination(&vault, &path, &target_dir)?;
        let name = new_path.file_name().unwrap_or_default().to_string_lossy();

        rename_no_replace(&old, &new_path).map_err(|error| match already_exists(&error) {
            true => format!("\"{}\" already exists in destination", name),
            false => error.to_string(),
        })?;
        follow_move(&vault, &old, &new_path);
        note_changes(&window, &[&old, &new_path]);
        let moved_to = new_path.to_string_lossy().into_owned();
        // Edits kept for it, or for anything inside it, go where it went.
        crate::recovery::follow_move(window.app_handle(), &path, &moved_to);
        Ok(moved_to)
    })
    .await
}

/// Where the entry at `path` would land inside `target_dir`, as the pair of
/// resolved paths `fs::rename` needs, or why the move cannot happen.
///
/// Apart from the command so that the guards can be exercised without a window
/// and a running app: the one that matters most is the last, and getting it
/// wrong is a lost subtree rather than an error message.
pub(crate) fn move_destination(
    vault: &Vault,
    path: &str,
    target_dir: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let old = within_vault(vault, Path::new(path))?;
    let name = old
        .file_name()
        .ok_or_else(|| "Invalid path".to_string())?
        .to_owned();
    let target = within_vault(vault, Path::new(target_dir))?;

    if !target.is_dir() {
        return Err("That is not a folder to move into".to_string());
    }

    // Both sides came back from `within_vault` resolved, which is what makes a
    // component-wise `starts_with` the right test here: a target written with
    // `..`, or reached through a symlink sitting inside the folder being moved,
    // is already spelled out as the directory it really is by the time it gets
    // this far. Comparing the two strings the frontend sent would not be -
    // `fs::rename` of a directory into its own descendant loses the subtree.
    if old.is_dir() && target.starts_with(&old) {
        return Err("Cannot move a folder into itself".to_string());
    }

    let new_path = target.join(&name);
    if new_path.exists() {
        return Err(format!(
            "\"{}\" already exists in destination",
            name.to_string_lossy()
        ));
    }

    Ok((old, new_path))
}

#[tauri::command]
pub(crate) async fn delete_entry(window: tauri::WebviewWindow, path: String) -> Result<(), String> {
    off_thread(move || {
        let vault = vault_of(&window);
        let p = within_vault(&vault, Path::new(&path))?;

        // To the Trash, not out of existence. `remove_dir_all` on a folder
        // picked by mistake took the whole subtree with it and there is no
        // undo anywhere in this app - the confirm dialog was the only thing
        // between a misclick and work that is simply gone. The OS has an undo
        // for exactly this, and it is the one people already know how to use.
        trashing().delete(&p).map_err(|error| error.to_string())?;
        note_changes(&window, &[&p]);
        Ok(())
    })
    .await
}

/// Opens a native "save file" dialog and writes `content` to the chosen path.
/// Returns the chosen path, or `None` if the user cancels the dialog.
#[tauri::command]
pub(crate) async fn save_file_picker(
    window: tauri::WebviewWindow,
    content: String,
) -> Result<Option<String>, String> {
    let chosen = window.clone();
    wait_for_picker(|send| {
        window
            .dialog()
            .file()
            .add_filter("Markdown Files", &["md", "markdown"])
            .set_file_name("untitled.md")
            .save_file(move |file_path| {
                let result = match file_path {
                    Some(path) => {
                        let path_str = path.to_string();
                        match write_atomically(Path::new(&path_str), content.as_bytes()) {
                            Ok(_) => {
                                // Somewhere the user pointed at themselves, which
                                // may well be outside the open folder. Recorded so
                                // that the autosave that follows is allowed to
                                // keep writing the note they just saved.
                                if let Ok(resolved) = Path::new(&path_str).canonicalize() {
                                    let vault = vault_of(&chosen);
                                    // Read from here on, as far as noticing
                                    // a change made elsewhere goes.
                                    remember(&vault, &resolved);
                                    locked(&vault.chosen).insert(resolved);
                                }
                                Ok(Some(path_str))
                            }
                            Err(e) => Err(format!("Failed to write file: {}", e)),
                        }
                    }
                    None => Ok(None),
                };
                send(result);
            });
    })
    .await
}

/// Names Win32 hands to a device rather than a file, whatever extension is put
/// on the end of them. Creating one fails, or opens a console.
pub(crate) const RESERVED_NAMES: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// Characters that make a name something other than a name: `:` opens an NTFS
/// alternate data stream, so `note.md:hidden` writes bytes the file tree has
/// no way to see, and the rest are Win32 wildcards or redirections.
pub(crate) const FORBIDDEN_CHARS: &[char] = &['"', '*', ':', '<', '>', '?', '|'];

/// Whether `name` would be a reserved device name on Windows. The extension is
/// not part of the question: `aux.md` is `AUX` as far as Win32 is concerned.
pub(crate) fn is_reserved(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").to_ascii_lowercase();
    RESERVED_NAMES.contains(&stem.as_str())
}

/// The final component of `name`, as it will actually land on disk, with
/// anything that could climb out of the target directory or confuse the
/// filesystem taken off it.
///
/// A dropped file's name is whatever the sending app put there, so it is
/// treated as a suggestion rather than a path. The rules are Windows' as well
/// as this platform's: a vault is very often a synced folder, and a note named
/// `report.` or `aux.md` is one that cannot be checked out on a machine that
/// is not this one. Trailing dots and spaces matter for a second reason -
/// Win32 drops them silently, so the name checked against what is already in
/// the folder would not be the name that ended up there, and `unused_path`
/// would hand back a path that overwrites a file it thought was free.
pub(crate) fn safe_file_name(name: &str) -> Result<String, String> {
    let cleaned: String = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .trim()
        .trim_start_matches('.')
        .chars()
        .filter(|c| !c.is_control() && !FORBIDDEN_CHARS.contains(c))
        .collect();
    let cleaned = cleaned.trim_end_matches(['.', ' ']).trim();

    if cleaned.is_empty() {
        return Err("Invalid file name".to_string());
    }
    if is_reserved(cleaned) {
        return Err(format!(
            "\"{}\" is a name Windows keeps for itself",
            cleaned
        ));
    }

    Ok(cleaned.to_string())
}

/// `name` exactly as it was given, once it is known to be usable.
///
/// The difference from `safe_file_name` is who is asking. A file arriving by
/// drag-and-drop is worth filing under a tidied-up version of whatever name it
/// came with; a name somebody typed into the sidebar is not, because the row
/// the tree then draws is built from what they typed. Quietly writing
/// `notes.md` for a typed `../notes.md` leaves the tree pointing at a file that
/// is not there, which is the shape the vault-escape bug had. So this refuses
/// instead, and the sidebar says why.
pub(crate) fn exact_file_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if safe_file_name(trimmed)? != trimmed {
        return Err(format!("\"{}\" is not a name a file can have", trimmed));
    }
    Ok(trimmed.to_string())
}

/// How a file gets to the Trash.
///
/// On macOS the crate's default is to ask Finder to do it, over AppleScript.
/// That works, and it costs the first delete a "nuza wants access to control
/// Finder" prompt from the system - which is an alarming thing to be shown
/// for deleting a note, and which somebody is quite likely to refuse. Refused,
/// every delete afterwards does nothing at all.
///
/// Asking the system framework directly needs no permission and cannot be
/// turned off. The note lands in the same Trash either way. What is given up
/// is Finder's "Put Back" menu item, which macOS does not always offer for
/// files trashed this way - dragging one out of the Trash still works, and a
/// delete that always happens is worth more than the tidier way of undoing it.
#[cfg(target_os = "macos")]
pub(crate) fn trashing() -> trash::TrashContext {
    use trash::macos::{DeleteMethod, TrashContextExtMacos};

    let mut context = trash::TrashContext::default();
    context.set_delete_method(DeleteMethod::NsFileManager);
    context
}

/// Everywhere else the default asks for nothing and is the right one.
#[cfg(not(target_os = "macos"))]
pub(crate) fn trashing() -> trash::TrashContext {
    trash::TrashContext::default()
}

/// Renames `from` to `to`, refusing rather than replacing when `to` is taken.
///
/// `fs::rename` is the wrong primitive for every rename in this file. On Unix
/// it replaces the destination silently, which makes the `exists()` check in
/// front of each one the only thing standing between a race and a note that is
/// simply gone - and a check is not a guarantee. The gap between asking and
/// acting is exactly where a sync client finishes writing the file being
/// renamed onto, and the loser of that race is whoever wrote first.
///
/// Every platform has a way to say "and fail if it is taken"; none of them is
/// the portable one. Where the filesystem underneath does not know the flag,
/// the call comes back unsupported and the plain rename is used after all -
/// no worse than before, with the check in front of it still catching every
/// case that is not a race.
pub(crate) fn rename_no_replace(from: &Path, to: &Path) -> std::io::Result<()> {
    match rename_exclusively(from, to) {
        Err(error) if not_supported(&error) => fs::rename(from, to),
        result => result,
    }
}

/// Whether the filesystem turned the request down for not understanding it,
/// rather than for the reason the request exists.
pub(crate) fn not_supported(error: &std::io::Error) -> bool {
    if error.kind() == std::io::ErrorKind::Unsupported {
        return true;
    }
    #[cfg(unix)]
    {
        // ENOSYS: the kernel has no such call. EINVAL / ENOTSUP / EOPNOTSUPP:
        // it has it, and this filesystem does not implement the flag.
        //
        // EOPNOTSUPP is compared rather than matched because on Linux it is
        // the same number as ENOTSUP, and two patterns for one value is an
        // unreachable arm there while being two distinct values on macOS.
        let code = error.raw_os_error();
        matches!(
            code,
            Some(libc::ENOSYS) | Some(libc::EINVAL) | Some(libc::ENOTSUP)
        ) || code == Some(libc::EOPNOTSUPP)
    }
    #[cfg(not(unix))]
    {
        false
    }
}

/// `from` and `to` as NUL-terminated strings, for the calls below.
#[cfg(unix)]
pub(crate) fn as_c_paths(
    from: &Path,
    to: &Path,
) -> std::io::Result<(std::ffi::CString, std::ffi::CString)> {
    use std::os::unix::ffi::OsStrExt;

    let source = std::ffi::CString::new(from.as_os_str().as_bytes())
        .map_err(|_| std::io::Error::from(std::io::ErrorKind::InvalidInput))?;
    let target = std::ffi::CString::new(to.as_os_str().as_bytes())
        .map_err(|_| std::io::Error::from(std::io::ErrorKind::InvalidInput))?;
    Ok((source, target))
}

#[cfg(target_os = "linux")]
pub(crate) fn rename_exclusively(from: &Path, to: &Path) -> std::io::Result<()> {
    let (source, target) = as_c_paths(from, to)?;

    // SAFETY: both are NUL-terminated strings that outlive the call, and
    // AT_FDCWD is the documented way to ask for paths as written.
    let result = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            source.as_ptr(),
            libc::AT_FDCWD,
            target.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };

    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn rename_exclusively(from: &Path, to: &Path) -> std::io::Result<()> {
    let (source, target) = as_c_paths(from, to)?;

    // SAFETY: as above - two NUL-terminated strings that outlive the call.
    let result = unsafe { libc::renamex_np(source.as_ptr(), target.as_ptr(), libc::RENAME_EXCL) };

    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(windows)]
pub(crate) fn rename_exclusively(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    /// Win32 wants UTF-16, NUL-terminated.
    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(Some(0)).collect()
    }

    let (source, target) = (wide(from), wide(to));

    // `fs::rename` passes MOVEFILE_REPLACE_EXISTING; the whole point here is
    // not to. Without it MoveFileExW fails with ERROR_ALREADY_EXISTS, which
    // Rust maps to the AlreadyExists kind the callers are looking for.
    //
    // SAFETY: both are NUL-terminated wide strings that outlive the call.
    let moved = unsafe {
        windows_sys::Win32::Storage::FileSystem::MoveFileExW(source.as_ptr(), target.as_ptr(), 0)
    };

    if moved != 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
pub(crate) fn rename_exclusively(_from: &Path, _to: &Path) -> std::io::Result<()> {
    Err(std::io::Error::from(std::io::ErrorKind::Unsupported))
}

/// Whether a failure was "something is already there".
pub(crate) fn already_exists(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::AlreadyExists
}

/// Creates a file in `directory` named after `name` that nothing was using,
/// adding " 1", " 2" and so on before the extension the way a file manager
/// would. Hands back the file itself along with where it landed.
///
/// Creating rather than choosing a name and leaving the caller to write it:
/// asking whether a path is free and then writing to it are two moments, and
/// two attachments dropped at once are perfectly capable of both being told
/// that "photo.png" is free. `create_new` asks and answers in one step, so
/// the one that loses moves on to "photo 1.png" instead of writing over the
/// one that won.
pub(crate) fn create_unused(directory: &Path, name: &str) -> Result<(fs::File, PathBuf), String> {
    let stem = Path::new(name)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let extension = Path::new(name)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();

    let mut last = None;
    for n in 0..10_000 {
        let candidate = match n {
            0 => directory.join(name),
            _ => directory.join(format!("{} {}{}", stem, n, extension)),
        };

        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => return Ok((file, candidate)),
            Err(error) if already_exists(&error) => continue,
            Err(error) => last = Some(error.to_string()),
        }
    }

    Err(last.unwrap_or_else(|| format!("Could not find a free name for \"{}\"", name)))
}

/// The folder to actually file media in, preferring one already sitting there
/// under a different case.
///
/// macOS and Windows are case-insensitive but case-preserving, so asking for
/// "media" beside an existing "Media" quietly writes into the latter while
/// every path handed back still says "media". The sidebar reads those paths
/// literally and invents a second, empty folder that vanishes on the next
/// restart - and on Linux, where the names really are distinct, the vault ends
/// up with two media folders side by side.
pub(crate) fn preferred_directory(directory: &Path) -> std::path::PathBuf {
    if directory.exists() {
        return directory.to_path_buf();
    }

    let (Some(parent), Some(name)) = (directory.parent(), directory.file_name()) else {
        return directory.to_path_buf();
    };

    let wanted = name.to_string_lossy().to_lowercase();
    let Ok(siblings) = fs::read_dir(parent) else {
        return directory.to_path_buf();
    };

    for sibling in siblings.flatten() {
        if sibling.file_name().to_string_lossy().to_lowercase() == wanted && sibling.path().is_dir()
        {
            return sibling.path();
        }
    }

    directory.to_path_buf()
}

/// Copies the file at `path` beside itself, numbered the way a file manager
/// numbers a copy - "note.md" becomes "note 1.md", then "note 2.md" - and
/// returns where the copy landed. The copy is created with `create_unused`,
/// so it can never land on top of a file that appeared in the meantime, and
/// it takes the original's permissions. Folders are not duplicated.
#[tauri::command]
pub(crate) async fn duplicate_entry(
    window: tauri::WebviewWindow,
    path: String,
) -> Result<String, String> {
    off_thread(move || {
        let vault = vault_of(&window);
        let source = within_vault(&vault, Path::new(&path))?;
        let copy = duplicate_file(&source)?;
        note_changes(&window, &[&copy]);
        Ok(copy.to_string_lossy().into_owned())
    })
    .await
}

pub(crate) fn duplicate_file(source: &Path) -> Result<PathBuf, String> {
    let metadata = fs::metadata(source).map_err(|e| e.to_string())?;
    if metadata.is_dir() {
        return Err("Folders can't be duplicated yet".to_string());
    }

    let directory = source
        .parent()
        .ok_or_else(|| "The file has no folder to put a copy in".to_string())?;
    let name = source
        .file_name()
        .ok_or_else(|| "The file has no name".to_string())?
        .to_string_lossy();

    let (mut copy, copy_path) = create_unused(directory, &name)?;
    let written = fs::File::open(source)
        .and_then(|mut original| std::io::copy(&mut original, &mut copy))
        .and_then(|_| copy.sync_all());
    if let Err(error) = written {
        // Half a copy is worse than none.
        drop(copy);
        let _ = fs::remove_file(&copy_path);
        return Err(error.to_string());
    }
    drop(copy);
    let _ = fs::set_permissions(&copy_path, metadata.permissions());

    Ok(copy_path)
}

/// Which of `paths` are still files in the open vault, for reopening the tabs
/// of a session: a note deleted or moved since is one not to open a tab onto.
///
/// Asked of the disk rather than of the sidebar's tree, which is read a folder
/// at a time and knows nothing about a note in a folder nobody has opened yet.
#[tauri::command]
pub(crate) async fn existing_files(
    window: tauri::WebviewWindow,
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    off_thread(move || Ok(files_present(&vault_of(&window), paths))).await
}

#[tauri::command]
pub(crate) async fn read_file(
    window: tauri::WebviewWindow,
    path: String,
) -> Result<String, String> {
    off_thread(move || {
        let vault = vault_of(&window);
        let path = within_vault(&vault, Path::new(&path))?;
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        // Where the note stood when it was read, so a later write can tell
        // whether anything else has been at it in the meantime.
        remember(&vault, &path);
        Ok(content)
    })
    .await
}

/// Writes `bytes` to `path` without ever leaving what is already there half
/// replaced.
///
/// `fs::write` truncates the file and then writes it, and autosave runs several
/// times a minute per open note: a panic, a power cut or a full disk in the gap
/// between those two steps is a note that is empty or cut in half, with no
/// backup and nothing to roll back to. The bytes go to a temporary file beside
/// the target instead, are flushed all the way to the disk, and are then
/// renamed over it - a rename within one filesystem is atomic, so a reader sees
/// either the note as it was or the note as it now is, never the gap.
pub(crate) fn write_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    write_through_a_temporary(path, bytes, false)
}

/// The same write, for a file that is nobody's business but its owner's: the
/// edits kept outside the vault. A new one stays readable by them alone.
pub(crate) fn write_privately(path: &Path, bytes: &[u8]) -> Result<(), String> {
    write_through_a_temporary(path, bytes, true)
}

/// A temporary file in `directory`, with the permissions a new file there
/// would ordinarily get.
///
/// One made the default way is private to its owner, which is right for a
/// scratch file in `/tmp` and wrong for a note: saved to a new path, it came
/// out unreadable to a group it was shared with, or to whatever builds a site
/// out of the folder. Asking for the usual mode lets the umask have its say,
/// exactly as it does for a file made any other way.
fn temporary_in(directory: &Path, private: bool) -> std::io::Result<tempfile::NamedTempFile> {
    #[cfg(unix)]
    if !private {
        use std::os::unix::fs::PermissionsExt;
        return tempfile::Builder::new()
            .permissions(fs::Permissions::from_mode(0o666))
            .tempfile_in(directory);
    }
    let _ = private;
    tempfile::NamedTempFile::new_in(directory)
}

fn write_through_a_temporary(path: &Path, bytes: &[u8], private: bool) -> Result<(), String> {
    use std::io::Write;

    /// A failure in its own words, without the name of the temporary file it
    /// happened to be using. That name is this function's business; someone
    /// being told their note could not be saved has no use for it, and every
    /// save picks a different one.
    fn plainly(error: impl ToString) -> String {
        let said = error.to_string();
        match said.split_once(" at path ") {
            Some((reason, _)) => reason.to_string(),
            None => said,
        }
    }

    let directory = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| "Cannot write to this path".to_string())?;

    let mut file = temporary_in(directory, private).map_err(plainly)?;

    // A note that is already there keeps the permissions it has, whatever a
    // new file would have been given.
    if let Ok(existing) = fs::metadata(path) {
        let _ = file.as_file().set_permissions(existing.permissions());
    }

    file.write_all(bytes).map_err(plainly)?;
    // Ordering the write before the rename, rather than trusting that a rename
    // recorded after it means the contents reached the disk as well.
    file.as_file().sync_all().map_err(plainly)?;
    file.persist(path).map_err(plainly)?;

    Ok(())
}

/// Writes a note back, refusing if it has moved on since the app read it.
///
/// `force` is the answer to that refusal, and only ever comes from someone
/// being asked which copy they want to keep.
#[tauri::command]
pub(crate) async fn write_file(
    window: tauri::WebviewWindow,
    path: String,
    content: String,
    force: Option<bool>,
) -> Result<(), String> {
    off_thread(move || {
        let vault = vault_of(&window);
        let path = within_vault_to_write(&vault, Path::new(&path))?;

        if !force.unwrap_or(false) && changed_since_read(&vault, &path) {
            return Err(CHANGED_ON_DISK.to_string());
        }

        write_atomically(&path, content.as_bytes())?;
        remember(&vault, &path);
        note_changes(&window, &[&path]);
        Ok(())
    })
    .await
}
