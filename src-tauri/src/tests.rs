use crate::cli::OpenTarget;
use crate::files::{
    already_exists, create_unused, duplicate_file, exact_file_name, move_destination,
    opened_by_the_system, rename_no_replace, safe_file_name, times_of, write_atomically,
};
// Only asked about where a file has a mode to ask about.
#[cfg(unix)]
use crate::files::write_privately;
use crate::fonts::system_font_families;
use crate::index::VaultIndex;
use crate::media::{body_bytes, header_text, media_body, media_body_in_chunks, requested_path};
use crate::multiwindow::{
    folder_of, note_window_target, plan_restore, read_saved, route, usable_frame, Frame, Open,
    Quit, Quitting, Route, SavedWindow, Screen,
};
use crate::recovery::{
    drop_kept, kept_for, legacy_recovery_file, move_kept, moved_path, prune_kept, recovery_file,
    stable_hash, Recovery,
};
use crate::search::{search_index, search_notes, search_text, search_vault, ContentHit, Matcher};
use crate::slow::{run_all, run_one};
use crate::state::{
    changed_since_read, files_present, follow_move, locked, remember, within_vault,
    within_vault_to_create, within_vault_to_write, Vault, Windows,
};
use crate::tree::{
    list_folder_with, probe, read_dir_recursive, read_dir_recursive_with, FileEntry, Patience,
    Probe, Prober, MAX_TREE_DEPTH,
};
use crate::wiki::{scan_vault, vault_wiki_links, wiki_links_in};
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

/// The note as it stands on disk, for asserting a write actually landed.
fn contents(path: &Path) -> String {
    fs::read_to_string(path).expect("the note should be readable")
}

#[test]
fn writes_a_new_note() {
    let vault = tempfile::tempdir().unwrap();
    let note = vault.path().join("note.md");

    write_atomically(&note, b"hello").unwrap();

    assert_eq!(contents(&note), "hello");
}

#[test]
fn replaces_an_existing_note() {
    let vault = tempfile::tempdir().unwrap();
    let note = vault.path().join("note.md");
    fs::write(&note, "the long version of the note").unwrap();

    write_atomically(&note, b"short").unwrap();

    assert_eq!(contents(&note), "short");
}

/// The temporary file is an implementation detail; a vault that collects
/// one per autosave would be one the sidebar fills up with rubbish.
#[test]
fn leaves_nothing_behind_beside_the_note() {
    let vault = tempfile::tempdir().unwrap();
    let note = vault.path().join("note.md");

    write_atomically(&note, b"one").unwrap();
    write_atomically(&note, b"two").unwrap();

    let entries: Vec<_> = fs::read_dir(vault.path()).unwrap().flatten().collect();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].path(), note);
}

/// A note that was readable by the group or the world stays that way after
/// the app has saved it once.
#[cfg(unix)]
#[test]
fn keeps_the_permissions_the_note_already_had() {
    use std::os::unix::fs::PermissionsExt;

    let vault = tempfile::tempdir().unwrap();
    let note = vault.path().join("note.md");
    fs::write(&note, "before").unwrap();
    fs::set_permissions(&note, fs::Permissions::from_mode(0o644)).unwrap();

    write_atomically(&note, b"after").unwrap();

    let mode = fs::metadata(&note).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o644);
}

/// A note saved to a path of its own for the first time is as readable as a
/// file made any other way - not private to its owner, as a temporary file is.
#[cfg(unix)]
#[test]
fn a_new_note_gets_the_permissions_any_new_file_would() {
    use std::os::unix::fs::PermissionsExt;

    let vault = tempfile::tempdir().unwrap();
    let note = vault.path().join("note.md");
    let ordinary = vault.path().join("ordinary.md");
    fs::write(&ordinary, "made the usual way").unwrap();

    write_atomically(&note, b"hello").unwrap();

    let mode = |path: &Path| fs::metadata(path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(&note), mode(&ordinary));
}

/// What is kept outside the vault is the owner's alone, whatever the umask.
#[cfg(unix)]
#[test]
fn a_private_write_stays_private() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempfile::tempdir().unwrap();
    let kept = dir.path().join("kept.json");

    write_privately(&kept, b"{}").unwrap();

    let mode = fs::metadata(&kept).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
}

/// A write into a folder that is not there fails outright rather than
/// reporting success over a note that was never saved.
#[test]
fn refuses_a_directory_that_is_not_there() {
    let vault = tempfile::tempdir().unwrap();
    let note = vault.path().join("missing").join("note.md");

    assert!(write_atomically(&note, b"hello").is_err());
}

/// A vault with `root` open and nothing chosen by hand.
fn opened(root: &Path) -> Vault {
    Vault {
        root: Mutex::new(Some(root.canonicalize().unwrap())),
        ..Default::default()
    }
}

#[test]
fn allows_a_note_in_the_vault() {
    let dir = tempfile::tempdir().unwrap();
    let vault = opened(dir.path());
    let note = dir.path().join("note.md");
    fs::write(&note, "hello").unwrap();

    assert!(within_vault(&vault, &note).is_ok());
}

#[test]
fn refuses_a_file_outside_the_vault() {
    let dir = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let vault = opened(dir.path());
    let secret = elsewhere.path().join("secret.md");
    fs::write(&secret, "hello").unwrap();

    assert!(within_vault(&vault, &secret).is_err());
}

/// Nothing at all is reachable until a folder has been opened.
#[test]
fn refuses_everything_with_no_vault_open() {
    let dir = tempfile::tempdir().unwrap();
    let note = dir.path().join("note.md");
    fs::write(&note, "hello").unwrap();

    assert!(within_vault(&Vault::default(), &note).is_err());
}

/// Two windows on two folders are two vaults: a note in one's folder is
/// nothing to the other, and opening a folder in one does not move the other.
#[test]
fn windows_keep_their_own_folder() {
    let first_dir = tempfile::tempdir().unwrap();
    let second_dir = tempfile::tempdir().unwrap();
    let first_note = first_dir.path().join("note.md");
    let second_note = second_dir.path().join("note.md");
    fs::write(&first_note, "one").unwrap();
    fs::write(&second_note, "two").unwrap();

    let windows = Windows::default();
    *locked(&windows.vault("main").root) = Some(first_dir.path().canonicalize().unwrap());
    *locked(&windows.vault("w-1").root) = Some(second_dir.path().canonicalize().unwrap());

    assert!(within_vault(&windows.vault("main"), &first_note).is_ok());
    assert!(within_vault(&windows.vault("main"), &second_note).is_err());
    assert!(within_vault(&windows.vault("w-1"), &second_note).is_ok());
    assert!(within_vault(&windows.vault("w-1"), &first_note).is_err());
}

/// A window nobody has opened a folder in refuses everything, whatever the
/// other windows have open.
#[test]
fn a_new_window_starts_with_nothing_open() {
    let dir = tempfile::tempdir().unwrap();
    let note = dir.path().join("note.md");
    fs::write(&note, "hello").unwrap();

    let windows = Windows::default();
    *locked(&windows.vault("main").root) = Some(dir.path().canonicalize().unwrap());

    assert!(within_vault(&windows.vault("w-new"), &note).is_err());
}

/// Asking twice for the same window is the same vault, so what one command
/// records is what the next one sees.
#[test]
fn a_window_gets_the_same_vault_each_time() {
    let dir = tempfile::tempdir().unwrap();
    let note = dir.path().join("note.md");
    fs::write(&note, "hello").unwrap();

    let windows = Windows::default();
    remember(&windows.vault("main"), &note);
    fs::write(&note, "changed, and longer").unwrap();
    // Some filesystems keep a second's resolution; make the move unmistakable.
    let later = SystemTime::now() + std::time::Duration::from_secs(5);
    fs::File::options()
        .write(true)
        .open(&note)
        .unwrap()
        .set_modified(later)
        .unwrap();

    assert!(changed_since_read(&windows.vault("main"), &note));
    assert!(!changed_since_read(&windows.vault("w-1"), &note));
}

/// A note one window has read is not one another has: each notices a change
/// to it for itself.
#[test]
fn windows_track_what_they_have_read_separately() {
    let dir = tempfile::tempdir().unwrap();
    let note = dir.path().join("note.md");
    fs::write(&note, "hello").unwrap();

    let windows = Windows::default();
    remember(&windows.vault("main"), &note);
    remember(&windows.vault("w-1"), &note);
    let later = SystemTime::now() + std::time::Duration::from_secs(5);
    fs::File::options()
        .write(true)
        .open(&note)
        .unwrap()
        .set_modified(later)
        .unwrap();
    // `w-1` reads the new version; `main` still holds the old one.
    remember(&windows.vault("w-1"), &note);

    assert!(changed_since_read(&windows.vault("main"), &note));
    assert!(!changed_since_read(&windows.vault("w-1"), &note));
}

/// Closing a window lets go of its vault, and a window of the same name
/// afterwards starts clean.
#[test]
fn closing_a_window_forgets_its_vault() {
    let dir = tempfile::tempdir().unwrap();
    let windows = Windows::default();
    *locked(&windows.vault("w-1").root) = Some(dir.path().canonicalize().unwrap());

    let watching = std::sync::Arc::downgrade(&windows.vault("w-1"));
    windows.remove("w-1");

    assert!(watching.upgrade().is_none());
    assert!(locked(&windows.vault("w-1").root).is_none());
}

/// The reason paths are resolved rather than compared as text.
#[test]
fn refuses_a_way_out_through_dot_dot() {
    let dir = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let vault = opened(dir.path());
    let secret = elsewhere.path().join("secret.md");
    fs::write(&secret, "hello").unwrap();

    let climbing = dir.path().join("..").join(
        elsewhere
            .path()
            .file_name()
            .map(Path::new)
            .unwrap()
            .join("secret.md"),
    );
    assert!(within_vault(&vault, &climbing).is_err());
}

/// A symlink inside the vault pointing out of it is a way out too.
#[cfg(unix)]
#[test]
fn refuses_a_way_out_through_a_symlink() {
    let dir = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let vault = opened(dir.path());
    let secret = elsewhere.path().join("secret.md");
    fs::write(&secret, "hello").unwrap();

    let link = dir.path().join("looks-like-a-note.md");
    std::os::unix::fs::symlink(&secret, &link).unwrap();

    assert!(within_vault(&vault, &link).is_err());
    assert!(within_vault_to_write(&vault, &link).is_err());
}

