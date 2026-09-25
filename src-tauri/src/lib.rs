// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use tauri::Manager;
#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial};
#[cfg(target_os = "windows")]
use window_vibrancy::{apply_blur, clear_blur};
use std::fs;
use tauri_plugin_dialog::DialogExt;
use std::path::Path;

#[derive(serde::Serialize)]
struct FileEntry {
    name: String, 
    path: String,
    #[serde(rename = "isDirectory")] // this ensures the JSON key is camel case
    is_directory: bool,
    children: Option<Vec<FileEntry>>,
}

/// Entries that are never notes: the dot-directories tools keep their own state
/// in, and dependency folders. A vault that happens to sit inside a repository
/// or a project can carry far more of these than it does notes, and walking
/// them costs more than everything the sidebar is actually there to show.
fn is_ignored(name: &str) -> bool {
    name.starts_with('.') || name == "node_modules"
}

fn read_dir_recursive(path: &Path) -> Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();

    if path.is_dir() {
        // Read the directory contents
        for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let entry_path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();

            if is_ignored(&name) {
                continue;
            }

            let is_directory = entry_path.is_dir();

            // If it's a directory, recursively read its children
            let children = if is_directory {
                Some(read_dir_recursive(&entry_path)?)
            } else {
                None
            };
            
            entries.push(FileEntry {
                name,
                path: entry_path.to_string_lossy().into_owned(),
                is_directory,
                children,
            });
        }
    }
    
    // Sort so directories appear first, then alphabetically
    entries.sort_by(|a, b| {
        b.is_directory.cmp(&a.is_directory)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    
    Ok(entries)
}

/// Tauri's dialog pickers deliver their result via a callback fired from a
/// separate thread, but a `#[tauri::command]` needs to return a value - this
/// blocks the async command on a channel until that callback runs.
fn block_on_picker<T, F>(register: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(Box<dyn FnOnce(Result<T, String>) + Send>),
{
    let (tx, rx) = std::sync::mpsc::channel();
    register(Box::new(move |result| {
        let _ = tx.send(result);
    }));
    rx.recv().map_err(|e| format!("Channel error: {}", e))?
}

#[derive(serde::Serialize)]
struct OpenedFolder {
    path: String,
    entries: Vec<FileEntry>,
}

/// Opens a native "open folder" dialog and returns the folder's path plus its
/// contents as a tree, read recursively. Returns `None` if the user cancels.
#[tauri::command]
async fn load_folder_picker(app_handle: tauri::AppHandle) -> Result<Option<OpenedFolder>, String> {
    let scope = app_handle.clone();
    block_on_picker(|send| {
        app_handle.dialog().file().pick_folder(move |folder_path| {
            let result = match folder_path {
                Some(path) => {
                    let path_str = path.to_string();
                    // Images embedded in a note are served over the asset
                    // protocol, which is handed the opened folder and nothing
                    // else - a note is text from disk that anything could have
                    // written, and it has no business reaching the rest of it.
                    scope
                        .asset_protocol_scope()
                        .allow_directory(&path_str, true)
                        .map_err(|e| e.to_string())
                        .and_then(|_| read_dir_recursive(Path::new(&path_str)))
                        .map(|entries| Some(OpenedFolder { path: path_str, entries }))
                }
                None => Ok(None),
            };
            send(result);
        });
    })
}

#[tauri::command]
fn create_file(parent_path: String, name: String) -> Result<(), String> {
    let path = Path::new(&parent_path).join(&name);
    if path.exists() {
        return Err(format!("\"{}\" already exists", name));
    }
    fs::File::create(&path).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_folder(parent_path: String, name: String) -> Result<(), String> {
    let path = Path::new(&parent_path).join(&name);
    if path.exists() {
        return Err(format!("\"{}\" already exists", name));
    }
    fs::create_dir(&path).map_err(|e| e.to_string())
}

/// Renames a file or folder in place, keeping it in the same parent
/// directory. Returns the new full path.
#[tauri::command]
fn rename_entry(path: String, new_name: String) -> Result<String, String> {
    let old = Path::new(&path);
    let parent = old.parent().ok_or_else(|| "Cannot rename this item".to_string())?;
    let new_path = parent.join(&new_name);
    if new_path.exists() {
        return Err(format!("\"{}\" already exists", new_name));
    }
    fs::rename(old, &new_path).map_err(|e| e.to_string())?;
    Ok(new_path.to_string_lossy().into_owned())
}

/// Moves a file or folder into `target_dir` (e.g. from a drag-and-drop),
/// keeping its name. Returns the new full path.
#[tauri::command]
fn move_entry(path: String, target_dir: String) -> Result<String, String> {
    let old = Path::new(&path);
    let name = old
        .file_name()
        .ok_or_else(|| "Invalid path".to_string())?
        .to_owned();
    let target = Path::new(&target_dir);

    if old.is_dir() && (target == old || target.starts_with(old)) {
        return Err("Cannot move a folder into itself".to_string());
    }

    let new_path = target.join(&name);
    if new_path.exists() {
        return Err(format!("\"{}\" already exists in destination", name.to_string_lossy()));
    }
    fs::rename(old, &new_path).map_err(|e| e.to_string())?;
    Ok(new_path.to_string_lossy().into_owned())
}

#[tauri::command]
fn delete_entry(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(p).map_err(|e| e.to_string())
    }
}

/// Opens a native "save file" dialog and writes `content` to the chosen path.
/// Returns the chosen path, or `None` if the user cancels the dialog.
#[tauri::command]
async fn save_file_picker(app_handle: tauri::AppHandle, content: String) -> Result<Option<String>, String> {
    block_on_picker(|send| {
        app_handle.dialog().file()
            .add_filter("Markdown Files", &["md", "markdown"])
            .set_file_name("untitled.md")
            .save_file(move |file_path| {
                let result = match file_path {
                    Some(path) => {
                        let path_str = path.to_string();
                        match fs::write(&path_str, &content) {
                            Ok(_) => Ok(Some(path_str)),
                            Err(e) => Err(format!("Failed to write file: {}", e)),
                        }
                    }
                    None => Ok(None),
                };
                send(result);
            });
    })
}

/// The final component of `name`, with anything that could climb out of the
/// target directory removed. A dropped file's name is whatever the sending app
/// put there, so it is treated as a suggestion rather than a path.
fn safe_file_name(name: &str) -> Result<String, String> {
    let cleaned = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .trim()
        .trim_start_matches('.')
        .replace('\0', "");

    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        Err("Invalid file name".to_string())
    } else {
        Ok(cleaned)
    }
}

/// A path in `directory` named after `name` that nothing is using yet, adding
/// " 1", " 2" and so on before the extension the way a file manager would.
fn unused_path(directory: &Path, name: &str) -> std::path::PathBuf {
    let candidate = directory.join(name);
    if !candidate.exists() {
        return candidate;
    }

    let stem = Path::new(name).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let extension = Path::new(name).extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();

    for n in 1..10_000 {
        let candidate = directory.join(format!("{} {}{}", stem, n, extension));
        if !candidate.exists() {
            return candidate;
        }
    }

    directory.join(name)
}

/// Writes a dropped or pasted file into `directory`, creating it if it is not
/// there yet. The bytes arrive base64-encoded because that survives the JSON
/// the IPC bridge speaks at a third of the cost of an array of numbers.
/// Returns the full path actually written, which may have been renamed to
/// avoid overwriting something.
#[tauri::command]
fn write_media(directory: String, name: String, data: String) -> Result<String, String> {
    use base64::Engine;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| format!("Could not read the dropped file: {}", e))?;

    let directory = Path::new(&directory);
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;

    let path = unused_path(directory, &safe_file_name(&name)?);
    fs::write(&path, bytes).map_err(|e| e.to_string())?;

    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(path, content).map_err(|e| e.to_string())
}

