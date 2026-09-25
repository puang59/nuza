import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toAccelerator } from "@/lib/keybinding";
import { isMacPlatform } from "@/lib/platform";

/** Fired by the "Close Tab" item the app puts in the macOS menu bar. */
const CLOSE_TAB_EVENT = "menu:close-tab";

/**
 * Closing a tab with ⌘W on macOS.
 *
 * The menu bar is offered a key equivalent before the webview is offered the
 * key, so a shortcut that sits in a menu never reaches the keymap listener at
 * all - which is why ⌘W used to close the window instead of the note. The app
 * replaces that menu item with one of its own; this listens for it, and keeps
 * its key equivalent pointed at whatever Close Tab is bound to so rebinding it
 * in Settings still works.
 *
 * Everywhere else there is no menu bar in the way and the keymap handles the
 * key itself, so this does nothing.
 */
export function useCloseTabMenu(binding: string, closeTab: () => void) {
  // Read through a ref so re-binding the shortcut doesn't mean tearing the
  // listener down and putting an identical one back.
  const latest = useRef(closeTab);
  latest.current = closeTab;

  useEffect(() => {
    if (!isMacPlatform()) return;

    const listening = listen(CLOSE_TAB_EVENT, () => latest.current());
    return () => {
      void listening.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    if (!isMacPlatform()) return;

    invoke("set_close_tab_shortcut", { accelerator: toAccelerator(binding) }).catch((error) => {
      console.error("Failed to update the Close Tab shortcut:", error);
    });
  }, [binding]);
}
