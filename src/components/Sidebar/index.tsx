import { memo, Ref, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ArrowUpDown, ChevronsDownUp, FilePlus, FolderPlus, Regex, Search, X } from "lucide-react";
import { cn } from "cn";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { draggedPath, endDrag } from "@/lib/dragSource";
import { searchFiles } from "@/lib/fileSearch";
import { ContentHit } from "@/lib/contentSearch";
import { useContentSearch } from "@/hooks/useContentSearch";
import { fileNameOf, relativePath } from "@/lib/media";
import { copyText } from "@/lib/clipboard";
import { folderOf, parentRow, rowAfter, visibleRows } from "@/lib/treeNavigation";
import { report } from "@/lib/notices";
import { revealLabel } from "@/lib/platform";
import { FileEntry } from "@/lib/types";
import { SORT_ORDERS, SortOrder, parentOf, sortTree } from "@/lib/fileTree";
import { usePersistedState } from "@/hooks/usePersistedState";
import { TreeContext, TreeActions, ContextMenuState, PendingCreate } from "./TreeContext";
import FileTreeNode, { NewEntryRow } from "./FileTreeNode";
import ContextMenu, { ContextMenuItem } from "./ContextMenu";
import ConfirmDeleteModal from "./ConfirmDeleteModal";
import SearchResults from "./SearchResults";
import VaultSwitcher from "./VaultSwitcher";
import Backlinks from "./Backlinks";
import Tags from "./Tags";
import { useBacklinks } from "@/hooks/useBacklinks";
import { EMPTY_OUTLINE, Outline as OutlineData } from "@/lib/markdown/headings";
import Outline from "./Outline";
import ViewSwitcher, { SidebarView, readView } from "./ViewSwitcher";
import { useTags } from "@/hooks/useTags";
import { Vault } from "@/lib/vaults";

/** What the rest of the app can ask the sidebar to do. */
export interface SidebarHandle {
  focusSearch: () => void;
  /** Puts the keyboard in the tree, on the open note if it is showing. */
  focusTree: () => void;
}

interface SidebarProps {
  /** The tree as far as it has been opened. */
  data: FileEntry[];
  /** Every file in the vault, as a tree, for searching: the folders not opened yet are in it too. */
  searchTree: FileEntry[];
  /** Every note in the vault, for the panels that look through all of them. */
  notes: string[];
  /** Reads what is inside a folder that has just been opened. */
  onLoadFolder: (path: string) => Promise<void>;
  rootPath?: string | null;
  onOpenFolder?: () => void;
  onFileSelect?: (path: string) => void;
  /** Opens a note with the caret on a line of it, for a hit in its text. */
  onOpenAt?: (path: string, line: number, column: number) => void;
  /** Opens a note in the split beside the main pane. */
  onOpenToSide?: (path: string) => void;
  currentFile?: string;
  onCreateFile: (parentPath: string, name: string) => Promise<void> | void;
  onCreateFolder: (parentPath: string, name: string) => Promise<void> | void;
  onRename: (path: string, newName: string) => Promise<void> | void;
  onDuplicate: (path: string) => Promise<void> | void;
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
  /** The open note's headings, and which section the editor is showing. */
  outline?: OutlineData;
  /** Goes to the heading whose line starts at `from` in the open note. */
  onJumpToHeading?: (from: number) => void;
  /** Whether hjkl should move around the tree as well as the arrow keys. */
  vimEnabled?: boolean;
  /** Hands the keyboard back to the editor, for Escape. */
  onReturnFocus?: () => void;
  ref?: Ref<SidebarHandle>;
}

