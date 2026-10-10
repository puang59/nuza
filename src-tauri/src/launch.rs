use crate::state::LaunchTarget;
use std::path::PathBuf;
use tauri::Manager;

/// Announced when `nuza <path>` is run while the app is open, carrying what
/// was asked for.
pub(crate) const OPEN_TARGET_EVENT: &str = "open-target";

/// Announced when a note has changed underneath the app, carrying its path.
pub(crate) const FILE_CHANGED_EVENT: &str = "file-changed";

/// The note or folder this window was started on - from a terminal, or because
/// it was opened for a path - once: the window asks as it comes up, and a
/// second ask finds nothing. Each window is asked for by its own label.
#[tauri::command]
pub(crate) fn take_launch_target(window: tauri::WebviewWindow) -> Option<crate::cli::OpenTarget> {
    window.state::<LaunchTarget>().take(window.label())
}

/// The program as the user would start it: the AppImage itself when that is
/// what is running, since the executable inside it is gone once it exits.
pub(crate) fn command_program() -> Result<PathBuf, String> {
    match std::env::var_os("APPIMAGE") {
        Some(image) if !image.is_empty() => Ok(PathBuf::from(image)),
        _ => std::env::current_exe().map_err(|e| e.to_string()),
    }
}

/// On Windows the profile comes first: `HOME` is only set there by a Unix-like
/// shell the app happened to be started from, and need not be the same place.
pub(crate) fn home_directory() -> Result<PathBuf, String> {
    let (first, second) = if cfg!(windows) {
        ("USERPROFILE", "HOME")
    } else {
        ("HOME", "USERPROFILE")
    };
    std::env::var_os(first)
        .or_else(|| std::env::var_os(second))
        .map(PathBuf::from)
        .ok_or_else(|| "Can't tell where your home folder is".to_string())
}

/// Whether the `nuza` command is installed, for Settings.
#[tauri::command]
pub(crate) fn cli_status() -> Result<crate::cli::CliStatus, String> {
    Ok(crate::cli::status(&home_directory()?, &command_program()?))
}

#[tauri::command]
pub(crate) fn install_cli() -> Result<crate::cli::CliStatus, String> {
    crate::cli::install(&home_directory()?, &command_program()?)
}

#[tauri::command]
pub(crate) fn uninstall_cli() -> Result<crate::cli::CliStatus, String> {
    crate::cli::uninstall(&home_directory()?, &command_program()?)
}
