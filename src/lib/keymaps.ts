export type KeymapAction =
  | "toggle-sidebar"
  | "save-file"
  | "open-folder"
  | "open-settings"
  | "toggle-vim-mode"
  | "check-updates"
  | "increase-font-size"
  | "decrease-font-size";

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
];

export const KEYMAP_STORAGE_KEY = "nuza:keymap-overrides";
