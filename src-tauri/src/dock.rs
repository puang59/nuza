//! Recent vaults in the menu of nuza's Dock icon, on macOS.
//!
//! Tauri has no hook for the Dock menu, so the app delegate is given the
//! `applicationDockMenu:` method AppKit asks it for, at startup. The menu is
//! built from the vaults the frontend last reported, newest first, and an item
//! chosen from it opens its vault the way `nuza <folder>` does: in the window
//! that has it, or one with nothing open, or a new one.

use std::sync::Mutex;
#[cfg(target_os = "macos")]
use std::{ffi::CStr, sync::OnceLock};

#[cfg(target_os = "macos")]
use objc2::rc::Retained;
#[cfg(target_os = "macos")]
use objc2::runtime::{AnyObject, Imp, Sel};
#[cfg(target_os = "macos")]
use objc2::{class, ffi, msg_send, sel};
#[cfg(target_os = "macos")]
use objc2_foundation::NSString;

#[cfg(target_os = "macos")]
use crate::cli::OpenTarget;

/// How many vaults the menu lists.
const SHOWN: usize = 10;

/// A vault for the menu: its folder, and what it is called.
#[derive(serde::Deserialize, Clone, Debug)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) struct DockVault {
    pub(crate) path: String,
    pub(crate) name: String,
}

static VAULTS: Mutex<Vec<DockVault>> = Mutex::new(Vec::new());
#[cfg(target_os = "macos")]
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

/// The two methods added to the delegate, as the runtime calls them.
#[cfg(target_os = "macos")]
type MenuMethod =
    unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> *mut AnyObject;
#[cfg(target_os = "macos")]
type ActionMethod = unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject);

/// The vaults to list, newest first, as the frontend keeps them. Folders that
/// are no longer there are left out.
#[tauri::command]
pub(crate) fn set_dock_vaults(vaults: Vec<DockVault>) {
    let shown: Vec<DockVault> = vaults
        .into_iter()
        .filter(|vault| std::path::Path::new(&vault.path).is_dir())
        .take(SHOWN)
        .collect();
    *VAULTS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = shown;
}

/// Gives the app delegate the Dock menu. On the main thread, once, at startup.
#[cfg(target_os = "macos")]
pub(crate) fn install(app: &tauri::AppHandle) {
    if APP.set(app.clone()).is_err() {
        return;
    }
    unsafe {
        let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        let delegate: *mut AnyObject = msg_send![ns_app, delegate];
        if delegate.is_null() {
            log::warn!("no app delegate to give the Dock menu to");
            return;
        }
        let class = (*delegate).class() as *const _ as *mut objc2::runtime::AnyClass;
        let menu: unsafe extern "C-unwind" fn(
            *mut AnyObject,
            Sel,
            *mut AnyObject,
        ) -> *mut AnyObject = dock_menu;
        let open: ActionMethod = open_vault;
        add_method(
            class,
            sel!(applicationDockMenu:),
            std::mem::transmute::<MenuMethod, Imp>(menu),
            c"@@:@",
        );
        add_method(
            class,
            sel!(nuzaOpenRecentVault:),
            std::mem::transmute::<ActionMethod, Imp>(open),
            c"v@:@",
        );
    }
}

#[cfg(target_os = "macos")]
unsafe fn add_method(class: *mut objc2::runtime::AnyClass, name: Sel, imp: Imp, types: &CStr) {
    if !ffi::class_addMethod(class, name, imp, types.as_ptr()).as_bool() {
        log::warn!("the app delegate already answers {name:?}; the Dock menu is left to it");
    }
}

/// `applicationDockMenu:` - asked for each time the Dock menu opens.
#[cfg(target_os = "macos")]
unsafe extern "C-unwind" fn dock_menu(
    this: *mut AnyObject,
    _: Sel,
    _app: *mut AnyObject,
) -> *mut AnyObject {
    let vaults = VAULTS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();
    let menu: *mut AnyObject = msg_send![class!(NSMenu), new];
    for vault in &vaults {
        let title = NSString::from_str(&vault.name);
        let path = NSString::from_str(&vault.path);
        let empty = NSString::from_str("");
        let item: *mut AnyObject = msg_send![class!(NSMenuItem), alloc];
        let item: *mut AnyObject = msg_send![
            item,
            initWithTitle: &*title,
            action: sel!(nuzaOpenRecentVault:),
            keyEquivalent: &*empty
        ];
        let _: () = msg_send![item, setTarget: this];
        let _: () = msg_send![item, setRepresentedObject: &*path];
        let _: () = msg_send![item, setToolTip: &*path];
        let _: () = msg_send![menu, addItem: item];
        let _: () = msg_send![item, release];
    }
    // Handed back autoreleased, as AppKit expects of a getter.
    msg_send![menu, autorelease]
}

/// A vault chosen from the Dock menu.
#[cfg(target_os = "macos")]
unsafe extern "C-unwind" fn open_vault(_this: *mut AnyObject, _: Sel, item: *mut AnyObject) {
    let path: Option<Retained<NSString>> = msg_send![item, representedObject];
    let (Some(path), Some(app)) = (path, APP.get()) else {
        return;
    };
    let target = OpenTarget {
        kind: "folder",
        path: path.to_string(),
        vault: None,
        single: false,
    };
    let app = app.clone();
    // Off the main thread, as everything that opens a window from an event is.
    std::thread::spawn(move || crate::multiwindow::open_path(&app, target));
}
