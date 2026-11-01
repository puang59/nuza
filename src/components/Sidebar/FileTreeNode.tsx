import { memo, useEffect, useRef, useState } from "react";
import { ChevronRight, CloudOff, File, Folder, FolderOpen } from "lucide-react";
import {
  draggedPaths,
  endDrag,
  setDragOver,
  setDraggedEntry,
  useIsDragged,
  useIsDragOver,
} from "@/lib/dragSource";
import { nameProblem, newEntryProblem } from "@/lib/entryName";
import { hasUnavailable, parentOf } from "@/lib/fileTree";
import { movableInto } from "@/lib/treeSelection";
import { FileIcon } from "@/lib/utils";
import { FileEntry } from "@/lib/types";
import { useTreeContext, useTreeMark } from "./TreeContext";
import InlineInput from "./InlineInput";

export function NewEntryRow({
  type,
  onSubmit,
  onCancel,
}: {
  type: "file" | "folder";
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  return (
    <li className="flex items-center gap-1.5 py-1 pl-2 pr-2 compact:py-0.5">
      {type === "folder" ? (
        <Folder className="h-4 w-4 shrink-0 text-[var(--nuza-accent)]" />
      ) : (
        <File className="h-4 w-4 shrink-0 text-zinc-500" />
      )}
      <InlineInput
        initialValue=""
        onSubmit={onSubmit}
        onCancel={onCancel}
        validate={newEntryProblem}
        className="min-w-0 flex-1 rounded bg-zinc-900 px-1 py-0.5 text-sm text-white outline outline-1 outline-blue-500"
      />
    </li>
  );
}

/** A click that picks a row, along with the ones already picked, rather than opening it. */
function isPicking(e: React.MouseEvent) {
  return e.metaKey || e.ctrlKey || e.shiftKey;
}

/** How long a closed folder has to be held under a drag before it opens. */
const SPRING_OPEN_DELAY = 600;

/**
 * One row of the tree, and the rows underneath it when it is a folder.
 *
 * Memoised, and paired with a memoised tree context: between them, a keystroke
 * in the search box or a rename opening somewhere else in the vault no longer
 * re-renders every row in it. The two flags that do change constantly come
 * from `dragSource`, where each row subscribes only to its own answer.
 */
function FileTreeNode({ entry }: { entry: FileEntry }) {
  const {
    onFileSelect,
    submitRename,
    cancelRename,
    submitCreate,
    cancelCreate,
    openContextMenu,
    moveEntry,
    attachFiles,
    loadFolder,
    marks,
  } = useTreeContext();

  const detailsRef = useRef<HTMLDetailsElement>(null);
  /**
   * Whether this folder's contents have been drawn. Not until it is first
   * opened: a closed folder still used to render every row beneath it, so a
   * large vault drew thousands of rows nobody had asked to see. Once drawn
   * they stay, so closing and reopening a folder costs nothing.
   */
  const [contentsShown, setContentsShown] = useState(false);
  /**
   * Whether what is inside this folder is being read, or could not be. A folder
   * is only read when it is opened, so a vault of any size opens at once; and a
   * folder that did not answer is asked again the next time it is opened.
   */
  const [reading, setReading] = useState<"idle" | "loading" | "failed">("idle");
  const isRenaming = useTreeMark((marks) => marks.renamingPath === entry.path);
  const isCurrent = useTreeMark((marks) => marks.currentFile === entry.path);
  const isSelected = useTreeMark((marks) => marks.selectedPath === entry.path);
  const isPicked = useTreeMark((marks) => marks.picked.has(entry.path));
  /** What is being named inside this folder, if anything is. */
  const creating = useTreeMark((marks) =>
    marks.pendingCreate?.parentPath === entry.path ? marks.pendingCreate.type : null
  );
  const isDraggedOver = useIsDragOver(entry.path);
  const isBeingDragged = useIsDragged(entry.path);
  const showCreateRow = entry.isDirectory && creating !== null;

  // Auto-expand a folder when the user asks to create something inside it,
  // so the inline input row is actually visible.
  useEffect(() => {
    if (showCreateRow && detailsRef.current) detailsRef.current.open = true;
  }, [showCreateRow]);

  function handleDragStart(e: React.DragEvent) {
    e.stopPropagation();
    e.dataTransfer.setData("text/plain", entry.path);
    e.dataTransfer.effectAllowed = "all";
    // A picked row carries every picked row with it.
    const { picked } = marks.get();
    setDraggedEntry(
      { path: entry.path, isDirectory: entry.isDirectory },
      picked.has(entry.path) ? Array.from(picked) : undefined
    );
  }

  function handleDragEnd(e: React.DragEvent) {
    e.stopPropagation();
    endDrag();
  }

  /** True while something from outside the app is being dragged over a row. */
  function carriesFiles(e: React.DragEvent) {
    return e.dataTransfer.types.includes("Files");
  }

  /** A folder takes the files itself; a file hands them to the folder it is in. */
  const dropTarget = entry.isDirectory ? entry.path : parentOf(entry.path);

  /**
   * Whether this row would do anything with what is being dragged over it.
   *
   * Everything goes to `dropTarget`: a folder takes it itself, and a file
   * hands it to the folder it is in - so a note let go of over a note lands
   * beside it, as it does in VS Code, rather than nowhere. A row dragged from
   * the tree is refused by the folder it is already in, and by itself and
   * anything inside it.
   */
  function wouldTake(e: React.DragEvent) {
    if (carriesFiles(e)) return true;
    return movableInto(draggedPaths(), dropTarget).length > 0;
  }

  /**
   * A closed folder held under a drag for a moment opens, so a note can be
   * carried down into a folder several levels deep without letting go first.
   */
  const springTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function stopSpring() {
    if (springTimer.current) clearTimeout(springTimer.current);
    springTimer.current = null;
  }
  useEffect(() => stopSpring, []);

  function handleDragOver(e: React.DragEvent) {
    if (!wouldTake(e)) return;
    e.preventDefault();
    e.stopPropagation();
    // Copying something in from outside, moving something already in the vault.
    e.dataTransfer.dropEffect = carriesFiles(e) ? "copy" : "move";
    // The folder that will take it lights up, which for a file is the one it is in.
    setDragOver(dropTarget);
    if (entry.isDirectory && !detailsRef.current?.open && !springTimer.current) {
      springTimer.current = setTimeout(() => {
        springTimer.current = null;
        if (detailsRef.current) detailsRef.current.open = true;
      }, SPRING_OPEN_DELAY);
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    e.stopPropagation();
    // Crossing from the row's name onto its icon is not leaving it.
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    stopSpring();
    if (isDraggedOver || !entry.isDirectory) setDragOver(null);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    stopSpring();

    const files = Array.from(e.dataTransfer.files);
    const dragging = movableInto(draggedPaths(), dropTarget);
    endDrag();

    if (files.length) attachFiles(dropTarget, files);
    else for (const path of dragging) moveEntry(path, dropTarget);
  }

  if (entry.isDirectory) {
    return (
      <li>
        {/*
          Icon state is scoped to this node's own [open] attribute with an
          arbitrary `&` selector rather than Tailwind's `group`/`group-open`.
          `group` is an unnamed, un-scoped class: `.group[open] .group-open:*`
          matches a descendant under *any* open ancestor, so nesting a folder
          inside an open one flipped its chevron and icon to look expanded
          while its own <details> was still closed - no content to show, and
          no visible change once it was actually toggled open.
        */}
        <details
          ref={detailsRef}
          // Fired however the folder is opened - a click, the keyboard, the
          // new-file row, the reveal below - since each sets `open`.
          onToggle={(event) => {
            if (!event.currentTarget.open) return;
            setContentsShown(true);

            // Not read yet, or read when some of its rows could not be answered
            // for - those may have come back since.
            if (reading === "loading" || (entry.children && !hasUnavailable(entry))) return;
            setReading("loading");
            loadFolder(entry.path).then(
              () => setReading("idle"),
              (error) => {
                console.error(`Couldn't read "${entry.path}":`, error);
                setReading("failed");
              }
            );
          }}
          className="[&[open]>summary>.cm-tree-chevron]:rotate-90 [&[open]>summary>.cm-tree-folder]:hidden [&[open]>summary>.cm-tree-folder-open]:block"
        >
          <summary
            data-path={entry.path}
            // Reachable from the keyboard but not from Tab: the panel takes
            // the tab stop and hands focus on to a row itself.
            tabIndex={-1}
            draggable={!isRenaming}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            // A mod- or shift-click picks the folder, which the tree sees; it
            // does not also open or shut it.
            onClick={(e) => {
              if (isPicking(e)) e.preventDefault();
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openContextMenu(e, entry);
            }}
            className={`flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors compact:py-0.5 hover:bg-zinc-800/25 hover:text-white focus:outline-none focus:ring-1 focus:ring-inset focus:ring-zinc-500 [-webkit-user-drag:element] [&::-webkit-details-marker]:hidden ${
              // Selected, so where the header's New File and New Folder go.
              isSelected || isPicked ? "bg-white/5 text-zinc-100 group-focus-within/tree:bg-white/10" : ""
            } ${isDraggedOver ? "bg-zinc-700/50 outline outline-1 outline-zinc-500" : ""} ${isBeingDragged ? "opacity-40" : ""}`}
          >
            <ChevronRight className="cm-tree-chevron h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform" />
            <Folder className="cm-tree-folder h-4 w-4 shrink-0 text-[var(--nuza-accent)]" />
            <FolderOpen className="cm-tree-folder-open hidden h-4 w-4 shrink-0 text-[var(--nuza-accent)]" />

            {isRenaming ? (
              <InlineInput
                initialValue={entry.name}
                onSubmit={(value) => submitRename(entry.path, value)}
                onCancel={cancelRename}
                validate={nameProblem}
                className="min-w-0 flex-1 rounded bg-zinc-900 px-1 py-0.5 text-sm text-white outline outline-1 outline-blue-500"
              />
            ) : (
              <span className="truncate">{entry.name}</span>
            )}
            {entry.unavailable && <Unavailable />}
          </summary>

          <ul className="ml-5 cursor-pointer border-l border-zinc-700 pl-3">
            {showCreateRow && (
              <NewEntryRow type={creating!} onSubmit={submitCreate} onCancel={cancelCreate} />
            )}
            {contentsShown &&
              entry.children?.map((child) => <MemoisedFileTreeNode key={child.path} entry={child} />)}
            {contentsShown && !entry.children && reading !== "failed" && (
              <li className="px-2 py-1 text-xs text-zinc-600">Loading</li>
            )}
            {reading === "failed" && !entry.children && (
              <li className="flex items-center gap-1.5 px-2 py-1 text-xs text-zinc-500">
                <CloudOff className="h-3 w-3 shrink-0" />
                Not available right now. Close and open the folder to try again.
              </li>
            )}
          </ul>
        </details>
      </li>
    );
  }

  return (
    <li>
      <button
        // How the panel finds this row again when something outside the tree
        // opens the file - a search hit, the quick-open palette, a tab.
        data-path={entry.path}
        tabIndex={-1}
        draggable={!isRenaming}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={(e) => !isRenaming && !isPicking(e) && onFileSelect && onFileSelect(entry.path)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openContextMenu(e, entry);
        }}
        className={`flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1.5 pl-7 pr-2 text-left text-sm transition-colors compact:py-0.5 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-zinc-500 [-webkit-user-drag:element] ${
          isPicked
            ? "bg-white/10 text-zinc-100"
            : isCurrent
              ? // The note the editor is actually showing. It lifts when the
                // panel has the keyboard and settles back when the editor takes
                // it, which is the only thing either pane does to say which one
                // is listening - no badge, no border, just the row you are on
                // being easier to find while you are the one moving around it.
                "bg-white/5 text-zinc-300 group-focus-within/tree:bg-white/15 group-focus-within/tree:text-white"
              : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-100"
        } ${isDraggedOver ? "bg-zinc-700/50 outline outline-1 outline-zinc-500" : ""} ${isBeingDragged ? "opacity-40" : ""}`}
      >
        <FileIcon name={entry.name} />
        {isRenaming ? (
          <InlineInput
            initialValue={entry.name}
            onSubmit={(value) => submitRename(entry.path, value)}
            onCancel={cancelRename}
            validate={nameProblem}
            className="min-w-0 flex-1 rounded bg-zinc-900 px-1 py-0.5 text-sm text-white outline outline-1 outline-blue-500"
          />
        ) : (
          <span className={`truncate ${entry.unavailable ? "text-zinc-600" : ""}`}>{entry.name}</span>
        )}
        {entry.unavailable && <Unavailable />}
      </button>
    </li>
  );
}

/** Marks a row the filesystem did not answer for in time - offline, or on a share that has gone quiet. */
function Unavailable() {
  return (
    <span title="Not available right now" className="ml-auto shrink-0 text-zinc-600">
      <CloudOff className="h-3 w-3" aria-label="Not available right now" />
    </span>
  );
}

const MemoisedFileTreeNode = memo(FileTreeNode);

export default MemoisedFileTreeNode;
