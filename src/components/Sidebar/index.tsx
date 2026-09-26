import { memo, Ref, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ChevronsDownUp, FilePlus, FolderPlus, Search, X } from "lucide-react";
import { cn } from "cn";
import { searchFiles } from "@/lib/fileSearch";
import { FileEntry } from "@/lib/types";
import { TreeContext, TreeActions, ContextMenuState, PendingCreate } from "./TreeContext";
import FileTreeNode, { NewEntryRow } from "./FileTreeNode";
import ContextMenu, { ContextMenuItem } from "./ContextMenu";
import ConfirmDeleteModal from "./ConfirmDeleteModal";
import SearchResults from "./SearchResults";
import VaultSwitcher from "./VaultSwitcher";
import { Vault } from "@/lib/vaults";

/** What the rest of the app can ask the sidebar to do. */
export interface SidebarHandle {
  focusSearch: () => void;
}

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
  onAttachFiles: (directory: string, files: File[]) => Promise<void> | void;
  vaults: Vault[];
  onSelectVault: (path: string) => Promise<boolean> | boolean;
  onRenameVault: (path: string, name: string) => void;
  onForgetVault: (path: string) => void;
  onResizeStart: (event: React.PointerEvent) => void;
  onResizeReset: () => void;
  isResizing: boolean;
  ref?: Ref<SidebarHandle>;
}

