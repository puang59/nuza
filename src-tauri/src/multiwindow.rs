//! More than one window: opening them, sending a path to the right one,
//! quitting all of them, and bringing them back next time.
//!
//! The design is in docs/multi-window.md. Each window owns its own vault (see
//! `state::Windows`); what is here is everything that is about the set of them.

use crate::cli::{plain, OpenTarget};
use crate::launch::OPEN_TARGET_EVENT;
use crate::state::{locked, LaunchTarget, Windows};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager, Runtime};

/// The window the config makes, and the one that is always first.
pub(crate) const MAIN_WINDOW: &str = "main";

/// Said to a window that has been asked to quit, which saves and answers with
/// `window_ready_to_quit`.
#[cfg(target_os = "macos")]
pub(crate) const QUIT_EVENT: &str = "menu:quit";

/// How long quitting waits for the windows to say they have saved. A window
/// that has hung cannot be allowed to keep the app from quitting.
#[cfg(target_os = "macos")]
const QUIT_PATIENCE: Duration = Duration::from_secs(5);

/// Two requests for a new window this close together are one: a menu key that
/// the webview was offered as well would otherwise open two.
const NEW_WINDOW_DEBOUNCE: Duration = Duration::from_millis(400);

/// How far a new window is set from the one it was opened beside.
const CASCADE: f64 = 28.0;

/// The name of the file the open windows are kept in, in the app's data folder.
const SNAPSHOT_FILE: &str = "windows.json";

// ---------------------------------------------------------------------------
// Where a path goes
// ---------------------------------------------------------------------------

/// A window, as far as deciding where a path goes is concerned.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Open {
    pub(crate) label: String,
    /// The folder it has open, or - for a window that has only just been
    /// opened and not collected what it was opened for - that.
    pub(crate) root: Option<PathBuf>,
}

/// What to do with a path that has been asked for.
#[derive(Debug, PartialEq)]
pub(crate) enum Route {
    /// Hand it to this window, and bring the window forward.
    Existing(String),
    /// Open a window for it.
    Fresh,
}

/// Where `target` should open, given the windows - the one that was in front
/// most recently first.
///
/// 1. A window that already has it: the folder as its vault, or a note inside
///    its vault. Two windows on one vault would be two watchers and two
///    autosave timers on one tree, so the one that is there is shown instead.
/// 2. A window with nothing open - the welcome screen - which is what that
///    window is waiting for.
/// 3. Otherwise a window of its own.
pub(crate) fn route(windows: &[Open], target: &OpenTarget) -> Route {
    let path = Path::new(&target.path);

    let holds = |root: &Path| {
        if target.kind == "folder" {
            root == path
        } else {
            path.starts_with(root)
        }
    };
    if let Some(window) = windows
        .iter()
        .find(|window| window.root.as_deref().is_some_and(holds))
    {
        return Route::Existing(window.label.clone());
    }
    if let Some(window) = windows.iter().find(|window| window.root.is_none()) {
        return Route::Existing(window.label.clone());
    }
    Route::Fresh
}

/// A root as a target's path would be spelled: without the `\\?\` Windows puts
/// on a resolved path, which the command line's paths never carry.
fn spelled(path: &Path) -> PathBuf {
    PathBuf::from(plain(path.to_path_buf()))
}

/// The folder a target is about, for a window that has been opened for it and
/// has not yet opened it.
pub(crate) fn folder_of(target: &OpenTarget) -> PathBuf {
    if let Some(vault) = &target.vault {
        return PathBuf::from(vault);
    }
    let path = PathBuf::from(&target.path);
    if target.kind == "folder" {
        path
    } else {
        path.parent().map(Path::to_path_buf).unwrap_or(path)
    }
}

/// The windows that are open, the one in front most recently first.
pub(crate) fn open_windows<R: Runtime>(app: &tauri::AppHandle<R>) -> Vec<Open> {
    let vaults = app.state::<Windows>();
    let launches = app.state::<LaunchTarget>();
    let recent = locked(&app.state::<Recent>().0).clone();

    let mut labels: Vec<String> = app.webview_windows().keys().cloned().collect();
    labels.sort_by_key(|label| {
        (
            recent
                .iter()
                .position(|seen| seen == label)
                .unwrap_or(usize::MAX),
            creation_order(label),
        )
    });

    labels
        .into_iter()
        .map(|label| {
            let root = vaults
                .root(&label)
                .map(|root| spelled(&root))
                .or_else(|| launches.pending(&label).map(|target| folder_of(&target)));
            Open { label, root }
        })
        .collect()
}