/// True for legacy symbol-encoded fonts (Wingdings, Webdings, ...), which map
/// plain letters to pictographs. Picking one would turn every note - and the
/// line numbers - into symbols, since the monospace fallback never kicks in.
fn is_symbol_font(data: &[u8], index: u32) -> bool {
    let Some(cmap) = ttf_parser::Face::parse(data, index).ok().and_then(|face| face.tables().cmap) else {
        return false;
    };
    let subtables: Vec<_> = cmap.subtables.into_iter().collect();
    !subtables.iter().any(|s| s.is_unicode())
        && subtables
            .iter()
            .any(|s| s.platform_id == ttf_parser::PlatformId::Windows && s.encoding_id == 0)
}

/// Lists the family names of every font installed on the system, sorted
/// case-insensitively. Async so the font scan runs off the main thread.
#[tauri::command]
async fn list_system_fonts() -> Vec<String> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();

    let families: std::collections::BTreeSet<String> = db
        .faces()
        .filter(|face| !db.with_face_data(face.id, is_symbol_font).unwrap_or(false))
        .filter_map(|face| face.families.first().map(|(name, _)| name.clone()))
        // macOS keeps private system fonts (e.g. ".SF NS") behind a leading dot
        .filter(|name| !name.starts_with('.'))
        .collect();

    let mut families: Vec<String> = families.into_iter().collect();
    families.sort_by_key(|name| name.to_lowercase());
    families
}

/// Applies or clears the OS-level window transparency/vibrancy effect.
/// No-op on platforms window-vibrancy doesn't support (e.g. Linux); the
/// frontend falls back to a plain opaque background there via CSS.
fn apply_transparency(window: &tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if enabled {
            apply_vibrancy(window, NSVisualEffectMaterial::Sidebar, None, None)
                .map_err(|e| e.to_string())?;
        } else {
            clear_vibrancy(window).map_err(|e| e.to_string())?;
        }
    }

    #[cfg(target_os = "windows")]
    {
        if enabled {
            apply_blur(window, Some((18, 18, 18, 125))).map_err(|e| e.to_string())?;
        } else {
            clear_blur(window).map_err(|e| e.to_string())?;
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (window, enabled);
    }

    Ok(())
}

/// Tauri command wrapper around [`apply_transparency`] for toggling the
/// effect at runtime from the frontend's settings panel.
#[tauri::command]
fn set_transparency(window: tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    apply_transparency(&window, enabled)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            apply_transparency(&window, true).expect("Unsupported platform!");
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            save_file_picker,
            load_folder_picker,
            read_file,
            write_file,
            write_media,
            create_file,
            create_folder,
            rename_entry,
            move_entry,
            delete_entry,
            list_system_fonts,
            set_transparency
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