function Sidebar({
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
  onAttachFiles,
  vaults,
  onSelectVault,
  onRenameVault,
  onForgetVault,
  onResizeStart,
  onResizeReset,
  isResizing,
  ref,
}: SidebarProps) {
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [pendingCreate, setPendingCreate] = useState<PendingCreate>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const treeRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const hasFolder = !!data && data.length > 0 && !!rootPath;

  const matches = useMemo(() => (isSearching ? searchFiles(data, query) : []), [isSearching, data, query]);
  /** With nothing typed the tree stays put, so opening search never blanks the panel. */
  const showResults = isSearching && query.trim().length > 0;

  function openSearch() {
    // Nothing to search until a folder is open, and the keymap can reach this
    // even when the header's toggle is not on screen.
    if (!hasFolder) return;
    setIsSearching(true);
    // The row animates open from zero height, so it is not focusable until the
    // browser has laid it out.
    requestAnimationFrame(() => searchRef.current?.focus());
  }

  function closeSearch() {
    setIsSearching(false);
    setQuery("");
    setActiveIndex(0);
  }

  useImperativeHandle(ref, () => ({ focusSearch: openSearch }));

  function selectResult(path: string) {
    onFileSelect?.(path);
    closeSearch();
  }

  function onSearchKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      // Two stages: clear what you typed, then put the panel back.
      if (query) {
        setQuery("");
        setActiveIndex(0);
      } else {
        closeSearch();
      }
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => Math.min(Math.max(index + step, 0), matches.length - 1));
      return;
    }

    if (event.key === "Enter" && matches[activeIndex]) {
      event.preventDefault();
      selectResult(matches[activeIndex].entry.path);
    }
  }

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

  function attachFiles(directory: string, files: File[]) {
    void onAttachFiles(directory, files);
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

  /**
   * Brings the open note into view: every folder on the way down to it is
   * unfolded, and the row scrolled to if it is off screen.
   *
   * A file opened from the quick-open palette or a search hit is otherwise
   * highlighted somewhere nobody can see, several collapsed folders deep -
   * which leaves no clue where in the vault the thing you are now editing
   * actually lives.
   *
   * The folds are read and written straight on the DOM rather than mirrored
   * into state: `<details>` owns whether it is open, which is also what lets
   * the whole tree stay uncontrolled and cheap. A closed `<details>` still
   * keeps its contents in the document, so the row can be found before any of
   * its ancestors have been opened.
   */
  useEffect(() => {
    const tree = treeRef.current;
    if (!tree || !currentFile || showResults) return;

    const row = tree.querySelector<HTMLElement>(`[data-path="${CSS.escape(currentFile)}"]`);
    if (!row) return;

    for (let node = row.parentElement; node && node !== tree; node = node.parentElement) {
      if (node instanceof HTMLDetailsElement) node.open = true;
    }

    // `nearest` so a row that is already visible is left where it is, rather
    // than the panel jumping to centre it on every tab change.
    row.scrollIntoView({ block: "nearest" });
  }, [currentFile, data, showResults]);

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
    attachFiles,
  };

  return (
    <aside className="relative flex h-full w-full shrink-0 flex-col text-zinc-300">
      {/* No resting divider - the editor's darker tint already separates the two
          panes. The handle is a forgiving grab target that only draws a line
          while it's hovered or being dragged. */}
      <div
        onPointerDown={onResizeStart}
        onDoubleClick={onResizeReset}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        title="Drag to resize, double-click to reset"
        className={`absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize after:absolute after:inset-y-0 after:left-1 after:w-px after:transition-colors ${
          isResizing ? "after:bg-[var(--nuza-accent)]" : "after:bg-transparent hover:after:bg-zinc-500"
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
              onClick={() => (isSearching ? closeSearch() : openSearch())}
              title="Search Files"
              className={cn(
                "cursor-pointer rounded p-1 transition-colors hover:bg-zinc-800 hover:text-white",
                isSearching ? "text-[var(--nuza-accent)]" : "text-zinc-500"
              )}
            >
              <Search className="h-3.5 w-3.5" />
            </button>
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

      {/* Kept mounted and collapsed to zero height so it slides rather than
          appears, and so the tree below it moves with it. */}
      <div className="sidebar-search" data-open={isSearching}>
        <div className="px-2 pt-1.5">
          <div
            className={cn(
              "flex items-center gap-1.5 rounded-md border bg-zinc-800/60 px-2 py-1 transition-colors",
              isSearching ? "border-zinc-700" : "border-transparent"
            )}
          >
            <Search className="h-3 w-3 shrink-0 text-zinc-500" />
            <input
              ref={searchRef}
              value={query}
              placeholder="Find a file"
              aria-label="Search files"
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onSearchKeyDown}
              className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-zinc-600"
            />
            {query && (
              <button
                onClick={() => {
                  setQuery("");
                  setActiveIndex(0);
                  searchRef.current?.focus();
                }}
                title="Clear"
                className="animate-fade-in shrink-0 cursor-pointer rounded text-zinc-500 transition-colors hover:text-white"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div
        ref={treeRef}
        onContextMenu={(e) => {
          if (!hasFolder) return;
          e.preventDefault();
          openContextMenu(e, null);
        }}
        onDragOver={(e) => {
          if (!rootPath) return;
          if (!draggingPath && !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
        }}
        onDrop={(e) => {
          if (!rootPath) return;
          const files = Array.from(e.dataTransfer.files);
          if (!files.length && !draggingPath) return;

          e.preventDefault();
          if (files.length) attachFiles(rootPath, files);
          else if (draggingPath) moveEntry(draggingPath, rootPath);
          setDraggingPath(null);
          setDragOverPath(null);
        }}
        className="flex flex-1 flex-col overflow-y-auto px-2 py-3"
      >
        {showResults ? (
          <SearchResults
            matches={matches}
            activeIndex={activeIndex}
            currentFile={currentFile}
            onHover={setActiveIndex}
            onSelect={selectResult}
          />
        ) : !hasFolder ? (
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
                <NewEntryRow
                  type={pendingCreate.type}
                  onSubmit={submitCreate}
                  onCancel={() => setPendingCreate(null)}
                />
              )}
              {data.map((entry) => (
                <FileTreeNode key={entry.path} entry={entry} />
              ))}
            </ul>
          </TreeContext.Provider>
        )}
      </div>

      <VaultSwitcher
        vaults={vaults}
        currentPath={rootPath ?? null}
        onSelect={onSelectVault}
        onOpenFolder={onOpenFolder}
        onRename={onRenameVault}
        onForget={onForgetVault}
      />

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextItems}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Always mounted: it has to outlive `deleteTarget` long enough to
          animate closed. */}
      <ConfirmDeleteModal
        target={deleteTarget}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </aside>
  );
}

export default memo(Sidebar);
