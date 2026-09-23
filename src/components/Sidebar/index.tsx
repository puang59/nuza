import { useMemo, useRef, useState } from "react";
import { ChevronsDownUp, FilePlus, FolderPlus } from "lucide-react";
import { FileEntry } from "@/lib/types";
import { TreeContext, TreeActions, ContextMenuState, PendingCreate } from "./TreeContext";
import FileTreeNode, { NewEntryRow } from "./FileTreeNode";
import ContextMenu, { ContextMenuItem } from "./ContextMenu";
import ConfirmDeleteModal from "./ConfirmDeleteModal";

interface SidebarProps {
  data: FileEntry[];
  rootPath?: string | null;
  onOpenFolder?: () => void;
  onFileSelect?: (path: string) => void;
  currentFile?: string;
  onCreateFile: (parentPath: string, name: string) => Promise<void> | void;
  onCreateFolder: (parentPath: string, name: string) => Promise<void> | void;
  onRename: (path: string, newName: string) => Promise<void> | void;
  onDelete: (path: string) => Promise<void> | void;
  onMove: (path: string, targetDir: string) => Promise<void> | void;
  onResizeStart: (event: React.PointerEvent) => void;
  onResizeReset: () => void;
  isResizing: boolean;
}

export default function Sidebar({
  data,
  rootPath,
  onOpenFolder,
  onFileSelect,
  currentFile = "",
  onCreateFile,
  onCreateFolder,
  onRename,
  onDelete,
  onMove,
  onResizeStart,
  onResizeReset,
  isResizing,
}: SidebarProps) {
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [pendingCreate, setPendingCreate] = useState<PendingCreate>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  const hasFolder = !!data && data.length > 0 && !!rootPath;

  const folderLabel = useMemo(() => {
    if (!rootPath) return "Explorer";
    const parts = rootPath.split(/[/\\]/).filter(Boolean);
    return parts[parts.length - 1] ?? "Explorer";
  }, [rootPath]);

  function openContextMenu(e: React.MouseEvent, entry: FileEntry | null) {
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }

  function beginCreate(type: "file" | "folder", parentPath?: string) {
    const target = parentPath ?? rootPath;
    if (!target) return;
    setRenamingPath(null);
    setPendingCreate({ parentPath: target, type });
  }

  async function submitCreate(name: string) {
    if (!pendingCreate) return;
    const { parentPath, type } = pendingCreate;
    setPendingCreate(null);
    try {
      if (type === "file") await onCreateFile(parentPath, name);
      else await onCreateFolder(parentPath, name);
    } catch (error) {
      console.error(`Failed to create ${type}:`, error);
    }
  }

  async function submitRename(path: string, newName: string) {
    setRenamingPath(null);
    try {
      await onRename(path, newName);
    } catch (error) {
      console.error("Failed to rename:", error);
    }
  }

  async function moveEntry(path: string, targetDir: string) {
    if (path === targetDir) return;
    try {
      await onMove(path, targetDir);
    } catch (error) {
      console.error("Failed to move:", error);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await onDelete(target.path);
    } catch (error) {
      console.error("Failed to delete:", error);
    }
  }

  function collapseAll() {
    treeRef.current?.querySelectorAll("details").forEach((el) => {
      (el as HTMLDetailsElement).open = false;
    });
  }

  const contextItems: ContextMenuItem[] = useMemo(() => {
    if (!contextMenu) return [];
    const { entry } = contextMenu;

    if (!entry) {
      return [
        { label: "New File", onClick: () => beginCreate("file") },
        { label: "New Folder", onClick: () => beginCreate("folder") },
      ];
    }

    const items: ContextMenuItem[] = [];
    if (entry.isDirectory) {
      items.push(
        { label: "New File", onClick: () => beginCreate("file", entry.path) },
        { label: "New Folder", onClick: () => beginCreate("folder", entry.path) }
      );
    }
    items.push(
      { label: "Rename", onClick: () => setRenamingPath(entry.path) },
      { label: "Delete", onClick: () => setDeleteTarget(entry), danger: true }
    );
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextMenu]);

  const treeActions: TreeActions = {
    onFileSelect,
    currentFile,
    renamingPath,
    submitRename,
    cancelRename: () => setRenamingPath(null),
    pendingCreate,
    submitCreate,
    cancelCreate: () => setPendingCreate(null),
    openContextMenu,
    draggingPath,
    setDraggingPath,
    dragOverPath,
    setDragOverPath,
    moveEntry,
  };

  return (
    <aside className="relative flex h-full w-full shrink-0 flex-col border-l border-zinc-700 text-zinc-300">
      {/* Straddles the border so there's a forgiving grab target, and tints the
          border itself on hover/drag rather than adding another visible chrome. */}
      <div
        onPointerDown={onResizeStart}
        onDoubleClick={onResizeReset}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        title="Drag to resize, double-click to reset"
        className={`absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize after:absolute after:inset-y-0 after:left-1 after:w-px after:transition-colors ${
          isResizing ? "after:bg-[#FF9696]" : "after:bg-transparent hover:after:bg-zinc-500"
        }`}
      />

      <div className="flex items-center justify-between gap-1 px-3 pt-1">
        <h2
          className="truncate text-xs font-semibold uppercase tracking-wider text-zinc-500"
          title={rootPath ?? undefined}
        >
          {folderLabel}
        </h2>

        {hasFolder && (
          <div className="flex shrink-0 items-center gap-0.5 ml-auto">
            <button
              onClick={() => beginCreate("file")}
              title="New File"
              className="cursor-pointer rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-white"
            >
              <FilePlus className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => beginCreate("folder")}
              title="New Folder"
              className="cursor-pointer rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-white"
            >
              <FolderPlus className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={collapseAll}
              title="Collapse Folders"
              className="cursor-pointer rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-white"
            >
              <ChevronsDownUp className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      <div
        ref={treeRef}
        onContextMenu={(e) => {
          if (!hasFolder) return;
          e.preventDefault();
          openContextMenu(e, null);
        }}
        onDragOver={(e) => {
          if (!draggingPath || !rootPath) return;
          e.preventDefault();
        }}
        onDrop={(e) => {
          if (!draggingPath || !rootPath) return;
          e.preventDefault();
          moveEntry(draggingPath, rootPath);
          setDraggingPath(null);
          setDragOverPath(null);
        }}
        className="flex flex-1 flex-col overflow-y-auto px-2 py-3"
      >
        {!hasFolder ? (
          <div className="mt-2 flex flex-1 flex-col items-center justify-start gap-3 text-center">
            {onOpenFolder && (
              <button
                onClick={onOpenFolder}
                className="cursor-pointer rounded bg-zinc-700 px-3 py-1.5 text-xs text-white transition-colors hover:bg-zinc-600"
              >
                Open Folder
              </button>
            )}
          </div>
        ) : (
          <TreeContext.Provider value={treeActions}>
            <ul className="space-y-0.5">
              {pendingCreate?.parentPath === rootPath && (
                <NewEntryRow type={pendingCreate.type} onSubmit={submitCreate} onCancel={() => setPendingCreate(null)} />
              )}
              {data.map((entry) => (
                <FileTreeNode key={entry.path} entry={entry} />
              ))}
            </ul>
          </TreeContext.Provider>
        )}
      </div>

      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextItems} onClose={() => setContextMenu(null)} />
      )}

      {deleteTarget && (
        <ConfirmDeleteModal
          name={deleteTarget.name}
          isDirectory={deleteTarget.isDirectory}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </aside>
  );
}