/// A new note has nothing to resolve, so its parent is what is checked -
/// which is also what stops a "name" that is really a path.
#[test]
fn checks_the_parent_of_something_being_created() {
    let dir = tempfile::tempdir().unwrap();
    let vault = opened(dir.path());

    assert!(within_vault_to_create(&vault, &dir.path().join("new.md")).is_ok());
    assert!(within_vault_to_create(&vault, &dir.path().join("../escaped.md")).is_err());
}

/// A note deleted from under the app is still one the app may write back.
#[test]
fn allows_writing_back_a_note_that_has_gone_missing() {
    let dir = tempfile::tempdir().unwrap();
    let vault = opened(dir.path());

    assert!(within_vault_to_write(&vault, &dir.path().join("vanished.md")).is_ok());
}

/// Moves `path`'s modification time on, the way another editor writing to
/// it would - explicitly rather than by writing twice and hoping the clock
/// noticed.
fn touch(path: &Path) {
    let file = fs::OpenOptions::new().write(true).open(path).unwrap();
    let later = SystemTime::now() + std::time::Duration::from_secs(5);
    file.set_times(fs::FileTimes::new().set_modified(later))
        .unwrap();
}

/// A note the app has never read is not out of date with anything.
#[test]
fn a_note_never_read_has_not_changed() {
    let dir = tempfile::tempdir().unwrap();
    let vault = opened(dir.path());
    let note = dir.path().join("note.md");
    fs::write(&note, "hello").unwrap();

    assert!(!changed_since_read(&vault, &note));
}

#[test]
fn a_note_nobody_touched_has_not_changed() {
    let dir = tempfile::tempdir().unwrap();
    let vault = opened(dir.path());
    let note = dir.path().join("note.md");
    fs::write(&note, "hello").unwrap();
    remember(&vault, &note);

    assert!(!changed_since_read(&vault, &note));
}

/// A renamed note is still a note that was read: a change made to it
/// elsewhere afterwards has to be noticed under its new name.
#[test]
fn a_renamed_note_is_still_watched_for_changes() {
    let dir = tempfile::tempdir().unwrap();
    let vault = opened(dir.path());
    let root = dir.path().canonicalize().unwrap();
    let (old, new) = (root.join("a.md"), root.join("b.md"));
    fs::write(&old, "hello").unwrap();
    remember(&vault, &old);

    fs::rename(&old, &new).unwrap();
    follow_move(&vault, &old, &new);
    assert!(!changed_since_read(&vault, &new));

    touch(&new);

    assert!(changed_since_read(&vault, &new));
    assert!(!locked(&vault.known).contains_key(&old));
}

/// Moving a folder moves every note that was read from inside it.
#[test]
fn notes_in_a_moved_folder_are_still_watched_for_changes() {
    let dir = tempfile::tempdir().unwrap();
    let vault = opened(dir.path());
    let root = dir.path().canonicalize().unwrap();
    fs::create_dir_all(root.join("drafts").join("deep")).unwrap();
    let note = root.join("drafts").join("deep").join("note.md");
    let beside = root.join("drafts-old.md");
    fs::write(&note, "hello").unwrap();
    fs::write(&beside, "hello").unwrap();
    remember(&vault, &note);
    remember(&vault, &beside);

    fs::rename(root.join("drafts"), root.join("archive")).unwrap();
    follow_move(&vault, &root.join("drafts"), &root.join("archive"));

    let landed = root.join("archive").join("deep").join("note.md");
    touch(&landed);
    assert!(changed_since_read(&vault, &landed));
    // A name that only starts the same way is not inside the folder.
    assert!(locked(&vault.known).contains_key(&beside));
}

/// A change that arrived before the rename is not waved through by it.
#[test]
fn a_rename_does_not_forgive_an_earlier_change() {
    let dir = tempfile::tempdir().unwrap();
    let vault = opened(dir.path());
    let root = dir.path().canonicalize().unwrap();
    let (old, new) = (root.join("a.md"), root.join("b.md"));
    fs::write(&old, "hello").unwrap();
    remember(&vault, &old);
    touch(&old);

    fs::rename(&old, &new).unwrap();
    follow_move(&vault, &old, &new);

    assert!(changed_since_read(&vault, &new));
}

/// Reopening a session asks which of its notes are still there, wherever in
/// the vault they are - not only at the top of it.
#[test]
fn finds_the_notes_of_a_session_that_are_still_there() {
    let dir = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let vault = opened(dir.path());
    fs::create_dir_all(dir.path().join("folder").join("deeper")).unwrap();
    let top = dir.path().join("top.md");
    let nested = dir.path().join("folder").join("deeper").join("nested.md");
    let outside = elsewhere.path().join("outside.md");
    for note in [&top, &nested, &outside] {
        fs::write(note, "hello").unwrap();
    }
    let text = |path: &Path| path.to_string_lossy().into_owned();

    let found = files_present(
        &vault,
        vec![
            text(&nested),
            text(&dir.path().join("gone.md")),
            text(&dir.path().join("folder")),
            text(&outside),
            text(&top),
        ],
    );

    assert_eq!(found, vec![text(&nested), text(&top)]);
}

/// The case the whole thing exists for: something else wrote to the note
/// after the app read it.
#[test]
fn a_note_written_elsewhere_has_changed() {
    let dir = tempfile::tempdir().unwrap();
    let vault = opened(dir.path());
    let note = dir.path().join("note.md");
    fs::write(&note, "hello").unwrap();
    remember(&vault, &note);

    touch(&note);

    assert!(changed_since_read(&vault, &note));
}

/// A note deleted from under the app is not what the app holds either.
#[test]
fn a_note_deleted_elsewhere_has_changed() {
    let dir = tempfile::tempdir().unwrap();
    let vault = opened(dir.path());
    let note = dir.path().join("note.md");
    fs::write(&note, "hello").unwrap();
    remember(&vault, &note);

    fs::remove_file(&note).unwrap();

    assert!(changed_since_read(&vault, &note));
}

/// The app's own save is not an external change: writing records where the
/// note now stands, so the next write is not refused over it.
#[test]
fn the_apps_own_write_is_not_a_change() {
    let dir = tempfile::tempdir().unwrap();
    let vault = opened(dir.path());
    let note = dir.path().join("note.md");
    fs::write(&note, "hello").unwrap();
    remember(&vault, &note);

    touch(&note);
    assert!(changed_since_read(&vault, &note));

    // What write_file does once it has written.
    write_atomically(&note, b"ours").unwrap();
    remember(&vault, &note);

    assert!(!changed_since_read(&vault, &note));
}

/// What `convertFileSrc` puts in the URI, read back out of it.
#[test]
fn reads_the_path_a_media_request_is_asking_for() {
    let uri: tauri::http::Uri = "nuza-media://localhost/%2Fvault%2Fmedia%2Fphoto.png"
        .parse()
        .unwrap();

    assert_eq!(requested_path(&uri), "/vault/media/photo.png");
}

/// A space, and anything else a filename is allowed to contain.
#[test]
fn reads_a_path_with_characters_that_had_to_be_encoded() {
    let uri: tauri::http::Uri = "nuza-media://localhost/%2Fvault%2Fa%20note%20(1).png"
        .parse()
        .unwrap();

    assert_eq!(requested_path(&uri), "/vault/a note (1).png");
}

/// A media file for the range tests, 26 bytes of known content.
fn alphabet(dir: &Path) -> (fs::File, u64) {
    let path = dir.join("media.bin");
    fs::write(&path, b"abcdefghijklmnopqrstuvwxyz").unwrap();
    let file = fs::File::open(&path).unwrap();
    let length = file.metadata().unwrap().len();
    (file, length)
}

#[test]
fn a_request_with_no_range_gets_the_whole_file() {
    let dir = tempfile::tempdir().unwrap();
    let (mut file, length) = alphabet(dir.path());

    let (bytes, content_range, status) = media_body(&mut file, length, None).unwrap();

    assert_eq!(bytes, b"abcdefghijklmnopqrstuvwxyz");
    assert_eq!(content_range, None);
    assert_eq!(status, 200);
}

/// The reason ranges are handled at all: a video is fetched in pieces, and
/// answering every request with the whole file is a video that cannot be
/// seeked.
#[test]
fn a_request_for_part_of_a_file_gets_that_part() {
    let dir = tempfile::tempdir().unwrap();
    let (mut file, length) = alphabet(dir.path());

    let (bytes, content_range, status) = media_body(&mut file, length, Some("bytes=3-7")).unwrap();

    assert_eq!(bytes, b"defgh");
    assert_eq!(content_range.as_deref(), Some("bytes 3-7/26"));
    assert_eq!(status, 206);
}

/// An open-ended range runs to the end of the file.
#[test]
fn a_request_from_a_point_onwards_runs_to_the_end() {
    let dir = tempfile::tempdir().unwrap();
    let (mut file, length) = alphabet(dir.path());

    let (bytes, content_range, _) = media_body(&mut file, length, Some("bytes=20-")).unwrap();

    assert_eq!(bytes, b"uvwxyz");
    assert_eq!(content_range.as_deref(), Some("bytes 20-25/26"));
}

/// "From here to the end" of a large file is answered a piece at a time: the
/// player comes back for the rest, and the rest is not held in memory for it.
#[test]
fn an_open_ended_request_gets_one_chunk() {
    let dir = tempfile::tempdir().unwrap();
    let (mut file, length) = alphabet(dir.path());

    let (bytes, content_range, status) =
        media_body_in_chunks(&mut file, length, Some("bytes=0-"), 10).unwrap();
    assert_eq!(bytes, b"abcdefghij");
    assert_eq!(content_range.as_deref(), Some("bytes 0-9/26"));
    assert_eq!(status, 206);

    // The last piece is whatever is left, not a chunk's worth.
    let (bytes, content_range, _) =
        media_body_in_chunks(&mut file, length, Some("bytes=20-"), 10).unwrap();
    assert_eq!(bytes, b"uvwxyz");
    assert_eq!(content_range.as_deref(), Some("bytes 20-25/26"));
}

