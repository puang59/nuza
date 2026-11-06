#[cfg(target_os = "windows")]
use window_vibrancy::{apply_acrylic, apply_mica, clear_acrylic, clear_mica};
#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial};

/// The Windows backdrop that does not make the window crawl.
///
/// DWM's blur-behind - what `apply_blur` reaches for - redraws the entire
/// window on every frame of a drag or a resize on anything past Windows 10
/// v1809, which is why dragging nuza across a Windows desktop took seconds
/// rather than following the pointer. Mica is the documented replacement and
/// costs nothing to move, so Windows 11 gets that, the one Windows 10 build
/// where acrylic is still cheap gets acrylic, and anything older goes without
/// a backdrop rather than going slow.
#[cfg(target_os = "windows")]
pub(crate) fn apply_windows_backdrop(
    window: &tauri::WebviewWindow,
    enabled: bool,
) -> Result<bool, String> {
    /// Windows 11, where mica exists.
    const MICA: u32 = 22000;
    /// Windows 10 v1809, where acrylic arrived.
    const ACRYLIC: u32 = 17763;
    /// Windows 10 v1903, from which acrylic drags as badly as blur does.
    const ACRYLIC_SLOWED: u32 = 18362;

    let build = windows_version::OsVersion::current().build;

    if build >= MICA {
        if enabled {
            apply_mica(window, Some(true)).map_err(|e| e.to_string())?;
        } else {
            clear_mica(window).map_err(|e| e.to_string())?;
        }
        Ok(true)
    } else if (ACRYLIC..ACRYLIC_SLOWED).contains(&build) {
        if enabled {
            apply_acrylic(window, Some((18, 18, 18, 125))).map_err(|e| e.to_string())?;
        } else {
            clear_acrylic(window).map_err(|e| e.to_string())?;
        }
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Applies or clears the OS-level window transparency/vibrancy effect, and
/// says whether this platform has one at all. Where it does not - Linux, or a
/// Windows build with no backdrop worth the frame rate - the frontend paints
/// the window opaque instead of leaving a hole through to the desktop.
pub(crate) fn apply_transparency(
    window: &tauri::WebviewWindow,
    enabled: bool,
) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        if enabled {
            apply_vibrancy(window, NSVisualEffectMaterial::Sidebar, None, None)
                .map_err(|e| e.to_string())?;
        } else {
            clear_vibrancy(window).map_err(|e| e.to_string())?;
        }
        Ok(true)
    }

    #[cfg(target_os = "windows")]
    {
        apply_windows_backdrop(window, enabled)
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (window, enabled);
        Ok(false)
    }
}

/// Lets a trackpad pinch reach the page.
///
/// wry switches WebView2's pinch zoom off along with the rest of its zoom
/// controls, and with it off WebView2 drops the gesture before the page can
/// see it as a wheel event with Ctrl held - so the editor has nothing to zoom
/// its text to. Only the pinch is switched back on: Ctrl+= and the like stay
/// the app's own, and the page cancels the zoom a pinch would otherwise cause.
/// Only WebView2 has the setting; elsewhere there is nothing to do.
pub(crate) fn pass_pinch_to_page(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "windows")]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings5;
        use windows::core::Interface;

        let result = window.with_webview(|webview| unsafe {
            let settings = webview
                .controller()
                .CoreWebView2()
                .and_then(|core| core.Settings())
                .and_then(|settings| settings.cast::<ICoreWebView2Settings5>());
            if let Ok(settings) = settings {
                let _ = settings.SetIsPinchZoomEnabled(true);
            }
        });
        if let Err(error) = result {
            log::warn!("pinch zoom left off: {}", error);
        }
    }

    #[cfg(not(target_os = "windows"))]
    let _ = window;
}

/// Tauri command wrapper around [`apply_transparency`] for toggling the
/// effect at runtime from the frontend's settings panel.
///
/// One of the two commands that stays on the main thread deliberately: it is
/// the window it is changing, and a window is the main thread's to touch.
/// There is no IO here to be slow about either.
/// Opens the system's print dialog for the window, which is also where a PDF
/// is saved from. The webview's own `window.print()` does nothing in the
/// macOS webview, so printing goes through Tauri's. A plain `fn`, so it runs
/// on the main thread, which is where the print panel has to be shown from.
#[tauri::command]
pub(crate) fn print_page(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn set_transparency(
    window: tauri::WebviewWindow,
    enabled: bool,
) -> Result<bool, String> {
    apply_transparency(&window, enabled)
}

/// A webview configuration that draws at the display's own refresh rate.
///
/// WebKit's `PreferPageRenderingUpdatesNear60FPSEnabled`, on by default,
/// drives animation frames at the divisor of the refresh rate nearest 60: on a
/// 144Hz screen that is 72fps, half what every native app beside nuza draws
/// at, and the caret, scrolling and the panels sliding in all look it. It is
/// read when a page is created, so it has to be in the configuration the
/// webview is built with - turning it off on a live page changes nothing.
///
/// The switch is WebKit's private feature list, looked up by name: a WebKit
/// that renames or drops it leaves the default in place rather than failing.
/// nuza is not distributed through the App Store, which is where private API
/// would matter. Built on the main thread, where WebKit's objects belong, and
/// handed back to whichever thread is building the window.
#[cfg(target_os = "macos")]
pub(crate) fn full_rate_configuration(
    app: &tauri::AppHandle,
) -> Option<objc2::rc::Retained<objc2_web_kit::WKWebViewConfiguration>> {
    use objc2::rc::Retained;
    use objc2::MainThreadMarker;
    use objc2_web_kit::WKWebViewConfiguration;

    if let Some(main) = MainThreadMarker::new() {
        return Some(full_rate(main));
    }

    /// Only carried across, never touched on the way: WebKit gets it back on
    /// the main thread when the window is built.
    struct Handoff(Retained<WKWebViewConfiguration>);
    unsafe impl Send for Handoff {}

    let (send, receive) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        if let Some(main) = MainThreadMarker::new() {
            let _ = send.send(Handoff(full_rate(main)));
        }
    })
    .ok()?;
    receive.recv().ok().map(|handoff| handoff.0)
}

#[cfg(target_os = "macos")]
fn full_rate(
    main: objc2::MainThreadMarker,
) -> objc2::rc::Retained<objc2_web_kit::WKWebViewConfiguration> {
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, NSObjectProtocol};
    use objc2::{msg_send, sel};
    use objc2_foundation::{NSArray, NSString};
    use objc2_web_kit::WKWebViewConfiguration;

    const FEATURE: &str = "PreferPageRenderingUpdatesNear60FPSEnabled";

    let config = unsafe { WKWebViewConfiguration::new(main) };
    let preferences = unsafe { config.preferences() };
    let Some(class) = AnyClass::get(c"WKPreferences") else {
        return config;
    };

    unsafe {
        let listed: bool = msg_send![class, respondsToSelector: sel!(_features)];
        if !listed || !preferences.respondsToSelector(sel!(_setEnabled:forFeature:)) {
            return config;
        }
        let features: Option<Retained<NSArray<AnyObject>>> = msg_send![class, _features];
        for feature in features.iter().flat_map(|features| features.iter()) {
            let key: Option<Retained<NSString>> = msg_send![&*feature, key];
            if key.is_some_and(|key| key.to_string() == FEATURE) {
                let _: () = msg_send![&*preferences, _setEnabled: false, forFeature: &*feature];
            }
        }
    }
    config
}