/// The labels in the order the windows were made: `main`, then `w-1`, `w-2`...
fn creation_order(label: &str) -> usize {
    label
        .strip_prefix("w-")
        .and_then(|n| n.parse().ok())
        .unwrap_or(0)
}

/// Which windows have been in front, most recent first.
#[derive(Default)]
pub(crate) struct Recent(pub(crate) Mutex<Vec<String>>);

impl Recent {
    pub(crate) fn focused(&self, label: &str) {
        let mut seen = locked(&self.0);
        seen.retain(|other| other != label);
        seen.insert(0, label.to_string());
    }

    pub(crate) fn gone(&self, label: &str) {
        locked(&self.0).retain(|other| other != label);
    }
}

/// Brings a window to the front.
fn raise<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

// ---------------------------------------------------------------------------
// Opening windows
// ---------------------------------------------------------------------------

/// Where a window is, in logical pixels - what is kept to put it back.
#[derive(serde::Serialize, serde::Deserialize, Clone, Copy, Debug, PartialEq)]
pub(crate) struct Frame {
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

/// A screen, in the same logical pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Screen {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

/// Whether a window put back at `frame` could be reached: its top-left corner
/// is on a screen that is there now, and it is a size anyone could use.
///
/// A display that was attached last time and is not now would otherwise put the
/// window somewhere off every screen, with no way to drag it back.
pub(crate) fn usable_frame(frame: &Frame, screens: &[Screen]) -> bool {
    const MIN_WIDTH: u32 = 300;
    const MIN_HEIGHT: u32 = 200;
    if frame.width < MIN_WIDTH || frame.height < MIN_HEIGHT {
        return false;
    }
    let (x, y) = (f64::from(frame.x), f64::from(frame.y));
    screens.iter().any(|screen| {
        x >= screen.x
            && x < screen.x + screen.width - 80.0
            && y >= screen.y
            && y < screen.y + screen.height - 80.0
            && f64::from(frame.width) <= screen.width * 1.1
            && f64::from(frame.height) <= screen.height * 1.1
    })
}

fn screens<R: Runtime>(app: &tauri::AppHandle<R>) -> Vec<Screen> {
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|monitor| {
            let scale = monitor.scale_factor();
            Screen {
                x: f64::from(monitor.position().x) / scale,
                y: f64::from(monitor.position().y) / scale,
                width: f64::from(monitor.size().width) / scale,
                height: f64::from(monitor.size().height) / scale,
            }
        })
        .collect()
}

fn frame_of<R: Runtime>(window: &tauri::WebviewWindow<R>) -> Option<Frame> {
    if window.is_minimized().unwrap_or(false) {
        return None;
    }
    let scale = window.scale_factor().ok()?;
    let position = window.outer_position().ok()?.to_logical::<f64>(scale);
    let size = window.outer_size().ok()?.to_logical::<f64>(scale);
    Some(Frame {
        x: position.x.round() as i32,
        y: position.y.round() as i32,
        width: size.width.round() as u32,
        height: size.height.round() as u32,
    })
}

static NEXT_WINDOW: AtomicUsize = AtomicUsize::new(1);