/// A request with no range is an `<img>`, and gets the whole picture however
/// large it is.
#[test]
fn a_request_with_no_range_is_not_cut_short() {
    let dir = tempfile::tempdir().unwrap();
    let (mut file, length) = alphabet(dir.path());

    let (bytes, _, status) = media_body_in_chunks(&mut file, length, None, 10).unwrap();

    assert_eq!(bytes.len(), 26);
    assert_eq!(status, 200);
}

/// A range header that makes no sense is not worth refusing over - the
/// whole file is a correct answer to "give me this file".
#[test]
fn a_range_that_cannot_be_read_gets_the_whole_file() {
    let dir = tempfile::tempdir().unwrap();
    let (mut file, length) = alphabet(dir.path());

    let (bytes, content_range, status) = media_body(&mut file, length, Some("pages=1-2")).unwrap();

    assert_eq!(bytes.len(), 26);
    assert_eq!(content_range, None);
    assert_eq!(status, 200);
}

/// The ordinary case: nothing is in the way and the note moves.
#[test]
fn renames_a_note() {
    let dir = tempfile::tempdir().unwrap();
    let from = dir.path().join("note.md");
    let to = dir.path().join("renamed.md");
    fs::write(&from, "hello").unwrap();

    rename_no_replace(&from, &to).unwrap();

    assert!(!from.exists());
    assert_eq!(contents(&to), "hello");
}

/// The one this exists for. `fs::rename` replaces the destination without
/// a word on Unix, so a note that happened to be there would be gone - and
/// the `exists()` check that used to be the only guard cannot see anything
/// created after it ran.
#[test]
fn refuses_to_rename_over_a_note_that_is_already_there() {
    let dir = tempfile::tempdir().unwrap();
    let from = dir.path().join("note.md");
    let to = dir.path().join("taken.md");
    fs::write(&from, "mine").unwrap();
    fs::write(&to, "someone else's").unwrap();

    let error = rename_no_replace(&from, &to).unwrap_err();

    assert!(
        already_exists(&error),
        "expected AlreadyExists, got {error:?}"
    );
    // Both are still there, and neither has been touched.
    assert_eq!(contents(&from), "mine");
    assert_eq!(contents(&to), "someone else's");
}

/// A folder in the way counts too - that one loses a whole subtree.
#[test]
fn refuses_to_rename_over_a_folder_that_is_already_there() {
    let dir = tempfile::tempdir().unwrap();
    let from = dir.path().join("notes");
    let to = dir.path().join("taken");
    fs::create_dir(&from).unwrap();
    fs::create_dir(&to).unwrap();
    fs::write(to.join("kept.md"), "still here").unwrap();

    assert!(rename_no_replace(&from, &to).is_err());
    assert_eq!(contents(&to.join("kept.md")), "still here");
}

#[test]
fn a_dropped_file_keeps_its_name_when_nothing_is_using_it() {
    let dir = tempfile::tempdir().unwrap();

    let (_, path) = create_unused(dir.path(), "photo.png").unwrap();

    assert_eq!(path, dir.path().join("photo.png"));
    assert!(path.exists());
}

/// Two attachments with the same name land beside each other rather than
/// one on top of the other.
#[test]
fn a_dropped_file_is_numbered_rather_than_written_over() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("photo.png"), "the first one").unwrap();

    let (_, path) = create_unused(dir.path(), "photo.png").unwrap();
    assert_eq!(path, dir.path().join("photo 1.png"));

    let (_, next) = create_unused(dir.path(), "photo.png").unwrap();
    assert_eq!(next, dir.path().join("photo 2.png"));

    // And the one that was there is untouched.
    assert_eq!(contents(&dir.path().join("photo.png")), "the first one");
}

/// The file comes back open, because creating it and writing it are the
/// same act - anything else is another gap for someone to write into.
#[test]
fn a_dropped_file_comes_back_ready_to_write() {
    use std::io::Write;

    let dir = tempfile::tempdir().unwrap();
    let (mut file, path) = create_unused(dir.path(), "photo.png").unwrap();

    file.write_all(b"the bytes").unwrap();
    drop(file);

    assert_eq!(contents(&path), "the bytes");
}

/// A name with no extension is numbered on the end rather than in the
/// middle of nothing.
#[test]
fn a_dropped_file_with_no_extension_is_numbered_too() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("scan"), "first").unwrap();

    let (_, path) = create_unused(dir.path(), "scan").unwrap();

    assert_eq!(path, dir.path().join("scan 1"));
}

/// A recovery file is named after the note's path, and two paths can in
/// principle hash to the same name. The path is recorded inside the file
/// so that one which does is not handed back as the other's edits.
#[test]
fn a_recovery_knows_which_note_it_belongs_to() {
    let kept = Recovery {
        path: "/vault/note.md".to_string(),
        content: "what was typed".to_string(),
    };
    let json = serde_json::to_vec(&kept).unwrap();

    let read: Recovery = serde_json::from_slice(&json).unwrap();
    assert_eq!(read.path, "/vault/note.md");
    assert_eq!(read.content, "what was typed");
}

/// One name per note, and a different one for a different note.
#[test]
fn a_note_is_kept_under_a_name_of_its_own() {
    let dir = Path::new("/recovery");

    assert_eq!(
        recovery_file(dir, "/vault/note.md"),
        recovery_file(dir, "/vault/note.md")
    );
    assert_ne!(
        recovery_file(dir, "/vault/note.md"),
        recovery_file(dir, "/vault/other.md")
    );
    // A path is not a filename: what lands in the directory is one.
    let file = recovery_file(dir, "/vault/deep/note.md");
    assert_eq!(file.parent(), Some(dir));
    assert!(file.extension().is_some_and(|e| e == "json"));
}

/// The name of a kept file must not change from one build to the next, so the
/// hash behind it is pinned to values worked out by hand from its definition.
#[test]
fn the_name_of_a_kept_file_never_changes() {
    assert_eq!(stable_hash(""), 0xcbf2_9ce4_8422_2325);
    assert_eq!(stable_hash("a"), 0xaf63_dc4c_8601_ec8c);
    assert_eq!(stable_hash("foobar"), 0x8594_4171_f739_67e8);
}

fn keep(file: &Path, note: &str, content: &str) {
    let kept = Recovery {
        path: note.to_string(),
        content: content.to_string(),
    };
    fs::write(file, serde_json::to_vec(&kept).unwrap()).unwrap();
}

/// What a build from before the fixed hash kept is still found, and let go
/// of when the question is answered.
#[test]
fn edits_kept_by_an_older_build_are_still_found() {
    let dir = tempfile::tempdir().unwrap();
    let note = "/vault/note.md";
    keep(
        &legacy_recovery_file(dir.path(), note),
        note,
        "typed last year",
    );

    assert_eq!(
        kept_for(dir.path(), note).as_deref(),
        Some("typed last year")
    );

    drop_kept(dir.path(), note).unwrap();
    assert_eq!(kept_for(dir.path(), note), None);
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
}

/// A file under the old name that belongs to some other note is not this
/// note's to read or to throw away.
#[test]
fn another_notes_file_is_left_alone() {
    let dir = tempfile::tempdir().unwrap();
    let file = legacy_recovery_file(dir.path(), "/vault/note.md");
    keep(&file, "/vault/other.md", "someone else's");

    assert_eq!(kept_for(dir.path(), "/vault/note.md"), None);
    drop_kept(dir.path(), "/vault/note.md").unwrap();
    assert!(file.exists());
}

#[test]
fn a_path_moves_with_the_folder_it_is_in() {
    assert_eq!(
        moved_path("/v/a.md", "/v/a.md", "/v/b.md").as_deref(),
        Some("/v/b.md")
    );
    assert_eq!(
        moved_path("/v/old/deep/a.md", "/v/old", "/v/new").as_deref(),
        Some("/v/new/deep/a.md")
    );
    assert_eq!(
        moved_path("C:\\v\\old\\a.md", "C:\\v\\old", "C:\\v\\new").as_deref(),
        Some("C:\\v\\new\\a.md")
    );
    // A name that only starts the same way is not inside the folder.
    assert_eq!(moved_path("/v/older.md", "/v/old", "/v/new"), None);
    assert_eq!(moved_path("/v/elsewhere.md", "/v/old", "/v/new"), None);
}

/// Edits kept for a note go where the note goes: renamed, or carried along
/// inside a folder that was.
#[test]
fn kept_edits_follow_a_rename() {
    let dir = tempfile::tempdir().unwrap();
    keep(
        &recovery_file(dir.path(), "/v/old/a.md"),
        "/v/old/a.md",
        "in the folder",
    );
    keep(
        &legacy_recovery_file(dir.path(), "/v/old/b.md"),
        "/v/old/b.md",
        "from an older build",
    );
    keep(
        &recovery_file(dir.path(), "/v/other.md"),
        "/v/other.md",
        "not moved",
    );

    move_kept(dir.path(), "/v/old", "/v/new");

    assert_eq!(
        kept_for(dir.path(), "/v/new/a.md").as_deref(),
        Some("in the folder")
    );
    assert_eq!(
        kept_for(dir.path(), "/v/new/b.md").as_deref(),
        Some("from an older build")
    );
    assert_eq!(kept_for(dir.path(), "/v/old/a.md"), None);
    assert_eq!(
        kept_for(dir.path(), "/v/other.md").as_deref(),
        Some("not moved")
    );
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 3);
}

/// Only what nobody will be asked about goes: old, and for a note that is
/// not there. A buffer whose note still exists is kept however old it is.
#[test]
fn only_old_edits_for_notes_that_are_gone_are_let_go() {
    let dir = tempfile::tempdir().unwrap();
    let vault = tempfile::tempdir().unwrap();
    let there = vault.path().join("there.md");
    fs::write(&there, "hello").unwrap();
    let there = there.to_string_lossy().into_owned();
    let gone = vault.path().join("gone.md").to_string_lossy().into_owned();

    keep(&recovery_file(dir.path(), &there), &there, "still wanted");
    keep(&recovery_file(dir.path(), &gone), &gone, "nobody to ask");
    fs::write(dir.path().join("broken.json"), "not json").unwrap();
    fs::write(dir.path().join("notes.txt"), "not ours").unwrap();

    // Nothing is old enough yet.
    prune_kept(dir.path(), Duration::from_secs(3600));
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 4);

    prune_kept(dir.path(), Duration::ZERO);
    assert_eq!(
        kept_for(dir.path(), &there).as_deref(),
        Some("still wanted")
    );
    assert_eq!(kept_for(dir.path(), &gone), None);
    assert!(!dir.path().join("broken.json").exists());
    assert!(dir.path().join("notes.txt").exists());
}

