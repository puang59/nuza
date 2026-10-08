export type KeymapAction =
  | "toggle-sidebar"
  | "save-file"
  | "open-folder"
  | "new-window"
  | "search-files"
  | "quick-open"
  | "open-settings"
  | "toggle-vim-mode"
  | "check-updates"
  | "increase-font-size"
  | "decrease-font-size"
  | "next-tab"
  | "previous-tab"
  | "recent-tab"
  | "close-tab"
  | "reopen-closed-tab"
  | "toggle-bold"
  | "toggle-italic"
  | "insert-link"
  | "print-note"
  | "next-heading"
  | "previous-heading";

export interface KeymapDefinition {
  id: KeymapAction;
  label: string;
  description: string;
  defaultBinding: string;
}

/** Every keyboard-drivable action in the editor, and its default binding. */
export const KEYMAP_ACTIONS: KeymapDefinition[] = [
  {
    id: "toggle-sidebar",
    label: "Toggle Sidebar",
    description: "Show or hide the file explorer",
    // Not mod+b: that is bold in every editor anyone writes in. mod+\ is
    // the sidebar toggle in Notion, among others.
    defaultBinding: "mod+\\",
  },
  {
    id: "save-file",
    label: "Save File",
    description: "Save the current file",
    defaultBinding: "mod+s",
  },
  {
    id: "open-folder",
    label: "Open Folder",
    description: "Open a folder in the explorer",
    defaultBinding: "mod+o",
  },
  {
    id: "new-window",
    label: "New Window",
    description: "Open another window, on the welcome screen",
    defaultBinding: "mod+shift+n",
  },
  {
    id: "search-files",
    label: "Search Files",
    description: "Find a file in the explorer by name",
    defaultBinding: "mod+p",
  },
  {
    id: "quick-open",
    label: "Quick Open",
    description: "Find a file from a floating search, with or without the explorer open",
    defaultBinding: "mod+shift+f",
  },
  {
    id: "open-settings",
    label: "Open Settings",
    description: "Open the settings panel",
    defaultBinding: "mod+,",
  },
  {
    id: "toggle-vim-mode",
    label: "Toggle Vim Mode",
    description: "Enable or disable Vim keybindings",
    defaultBinding: "mod+shift+v",
  },
  {
    id: "check-updates",
    label: "Check for Updates",
    description: "Check for a new version of nuza",
    defaultBinding: "mod+shift+u",
  },
  {
    id: "increase-font-size",
    label: "Increase Font Size",
    description: "Make the editor text bigger",
    defaultBinding: "mod+=",
  },
  {
    id: "decrease-font-size",
    label: "Decrease Font Size",
    description: "Make the editor text smaller",
    defaultBinding: "mod+-",
  },
  {
    id: "next-tab",
    label: "Next Tab",
    description: "Switch to the tab on the right",
    defaultBinding: "mod+alt+arrowright",
  },
  {
    id: "previous-tab",
    label: "Previous Tab",
    description: "Switch to the tab on the left",
    defaultBinding: "mod+alt+arrowleft",
  },
  {
    id: "recent-tab",
    label: "Recent Tab",
    description: "Flip back to the previously viewed tab",
    defaultBinding: "ctrl+tab",
  },
  {
    // On macOS this is the native "Close Window" shortcut, which fires before
    // the webview ever sees the key - so the app replaces that menu item with
    // one of its own rather than leaving mod+w closing the whole window.
    id: "close-tab",
    label: "Close Tab",
    description: "Close the current tab",
    defaultBinding: "mod+w",
  },
  {
    id: "reopen-closed-tab",
    label: "Reopen Closed Tab",
    description: "Bring back the tab closed most recently",
    defaultBinding: "mod+shift+t",
  },
  {
    id: "toggle-bold",
    label: "Bold",
    description: "Make the selection bold, or plain again",
    defaultBinding: "mod+b",
  },
  {
    id: "toggle-italic",
    label: "Italic",
    description: "Make the selection italic, or plain again",
    defaultBinding: "mod+i",
  },
  {
    id: "insert-link",
    label: "Insert Link",
    description: "Turn the selection into a link",
    defaultBinding: "mod+k",
  },
  {
    // Not mod+p, which finds a file - the one shortcut nuza users reach for
    // far more often than printing.
    id: "print-note",
    label: "Print / Save as PDF",
    description: "Print the open note, or save it as a PDF from the print dialog",
    defaultBinding: "mod+shift+p",
  },
  {
    id: "next-heading",
    label: "Next Heading",
    description: "Move to the next heading down the note",
    defaultBinding: "mod+alt+arrowdown",
  },
  {
    id: "previous-heading",
    label: "Previous Heading",
    description: "Move to the nearest heading above",
    defaultBinding: "mod+alt+arrowup",
  },
];

export const KEYMAP_STORAGE_KEY = "nuza:keymap-overrides";

/**
 * The actions whose binding is also some other action's.
 *
 * Two actions can be given the same chord, and the listener returns on the
 * first one it matches - so the loser simply stops working, with nothing on
 * screen to say why. Settings shows this beside both of them.
 */
export function conflictingActions(bindings: Partial<Record<KeymapAction, string>>): Set<KeymapAction> {
  const seen = new Map<string, KeymapAction[]>();

  for (const action of KEYMAP_ACTIONS) {
    const binding = bindings[action.id];
    if (!binding) continue;
    seen.set(binding, [...(seen.get(binding) ?? []), action.id]);
  }

  const clashing = new Set<KeymapAction>();
  for (const sharing of seen.values()) {
    if (sharing.length > 1) for (const action of sharing) clashing.add(action);
  }
  return clashing;
}
