import { formatBinding } from "./keybinding";
import type { KeymapAction } from "./keymaps";

/** One line of the guide: something to do, and the keys that do it. */
export interface StartingPoint {
  action: KeymapAction;
  label: string;
}

/**
 * What to offer on an empty scratch note. Someone opening the app for the
 * first time has a blank page and no idea what the app does with folders; the
 * way in is opening one. With a vault open, the next things anyone wants are
 * a note to write in and a way to find the ones already there.
 */
export function startingPoints(hasVault: boolean): StartingPoint[] {
  return hasVault
    ? [
        { action: "new-note", label: "Create new note" },
        { action: "quick-open", label: "Go to file" },
        { action: "toggle-sidebar", label: "Toggle the sidebar" },
        { action: "open-settings", label: "Settings" },
      ]
    : [
        { action: "open-folder", label: "Open a folder" },
        { action: "open-settings", label: "Settings" },
      ];
}

/** A starting point as it reads: its label, and its keys in brackets if it has any. */
export function describeStartingPoint(label: string, binding: string, isMac?: boolean) {
  const keys = formatBinding(binding, isMac);
  return keys ? `${label} (${keys})` : label;
}