function Sidebar({
  data,
  searchTree,
  notes,
  onLoadFolder,
  rootPath,
  onOpenFolder,
  onFileSelect,
  onOpenAt,
  onOpenToSide,
  currentFile = "",
  onCreateFile,
  onCreateFolder,
  onRename,
  onDuplicate,
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
  outline = EMPTY_OUTLINE,
  onJumpToHeading,
  vimEnabled = false,
  onReturnFocus,
  ref,
}: SidebarProps) {
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [pendingCreate, setPendingCreate] = useState<PendingCreate>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [sortOrder, setSortOrder] = usePersistedState<SortOrder>("sidebarSort", "name");
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null);
  // Folded to begin with, which is also when it costs nothing: the tags are
  // only read from the vault while the panel is open.
  // Which of its views the sidebar is on. Checked on the way out of storage,
  // which may hold a view from a build that had others.
  const [storedView, setView] = usePersistedState<SidebarView>("sidebarView", "files");
  const view = readView(storedView);
  // Only for a note in the vault: the scratch note has no name to link to.
  const inVault = !!rootPath && currentFile.startsWith(rootPath);
  // Fetched folded too: the count on the heading is worth having on its own.
  const backlinks = useBacklinks(currentFile, rootPath ?? null, notes, inVault);
  const tags = useTags(currentFile, rootPath ?? null, notes, !!rootPath && view === "tags");
  // Storage can hold anything; an order that is not one falls back to name.
  const order = SORT_ORDERS.some((option) => option.id === sortOrder) ? sortOrder : "name";
  /** The tree in the order it is shown in. For name order it is the tree itself. */
  const shownData = useMemo(() => sortTree(data, order), [data, order]);
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [query, setQuery] = useState("");
  // Whether what is typed is a regular expression to look for in the notes'
  // text, rather than words. Kept: someone who searches with patterns does so
  // every time.
  const [patternSearch, setPatternSearch] = usePersistedState("searchByPattern", false);
  const [activeIndex, setActiveIndex] = useState(0);
  const treeRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const hasFolder = !!rootPath;

  // File names are matched as words; a pattern is not a name, so with one
  // there are no file matches, only the lines it finds.
  const matches = useMemo(
    () => (isSearching && !patternSearch ? searchFiles(searchTree, query) : []),
    [isSearching, patternSearch, searchTree, query]
  );
  const { hits: contentHits, error: searchError } = useContentSearch(
    query,
    isSearching && hasFolder,
    patternSearch
  );
  const resultCount = matches.length + contentHits.length;
  /** With nothing typed the tree stays put, so opening search never blanks the panel. */
  const showResults = isSearching && query.trim().length > 0;

  function openSearch() {
    // Nothing to search until a folder is open, and the keymap can reach this
    // even when the header's toggle is not on screen.
    if (!hasFolder) return;
    // The search is of the files, wherever the sidebar happened to be.
    setView("files");
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

  /** Moves the keyboard to `row`, bringing it into view if it is off screen. */
  function focusRow(row: HTMLElement | null | undefined) {
    if (!row) return;
    row.focus();
    row.scrollIntoView({ block: "nearest" });
  }

  /** The open note's row, or the first one when it is not in the tree. */
  function focusOpenRow() {
    const tree = treeRef.current;
    if (!tree) return;

    const rows = visibleRows(tree);
    focusRow(rows.find((row) => row.dataset.path === currentFile) ?? rows[0]);
  }

  useImperativeHandle(ref, () => ({
    focusSearch: openSearch,
    // The panel is `inert` until it is open, and inert elements refuse focus,
    // so this waits for the frame the attribute comes off in.
    focusTree: () => requestAnimationFrame(focusOpenRow),
  }));

  function selectResult(path: string) {
    onFileSelect?.(path);
    closeSearch();
  }

  function selectHit(hit: ContentHit) {
    if (onOpenAt) onOpenAt(hit.path, hit.line, hit.column);
    else onFileSelect?.(hit.path);
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
      setActiveIndex((index) => Math.min(Math.max(index + step, 0), resultCount - 1));
      return;
    }

    if (event.key === "Enter" && activeIndex < resultCount) {
      event.preventDefault();
      if (activeIndex < matches.length) selectResult(matches[activeIndex].entry.path);
      else selectHit(contentHits[activeIndex - matches.length]);
    }
  }

  const folderLabel = useMemo(() => {
    if (!rootPath) return "Explorer";
    const parts = rootPath.split(/[/\\]/).filter(Boolean);
    return parts[parts.length - 1] ?? "Explorer";
  }, [rootPath]);

  /**
   * Moving around the tree from the keyboard.
   *
   * Which row the keyboard is on is not state of ours: it is whichever row
   * holds focus, read back off the document. That is what makes the panel
   * active when it is focused and inactive when the editor takes focus back,
   * with no flag anywhere to be kept in step with either - and why the row
   * only lights up while the panel actually has the keyboard.
   */
  function onTreeKeyDown(event: React.KeyboardEvent) {
    const tree = treeRef.current;
    // A row being named or renamed owns every key while it is open.
    if (!tree || event.target instanceof HTMLInputElement) return;

    const { key } = event;
    const focused = document.activeElement;
    const row =
      focused instanceof HTMLElement && tree.contains(focused)
        ? focused.closest<HTMLElement>("[data-path]")
        : null;

    if (key === "Escape") {
      event.preventDefault();
      onReturnFocus?.();
      return;
    }

    if (key === "ArrowDown" || key === "ArrowUp" || (vimEnabled && (key === "j" || key === "k"))) {
      event.preventDefault();
      const forwards = key === "ArrowDown" || key === "j";
      focusRow(rowAfter(visibleRows(tree), row, forwards ? 1 : -1));
      return;
    }

    if (key === "Home" || key === "End") {
      event.preventDefault();
      const rows = visibleRows(tree);
      focusRow(key === "Home" ? rows[0] : rows[rows.length - 1]);
      return;
    }

    if (!row) return;
    const folder = folderOf(row);

    // Rightwards goes inwards: a shut folder opens, an open one steps into.
    if (key === "ArrowRight" || (vimEnabled && key === "l")) {
      if (!folder) return;
      event.preventDefault();
      if (folder.open) focusRow(rowAfter(visibleRows(tree), row, 1));
      else folder.open = true;
      return;
    }

    // Leftwards goes outwards: an open folder shuts, anything else goes up to
    // the folder it is in.
    if (key === "ArrowLeft" || (vimEnabled && key === "h")) {
      event.preventDefault();
      if (folder?.open) folder.open = false;
      else focusRow(parentRow(row, tree));
      return;
    }

    if (key === "Enter" || (vimEnabled && key === "o")) {
      event.preventDefault();
      if (folder) folder.open = !folder.open;
      else if (row.dataset.path) onFileSelect?.(row.dataset.path);
    }
  }

  // Everything handed to the tree context is a stable reference, so that the
  // context value can be memoised and a re-render of the panel - a keystroke
  // in the search box, a rename opening - stops re-rendering every row in the
  // vault along with it.
  const openContextMenu = useCallback((e: React.MouseEvent, entry: FileEntry | null) => {
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  function beginCreate(type: "file" | "folder", parentPath?: string) {
    const target = parentPath ?? rootPath;
    if (!target) return;
    setRenamingPath(null);
    setPendingCreate({ parentPath: target, type });
  }

  const submitCreate = useCallback(
    async (name: string) => {
      if (!pendingCreate) return;
      const { parentPath, type } = pendingCreate;
      setPendingCreate(null);
      try {
        if (type === "file") await onCreateFile(parentPath, name);
        else await onCreateFolder(parentPath, name);
      } catch (error) {
        report(`Couldn't create "${name}"`, error);
      }
    },
    [pendingCreate, onCreateFile, onCreateFolder]
  );

  const submitRename = useCallback(
    async (path: string, newName: string) => {
      setRenamingPath(null);
      try {
        await onRename(path, newName);
      } catch (error) {
        report(`Couldn't rename "${fileNameOf(path)}"`, error);
      }
    },
    [onRename]
  );

  const attachFiles = useCallback(
    (directory: string, files: File[]) => {
      void onAttachFiles(directory, files);
    },
    [onAttachFiles]
  );

  const moveEntry = useCallback(
    async (path: string, targetDir: string) => {
      if (path === targetDir) return;
      try {
        await onMove(path, targetDir);
      } catch (error) {
        report(`Couldn't move "${fileNameOf(path)}"`, error);
      }
    },
    [onMove]
  );

  const cancelRename = useCallback(() => setRenamingPath(null), []);
  const cancelCreate = useCallback(() => setPendingCreate(null), []);

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await onDelete(target.path);
    } catch (error) {
      report(`Couldn't delete "${target.name}"`, error);
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
   * the whole tree stay uncontrolled and cheap. A folder only draws its rows
   * once it has been opened, so the note's row may not exist yet: the folders
   * on the way down are opened from the top, one level at a time as each one
   * draws its contents, until the row is there to scroll to.
   */
  useEffect(() => {
    const tree = treeRef.current;
    if (!tree || !currentFile || !rootPath || showResults || !currentFile.startsWith(rootPath)) return;

    const folders: string[] = [];
    for (let path = parentOf(currentFile); path.length > rootPath.length; path = parentOf(path)) {
      folders.unshift(path);
    }

    let frame = 0;
    let tries = folders.length + 4;
    function reveal() {
      const find = (path: string) => tree!.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`);

      for (const folder of folders) {
        const details = find(folder)?.parentElement;
        if (!(details instanceof HTMLDetailsElement)) break;
        if (!details.open) details.open = true;
      }

      const row = find(currentFile);
      // `nearest` so a row that is already visible is left where it is, rather
      // than the panel jumping to centre it on every tab change.
      if (row) row.scrollIntoView({ block: "nearest" });
      else if (tries-- > 0) frame = requestAnimationFrame(reveal);
    }

    reveal();
    return () => cancelAnimationFrame(frame);
  }, [currentFile, data, rootPath, showResults]);

  /** Opens the folder holding `path` in the system's file manager, with it selected. */
  function revealEntry(path: string) {
    revealItemInDir(path).catch((error) => report(`Couldn't show "${fileNameOf(path)}"`, error));
  }

  /**
   * Copies a path. The relative one is written the way a link in a note is,
   * from the vault's root with forward slashes, so it pastes straight into one.
   */
  function copyPath(path: string) {
    copyText(path).catch((error) => report("Couldn't copy the path", error));
  }

  function duplicateEntry(path: string) {
    Promise.resolve(onDuplicate(path)).catch((error) =>
      report(`Couldn't duplicate "${fileNameOf(path)}"`, error)
    );
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
    // The note in front cannot also be beside itself.
    if (onOpenToSide && !entry.isDirectory && entry.path !== currentFile) {
      items.push({ label: "Open to the Side", onClick: () => onOpenToSide(entry.path) });
    }
    items.push({ label: "Rename", onClick: () => setRenamingPath(entry.path) });
    if (!entry.isDirectory) items.push({ label: "Duplicate", onClick: () => duplicateEntry(entry.path) });
    items.push(
      { label: revealLabel(), onClick: () => revealEntry(entry.path) },
      { label: "Copy Path", onClick: () => copyPath(entry.path) },
      { label: "Copy Relative Path", onClick: () => copyPath(relativePath(rootPath ?? "", entry.path)) },
      { label: "Delete", onClick: () => setDeleteTarget(entry), danger: true }
    );
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextMenu]);

  const treeActions: TreeActions = useMemo(
    () => ({
      onFileSelect,
      currentFile,
      renamingPath,
      submitRename,
      cancelRename,
      pendingCreate,
      submitCreate,
      cancelCreate,
      openContextMenu,
      moveEntry,
      attachFiles,
      loadFolder: onLoadFolder,
    }),
    [
      onFileSelect,
      currentFile,
      renamingPath,
      submitRename,
      cancelRename,
      pendingCreate,
      submitCreate,
      cancelCreate,
      openContextMenu,
      moveEntry,
      attachFiles,
      onLoadFolder,
    ]
  );

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

      {/* As tall with the tree's buttons as without them, so the views below
          do not shift when the buttons go. */}
      <div className="flex min-h-[26px] items-center justify-between gap-1 px-3 pt-1">
        <h2
          className="truncate text-xs font-semibold uppercase tracking-wider text-zinc-500"
          title={rootPath ?? undefined}
        >
          {folderLabel}
        </h2>

        {/* These act on the tree, so they are only there with it. */}
        {hasFolder && view === "files" && (
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
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setSortMenu({ x: rect.left, y: rect.bottom + 4 });
              }}
              title="Sort Order"
              aria-label="Sort order"
              className={cn(
                "cursor-pointer rounded p-1 transition-colors hover:bg-zinc-800 hover:text-white",
                order === "name" ? "text-zinc-500" : "text-[var(--nuza-accent)]"
              )}
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
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

      {hasFolder && <ViewSwitcher view={view} onChange={setView} />}

      {/* Kept mounted and collapsed to zero height so it slides rather than
          appears, and so the tree below it moves with it. */}
      <div className={cn("sidebar-search", view !== "files" && "hidden")} data-open={isSearching}>
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
              placeholder={patternSearch ? "Find text by pattern" : "Find a file or text"}
              aria-label="Search files"
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onSearchKeyDown}
              className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-zinc-600"
            />
            <button
              onClick={() => {
                setPatternSearch((on) => !on);
                setActiveIndex(0);
                searchRef.current?.focus();
              }}
              title={patternSearch ? "Regular Expression: On" : "Regular Expression: Off"}
              aria-label="Search by regular expression"
              aria-pressed={patternSearch}
              className={cn(
                "shrink-0 cursor-pointer rounded transition-colors hover:text-white",
                patternSearch ? "text-[var(--nuza-accent)]" : "text-zinc-600"
              )}
            >
              <Regex className="h-3 w-3" />
            </button>
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
        // The panel takes one tab stop and hands the keyboard to a row, which
        // is what keeps Tab from walking through every file in the vault.
        tabIndex={hasFolder ? 0 : -1}
        role="tree"
        onKeyDown={onTreeKeyDown}
        onFocus={(e) => {
          // Only when the panel itself was focused. A row taking focus - by
          // click, or from the keys above - is already where it should be.
          if (e.target === e.currentTarget) focusOpenRow();
        }}
        onContextMenu={(e) => {
          if (!hasFolder) return;
          e.preventDefault();
          openContextMenu(e, null);
        }}
        onDragOver={(e) => {
          if (!rootPath) return;
          if (!draggedPath() && !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
        }}
        onDrop={(e) => {
          if (!rootPath) return;
          const files = Array.from(e.dataTransfer.files);
          const dragging = draggedPath();
          if (!files.length && !dragging) return;

          e.preventDefault();
          endDrag();
          if (files.length) attachFiles(rootPath, files);
          else if (dragging) moveEntry(dragging, rootPath);
        }}
        // Hidden rather than unmounted while another view is up: which
        // folders are open lives in the rows, and would be lost with them.
        className={cn(
          "group/tree flex-1 flex-col overflow-y-auto px-2 py-3 outline-none compact:py-1.5",
          view === "files" || !hasFolder ? "flex" : "hidden"
        )}
      >
        {showResults ? (
          <SearchResults
            matches={matches}
            contentHits={contentHits}
            error={searchError}
            rootPath={rootPath ?? ""}
            activeIndex={activeIndex}
            currentFile={currentFile}
            onHover={setActiveIndex}
            onSelect={selectResult}
            onSelectHit={selectHit}
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
                <NewEntryRow type={pendingCreate.type} onSubmit={submitCreate} onCancel={cancelCreate} />
              )}
              {shownData.map((entry) => (
                <FileTreeNode key={entry.path} entry={entry} />
              ))}
            </ul>
          </TreeContext.Provider>
        )}
      </div>

      {hasFolder && view !== "files" && (
        <div className="animate-fade-in min-h-0 flex-1 overflow-y-auto px-2 py-3 compact:py-1.5">
          {view === "outline" && (
            <Outline
              headings={outline.headings}
              active={outline.active}
              onJump={(from) => onJumpToHeading?.(from)}
            />
          )}
          {view === "tags" && (
            <Tags
              index={tags}
              onOpen={(path, line) => (onOpenAt ? onOpenAt(path, line, 0) : onFileSelect?.(path))}
            />
          )}
          {view === "links" &&
            (inVault ? (
              <Backlinks
                links={backlinks}
                onOpen={(path, line) => (onOpenAt ? onOpenAt(path, line, 0) : onFileSelect?.(path))}
              />
            ) : (
              <p className="px-2 py-1 text-xs text-zinc-600">
                Open a note in this vault to see what links to it.
              </p>
            ))}
        </div>
      )}

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

      {sortMenu && (
        <ContextMenu
          x={sortMenu.x}
          y={sortMenu.y}
          items={SORT_ORDERS.map((option) => ({
            label: option.label,
            checked: option.id === order,
            onClick: () => setSortOrder(option.id),
          }))}
          onClose={() => setSortMenu(null)}
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