/// Saving the scratch note somewhere by hand is consent for that file, and
/// for nothing else in the folder it landed in.
#[test]
fn allows_only_the_file_a_dialog_chose() {
    let dir = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let chosen = elsewhere.path().join("saved.md");
    let neighbour = elsewhere.path().join("neighbour.md");
    fs::write(&chosen, "hello").unwrap();
    fs::write(&neighbour, "hello").unwrap();

    let vault = opened(dir.path());
    locked(&vault.chosen).insert(chosen.canonicalize().unwrap());

    assert!(within_vault(&vault, &chosen).is_ok());
    assert!(within_vault(&vault, &neighbour).is_err());
}

/// A dropped file keeps the name it came with when there is nothing wrong
/// with it.
#[test]
fn leaves_an_ordinary_name_alone() {
    assert_eq!(safe_file_name("photo.png").unwrap(), "photo.png");
    assert_eq!(
        safe_file_name("Notes from 2026 (draft).md").unwrap(),
        "Notes from 2026 (draft).md"
    );
}

/// The name on a dropped file is whatever the sending app put there, and
/// only the last component of it is a name.
#[test]
fn tidies_a_dropped_name_into_one_component() {
    assert_eq!(safe_file_name("../../photo.png").unwrap(), "photo.png");
    assert_eq!(
        safe_file_name("C:\\Windows\\photo.png").unwrap(),
        "photo.png"
    );
    assert_eq!(safe_file_name(".hidden.png").unwrap(), "hidden.png");
}

/// `:` is an NTFS alternate data stream: bytes written to `note.md:hidden`
/// do not show up in the file tree, or in the file's own size.
#[test]
fn takes_the_stream_separator_out_of_a_dropped_name() {
    assert_eq!(safe_file_name("note.md:hidden").unwrap(), "note.mdhidden");
    assert_eq!(safe_file_name("what?.png").unwrap(), "what.png");
}

/// Win32 drops trailing dots and spaces on the way to disk, so a name that
/// ends in one is not the name that lands - and `unused_path` would then be
/// checking whether the wrong path is free.
#[test]
fn takes_trailing_dots_and_spaces_off_a_dropped_name() {
    assert_eq!(safe_file_name("report.").unwrap(), "report");
    assert_eq!(safe_file_name("report. . ").unwrap(), "report");
}

#[test]
fn refuses_a_dropped_name_with_nothing_usable_left() {
    assert!(safe_file_name("..").is_err());
    assert!(safe_file_name("/").is_err());
    assert!(safe_file_name("   ").is_err());
    assert!(safe_file_name(":?*").is_err());
}

/// Reserved whatever is put after them: Win32 reads the stem, so `aux.md`
/// is the printer port and not a note.
#[test]
fn refuses_a_reserved_device_name() {
    assert!(safe_file_name("aux.md").is_err());
    assert!(safe_file_name("CON").is_err());
    assert!(safe_file_name("lpt1.txt").is_err());
    assert!(safe_file_name("auxiliary.md").is_ok());
}

/// A typed name is taken exactly as typed, or refused. The row the sidebar
/// draws is built from what was typed, so a file quietly written under a
/// different name is one the tree cannot find again.
#[test]
fn takes_a_typed_name_only_as_it_was_typed() {
    assert_eq!(exact_file_name("note.md").unwrap(), "note.md");
    assert_eq!(exact_file_name("  note.md  ").unwrap(), "note.md");

    for typed in [
        "../../notes.md",
        "sub/note.md",
        ".hidden",
        "note.md:x",
        "report.",
        "aux.md",
    ] {
        assert!(exact_file_name(typed).is_err(), "{typed} should be refused");
    }
}

/// A vault with `root` open, a folder in it, and a note in the folder.
fn vault_with_a_folder() -> (tempfile::TempDir, Vault) {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("folder")).unwrap();
    fs::create_dir(dir.path().join("folder").join("inner")).unwrap();
    fs::write(dir.path().join("note.md"), "hello").unwrap();
    let vault = opened(dir.path());
    (dir, vault)
}

#[test]
fn moves_a_note_into_a_folder() {
    let (dir, vault) = vault_with_a_folder();

    let (old, new) = move_destination(
        &vault,
        dir.path().join("note.md").to_str().unwrap(),
        dir.path().join("folder").to_str().unwrap(),
    )
    .unwrap();

    assert_eq!(old, dir.path().canonicalize().unwrap().join("note.md"));
    assert_eq!(new.file_name().unwrap(), "note.md");
    assert!(new.starts_with(dir.path().canonicalize().unwrap().join("folder")));
}

/// The move that loses a subtree if it goes through.
#[test]
fn refuses_moving_a_folder_into_its_own_child() {
    let (dir, vault) = vault_with_a_folder();
    let folder = dir.path().join("folder");

    assert!(move_destination(
        &vault,
        folder.to_str().unwrap(),
        folder.join("inner").to_str().unwrap(),
    )
    .is_err());

    // The same move, spelled so that a textual comparison would let it
    // past: the target does not start with the folder as written.
    assert!(move_destination(
        &vault,
        folder.to_str().unwrap(),
        folder
            .join("..")
            .join("folder")
            .join("inner")
            .to_str()
            .unwrap(),
    )
    .is_err());
}

/// And through a symlink, which no amount of string comparison would catch.
#[cfg(unix)]
#[test]
fn refuses_moving_a_folder_into_itself_through_a_symlink() {
    let (dir, vault) = vault_with_a_folder();
    let folder = dir.path().join("folder");
    let link = dir.path().join("shortcut");
    std::os::unix::fs::symlink(folder.join("inner"), &link).unwrap();

    assert!(move_destination(&vault, folder.to_str().unwrap(), link.to_str().unwrap()).is_err());
}

/// Dropping a note onto a file rather than a folder says so, instead of
/// handing the OS a path with a file in the middle of it.
#[test]
fn refuses_moving_into_something_that_is_not_a_folder() {
    let (dir, vault) = vault_with_a_folder();
    let other = dir.path().join("other.md");
    fs::write(&other, "hello").unwrap();

    assert!(move_destination(
        &vault,
        dir.path().join("note.md").to_str().unwrap(),
        other.to_str().unwrap(),
    )
    .is_err());
}

/// The names in a listing, folders marked with a trailing slash.
fn names(entries: &[FileEntry]) -> Vec<String> {
    entries
        .iter()
        .map(|entry| {
            if entry.is_directory {
                format!("{}/", entry.name)
            } else {
                entry.name.clone()
            }
        })
        .collect()
}

#[test]
fn reads_folders_first_then_by_name() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("b.md"), "").unwrap();
    fs::write(dir.path().join("A.md"), "").unwrap();
    fs::create_dir(dir.path().join("notes")).unwrap();
    fs::write(dir.path().join("notes").join("inner.md"), "").unwrap();
    fs::create_dir(dir.path().join(".git")).unwrap();

    let tree = read_dir_recursive(dir.path()).unwrap();
    assert_eq!(names(&tree), ["notes/", "A.md", "b.md"]);
    assert_eq!(names(tree[0].children.as_ref().unwrap()), ["inner.md"]);
    assert!(tree[1].children.is_none());
    // Every platform records when a file was last written.
    assert!(tree.iter().all(|entry| entry.modified.is_some()));
}

/// Past the depth cap a folder is listed, with nothing read inside it.
#[test]
fn stops_reading_at_the_depth_cap() {
    let dir = tempfile::tempdir().unwrap();
    let mut deepest = dir.path().to_path_buf();
    for _ in 0..MAX_TREE_DEPTH + 2 {
        deepest.push("d");
    }
    fs::create_dir_all(&deepest).unwrap();

    let tree = read_dir_recursive(dir.path()).unwrap();
    let mut level: &[FileEntry] = &tree;
    let mut depth = 1;
    while let Some(children) = level.first().and_then(|entry| entry.children.as_deref()) {
        if children.is_empty() {
            break;
        }
        level = children;
        depth += 1;
    }
    assert_eq!(depth, MAX_TREE_DEPTH);
}

/// `ln -s . loop` used to be walked until the stack overflowed.
#[cfg(unix)]
#[test]
fn leaves_out_a_link_back_up_the_tree() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("notes")).unwrap();
    fs::write(dir.path().join("notes").join("a.md"), "").unwrap();
    std::os::unix::fs::symlink(dir.path(), dir.path().join("notes").join("up")).unwrap();
    std::os::unix::fs::symlink(".", dir.path().join("loop")).unwrap();

    let tree = read_dir_recursive(dir.path()).unwrap();
    assert_eq!(names(&tree), ["notes/"]);
    assert_eq!(names(tree[0].children.as_ref().unwrap()), ["a.md"]);
}

/// Nothing through a link out of the vault could be opened, so it is not listed.
#[cfg(unix)]
#[test]
fn leaves_out_a_link_to_a_folder_outside_the_vault() {
    let dir = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    fs::write(elsewhere.path().join("secret.md"), "").unwrap();
    std::os::unix::fs::symlink(elsewhere.path(), dir.path().join("out")).unwrap();

    assert!(read_dir_recursive(dir.path()).unwrap().is_empty());
}

#[cfg(unix)]
#[test]
fn follows_a_link_to_another_folder_in_the_vault() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("real")).unwrap();
    fs::write(dir.path().join("real").join("a.md"), "").unwrap();
    std::os::unix::fs::symlink(dir.path().join("real"), dir.path().join("alias")).unwrap();
    fs::write(dir.path().join("note.md"), "").unwrap();
    std::os::unix::fs::symlink(dir.path().join("note.md"), dir.path().join("linked.md")).unwrap();
    std::os::unix::fs::symlink(dir.path().join("gone"), dir.path().join("broken.md")).unwrap();

    let tree = read_dir_recursive(dir.path()).unwrap();
    assert_eq!(
        names(&tree),
        ["alias/", "real/", "broken.md", "linked.md", "note.md"]
    );
    assert_eq!(names(tree[0].children.as_ref().unwrap()), ["a.md"]);
}

