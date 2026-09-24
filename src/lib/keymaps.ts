export type KeymapAction =
  | "toggle-sidebar"
  | "save-file"
  | "open-folder"
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
  | "close-tab";

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
    defaultBinding: "mod+b",
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
    // Deliberately not mod+w: on macOS that's the native "Close Window" menu
    // shortcut, which fires before the webview ever sees the key and would
    // close the whole app instead of the tab.
    id: "close-tab",
    label: "Close Tab",
    description: "Close the current tab",
    defaultBinding: "mod+shift+w",
  },
];

export const KEYMAP_STORAGE_KEY = "nuza:keymap-overrides";
