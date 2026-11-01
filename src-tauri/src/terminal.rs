//! Opening a folder of the vault in a terminal.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::state::{vault_of, within_vault};
use crate::tasks::off_thread;

/// Opens the vault folder `path` in `app` - the terminal named in Settings -
/// or, with none named, the platform's own: Terminal on macOS, Windows
/// Terminal (or cmd where it is missing) on Windows, and the desktop's chosen
/// terminal on Linux. Only folders inside the open vault are opened.
#[tauri::command]
pub(crate) async fn open_in_terminal(
    window: tauri::WebviewWindow,
    path: String,
    app: Option<String>,
) -> Result<(), String> {
    off_thread(move || {
        let vault = vault_of(&window);
        let folder = within_vault(&vault, Path::new(&path))?;
        if !folder.is_dir() {
            return Err("Only a folder can be opened in a terminal".to_string());
        }
        let app = app
            .map(|app| app.trim().to_string())
            .filter(|app| !app.is_empty());
        for mut command in commands_for(&folder, app.as_deref()) {
            if command.spawn().is_ok() {
                return Ok(());
            }
        }
        Err(match app {
            Some(app) => format!("Couldn't start \"{app}\""),
            None => "No terminal was found to open".to_string(),
        })
    })
    .await
}

/// What to try, in order, to open `folder` in a terminal.
pub(crate) fn commands_for(folder: &Path, app: Option<&str>) -> Vec<Command> {
    let folder: PathBuf = folder.to_path_buf();
    let mut tries = Vec::new();

    #[cfg(target_os = "macos")]
    {
        let mut open = Command::new("open");
        open.args(["-a", app.unwrap_or("Terminal")]).arg(&folder);
        tries.push(open);
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(app) = app {
            let mut named = Command::new(app);
            named.current_dir(&folder);
            tries.push(named);
        }
        let mut terminal = Command::new("wt");
        terminal.arg("-d").arg(&folder);
        tries.push(terminal);
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "start", "cmd"]).current_dir(&folder);
        tries.push(cmd);
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let names: Vec<&str> = match app {
            Some(app) => vec![app],
            None => vec![
                "x-terminal-emulator",
                "gnome-terminal",
                "konsole",
                "xfce4-terminal",
                "xterm",
            ],
        };
        for name in names {
            let mut command = Command::new(name);
            command.current_dir(&folder);
            tries.push(command);
        }
    }

    tries
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::commands_for;
    use std::path::Path;

    fn described(app: Option<&str>) -> Vec<String> {
        commands_for(Path::new("/vault/notes"), app)
            .iter()
            .map(|command| {
                std::iter::once(command.get_program())
                    .chain(command.get_args())
                    .map(|part| part.to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .collect()
    }

    #[test]
    fn opens_terminal_unless_another_app_is_named() {
        assert_eq!(described(None), ["open -a Terminal /vault/notes"]);
        assert_eq!(described(Some("iTerm")), ["open -a iTerm /vault/notes"]);
    }
}