#[test]
fn reads_a_percent_encoded_header() {
    let mut headers = tauri::http::HeaderMap::new();
    headers.insert(
        "x-nuza-name",
        "Screen%20Shot%20%E2%9C%93.png".parse().unwrap(),
    );
    assert_eq!(
        header_text(&headers, "x-nuza-name").unwrap(),
        "Screen Shot \u{2713}.png"
    );
    assert!(header_text(&headers, "x-nuza-directory").is_err());
}

#[test]
fn reads_a_body_sent_raw_or_as_json() {
    let raw = tauri::ipc::InvokeBody::Raw(vec![0, 1, 255]);
    assert_eq!(body_bytes(&raw).unwrap(), [0, 1, 255]);

    let json = tauri::ipc::InvokeBody::Json(serde_json::json!([0, 1, 255]));
    assert_eq!(body_bytes(&json).unwrap(), [0, 1, 255]);

    let wrong = tauri::ipc::InvokeBody::Json(serde_json::json!({ "data": "AAH/" }));
    assert!(body_bytes(&wrong).is_err());
}

fn matcher(query: &str) -> Matcher {
    Matcher::text(query).expect("the query should have something in it")
}

#[test]
fn finds_a_line_ignoring_case() {
    let hits = search_text(
        "n.md",
        "first\nSecond Line here\nthird",
        &matcher("line"),
        5,
    );
    assert_eq!(
        hits,
        [ContentHit {
            path: "n.md".into(),
            line: 2,
            column: 7,
            preview: "Second Line here".into(),
            preview_start: 7,
            match_length: 4,
        }]
    );
}

#[test]
fn counts_columns_in_utf16() {
    // The emoji is two UTF-16 units, as it is to CodeMirror.
    let hits = search_text("n.md", "\u{1F600} caf\u{e9} ok", &matcher("OK"), 5);
    assert_eq!(hits[0].column, 8);
    assert_eq!(hits[0].preview_start, 8);
}

#[test]
fn cuts_a_long_line_down_around_the_match() {
    let line = format!("{}needle{}", "a".repeat(200), "b".repeat(200));
    let hit = &search_text("n.md", &line, &matcher("needle"), 5)[0];
    assert!(hit.preview.starts_with('\u{2026}') && hit.preview.ends_with('\u{2026}'));
    let start = hit.preview_start;
    let shown: String = hit.preview.chars().skip(start).take(6).collect();
    assert_eq!(shown, "needle");
    assert_eq!(hit.column, 200);
}

#[test]
fn stops_at_the_limit() {
    let text = "x\n".repeat(10);
    assert_eq!(search_text("n.md", &text, &matcher("x"), 3).len(), 3);
}

#[test]
fn searches_only_the_notes_the_tree_lists() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("sub")).unwrap();
    fs::create_dir(dir.path().join(".obsidian")).unwrap();
    fs::write(dir.path().join("a.md"), "has the Word").unwrap();
    fs::write(dir.path().join("sub").join("b.MD"), "word again").unwrap();
    fs::write(dir.path().join("c.txt"), "word in a text file").unwrap();
    fs::write(dir.path().join(".obsidian").join("d.md"), "word hidden").unwrap();

    let hits = search_vault(dir.path(), "  WORD ").unwrap();
    let mut found: Vec<&str> = hits
        .iter()
        .map(|hit| Path::new(&hit.path).file_name().unwrap().to_str().unwrap())
        .collect();
    found.sort();
    assert_eq!(found, ["a.md", "b.MD"]);
    assert!(search_vault(dir.path(), "   ").unwrap().is_empty());
}

#[test]
fn duplicates_a_note_beside_itself_numbered() {
    let dir = tempfile::tempdir().unwrap();
    let note = dir.path().join("note.md");
    fs::write(&note, "hello").unwrap();

    let first = duplicate_file(&note).unwrap();
    let second = duplicate_file(&note).unwrap();

    assert_eq!(first, dir.path().join("note 1.md"));
    assert_eq!(second, dir.path().join("note 2.md"));
    assert_eq!(contents(&first), "hello");
    assert_eq!(contents(&note), "hello");
}

#[test]
fn refuses_to_duplicate_a_folder() {
    let dir = tempfile::tempdir().unwrap();
    assert!(duplicate_file(dir.path()).is_err());
}

#[cfg(unix)]
#[test]
fn a_duplicate_keeps_the_originals_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let note = dir.path().join("private.md");
    fs::write(&note, "x").unwrap();
    fs::set_permissions(&note, fs::Permissions::from_mode(0o600)).unwrap();

    let copy = duplicate_file(&note).unwrap();
    assert_eq!(
        fs::metadata(copy).unwrap().permissions().mode() & 0o777,
        0o600
    );
}

/// Whatever fonts the machine running this has - CI's may have few - the
/// list is sorted, has no repeats and no private dotted families.
#[test]
fn lists_font_families_sorted_and_public() {
    let families = system_font_families();
    let mut sorted = families.clone();
    sorted.sort_by_key(|name| name.to_lowercase());
    sorted.dedup();
    assert_eq!(families, sorted);
    assert!(families.iter().all(|name| !name.starts_with('.')));
}

#[test]
fn finds_wiki_links_outside_code() {
    let text = "see [[Ideas]] and [[a/b|label]]\n```\n[[not this]]\n```\n[[]] [[x] [[last]]";
    let links = wiki_links_in("n.md", text);
    let found: Vec<(&str, usize)> = links.iter().map(|l| (l.target.as_str(), l.line)).collect();
    assert_eq!(found, [("Ideas", 1), ("a/b|label", 1), ("last", 5)]);
    assert_eq!(links[0].preview, "see [[Ideas]] and [[a/b|label]]");
}

#[test]
fn lists_the_wiki_links_in_a_vault() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("a.md"), "to [[b]]").unwrap();
    fs::create_dir(dir.path().join(".hidden")).unwrap();
    fs::write(dir.path().join(".hidden").join("c.md"), "to [[b]]").unwrap();
    fs::write(dir.path().join("d.txt"), "to [[b]]").unwrap();

    let links = vault_wiki_links(dir.path()).unwrap();
    assert_eq!(links.len(), 1);
    assert!(links[0].from.ends_with("a.md"));
}

#[test]
fn lists_the_tags_in_the_notes_a_vault_shows() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("a.md"), "one #alpha\ntwo #beta").unwrap();
    fs::create_dir(dir.path().join(".hidden")).unwrap();
    fs::write(dir.path().join(".hidden").join("c.md"), "#hidden").unwrap();
    fs::write(dir.path().join("d.txt"), "#text").unwrap();

    let tags = scan_vault(dir.path(), crate::tags::tags_in).unwrap();
    assert_eq!(
        tags.iter()
            .map(|t| (t.tag.as_str(), t.line))
            .collect::<Vec<_>>(),
        [("alpha", 1), ("beta", 2)]
    );
    assert!(tags[0].from.ends_with("a.md"));
}

/// Two real windows, with no screen behind them: the label a command is called
/// from is what picks the vault. Not built on Windows, where the test
/// executable cannot start with a webview in it - see Cargo.toml.
#[cfg(not(windows))]
mod windows {
    use super::*;
    use crate::folder::adopt_folder;
    use crate::launch::FILE_CHANGED_EVENT;
    use crate::state::vault_of;
    use std::sync::mpsc;
    use std::time::Duration;
    use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
    use tauri::{Listener, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

    fn two_windows() -> (
        tauri::App<MockRuntime>,
        WebviewWindow<MockRuntime>,
        WebviewWindow<MockRuntime>,
    ) {
        let app = mock_builder()
            .manage(Windows::default())
            .build(mock_context(noop_assets()))
            .unwrap();
        let first = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default())
            .build()
            .unwrap();
        let second = WebviewWindowBuilder::new(&app, "w-1", WebviewUrl::default())
            .build()
            .unwrap();
        (app, first, second)
    }

    #[test]
    fn opening_a_folder_in_one_window_leaves_the_other_alone() {
        let (_app, first, second) = two_windows();
        let first_dir = tempfile::tempdir().unwrap();
        let second_dir = tempfile::tempdir().unwrap();
        let first_note = first_dir.path().join("note.md");
        let second_note = second_dir.path().join("note.md");
        fs::write(&first_note, "one").unwrap();
        fs::write(&second_note, "two").unwrap();

        // The second window has nothing yet, while the first has its folder.
        adopt_folder(&first, first_dir.path().to_string_lossy().into_owned()).unwrap();
        assert!(within_vault(&vault_of(&first), &first_note).is_ok());
        assert!(within_vault(&vault_of(&second), &first_note).is_err());

        // Opening a folder in the second does not move the first.
        adopt_folder(&second, second_dir.path().to_string_lossy().into_owned()).unwrap();
        assert!(within_vault(&vault_of(&second), &second_note).is_ok());
        assert!(within_vault(&vault_of(&first), &first_note).is_ok());
        assert!(within_vault(&vault_of(&first), &second_note).is_err());
    }

    /// Both windows watch the same folder, but only the one that has read the
    /// note is told it changed - and it is told alone.
    #[test]
    fn a_change_is_announced_to_the_window_that_holds_the_note() {
        let (_app, first, second) = two_windows();
        let dir = tempfile::tempdir().unwrap();
        let note = dir.path().join("note.md");
        fs::write(&note, "hello").unwrap();
        let folder = dir.path().to_string_lossy().into_owned();
        adopt_folder(&first, folder.clone()).unwrap();
        adopt_folder(&second, folder).unwrap();

        let (heard_first, first_hears) = mpsc::channel();
        let (heard_second, second_hears) = mpsc::channel();
        first.listen(FILE_CHANGED_EVENT, move |_| {
            let _ = heard_first.send(());
        });
        second.listen(FILE_CHANGED_EVENT, move |_| {
            let _ = heard_second.send(());
        });

        let note = note.canonicalize().unwrap();
        remember(&vault_of(&first), &note);
        let later = SystemTime::now() + Duration::from_secs(5);
        fs::File::options()
            .write(true)
            .open(&note)
            .unwrap()
            .set_modified(later)
            .unwrap();

        assert!(first_hears.recv_timeout(Duration::from_secs(10)).is_ok());
        assert!(second_hears
            .recv_timeout(Duration::from_millis(500))
            .is_err());
    }
}

