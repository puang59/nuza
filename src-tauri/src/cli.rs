//! `nuza <path>` from a terminal: what is asked for, and the shim that makes
//! the command available.
//!
//! There is no second binary. The app is the command: run with a path, it
//! opens it, and run while it is already open, it hands the path to the
//! window that is (see the single-instance plugin in `run`). What the shim
//! adds is a `nuza` on the PATH that starts the app without holding the
//! terminal.

use std::path::{Path, PathBuf};

/// What the command line asked to open.
#[derive(serde::Serialize, Clone, Debug, PartialEq)]
pub struct OpenTarget {
    /// "folder" or "file".
    pub kind: &'static str,
    pub path: String,
    /// For a note moved into a window of its own: the vault it is in, which is
    /// the folder that window opens, with nothing else of the vault's tabs
    /// brought along. Without it a note opens in its own folder.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vault: Option<String>,
}

/// A path without the `\\?\` that canonicalising puts on one in Windows,
/// which nothing else in the app writes and so would never match the tree.
pub(crate) fn plain(path: PathBuf) -> String {
    let text = path.to_string_lossy().into_owned();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC") => rest.to_string(),
        _ => text,
    }
}

/// The first path on a command line - `args` as the process saw them, the
/// program first - that exists, resolved against `cwd` where it is relative.
/// Flags are not paths, and neither is anything that is not there: asking for
/// a note that does not exist opens nothing rather than somewhere else.
pub fn target_from_args(args: &[String], cwd: &Path) -> Option<OpenTarget> {
    args.iter()
        .skip(1)
        .filter(|arg| !arg.is_empty() && !arg.starts_with('-'))
        .find_map(|arg| {
            let path = cwd.join(arg).canonicalize().ok()?;
            let kind = if path.is_dir() {
                "folder"
            } else if path.is_file() {
                "file"
            } else {
                return None;
            };
            Some(OpenTarget {
                kind,
                path: plain(path),
                vault: None,
            })
        })
}

/// The first line the shim carries, which is how it is told apart from some
/// other `nuza` that happens to be in the same place.
#[cfg(unix)]
const MARKER: &str = "# nuza command-line shim";

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct CliStatus {
    /// Whether this platform can install the command from here.
    pub supported: bool,
    /// "none", "installed", "outdated" (ours, but for an app that has moved)
    /// or "foreign" (something else called `nuza`, which is left alone).
    pub state: &'static str,
    /// Where the shim goes, or is.
    pub path: String,
}

#[cfg(unix)]
mod shim {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    /// `~/.local/bin`: on the PATH of most shells that have it set up, and
    /// somewhere that needs no administrator to write to.
    fn shim_path(home: &Path) -> PathBuf {
        home.join(".local").join("bin").join("nuza")
    }

    /// `text` safe inside single quotes.
    fn quoted(text: &str) -> String {
        format!("'{}'", text.replace('\'', r"'\''"))
    }

    /// Starts the app detached, so the terminal comes back at once. A path
    /// given relative is resolved by the app against the folder it was typed
    /// in, which the app inherits.
    fn contents(exe: &Path) -> String {
        format!(
            "#!/bin/sh\n{MARKER}. Installed by nuza; remove it from Settings.\nnohup {} \"$@\" >/dev/null 2>&1 &\n",
            quoted(&exe.to_string_lossy())
        )
    }

    pub fn status(home: &Path, exe: &Path) -> CliStatus {
        let path = shim_path(home);
        let state = match fs::read_to_string(&path) {
            Err(_) if path.symlink_metadata().is_err() => "none",
            Err(_) => "foreign",
            Ok(text) if !text.contains(MARKER) => "foreign",
            Ok(text) if text == contents(exe) => "installed",
            Ok(_) => "outdated",
        };
        CliStatus {
            supported: true,
            state,
            path: path.to_string_lossy().into_owned(),
        }
    }

    pub fn install(home: &Path, exe: &Path) -> Result<CliStatus, String> {
        let path = shim_path(home);
        if status(home, exe).state == "foreign" {
            return Err(format!(
                "There is already a different \"nuza\" at {}",
                path.display()
            ));
        }

        let directory = path.parent().ok_or("No folder to put the command in")?;
        fs::create_dir_all(directory).map_err(|e| e.to_string())?;
        fs::write(&path, contents(exe)).map_err(|e| e.to_string())?;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
        Ok(status(home, exe))
    }

    pub fn uninstall(home: &Path, exe: &Path) -> Result<CliStatus, String> {
        let path = shim_path(home);
        match status(home, exe).state {
            "none" => {}
            "foreign" => {
                return Err(format!(
                    "The \"nuza\" at {} was not put there by nuza, so it is left alone",
                    path.display()
                ))
            }
            _ => fs::remove_file(&path).map_err(|e| e.to_string())?,
        }
        Ok(status(home, exe))
    }
}

#[cfg(unix)]
pub use shim::{install, status, uninstall};

#[cfg(not(unix))]
pub fn status(_home: &Path, _exe: &Path) -> CliStatus {
    CliStatus {
        supported: false,
        state: "none",
        path: String::new(),
    }
}

#[cfg(not(unix))]
pub fn install(_home: &Path, _exe: &Path) -> Result<CliStatus, String> {
    Err("The command can't be installed on this platform yet".to_string())
}