/// Opens a window - on `target` when there is one - set at `frame` when there
/// is one, and otherwise a little way from the window in front.
///
/// Built from the settings `tauri.conf.json` gives the first window, so the
/// overlay title bar, the traffic lights and the transparency are the same and
/// are only written down once. Not for the main thread: on Windows, building a
/// window from the thread that is pumping the event loop waits on itself.
pub(crate) fn open_window(
    app: &tauri::AppHandle,
    target: Option<OpenTarget>,
    frame: Option<Frame>,
) -> Result<tauri::WebviewWindow, String> {
    let mut config = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .ok_or_else(|| "There is no window to base a new one on".to_string())?;
    let label = format!("w-{}", NEXT_WINDOW.fetch_add(1, Ordering::SeqCst));
    config.label = label.clone();

    // Before the window exists, since it asks for it the moment it is up.
    if let Some(target) = target {
        app.state::<LaunchTarget>().queue(&label, target);
    }

    let beside = frame.or_else(|| {
        let focused = app
            .webview_windows()
            .into_values()
            .find(|window| window.is_focused().unwrap_or(false))?;
        let at = frame_of(&focused)?;
        Some(Frame {
            x: at.x + CASCADE as i32,
            y: at.y + CASCADE as i32,
            ..at
        })
    });

    let mut builder =
        tauri::WebviewWindowBuilder::from_config(app, &config).map_err(|e| e.to_string())?;
    if let Some(frame) = beside.filter(|frame| usable_frame(frame, &screens(app))) {
        builder = builder
            .position(f64::from(frame.x), f64::from(frame.y))
            .inner_size(f64::from(frame.width), f64::from(frame.height));
    }
    let window = builder.build().map_err(|e| e.to_string())?;

    // A window without a backdrop is a window that paints itself opaque, which
    // the frontend already handles. The backdrop is the main thread's to apply,
    // and this is not it.
    let backdrop = window.clone();
    let _ = app.run_on_main_thread(move || {
        if let Err(error) = crate::window::apply_transparency(&backdrop, true) {
            eprintln!("nuza: no window backdrop on this platform: {}", error);
        }
    });
    raise(&window);
    changed(app);
    Ok(window)
}

/// Opens a window without waiting for it, from wherever this is called - which
/// may be the thread the menu's events arrive on.
#[cfg(target_os = "macos")]
pub(crate) fn open_window_soon(app: &tauri::AppHandle, target: Option<OpenTarget>) {
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(error) = open_window(&app, target, None) {
            eprintln!("nuza: could not open a window: {}", error);
        }
    });
}

/// Sends `target` where it should go: to the window that already has it, or to
/// a window with nothing open, or to one made for it. Not for the main thread.
pub(crate) fn open_path(app: &tauri::AppHandle, target: OpenTarget) {
    match route(&open_windows(app), &target) {
        Route::Existing(label) => {
            if let Some(window) = app.get_webview_window(&label) {
                // A window that is up and listening is told; one that has been
                // opened and not yet collected what it was opened for is
                // routed to as the folder it is about to show, and so is not
                // this case.
                let _ = window.emit_to(&label, OPEN_TARGET_EVENT, target);
                raise(&window);
            }
        }
        Route::Fresh => {
            if let Err(error) = open_window(app, Some(target), None) {
                eprintln!("nuza: could not open a window: {}", error);
            }
        }
    }
}

/// Plain `nuza`, or the dock: bring forward the window that was in front last.
pub(crate) fn raise_recent(app: &tauri::AppHandle) {
    let windows = open_windows(app);
    if let Some(window) = windows
        .first()
        .and_then(|first| app.get_webview_window(&first.label))
    {
        raise(&window);
    }
}

/// The frontend's way to open a window: `File > New Window`.
#[tauri::command]
pub(crate) async fn open_new_window(app: tauri::AppHandle) -> Result<(), String> {
    static LAST: Mutex<Option<Instant>> = Mutex::new(None);
    {
        let mut last = locked(&LAST);
        if last.is_some_and(|at| at.elapsed() < NEW_WINDOW_DEBOUNCE) {
            return Ok(());
        }
        *last = Some(Instant::now());
    }
    tauri::async_runtime::spawn_blocking(move || open_window(&app, None, None).map(|_| ()))
        .await
        .map_err(|e| e.to_string())?
}

/// What a window opened for one note of `vault` is started on, or why not.
///
/// `resolved` is the note as the filesystem has it and `root` the calling
/// window's vault, both already checked; `path` and `vault` are the same two
/// as the frontend spells them, which is how the new window will ask for them.
pub(crate) fn note_window_target(
    resolved: &Path,
    root: Option<&Path>,
    path: &str,
    vault: &str,
) -> Result<OpenTarget, String> {
    let root = root.ok_or_else(|| "No folder is open".to_string())?;
    if !resolved.is_file() {
        return Err("That is not a note to open".to_string());
    }
    // The folder named has to be the one this window really has open: the
    // new window will open it as its vault, and must not be talked into
    // opening some other folder that happens to hold the note.
    let named = Path::new(vault).canonicalize().map_err(|e| e.to_string())?;
    if named != root {
        return Err("That is not the folder this window has open".to_string());
    }
    Ok(OpenTarget {
        kind: "file",
        path: path.to_string(),
        vault: Some(vault.to_string()),
    })
}