// ---------------------------------------------------------------------------
// Calls with a deadline, and a tree that is read a folder at a time
// ---------------------------------------------------------------------------

/// A call that does not return until the test is over, and then does: standing
/// in for a call that never returns without keeping a thread of the pool
/// asleep long enough to starve every other test that is using it.
struct Stall(Arc<std::sync::atomic::AtomicBool>);

impl Stall {
    fn new() -> Stall {
        Stall(Arc::new(std::sync::atomic::AtomicBool::new(false)))
    }

    fn call(&self) -> impl Fn() + Send + Sync + 'static {
        let released = self.0.clone();
        move || {
            while !released.load(std::sync::atomic::Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    }
}

impl Drop for Stall {
    fn drop(&mut self) {
        self.0.store(true, std::sync::atomic::Ordering::SeqCst);
    }
}

#[test]
fn a_call_that_never_returns_does_not_hold_up_the_others() {
    let stall = Stall::new();
    let started = Instant::now();
    let jobs: Vec<Box<dyn FnOnce() -> usize + Send>> = (0..6usize)
        .map(|n| {
            let wait = stall.call();
            Box::new(move || {
                if n == 2 {
                    wait();
                }
                n
            }) as Box<dyn FnOnce() -> usize + Send>
        })
        .collect();

    let answers = run_all(jobs, Duration::from_millis(300));
    assert_eq!(answers, [Some(0), Some(1), None, Some(3), Some(4), Some(5)]);
    assert!(started.elapsed() < Duration::from_secs(2));
}

#[test]
fn a_single_slow_call_gives_up_at_its_deadline() {
    let stall = Stall::new();
    let wait = stall.call();
    let started = Instant::now();
    let answer = run_one(
        move || {
            wait();
            1
        },
        Duration::from_millis(200),
    );
    assert_eq!(answer, None);
    assert!(started.elapsed() < Duration::from_secs(2));
    assert_eq!(run_one(|| 7, Duration::from_secs(5)), Some(7));
}

/// More stuck calls than the pool has threads still leaves it able to answer.
#[test]
fn stuck_calls_do_not_use_the_pool_up() {
    let stall = Stall::new();
    let stuck: Vec<Box<dyn FnOnce() + Send>> = (0..12)
        .map(|_| Box::new(stall.call()) as Box<dyn FnOnce() + Send>)
        .collect();
    let answers = run_all(stuck, Duration::from_millis(100));
    assert!(answers.iter().all(Option::is_none));

    assert_eq!(
        run_one(|| "still here", Duration::from_secs(2)),
        Some("still here")
    );
}

const QUICK: Patience = Patience {
    entry: Duration::from_millis(500),
    listing: Duration::from_secs(5),
};

/// A probe that never answers for one name, as an offline placeholder would not.
fn stalls_on(name: &'static str, stall: &Stall) -> Prober {
    let wait = stall.call();
    Arc::new(move |path, is_symlink| {
        if path.file_name().is_some_and(|file| file == name) {
            wait();
        }
        probe(path, is_symlink)
    })
}

#[test]
fn a_file_that_does_not_answer_is_listed_as_unavailable() {
    let stall = Stall::new();
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("a.md"), "").unwrap();
    fs::write(dir.path().join("offline.md"), "").unwrap();
    fs::write(dir.path().join("z.md"), "").unwrap();
    let resolved = dir.path().canonicalize().unwrap();

    let started = Instant::now();
    let listed = list_folder_with(
        dir.path(),
        &resolved,
        &resolved,
        QUICK,
        stalls_on("offline.md", &stall),
    )
    .unwrap();

    assert!(started.elapsed() < Duration::from_secs(3));
    assert_eq!(names(&listed), ["a.md", "offline.md", "z.md"]);
    let flags: Vec<bool> = listed.iter().map(|entry| entry.unavailable).collect();
    assert_eq!(flags, [false, true, false]);
    // Nothing is known about it, and the rows that answered are whole.
    assert!(listed[1].modified.is_none());
    assert!(listed[0].modified.is_some() && listed[2].modified.is_some());
}

/// A folder full of offline files costs the wait once, not once a file.
#[test]
fn a_folder_of_offline_files_costs_one_wait() {
    let stall = Stall::new();
    let dir = tempfile::tempdir().unwrap();
    for n in 0..20 {
        fs::write(dir.path().join(format!("offline-{n}.md")), "").unwrap();
    }
    let resolved = dir.path().canonicalize().unwrap();
    let wait = stall.call();
    let everything_stalls: Prober = Arc::new(move |_, _| {
        wait();
        Probe::default()
    });

    let started = Instant::now();
    let listed =
        list_folder_with(dir.path(), &resolved, &resolved, QUICK, everything_stalls).unwrap();

    assert!(started.elapsed() < Duration::from_secs(3));
    assert_eq!(listed.len(), 20);
    assert!(listed.iter().all(|entry| entry.unavailable));
}

#[test]
fn a_whole_vault_is_read_past_a_file_that_does_not_answer() {
    let stall = Stall::new();
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("sub")).unwrap();
    fs::write(dir.path().join("sub").join("offline.md"), "").unwrap();
    fs::write(dir.path().join("sub").join("here.md"), "").unwrap();
    fs::write(dir.path().join("top.md"), "").unwrap();

    let tree = read_dir_recursive_with(dir.path(), QUICK, stalls_on("offline.md", &stall)).unwrap();
    let sub = tree[0].children.as_ref().unwrap();
    assert_eq!(names(sub), ["here.md", "offline.md"]);
    assert!(sub[1].unavailable && !sub[0].unavailable);
    assert_eq!(names(&tree), ["sub/", "top.md"]);
}

#[test]
fn a_folder_lists_its_rows_and_leaves_what_is_inside_them_unread() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("notes")).unwrap();
    fs::write(dir.path().join("notes").join("inner.md"), "").unwrap();
    fs::write(dir.path().join("a.md"), "").unwrap();
    let resolved = dir.path().canonicalize().unwrap();

    let top = list_folder_with(dir.path(), &resolved, &resolved, QUICK, Arc::new(probe)).unwrap();
    assert_eq!(names(&top), ["notes/", "a.md"]);
    // A folder with no `children` has not been read - which is not the same as
    // one with nothing in it.
    assert!(top[0].children.is_none());

    let inside = list_folder_with(
        &dir.path().join("notes"),
        &resolved.join("notes"),
        &resolved,
        QUICK,
        Arc::new(probe),
    )
    .unwrap();
    assert_eq!(names(&inside), ["inner.md"]);
}

#[cfg(unix)]
#[test]
fn a_folder_left_out_a_link_back_up_the_tree() {
    let dir = tempfile::tempdir().unwrap();
    let resolved = dir.path().canonicalize().unwrap();
    fs::create_dir(dir.path().join("notes")).unwrap();
    std::os::unix::fs::symlink(dir.path(), dir.path().join("notes").join("up")).unwrap();
    std::os::unix::fs::symlink(".", dir.path().join("notes").join("here")).unwrap();
    fs::create_dir(dir.path().join("other")).unwrap();
    std::os::unix::fs::symlink(
        dir.path().join("other"),
        dir.path().join("notes").join("beside"),
    )
    .unwrap();

    let inside = list_folder_with(
        &dir.path().join("notes"),
        &resolved.join("notes"),
        &resolved,
        QUICK,
        Arc::new(probe),
    )
    .unwrap();
    // The two that lead back to where the walk already is are not shown; one
    // that leads somewhere else in the vault is.
    assert_eq!(names(&inside), ["beside/"]);
}

#[test]
fn a_folder_that_is_not_there_is_an_error() {
    let dir = tempfile::tempdir().unwrap();
    let resolved = dir.path().canonicalize().unwrap();
    assert!(list_folder_with(
        &dir.path().join("gone"),
        &resolved.join("gone"),
        &resolved,
        QUICK,
        Arc::new(probe)
    )
    .is_err());
}

// ---------------------------------------------------------------------------
// The index, and a search that ranks
// ---------------------------------------------------------------------------

fn note(path: &str, name: &str, text: &str) -> crate::index::Note {
    crate::index::Note {
        path: path.to_string(),
        name: name.to_string(),
        text: Arc::from(text),
    }
}

fn lines(hits: &[ContentHit]) -> Vec<(String, usize)> {
    hits.iter()
        .map(|hit| (hit.path.clone(), hit.line))
        .collect()
}

#[test]
fn a_whole_word_outranks_one_inside_another() {
    let notes = [note(
        "a.md",
        "a.md",
        "the catalog is long\nsee the cat here\nconcatenate",
    )];
    let hits = search_notes(&notes, &matcher("cat"));
    // Whole word first, then the word that merely starts with it, then the
    // one that has it in the middle.
    assert_eq!(
        lines(&hits),
        [("a.md".into(), 2), ("a.md".into(), 1), ("a.md".into(), 3)]
    );
}

#[test]
fn a_heading_and_the_case_typed_rank_higher() {
    let notes = [note(
        "a.md",
        "a.md",
        "plain mention of Rust here\n# Rust\nlater mention of rust here",
    )];
    let hits = search_notes(&notes, &matcher("Rust"));
    assert_eq!(hits[0].line, 2);
    // Same words, but one is in the case that was typed.
    assert_eq!(hits[1].line, 1);
    assert_eq!(hits[2].line, 3);
}

#[test]
fn a_note_named_for_the_query_comes_before_one_that_mentions_it() {
    let notes = [
        note(
            "a-mention.md",
            "a-mention.md",
            "we talked about gardening today",
        ),
        note(
            "gardening.md",
            "gardening.md",
            "we talked about gardening today",
        ),
    ];
    let hits = search_notes(&notes, &matcher("gardening"));
    assert_eq!(hits[0].path, "gardening.md");
    assert_eq!(hits[1].path, "a-mention.md");
}

#[test]
fn a_note_contributes_its_best_lines_not_its_first() {
    let mut text = String::new();
    for _ in 0..8 {
        text.push_str(
            "a long paragraph that only mentions the word somewhere deep inside: xcatx\n",
        );
    }
    text.push_str("# cat\n");
    let hits = search_notes(&[note("a.md", "a.md", &text)], &matcher("cat"));
    assert_eq!(hits.len(), 5);
    // The heading is the last line of the note, and still the first hit.
    assert_eq!(hits[0].line, 9);
}

