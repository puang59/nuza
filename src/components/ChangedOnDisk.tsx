import { fileNameOf } from "@/lib/media";

interface ChangedOnDiskProps {
  /** The note being asked about, or null when there is nothing to ask. */
  path: string | null;
  /** Take the copy on disk, dropping the edits in the tab. */
  onReload: () => void;
  /** Keep the edits in the tab, over the top of the copy on disk. */
  onKeepMine: () => void;
  /**
   * The file is not on disk at all any more - deleted, moved or renamed by
   * something other than the app. There is no copy to take, so the choice is
   * between putting the note back and letting it go.
   */
  missing?: boolean;
  /** Close the note without writing it anywhere. Offered for a missing file. */
  onDiscard?: () => void;
}

/**
 * Two copies of a note and no way to tell which one is wanted.
 *
 * Something else - a sync client, a git checkout, another editor - wrote to a
 * note that had unsaved edits in it here. Nothing is written back until this
 * is answered, so both copies are still there to choose between; the bar stays
 * until one of them is picked.
 */
export default function ChangedOnDisk({
  path,
  onReload,
  onKeepMine,
  missing = false,
  onDiscard,
}: ChangedOnDiskProps) {
  if (!path) return null;

  if (missing) {
    return (
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2">
        {/* Wide enough to read before it gives way: in a narrow pane the buttons
            drop to a line of their own rather than squeezing this to a column. */}
        <p className="min-w-0 flex-1 basis-64 text-sm text-amber-100/90">
          <span className="text-amber-100">"{fileNameOf(path)}"</span> is no longer on disk. What is here is
          not saved anywhere.
        </p>
        <div className="flex shrink-0 gap-2">
          {onDiscard && (
            <button
              onClick={onDiscard}
              className="cursor-pointer rounded-md px-3 py-1 text-sm text-amber-100/90 transition-colors hover:bg-amber-500/20"
            >
              Close without saving
            </button>
          )}
          <button
            onClick={onKeepMine}
            className="cursor-pointer rounded-md bg-amber-500/80 px-3 py-1 text-sm text-black transition-colors hover:bg-amber-400"
          >
            Save it here again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2">
      <p className="min-w-0 flex-1 text-sm text-amber-100/90">
        <span className="text-amber-100">"{fileNameOf(path)}"</span> changed on disk while you were editing
        it. Nothing has been saved over it.
      </p>
      <div className="flex shrink-0 gap-2">
        <button
          onClick={onReload}
          className="cursor-pointer rounded-md px-3 py-1 text-sm text-amber-100/90 transition-colors hover:bg-amber-500/20"
        >
          Use the file
        </button>
        <button
          onClick={onKeepMine}
          className="cursor-pointer rounded-md bg-amber-500/80 px-3 py-1 text-sm text-black transition-colors hover:bg-amber-400"
        >
          Keep my edits
        </button>
      </div>
    </div>
  );
}