/// Moves a note into a window of its own: a new window on the same vault,
/// showing that note and nothing else of the vault's tabs.
///
/// Opened directly rather than through `route`, which would only bring this
/// window forward - it already has the vault open, and that is the point.
#[tauri::command]
pub(crate) async fn open_note_in_new_window(
    window: tauri::WebviewWindow,
    path: String,
    vault: String,
) -> Result<(), String> {
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let held = crate::state::vault_of(&window);
        let resolved = crate::state::within_vault(&held, Path::new(&path))?;
        let root = locked(&held.root).clone();
        let target = note_window_target(&resolved, root.as_deref(), &path, &vault)?;
        open_window(&app, Some(target), None).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// Closing and quitting
// ---------------------------------------------------------------------------

/// Quitting with several windows open: each is asked to save, and the app goes
/// when all of them have said they have.
#[derive(Default)]
pub(crate) struct Quit {
    waiting: Mutex<Option<HashSet<String>>>,
}

/// How a window's saying it has saved left the quit.
#[derive(Debug, PartialEq)]
pub(crate) enum Quitting {
    /// That was the last one: the app can go.
    Done,
    /// Still waiting on others.
    Waiting,
    /// Nobody asked for a quit.
    Idle,
}

impl Quit {
    /// Starts a quit with `labels` still to answer. False if one is already
    /// under way, which is how a second press of the key is told from the first.
    #[cfg(any(target_os = "macos", test))]
    pub(crate) fn begin(&self, labels: impl IntoIterator<Item = String>) -> bool {
        let mut waiting = locked(&self.waiting);
        if waiting.is_some() {
            return false;
        }
        *waiting = Some(labels.into_iter().collect());
        true
    }

    pub(crate) fn answered(&self, label: &str) -> Quitting {
        let mut waiting = locked(&self.waiting);
        let Some(labels) = waiting.as_mut() else {
            return Quitting::Idle;
        };
        labels.remove(label);
        if labels.is_empty() {
            Quitting::Done
        } else {
            Quitting::Waiting
        }
    }
}

/// Set once the app is on its way out, from which point the windows going away
/// is not the person closing them and so is not recorded as that.
#[derive(Default)]
pub(crate) struct ShuttingDown(pub(crate) AtomicBool);

/// Asks every window to save, and quits when they have - or when they have had
/// long enough. The windows are written down first, while they are all still
/// there: it is the set of them at the moment of quitting that comes back.
#[cfg(target_os = "macos")]
pub(crate) fn begin_quit(app: &tauri::AppHandle) {
    let labels: Vec<String> = app.webview_windows().keys().cloned().collect();
    if labels.is_empty() {
        app.exit(0);
        return;
    }
    if !app.state::<Quit>().begin(labels.clone()) {
        return;
    }

    save_windows(app);
    app.state::<ShuttingDown>().0.store(true, Ordering::SeqCst);
    for label in &labels {
        let _ = app.emit_to(label, QUIT_EVENT, ());
    }

    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(QUIT_PATIENCE);
        app.exit(0);
    });
}

/// A window has saved what it had and is ready for the app to go.
#[tauri::command]
pub(crate) fn window_ready_to_quit(window: tauri::WebviewWindow) {
    let app = window.app_handle();
    if app.state::<Quit>().answered(window.label()) == Quitting::Done {
        app.exit(0);
    }
}

/// What a window's closing starts. The last window closing is the app being
/// left, so the windows are written down before it goes; any other is one
/// window being put away, and is recorded by `window_gone`.
pub(crate) fn window_closing(app: &tauri::AppHandle) {
    if app.webview_windows().len() <= 1 {
        save_windows(app);
        app.state::<ShuttingDown>().0.store(true, Ordering::SeqCst);
    }
}

/// A window has gone: forget it, and - unless the app is leaving - what is
/// left open is what comes back.
pub(crate) fn window_gone(app: &tauri::AppHandle, label: &str) {
    app.state::<Windows>().remove(label);
    app.state::<Recent>().gone(label);
    app.state::<LaunchTarget>().take(label);
    changed(app);
    // Closing the last window leaves the app, on every platform: there is no
    // menu bar to keep it in with nothing open.
    if app.webview_windows().is_empty() {
        app.exit(0);
    }
}

/// The set of windows has changed, or what one of them shows has: what is kept
/// for next time and what the menu lists are brought up to date.
pub(crate) fn changed(app: &tauri::AppHandle) {
    if !app.state::<ShuttingDown>().0.load(Ordering::SeqCst) {
        save_windows(app);
    }
    #[cfg(target_os = "macos")]
    crate::menu::refresh_window_menu(app);
}