#[test]
fn a_lot_of_hits_are_cut_off_at_the_limit() {
    let notes: Vec<_> = (0..300)
        .map(|n| note(&format!("{n:03}.md"), &format!("{n:03}.md"), "needle"))
        .collect();
    assert_eq!(search_notes(&notes, &matcher("needle")).len(), 200);
}

#[test]
fn a_line_with_accents_is_searched_as_well_as_one_without() {
    let notes = [note("a.md", "a.md", "Caf\u{e9} au lait\ncafe au lait")];
    let hits = search_notes(&notes, &matcher("CAF\u{c9}"));
    assert_eq!(lines(&hits), [("a.md".into(), 1)]);
    let hits = search_notes(&notes, &matcher("cafe"));
    assert_eq!(lines(&hits), [("a.md".into(), 2)]);
}

#[test]
fn a_pattern_finds_what_a_pattern_describes() {
    let notes = [note(
        "a.md",
        "a.md",
        "due 2026-10-05\nnothing here\ncall 555-0100 or 555-0199",
    )];
    let pattern = Matcher::pattern(r"\d{4}-\d{2}-\d{2}").unwrap().unwrap();
    let hits = search_notes(&notes, &pattern);
    assert_eq!(lines(&hits), [("a.md".into(), 1)]);
    assert_eq!((hits[0].column, hits[0].match_length), (4, 10));

    // Ignoring case, like the plain search.
    let pattern = Matcher::pattern("NOTHING").unwrap().unwrap();
    assert_eq!(search_notes(&notes, &pattern).len(), 1);
}

#[test]
fn a_pattern_counts_columns_in_characters_and_utf16() {
    let notes = [note("a.md", "a.md", "\u{1F600} caf\u{e9} ok")];
    let pattern = Matcher::pattern("ok").unwrap().unwrap();
    let hits = search_notes(&notes, &pattern);
    assert_eq!(hits[0].column, 8);
}

#[test]
fn a_pattern_that_matches_nothing_in_a_line_is_not_a_hit() {
    let notes = [note("a.md", "a.md", "abc\n\nxyz")];
    // `x*` matches the empty string everywhere, which is nothing to show.
    let pattern = Matcher::pattern("q*").unwrap().unwrap();
    assert!(search_notes(&notes, &pattern).is_empty());
}

#[test]
fn a_bad_or_empty_pattern_is_dealt_with_rather_than_run() {
    assert!(Matcher::pattern("(unclosed").is_err());
    assert!(Matcher::pattern(&"a".repeat(600)).is_err());
    assert!(Matcher::pattern("   ").unwrap().is_none());
}

/// Nested repetition is the textbook pattern that never finishes in a
/// backtracking engine. It has to come back here.
#[test]
fn a_pattern_that_would_hang_a_backtracking_engine_comes_back() {
    let line = format!("{}!", "a".repeat(5000));
    let notes = [note("a.md", "a.md", &line)];
    let pattern = Matcher::pattern("(a+)+$").unwrap().unwrap();

    let started = Instant::now();
    let _ = search_notes(&notes, &pattern);
    assert!(started.elapsed() < Duration::from_secs(5));
}

fn paths(index: &VaultIndex) -> Vec<String> {
    index
        .files()
        .iter()
        .map(|entry| {
            Path::new(&entry.path)
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned()
        })
        .collect()
}

#[test]
fn the_index_lists_every_file_in_the_vault() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir_all(dir.path().join("a").join("b")).unwrap();
    fs::create_dir(dir.path().join(".git")).unwrap();
    fs::write(dir.path().join("top.md"), "").unwrap();
    fs::write(dir.path().join("a").join("b").join("deep.md"), "").unwrap();
    fs::write(dir.path().join("a").join("pic.png"), "").unwrap();
    fs::write(dir.path().join(".git").join("HEAD"), "").unwrap();

    let index = VaultIndex::for_folder(dir.path()).unwrap();
    let mut found = paths(&index);
    found.sort();
    assert_eq!(found, ["deep.md", "pic.png", "top.md"]);
}

#[test]
fn the_index_follows_a_note_being_made_and_taken_away() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("one.md"), "").unwrap();
    let index = VaultIndex::for_folder(dir.path()).unwrap();

    let two = dir.path().join("two.md");
    fs::write(&two, "").unwrap();
    assert!(index.refresh(&two), "a new file changes the list");
    assert_eq!(paths(&index), ["one.md", "two.md"]);

    // Saving it again is not news: it is the same file.
    assert!(!index.refresh(&two));

    fs::remove_file(&two).unwrap();
    assert!(index.refresh(&two));
    assert_eq!(paths(&index), ["one.md"]);
    assert!(!index.refresh(&two), "nothing left to forget");
}

#[test]
fn the_index_follows_a_folder_that_moves() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("old")).unwrap();
    fs::write(dir.path().join("old").join("a.md"), "").unwrap();
    fs::write(dir.path().join("old").join("b.md"), "").unwrap();
    let index = VaultIndex::for_folder(dir.path()).unwrap();

    fs::rename(dir.path().join("old"), dir.path().join("new")).unwrap();
    assert!(index.refresh(&dir.path().join("old")));
    assert!(index.refresh(&dir.path().join("new")));

    let found: Vec<String> = index.files().into_iter().map(|entry| entry.path).collect();
    assert_eq!(found.len(), 2);
    assert!(found.iter().all(|path| path.contains("new")));
}

#[test]
fn the_index_does_not_hear_about_the_folders_a_vault_leaves_out() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join(".git")).unwrap();
    let index = VaultIndex::for_folder(dir.path()).unwrap();

    let inside = dir.path().join(".git").join("index.md");
    fs::write(&inside, "").unwrap();
    assert!(!index.refresh(&inside));
    assert!(index.files().is_empty());
    // And not a path from somewhere else altogether.
    let elsewhere = tempfile::tempdir().unwrap();
    fs::write(elsewhere.path().join("x.md"), "").unwrap();
    assert!(!index.refresh(&elsewhere.path().join("x.md")));
}

/// The watcher reports paths as the OS spells them, which for a vault opened
/// through a link is not how the sidebar spells them.
#[cfg(unix)]
#[test]
fn the_index_reports_paths_as_the_folder_was_opened() {
    let real = tempfile::tempdir().unwrap();
    let parent = tempfile::tempdir().unwrap();
    let link = parent.path().join("vault");
    std::os::unix::fs::symlink(real.path(), &link).unwrap();
    let index = VaultIndex::for_folder(&link).unwrap();

    let note = real.path().canonicalize().unwrap().join("new.md");
    fs::write(&note, "").unwrap();
    assert!(index.refresh(&note));
    assert_eq!(
        index.files()[0].path,
        link.join("new.md").to_string_lossy().into_owned()
    );
}

#[test]
fn a_notes_text_is_read_once_and_again_after_it_changes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("a.md");
    fs::write(&path, "first").unwrap();
    fs::write(dir.path().join("b.txt"), "not a note").unwrap();
    let index = VaultIndex::for_folder(dir.path()).unwrap();

    let notes = index.notes();
    assert_eq!(notes.len(), 1);
    assert_eq!(&*notes[0].text, "first");

    // Changed behind the index's back: what it holds is what it read, until it
    // is told. This is the point - a query is not a walk of the vault.
    fs::write(&path, "second").unwrap();
    assert_eq!(&*index.notes()[0].text, "first");

    index.refresh(&path);
    assert_eq!(&*index.notes()[0].text, "second");
}

#[test]
fn a_search_finds_a_note_written_after_the_index_was_built() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("a.md"), "nothing").unwrap();
    let index = VaultIndex::for_folder(dir.path()).unwrap();
    assert!(search_index(&index, "needle", false).unwrap().is_empty());

    let fresh = dir.path().join("fresh.md");
    fs::write(&fresh, "a needle here").unwrap();
    index.refresh(&fresh);
    let hits = search_index(&index, "needle", false).unwrap();
    assert_eq!(hits.len(), 1);
    assert!(hits[0].path.ends_with("fresh.md"));
}

#[test]
fn a_search_by_pattern_says_so_when_the_pattern_is_bad() {
    let dir = tempfile::tempdir().unwrap();
    let index = VaultIndex::for_folder(dir.path()).unwrap();
    assert_eq!(
        search_index(&index, "(", true).unwrap_err(),
        "Not a valid regular expression"
    );
    assert!(search_index(&index, "  ", true).unwrap().is_empty());
}

#[test]
fn a_note_too_large_to_be_a_note_is_not_read() {
    let dir = tempfile::tempdir().unwrap();
    let big = fs::File::create(dir.path().join("big.md")).unwrap();
    big.set_len(crate::index::SEARCHABLE_BYTES + 1).unwrap();
    fs::write(dir.path().join("small.md"), "needle").unwrap();
    let index = VaultIndex::for_folder(dir.path()).unwrap();

    let notes = index.notes();
    assert_eq!(notes.len(), 1);
    assert!(notes[0].path.ends_with("small.md"));
}

// ---------------------------------------------------------------------------
// More than one window
// ---------------------------------------------------------------------------

fn window(label: &str, root: Option<&str>) -> Open {
    Open {
        label: label.to_string(),
        root: root.map(std::path::PathBuf::from),
    }
}

fn folder(path: &str) -> OpenTarget {
    OpenTarget {
        kind: "folder",
        path: path.to_string(),
        vault: None,
    }
}

fn note_at(path: &str) -> OpenTarget {
    OpenTarget {
        kind: "file",
        path: path.to_string(),
        vault: None,
    }
}

#[test]
fn a_folder_goes_to_the_window_that_has_it_open() {
    let windows = [window("main", Some("/a")), window("w-1", Some("/b"))];
    assert_eq!(
        route(&windows, &folder("/b")),
        Route::Existing("w-1".into())
    );
}

#[test]
fn a_note_goes_to_the_window_whose_vault_it_is_in() {
    let windows = [window("main", Some("/a")), window("w-1", Some("/b"))];
    assert_eq!(
        route(&windows, &note_at("/b/deep/note.md")),
        Route::Existing("w-1".into())
    );
}

#[test]
fn a_folder_inside_an_open_vault_is_not_that_vault() {
    let windows = [window("main", Some("/a"))];
    assert_eq!(route(&windows, &folder("/a/sub")), Route::Fresh);
}

