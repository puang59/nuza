import { createContext, useContext, useSyncExternalStore } from "react";
import { FileEntry } from "@/lib/types";

export type PendingCreate = { parentPath: string; type: "file" | "folder" } | null;

export type ContextMenuState = {
  x: number;
  y: number;
  /** The entry that was right-clicked, or `null` for the background/root. */
  entry: FileEntry | null;
} | null;

/**
 * What a row in the tree can do. Everything here is stable for as long as the
 * sidebar is, or close to it - which is what lets the value be memoised and a
 * search keystroke stop re-rendering the whole vault. Anything that changes
 * per animation frame belongs in `dragSource`, not here.
 */
export interface TreeActions {
  onFileSelect?: (path: string) => void;
  /** Which rows are open, selected, being renamed or being made into: see `TreeMarks`. */
  marks: TreeMarkStore;
  submitRename: (path: string, newName: string) => void;
  cancelRename: () => void;
  submitCreate: (name: string) => void;
  cancelCreate: () => void;
  openContextMenu: (e: React.MouseEvent, entry: FileEntry | null) => void;
  moveEntry: (path: string, targetDir: string) => void;
  /** Files dragged in from outside the app, to be copied into `directory`. */
  attachFiles: (directory: string, files: File[]) => void;
  /**
   * Reads what is inside a folder that has just been opened. Rejects when the
   * folder did not answer, so its row can say so.
   */
  loadFolder: (path: string) => Promise<void>;
}

export const TreeContext = createContext<TreeActions | null>(null);

export function useTreeContext() {
  const ctx = useContext(TreeContext);
  if (!ctx) throw new Error("useTreeContext must be used within a TreeContext.Provider");
  return ctx;
}

/**
 * What sets one row apart from the rest: the note open in the editor, the
 * row selected, the one being renamed, the folder a new entry is being named
 * in. Each changes for one or two rows at a time, and opening another note
 * changes the first on every tab switch - so it is kept outside the context,
 * and each row asks only whether it is the one. Through the context, every
 * row drawn in the vault was drawn again for each note opened: over a
 * thousand of them with the folders open.
 */
export interface TreeMarks {
  currentFile: string;
  /** The row selected in the tree: where the header's New File and New Folder put things. */
  selectedPath: string | null;
  renamingPath: string | null;
  pendingCreate: PendingCreate;
  /** Rows picked together with mod- or shift-click; empty when only one is selected. */
  picked: ReadonlySet<string>;
}

export interface TreeMarkStore {
  get: () => TreeMarks;
  set: (marks: TreeMarks) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createTreeMarks(marks: TreeMarks): TreeMarkStore {
  let current = marks;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(next) {
      if (
        next.currentFile === current.currentFile &&
        next.selectedPath === current.selectedPath &&
        next.renamingPath === current.renamingPath &&
        next.pendingCreate === current.pendingCreate &&
        next.picked === current.picked
      )
        return;
      current = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * One row's answer from the marks. `read` must return something compared by
 * value - a flag, a name - so a row is drawn again only when its own answer
 * changes, however often the marks do.
 */
export function useTreeMark<T>(read: (marks: TreeMarks) => T): T {
  const { marks } = useTreeContext();
  const answer = () => read(marks.get());
  // The same answer for a render to markup, where there is nothing to subscribe to.
  return useSyncExternalStore(marks.subscribe, answer, answer);
}