// ---------------------------------------------------------------------------
// Bringing the windows back
// ---------------------------------------------------------------------------

/// One window of the last run: the folder it had open, and where it was.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct SavedWindow {
    pub(crate) root: String,
    pub(crate) frame: Option<Frame>,
}

fn snapshot_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(SNAPSHOT_FILE))
}

/// Windows that have a folder open, in the order they were made.
fn current_windows<R: Runtime>(app: &tauri::AppHandle<R>) -> Vec<SavedWindow> {
    let vaults = app.state::<Windows>();
    let mut windows: Vec<_> = app.webview_windows().into_iter().collect();
    windows.sort_by_key(|(label, _)| creation_order(label));

    windows
        .into_iter()
        .filter_map(|(label, window)| {
            let root = vaults.root(&label)?;
            Some(SavedWindow {
                root: plain(root),
                frame: frame_of(&window),
            })
        })
        .collect()
}

/// Writes down which folders are open, and where. A window with nothing open
/// is not worth bringing back, so it is not kept.
pub(crate) fn save_windows<R: Runtime>(app: &tauri::AppHandle<R>) {
    let Some(path) = snapshot_path(app) else {
        return;
    };
    let windows = current_windows(app);
    // Written even when empty, so the last window to have had a folder is not
    // brought back after the folder was closed.
    let Ok(json) = serde_json::to_vec(&windows) else {
        return;
    };
    if let Some(directory) = path.parent() {
        let _ = std::fs::create_dir_all(directory);
    }
    if let Err(error) = crate::files::write_atomically(&path, &json) {
        eprintln!("nuza: could not keep the open windows: {}", error);
    }
}

/// The windows of the last run, without any that are not there any more.
/// Whatever is in the file, anything that is not a window is left out.
pub(crate) fn read_saved(json: &[u8]) -> Vec<SavedWindow> {
    let saved: Vec<SavedWindow> = serde_json::from_slice(json).unwrap_or_default();
    saved
        .into_iter()
        .filter(|window| Path::new(&window.root).is_dir())
        .collect()
}

/// What the first window starts on, and which others are opened - none of them
/// the one that `launched`, if the app was started on something, already is.
pub(crate) fn plan_restore(
    saved: Vec<SavedWindow>,
    launched: Option<&OpenTarget>,
) -> (Option<SavedWindow>, Vec<SavedWindow>) {
    let covered = |window: &SavedWindow| {
        launched.is_some_and(|target| {
            let path = Path::new(&target.path);
            if target.kind == "folder" {
                path == Path::new(&window.root)
            } else {
                path.starts_with(&window.root)
            }
        })
    };
    let mut saved: Vec<SavedWindow> = saved.into_iter().filter(|w| !covered(w)).collect();
    if launched.is_some() || saved.is_empty() {
        return (None, saved);
    }
    let first = saved.remove(0);
    (Some(first), saved)
}

/// Starts the first window on what the last run left open, and opens the rest
/// beside it. Called as the app comes up, before any window has loaded.
pub(crate) fn restore_windows(app: &tauri::AppHandle, launched: Option<&OpenTarget>) {
    let Some(path) = snapshot_path(app) else {
        return;
    };
    let Ok(json) = std::fs::read(path) else {
        return;
    };
    let (first, others) = plan_restore(read_saved(&json), launched);

    if let Some(first) = first {
        app.state::<LaunchTarget>().queue(
            MAIN_WINDOW,
            OpenTarget {
                kind: "folder",
                path: first.root,
                vault: None,
            },
        );
        if let (Some(frame), Some(window)) = (first.frame, app.get_webview_window(MAIN_WINDOW)) {
            if usable_frame(&frame, &screens(app)) {
                let _ = window.set_size(tauri::LogicalSize::new(frame.width, frame.height));
                let _ = window.set_position(tauri::LogicalPosition::new(frame.x, frame.y));
            }
        }
    }

    if others.is_empty() {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        for window in others {
            let target = OpenTarget {
                kind: "folder",
                path: window.root,
                vault: None,
            };
            if let Err(error) = open_window(&app, Some(target), window.frame) {
                eprintln!("nuza: could not bring a window back: {}", error);
            }
        }
    });
}