#[test]
fn a_neighbouring_folder_with_the_same_beginning_is_not_inside() {
    let windows = [window("main", Some("/notes"))];
    assert_eq!(route(&windows, &note_at("/notes-old/a.md")), Route::Fresh);
}

#[test]
fn a_path_nobody_has_gets_a_window_with_nothing_open_before_a_new_one() {
    let windows = [window("main", Some("/a")), window("w-1", None)];
    assert_eq!(
        route(&windows, &folder("/c")),
        Route::Existing("w-1".into())
    );
}

#[test]
fn a_path_nobody_has_and_no_empty_window_gets_a_window_of_its_own() {
    let windows = [window("main", Some("/a")), window("w-1", Some("/b"))];
    assert_eq!(route(&windows, &folder("/c")), Route::Fresh);
    assert_eq!(route(&[], &folder("/c")), Route::Fresh);
}

#[test]
fn the_window_that_has_it_wins_over_an_empty_one_in_front() {
    // The empty window is in front, but the folder is already open elsewhere.
    let windows = [window("w-2", None), window("main", Some("/a"))];
    assert_eq!(
        route(&windows, &folder("/a")),
        Route::Existing("main".into())
    );
}

#[test]
fn the_window_in_front_is_the_one_chosen_when_two_would_do() {
    let windows = [window("w-1", Some("/a/x")), window("main", Some("/a"))];
    assert_eq!(
        route(&windows, &note_at("/a/x/n.md")),
        Route::Existing("w-1".into())
    );
}

#[test]
fn a_quit_is_over_when_every_window_has_answered() {
    let quit = Quit::default();
    assert!(quit.begin(["main".to_string(), "w-1".to_string()]));
    assert_eq!(quit.answered("w-1"), Quitting::Waiting);
    assert_eq!(quit.answered("main"), Quitting::Done);
}

#[test]
fn a_window_answering_twice_does_not_finish_the_quit_early() {
    let quit = Quit::default();
    quit.begin(["main".to_string(), "w-1".to_string()]);
    assert_eq!(quit.answered("main"), Quitting::Waiting);
    assert_eq!(quit.answered("main"), Quitting::Waiting);
    assert_eq!(quit.answered("w-1"), Quitting::Done);
}

#[test]
fn an_answer_with_no_quit_asked_for_is_not_a_quit() {
    assert_eq!(Quit::default().answered("main"), Quitting::Idle);
}

#[test]
fn a_second_quit_while_one_is_under_way_is_ignored() {
    let quit = Quit::default();
    assert!(quit.begin(["main".to_string()]));
    assert!(!quit.begin(["main".to_string()]));
}

const SCREENS: [Screen; 2] = [
    Screen {
        x: 0.0,
        y: 0.0,
        width: 1440.0,
        height: 900.0,
    },
    Screen {
        x: -1920.0,
        y: 0.0,
        width: 1920.0,
        height: 1080.0,
    },
];

fn frame(x: i32, y: i32, width: u32, height: u32) -> Frame {
    Frame {
        x,
        y,
        width,
        height,
    }
}

#[test]
fn a_window_is_put_back_where_it_was() {
    assert!(usable_frame(&frame(100, 80, 800, 600), &SCREENS));
    // On the second display, at negative x.
    assert!(usable_frame(&frame(-1500, 100, 800, 600), &SCREENS));
}

/// The display it was on is no longer attached.
#[test]
fn a_window_that_would_be_off_every_screen_is_not_put_there() {
    assert!(!usable_frame(&frame(3000, 100, 800, 600), &SCREENS[..1]));
    assert!(!usable_frame(&frame(-1500, 100, 800, 600), &SCREENS[..1]));
    assert!(!usable_frame(&frame(100, 5000, 800, 600), &SCREENS));
    assert!(!usable_frame(&frame(100, 80, 800, 600), &[]));
}

#[test]
fn a_window_too_small_or_too_big_to_use_is_not_put_back() {
    assert!(!usable_frame(&frame(100, 80, 20, 20), &SCREENS));
    assert!(!usable_frame(&frame(100, 80, 9000, 600), &SCREENS));
}

#[test]
fn a_window_whose_corner_is_hanging_off_the_edge_is_not_put_back() {
    // Its top-left is on the screen, but only just: nothing of it to grab.
    assert!(!usable_frame(&frame(1430, 100, 800, 600), &SCREENS[..1]));
}

#[test]
fn the_saved_windows_are_read_back_without_the_ones_that_are_gone() {
    let here = tempfile::tempdir().unwrap();
    let json = format!(
        r#"[{{"root":{:?},"frame":{{"x":10,"y":20,"width":800,"height":600}}}},
            {{"root":"/definitely/not/here","frame":null}}]"#,
        here.path().to_string_lossy()
    );
    let saved = read_saved(json.as_bytes());
    assert_eq!(saved.len(), 1);
    assert_eq!(saved[0].frame, Some(frame(10, 20, 800, 600)));
}

#[test]
fn a_damaged_record_of_the_windows_is_no_windows() {
    assert!(read_saved(b"not json").is_empty());
    assert!(read_saved(b"{\"root\": 3}").is_empty());
    assert!(read_saved(b"").is_empty());
}

fn saved(root: &str) -> SavedWindow {
    SavedWindow {
        root: root.to_string(),
        frame: None,
    }
}

#[test]
fn the_first_saved_window_starts_the_app_and_the_rest_open_beside_it() {
    let (first, others) = plan_restore(vec![saved("/a"), saved("/b"), saved("/c")], None);
    assert_eq!(first, Some(saved("/a")));
    assert_eq!(others, [saved("/b"), saved("/c")]);
}

#[test]
fn nothing_saved_is_nothing_to_restore() {
    assert_eq!(plan_restore(vec![], None), (None, vec![]));
}

/// Started with `nuza ~/b`: that window is the first, and the one that was
/// already on `~/b` is not opened again.
#[test]
fn an_app_started_on_a_folder_keeps_the_others_but_not_that_one() {
    let (first, others) = plan_restore(
        vec![saved("/a"), saved("/b"), saved("/c")],
        Some(&folder("/b")),
    );
    assert_eq!(first, None);
    assert_eq!(others, [saved("/a"), saved("/c")]);
}

#[test]
fn an_app_started_on_a_note_does_not_open_its_vault_twice() {
    let (first, others) = plan_restore(
        vec![saved("/a"), saved("/b")],
        Some(&note_at("/b/deep/n.md")),
    );
    assert_eq!(first, None);
    assert_eq!(others, [saved("/a")]);
}

/// A window with a launch target waiting for it is as good as on that folder.
#[test]
fn launch_targets_are_held_per_window() {
    let launches = crate::state::LaunchTarget::default();
    launches.queue("main", folder("/a"));
    launches.queue("w-1", folder("/b"));

    assert_eq!(launches.pending("w-1"), Some(folder("/b")));
    assert_eq!(launches.take("w-1"), Some(folder("/b")));
    assert_eq!(launches.take("w-1"), None, "it is handed over once");
    assert_eq!(launches.take("main"), Some(folder("/a")));
}

#[test]
fn the_folder_a_window_has_open_is_told_without_making_a_vault() {
    let windows = Windows::default();
    assert_eq!(windows.root("main"), None);

    let dir = tempfile::tempdir().unwrap();
    *locked(&windows.vault("main").root) = Some(dir.path().to_path_buf());
    assert_eq!(windows.root("main"), Some(dir.path().to_path_buf()));
    assert_eq!(windows.root("w-1"), None);
}

/// Only documents and media go to the system. A script, an app or anything
/// unknown does not: for those, "open" means "run".
#[test]
fn only_documents_and_media_are_handed_to_the_system() {
    for name in ["paper.pdf", "Talk.MP4", "notes.final.docx", "song.flac"] {
        assert!(opened_by_the_system(Path::new(name)), "{name}");
    }
    for name in [
        "run.command",
        "setup.sh",
        "tool.exe",
        "Thing.app",
        "note.md",
        "pdf",
        ".pdf",
        "archive.pdf.sh",
        "noextension",
    ] {
        assert!(!opened_by_the_system(Path::new(name)), "{name}");
    }
}

/// A note has a time it was last changed, and it is a recent one for a note
/// just written; a file that is not there has no times at all.
#[test]
fn reads_when_a_note_was_last_changed() {
    let dir = tempfile::tempdir().unwrap();
    let note = dir.path().join("note.md");
    fs::write(&note, "hello").unwrap();

    let times = times_of(&note).unwrap();
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    let modified = times.modified.expect("a modification time");
    assert!(modified <= now + 2_000 && now.saturating_sub(modified) < 60_000);

    assert!(times_of(&dir.path().join("missing.md")).is_err());
}

/// A note moved into its own window opens the vault it is in, not its own
/// folder - and only when the folder named is the one the window really has.
#[test]
fn a_note_window_opens_the_vault_the_note_is_in() {
    let dir = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    fs::create_dir_all(root.join("sub")).unwrap();
    let note = root.join("sub").join("note.md");
    fs::write(&note, "hello").unwrap();
    let text = |path: &Path| path.to_string_lossy().into_owned();

    let target = note_window_target(&note, Some(&root), &text(&note), &text(dir.path())).unwrap();
    assert_eq!(target.kind, "file");
    assert_eq!(target.path, text(&note));
    assert_eq!(target.vault, Some(text(dir.path())));

    // Some other folder, a folder in place of a note, and no vault at all.
    assert!(note_window_target(&note, Some(&root), &text(&note), &text(elsewhere.path())).is_err());
    assert!(note_window_target(&root.join("sub"), Some(&root), "x", &text(dir.path())).is_err());
    assert!(note_window_target(&note, None, &text(&note), &text(dir.path())).is_err());
}

/// A window on its way up for one note of a vault counts as holding that
/// vault, not the note's own folder, when a path is being routed.
#[test]
fn a_note_window_counts_as_its_vault_while_it_opens() {
    let pending = OpenTarget {
        kind: "file",
        path: "/vault/sub/note.md".to_string(),
        vault: Some("/vault".to_string()),
    };
    let windows = vec![Open {
        label: "w-1".to_string(),
        root: Some(folder_of(&pending)),
    }];
    assert_eq!(
        route(&windows, &note_at("/vault/other.md")),
        Route::Existing("w-1".to_string())
    );
}
