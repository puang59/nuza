import { useEffect, useRef } from "react";
import { ChevronRight, File, Folder, FolderOpen } from "lucide-react";
import { setDraggedEntry } from "@/lib/dragSource";
import { parentOf } from "@/lib/fileTree";
import { FileIcon } from "@/lib/utils";
import { FileEntry } from "@/lib/types";
import { useTreeContext } from "./TreeContext";
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
    <li className="flex items-center gap-1.5 py-1 pl-2 pr-2">
      {type === "folder" ? (
        <Folder className="h-4 w-4 shrink-0 text-[var(--nuza-accent)]" />
      ) : (
        <File className="h-4 w-4 shrink-0 text-zinc-500" />
      )}
      <InlineInput
        initialValue=""
        onSubmit={onSubmit}
        onCancel={onCancel}
        className="min-w-0 flex-1 rounded bg-zinc-900 px-1 py-0.5 text-sm text-white outline outline-1 outline-blue-500"
      />
    </li>
  );
}

export default function FileTreeNode({ entry }: { entry: FileEntry }) {
  const {
    onFileSelect,
    currentFile,
    renamingPath,
    submitRename,
    cancelRename,
    pendingCreate,
    submitCreate,
    cancelCreate,
    openContextMenu,
    draggingPath,
    setDraggingPath,
    dragOverPath,
    setDragOverPath,
    moveEntry,
    attachFiles,
  } = useTreeContext();

  const detailsRef = useRef<HTMLDetailsElement>(null);
  const isRenaming = renamingPath === entry.path;
  const isDraggedOver = dragOverPath === entry.path;
  const isBeingDragged = draggingPath === entry.path;
  const showCreateRow = entry.isDirectory && pendingCreate?.parentPath === entry.path;

  // Auto-expand a folder when the user asks to create something inside it,
  // so the inline input row is actually visible.
  useEffect(() => {
    if (showCreateRow && detailsRef.current) detailsRef.current.open = true;
  }, [showCreateRow]);

  function handleDragStart(e: React.DragEvent) {
    e.stopPropagation();
    e.dataTransfer.setData("text/plain", entry.path);
    e.dataTransfer.effectAllowed = "all";
    setDraggedEntry({ path: entry.path, isDirectory: entry.isDirectory });
    setDraggingPath(entry.path);
  }

  function handleDragEnd(e: React.DragEvent) {
    e.stopPropagation();
    setDraggedEntry(null);
    setDraggingPath(null);
    setDragOverPath(null);
  }

  /** True while something from outside the app is being dragged over a row. */
  function carriesFiles(e: React.DragEvent) {
    return e.dataTransfer.types.includes("Files");
  }

  /** A folder takes the files itself; a file hands them to the folder it is in. */
  const dropTarget = entry.isDirectory ? entry.path : parentOf(entry.path);

  function handleDragOver(e: React.DragEvent) {
    const external = carriesFiles(e);
    if (!external && (!draggingPath || draggingPath === entry.path)) return;
    e.preventDefault();
    e.stopPropagation();
    // Copying something in from outside, moving something already in the vault.
    e.dataTransfer.dropEffect = external ? "copy" : "move";
    setDragOverPath(entry.path);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPath(null);

    const files = Array.from(e.dataTransfer.files);
    if (files.length) {
      attachFiles(dropTarget, files);
    } else if (draggingPath && draggingPath !== entry.path && entry.isDirectory) {
      moveEntry(draggingPath, entry.path);
    }
    setDraggingPath(null);
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
          className="[&[open]>summary>.cm-tree-chevron]:rotate-90 [&[open]>summary>.cm-tree-folder]:hidden [&[open]>summary>.cm-tree-folder-open]:block"
        >
          <summary
            draggable={!isRenaming}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDragLeave={(e) => {
              e.stopPropagation();
              if (dragOverPath === entry.path) setDragOverPath(null);
            }}
            onDrop={handleDrop}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openContextMenu(e, entry);
            }}
            className={`flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-zinc-800/25 hover:text-white [-webkit-user-drag:element] [&::-webkit-details-marker]:hidden ${
              isDraggedOver ? "bg-zinc-700/50 outline outline-1 outline-zinc-500" : ""
            } ${isBeingDragged ? "opacity-40" : ""}`}
          >
            <ChevronRight className="cm-tree-chevron h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform" />
            <Folder className="cm-tree-folder h-4 w-4 shrink-0 text-[var(--nuza-accent)]" />
            <FolderOpen className="cm-tree-folder-open hidden h-4 w-4 shrink-0 text-[var(--nuza-accent)]" />

            {isRenaming ? (
              <InlineInput
                initialValue={entry.name}
                onSubmit={(value) => submitRename(entry.path, value)}
                onCancel={cancelRename}
                className="min-w-0 flex-1 rounded bg-zinc-900 px-1 py-0.5 text-sm text-white outline outline-1 outline-blue-500"
              />
            ) : (
              <span className="truncate">{entry.name}</span>
            )}
          </summary>

          <ul className="ml-5 cursor-pointer border-l border-zinc-700 pl-3">
            {showCreateRow && (
              <NewEntryRow type={pendingCreate!.type} onSubmit={submitCreate} onCancel={cancelCreate} />
            )}
            {entry.children?.map((child) => (
              <FileTreeNode key={child.path} entry={child} />
            ))}
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
        draggable={!isRenaming}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={(e) => {
          e.stopPropagation();
          if (dragOverPath === entry.path) setDragOverPath(null);
        }}
        onDrop={handleDrop}
        onClick={() => !isRenaming && onFileSelect && onFileSelect(entry.path)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openContextMenu(e, entry);
        }}
        className={`flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1.5 pl-7 pr-2 text-left text-sm transition-colors [-webkit-user-drag:element] ${
          currentFile === entry.path
            ? // The note the editor is actually showing: a plain grey wash, a
              // step up from the hover behind it so it still reads as the open
              // file once the pointer has moved on.
              "bg-white/10 text-white"
            : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-100"
        } ${isDraggedOver ? "bg-zinc-700/50 outline outline-1 outline-zinc-500" : ""} ${isBeingDragged ? "opacity-40" : ""}`}
      >
        <FileIcon name={entry.name} />
        {isRenaming ? (
          <InlineInput
            initialValue={entry.name}
            onSubmit={(value) => submitRename(entry.path, value)}
            onCancel={cancelRename}
            className="min-w-0 flex-1 rounded bg-zinc-900 px-1 py-0.5 text-sm text-white outline outline-1 outline-blue-500"
          />
        ) : (
          <span className="truncate">{entry.name}</span>
        )}
      </button>
    </li>
  );
}
