import type { EditorView } from "@codemirror/view";

/**
 * What the plugin API needs from the app, which lives in React state: the open
 * folder, the editors, the tabs. App.tsx hands it over once and keeps it
 * current; the API reads it at the moment a plugin asks.
 */
export interface HostBridge {
  /** The open folder, or null. */
  root(): string | null;
  /** The note in the main pane, by its full path, or null for the scratch note. */
  activePath(): string | null;
  activeView(): EditorView | null;
  /** Whether a note is held by the editor (it has a tab). */
  isOpen(path: string): boolean;
  /** The text of a note the editor holds, unsaved edits and all. */
  readOpen(path: string): string;
  /** Changes a note the editor holds, as an edit the autosave will write. */
  editOpen(path: string, text: string): boolean;
  openNote(path: string, options: { split?: boolean }): Promise<void>;
  rename(path: string, newName: string): Promise<void>;
  trash(path: string): Promise<void>;
  createFolder(parent: string, name: string): Promise<void>;
}

let current: HostBridge | null = null;

export function setHostBridge(bridge: HostBridge | null) {
  current = bridge;
}

/** The app's side of the API, or an error a plugin can read if there is none yet. */
export function host(): HostBridge {
  if (!current) throw new Error("nuza isn't ready yet");
  return current;
}
