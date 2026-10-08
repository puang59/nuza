import { Ref } from "react";
import { X } from "lucide-react";
import { fileNameOf } from "@/lib/media";
import ChangedOnDisk from "./ChangedOnDisk";
import RecoveredEdits from "./RecoveredEdits";

interface SidePaneProps {
  /** The note in the split. */
  path: string;
  isDirty: boolean;
  hasConflict: boolean;
  /** The note's file has gone from disk. */
  isMissing: boolean;
  hasRecovered: boolean;
  /** CodeMirror mounts itself in here, as in the main pane. */
  containerRef: Ref<HTMLDivElement>;
  onContextMenu: (event: React.MouseEvent) => void;
  onClose: () => void;
  onReload: () => void;
  onKeepMine: () => void;
  /** Close a note whose file has gone, without writing it anywhere. */
  onDiscardMissing: () => void;
  onRestore: () => void;
  onDiscard: () => void;
}

/**
 * The second pane, beside the first: one note, named across the top, with the
 * same two questions the main pane can be asked about it. It has no tabs - the
 * split is for looking at a note while writing in another, and closing it is
 * how the main pane gets the width back.
 */
export default function SidePane({
  path,
  isDirty,
  hasConflict,
  isMissing,
  hasRecovered,
  containerRef,
  onContextMenu,
  onClose,
  onReload,
  onKeepMine,
  onDiscardMissing,
  onRestore,
  onDiscard,
}: SidePaneProps) {
  const name = fileNameOf(path);

  return (
    <section
      aria-label={`${name}, in the split`}
      className="animate-fade-in flex min-w-0 flex-1 flex-col border-l border-[var(--nuza-hairline)] print:hidden"
    >
      <header className="flex h-8 shrink-0 items-center gap-2 px-4 text-xs text-zinc-500">
        <span className="truncate text-zinc-300" title={path}>
          {name}
        </span>
        {isDirty && (
          <span
            aria-label="Unsaved changes"
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--nuza-accent)]"
          />
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${name}`}
          title="Close the split"
          className="ml-auto flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <ChangedOnDisk
        path={hasConflict || isMissing ? path : null}
        missing={isMissing}
        onReload={onReload}
        onKeepMine={onKeepMine}
        onDiscard={onDiscardMissing}
      />
      <RecoveredEdits path={hasRecovered ? path : null} onRestore={onRestore} onDiscard={onDiscard} />

      <div ref={containerRef} onContextMenu={onContextMenu} className="min-h-0 flex-1" />
    </section>
  );
}
