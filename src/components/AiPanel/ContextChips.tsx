import { FileText, TextSelect, X } from "lucide-react";

/** Something going with the next question, as a chip above the composer. */
export interface ContextChip {
  id: string;
  kind: "note" | "file" | "lines";
  label: string;
  /** The lines, for a chip that is only some of a note: "L3–5". */
  detail?: string | null;
  /** Shown on hover: the path, or what of the note goes. */
  title?: string;
  /** Takes it out of the context; the open note's own chip has none. */
  onRemove?: () => void;
}

interface ContextChipsProps {
  chips: ContextChip[];
  /** Whether there are suggested edits waiting to be looked at. */
  reviewable: boolean;
  onReview: () => void;
}

/**
 * What the next question carries: the open note (or its selection), and any
 * notes or lines added to it. Small, in a row that wraps, each one coming in
 * as it is added and taken out with its own ×.
 */
export default function ContextChips({ chips, reviewable, onReview }: ContextChipsProps) {
  if (!chips.length && !reviewable) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 pb-1.5">
      {chips.map((chip) => {
        const Icon = chip.kind === "lines" ? TextSelect : FileText;
        return (
          <span
            key={chip.id}
            title={chip.title}
            className="animate-ai-in flex max-w-full items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900/50 py-0.5 pl-1.5 pr-1 text-[11px] text-gray-300"
          >
            <Icon size={11} className="shrink-0 text-gray-500" aria-hidden />
            <span className="truncate">{chip.label}</span>
            {chip.detail && <span className="shrink-0 text-gray-500">{chip.detail}</span>}
            {chip.onRemove && (
              <button
                type="button"
                onClick={chip.onRemove}
                aria-label={`Remove ${chip.label} from the context`}
                className="flex shrink-0 cursor-pointer items-center rounded text-gray-600 transition-colors hover:text-gray-200"
              >
                <X size={11} />
              </button>
            )}
          </span>
        );
      })}
      {reviewable && (
        <button
          type="button"
          onClick={onReview}
          className="animate-ai-in ml-auto cursor-pointer rounded-md bg-zinc-800 px-1.5 py-0.5 text-[11px] text-gray-200 transition-colors hover:bg-zinc-700"
        >
          Review
        </button>
      )}
    </div>
  );
}
