import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { exit } from "@tauri-apps/plugin-process";
import { isMacPlatform } from "@/lib/platform";

/** Fired by the "Quit" item the app puts in the macOS menu bar. */
const QUIT_EVENT = "menu:quit";

/**
 * Putting the work away on the way out.
 *
 * Autosave is a timer: a note is written back a short while after it changes,
 * which is what keeps a burst of typing to one write. Leaving inside that
 * window used to drop whatever it had not got to - there is no prompt on the
 * way out to catch it, and quitting an editor is rarely a decision to throw
 * the last sentence away.
 *
 * Both ways out are held open just long enough to write. The window's close
 * button announces itself and can be told to wait; ⌘Q cannot, because on macOS
 * it is a menu key equivalent that ends the process before the webview is told
 * anything at all, so the app puts its own Quit item in the menu bar and that
 * item comes through here instead.
 */
export function useSaveOnExit(flush: () => Promise<void>) {
  // Through a ref so a rebuilt `flush` does not mean tearing the listeners
  // down and putting identical ones back.
  const latest = useRef(flush);
  latest.current = flush;

  useEffect(() => {
    async function leave() {
      try {
        await latest.current();
      } catch (error) {
        // Quitting is not the moment to refuse to quit. Whatever could not be
        // written is reported, and the app still goes.
        console.error("Failed to save on the way out:", error);
      }
      await exit(0);
    }

    const window = getCurrentWindow();
    const closing = window.onCloseRequested((event) => {
      // Held, not cancelled: the window goes as soon as the writes are done.
      event.preventDefault();
      void leave();
    });
    const quitting = isMacPlatform() ? listen(QUIT_EVENT, () => void leave()) : null;

    return () => {
      void closing.then((stop) => stop());
      void quitting?.then((stop) => stop());
    };
  }, []);
}
