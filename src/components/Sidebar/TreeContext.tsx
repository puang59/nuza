import { createContext, useContext } from "react";
import { FileEntry } from "@/lib/types";

export type PendingCreate = { parentPath: string; type: "file" | "folder" } | null;

export type ContextMenuState = {
  x: number;
  y: number;
  /** The entry that was right-clicked, or `null` for the background/root. */
  entry: FileEntry | null;
} | null;

export interface TreeActions {
  onFileSelect?: (path: string) => void;
  currentFile: string;
  renamingPath: string | null;
  submitRename: (path: string, newName: string) => void;
  cancelRename: () => void;
  pendingCreate: PendingCreate;
  submitCreate: (name: string) => void;
  cancelCreate: () => void;
  openContextMenu: (e: React.MouseEvent, entry: FileEntry | null) => void;
  draggingPath: string | null;
  setDraggingPath: (path: string | null) => void;
  dragOverPath: string | null;
  setDragOverPath: (path: string | null) => void;
  moveEntry: (path: string, targetDir: string) => void;
  /** Files dragged in from outside the app, to be copied into `directory`. */
  attachFiles: (directory: string, files: File[]) => void;
}

export const TreeContext = createContext<TreeActions | null>(null);

export function useTreeContext() {
  const ctx = useContext(TreeContext);
  if (!ctx) throw new Error("useTreeContext must be used within a TreeContext.Provider");
  return ctx;
}