#[cfg(not(unix))]
pub fn uninstall(_home: &Path, _exe: &Path) -> Result<CliStatus, String> {
    Err("The command can't be installed on this platform yet".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn opens_a_folder_and_a_file() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.md"), "").unwrap();
        fs::create_dir(dir.path().join("notes")).unwrap();
        let root = dir.path().canonicalize().unwrap();

        let folder = target_from_args(&args(&["nuza", "notes"]), &root).unwrap();
        assert_eq!(folder.kind, "folder");
        assert!(folder.path.ends_with("notes"));

        let file = target_from_args(&args(&["nuza", "a.md"]), &root).unwrap();
        assert_eq!(file.kind, "file");
        assert!(file.path.ends_with("a.md"));
    }

    #[test]
    fn resolves_a_relative_path_against_the_folder_it_was_typed_in() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("notes")).unwrap();
        fs::write(dir.path().join("notes").join("a.md"), "").unwrap();
        let root = dir.path().canonicalize().unwrap();

        let target = target_from_args(&args(&["nuza", "./notes/../notes/a.md"]), &root).unwrap();
        // The same path the app writes everywhere else: on Windows that is
        // without the `\\?\` canonicalising puts on the front.
        assert_eq!(target.path, plain(root.join("notes").join("a.md")));
    }

    #[test]
    fn takes_an_absolute_path_as_it_is() {
        let dir = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let target = target_from_args(
            &args(&["nuza", &elsewhere.path().to_string_lossy()]),
            dir.path(),
        )
        .unwrap();
        assert_eq!(target.kind, "folder");
    }

    #[test]
    fn skips_flags_and_the_program_itself() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("notes")).unwrap();
        // The program is the first argument, and is never what is asked for,
        // even though it exists.
        let exe = std::env::current_exe().unwrap();
        let target = target_from_args(
            &args(&[&exe.to_string_lossy(), "-psn_0_12345", "--flag", "notes"]),
            dir.path(),
        )
        .unwrap();
        assert!(target.path.ends_with("notes"));
    }

    #[test]
    fn opens_nothing_for_a_path_that_is_not_there() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            target_from_args(&args(&["nuza", "missing.md"]), dir.path()),
            None
        );
        assert_eq!(target_from_args(&args(&["nuza"]), dir.path()), None);
        assert_eq!(target_from_args(&args(&["nuza", ""]), dir.path()), None);
    }

    #[test]
    fn passes_over_a_path_that_is_not_there_for_one_that_is() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("b.md"), "").unwrap();
        let target = target_from_args(&args(&["nuza", "missing.md", "b.md"]), dir.path()).unwrap();
        assert!(target.path.ends_with("b.md"));
    }

    #[cfg(unix)]
    mod shim_tests {
        use super::*;
        use std::os::unix::fs::PermissionsExt;

        fn exe() -> PathBuf {
            PathBuf::from("/Applications/nuza.app/Contents/MacOS/nuza")
        }

        #[test]
        fn installs_an_executable_shim_and_says_so() {
            let home = tempfile::tempdir().unwrap();
            assert_eq!(status(home.path(), &exe()).state, "none");

            let installed = install(home.path(), &exe()).unwrap();
            assert_eq!(installed.state, "installed");
            assert!(installed.supported);

            let path = PathBuf::from(&installed.path);
            assert!(path.ends_with(".local/bin/nuza"));
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o111,
                0o111
            );
            let text = fs::read_to_string(&path).unwrap();
            assert!(text.starts_with("#!/bin/sh\n"));
            assert!(text.contains(MARKER));
            assert!(text.contains("nohup '/Applications/nuza.app/Contents/MacOS/nuza' \"$@\""));
        }

        #[test]
        fn installing_again_changes_nothing() {
            let home = tempfile::tempdir().unwrap();
            install(home.path(), &exe()).unwrap();
            assert_eq!(install(home.path(), &exe()).unwrap().state, "installed");
        }

        #[test]
        fn notices_an_app_that_has_moved_and_updates_the_shim() {
            let home = tempfile::tempdir().unwrap();
            install(home.path(), &exe()).unwrap();

            let moved = PathBuf::from("/Users/me/Apps/nuza.app/Contents/MacOS/nuza");
            assert_eq!(status(home.path(), &moved).state, "outdated");
            assert_eq!(install(home.path(), &moved).unwrap().state, "installed");
        }

        #[test]
        fn quotes_a_path_with_a_quote_in_it() {
            let home = tempfile::tempdir().unwrap();
            let odd = PathBuf::from("/tmp/it's here/nuza");
            let installed = install(home.path(), &odd).unwrap();
            let text = fs::read_to_string(&installed.path).unwrap();
            assert!(text.contains(r"nohup '/tmp/it'\''s here/nuza' "));
        }

        #[test]
        fn removes_its_own_shim() {
            let home = tempfile::tempdir().unwrap();
            let path = PathBuf::from(install(home.path(), &exe()).unwrap().path);
            assert_eq!(uninstall(home.path(), &exe()).unwrap().state, "none");
            assert!(!path.exists());
            // Nothing to remove is not a failure.
            assert_eq!(uninstall(home.path(), &exe()).unwrap().state, "none");
        }

        #[test]
        fn leaves_a_different_nuza_alone() {
            let home = tempfile::tempdir().unwrap();
            let bin = home.path().join(".local").join("bin");
            fs::create_dir_all(&bin).unwrap();
            fs::write(bin.join("nuza"), "#!/bin/sh\necho mine\n").unwrap();

            assert_eq!(status(home.path(), &exe()).state, "foreign");
            assert!(install(home.path(), &exe()).is_err());
            assert!(uninstall(home.path(), &exe()).is_err());
            assert_eq!(
                fs::read_to_string(bin.join("nuza")).unwrap(),
                "#!/bin/sh\necho mine\n"
            );
        }
    }
}
