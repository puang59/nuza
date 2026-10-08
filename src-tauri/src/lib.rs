#[cfg(target_os = "linux")]
mod appimage;
mod cli;
mod files;
mod folder;
mod fonts;
mod index;
mod launch;
mod media;
mod menu;
mod multiwindow;
mod recovery;
mod search;
mod slow;
mod state;
mod tags;
mod tasks;
mod tree;
mod watcher;
mod wiki;
mod window;

#[cfg(test)]
mod tests;

use std::path::Path;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before anything else: it may start the program again.
    #[cfg(target_os = "linux")]
    appimage::prefer_system_wayland();

    let builder = tauri::Builder::default();

    // First of the plugins, which is what it asks for: a second `nuza` is
    // stopped before it sets anything else up, and its arguments come here.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        let target = cli::target_from_args(&args, Path::new(&cwd));
        let app = app.clone();
        // Off the thread the arguments arrive on: opening a window from the
        // thread that pumps the event loop can wait on itself.
        std::thread::spawn(move || match target {
            // To the window that has it, or one with nothing open, or a new one.
            Some(target) => multiwindow::open_path(&app, target),
            // Plain `nuza`: the person has just run the command, and wants to
            // see the app.
            None => multiwindow::raise_recent(&app),
        });
    }));

    let builder = builder
        // Before any window exists to be told about them.
        .manage(multiwindow::Recent::default())
        .manage(multiwindow::Quit::default())
        .manage(multiwindow::ShuttingDown::default())
        .manage(state::LaunchTarget::default())
        // A note's images and video, served against the open folder rather
        // than against a list of every folder ever opened.
        .register_asynchronous_uri_scheme_protocol(
            media::MEDIA_PROTOCOL,
            |context, request, responder| {
                let app_handle = context.app_handle().clone();
                // Which window asked decides which folder the file may come from.
                let label = context.webview_label().to_string();
                // Off the main thread for the same reason the commands are:
                // this reads a file, and a video asks for a great many of
                // these while the window is trying to draw.
                tauri::async_runtime::spawn_blocking(move || {
                    responder.respond(media::serve_media(&app_handle, &label, &request));
                });
            },
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Empty until a folder is opened, which is also what makes every
            // filesystem command refuse until then.
            app.manage(state::Windows::default());

            // What `nuza <path>` started this run on, if it did. Read here, not
            // by the window, so it does not depend on who asks first.
            let launched = std::env::current_dir()
                .ok()
                .and_then(|cwd| cli::target_from_args(&std::env::args().collect::<Vec<_>>(), &cwd));
            if let Some(target) = launched.clone() {
                app.state::<state::LaunchTarget>()
                    .queue(multiwindow::MAIN_WINDOW, target);
            }

            // A window without a backdrop is a window that paints itself
            // opaque - the frontend already handles that, and it is not worth
            // refusing to start over.
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = window::apply_transparency(&window, true) {
                    eprintln!("nuza: no window backdrop on this platform: {}", error);
                }
            }

            // The windows the last run ended with, brought back: the first on
            // the main window, the rest beside it.
            multiwindow::restore_windows(app.handle(), launched.as_ref());

            // Edits kept for notes that have since been deleted are let go of,
            // once they are old enough that nobody is coming back for them.
            recovery::prune_in_background(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::Focused(true) => {
                window
                    .state::<multiwindow::Recent>()
                    .focused(window.label());
            }
            // The last one closing is the app being left; the windows are
            // written down before the first of them goes.
            tauri::WindowEvent::CloseRequested { .. } => {
                multiwindow::window_closing(window.app_handle());
            }
            // The window's folder goes with it, and its watcher with that.
            tauri::WindowEvent::Destroyed => {
                multiwindow::window_gone(window.app_handle(), window.label());
            }
            _ => {}
        })
        .plugin(tauri_plugin_opener::init());

    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(menu::build_menu)
        .on_menu_event(menu::on_menu_event);

    builder
        .invoke_handler(tauri::generate_handler![
            files::save_file_picker,
            folder::load_folder_picker,
            folder::open_folder,
            folder::list_folder,
            files::read_file,
            files::existing_files,
            files::file_times,
            files::open_with_system,
            search::search_contents,
            search::list_files,
            wiki::list_wiki_links,
            search::list_tags,
            launch::take_launch_target,
            launch::cli_status,
            launch::install_cli,
            launch::uninstall_cli,
            files::duplicate_entry,
            files::write_file,
            media::write_media,
            recovery::keep_recovery,
            recovery::take_recovery,
            recovery::drop_recovery,
            files::create_file,
            files::create_folder,
            files::rename_entry,
            files::move_entry,
            files::delete_entry,
            fonts::list_system_fonts,
            multiwindow::open_new_window,
            multiwindow::open_note_in_new_window,
            multiwindow::window_ready_to_quit,
            window::set_transparency,
            window::print_page,
            menu::set_close_tab_shortcut
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
