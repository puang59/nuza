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
  | "previous-heading"
  | "new-note"
  | "reset-font-size"
  | "toggle-inline-code"
  | "toggle-strikethrough"
  | "toggle-bullet-list"
  | "toggle-numbered-list"
  | "toggle-task-list"
  | "toggle-blockquote"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "heading-4"
  | "heading-5"
  | "heading-6"
  | "heading-none"
  | "go-back"
  | "go-forward";

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
  {
    id: "new-note",
    label: "New Note",
    description: "Make a note beside the open one, and open it",
    defaultBinding: "mod+n",
  },
  {
    id: "reset-font-size",
    label: "Reset Font Size",
    description: "Put the editor text back to its usual size",
    defaultBinding: "mod+0",
  },
  {
    id: "toggle-inline-code",
    label: "Inline Code",
    description: "Mark the selection as code, or plain again",
    defaultBinding: "mod+e",
  },
  {
    id: "toggle-strikethrough",
    label: "Strikethrough",
    description: "Strike the selection through, or plain again",
    defaultBinding: "mod+shift+x",
  },
  {
    id: "toggle-bullet-list",
    label: "Bullet List",
    description: "Turn the selected lines into bullets, or back",
    defaultBinding: "mod+shift+8",
  },
  {
    id: "toggle-numbered-list",
    label: "Numbered List",
    description: "Turn the selected lines into numbered points, or back",
    defaultBinding: "mod+shift+7",
  },
  {
    id: "toggle-task-list",
    label: "Task List",
    description: "Turn the selected lines into tasks, or back",
    defaultBinding: "mod+shift+9",
  },
  {
    id: "toggle-blockquote",
    label: "Quote",
    description: "Quote the selected lines, or unquote them",
    defaultBinding: "mod+shift+.",
  },
  {
    id: "heading-1",
    label: "Heading 1",
    description: "Make the line a level 1 heading, or plain again",
    defaultBinding: "mod+alt+1",
  },
  {
    id: "heading-2",
    label: "Heading 2",
    description: "Make the line a level 2 heading, or plain again",
    defaultBinding: "mod+alt+2",
  },
  {
    id: "heading-3",
    label: "Heading 3",
    description: "Make the line a level 3 heading, or plain again",
    defaultBinding: "mod+alt+3",
  },
  {
    id: "heading-4",
    label: "Heading 4",
    description: "Make the line a level 4 heading, or plain again",
    defaultBinding: "mod+alt+4",
  },
  {
    id: "heading-5",
    label: "Heading 5",
    description: "Make the line a level 5 heading, or plain again",
    defaultBinding: "mod+alt+5",
  },
  {
    id: "heading-6",
    label: "Heading 6",
    description: "Make the line a level 6 heading, or plain again",
    defaultBinding: "mod+alt+6",
  },
  {
    id: "heading-none",
    label: "Plain Text",
    description: "Take the heading off the line",
    defaultBinding: "mod+alt+0",
  },
  {
    id: "go-back",
    label: "Go Back",
    description: "Return to the place you were before the last jump",
    defaultBinding: "mod+[",
  },
  {
    id: "go-forward",
    label: "Go Forward",
    description: "Return to the place you went back from",
    defaultBinding: "mod+]",
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
