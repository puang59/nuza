import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { useExitAnimation } from "@/hooks/useExitAnimation";
import { nameProblem, withNoteExtension } from "@/lib/entryName";

interface NameNoteDialogProps {
  /** The draft being saved, and the name offered for it; null when nothing is. */
  naming: { path: string; suggested: string } | null;
  onSave: (path: string, name: string) => void;
  onCancel: () => void;
}

/**
 * Asks what a new note is to be called the first time it is saved, offering
 * its heading. The `.md` is added when it is left off, as in New File.
 */
export default function NameNoteDialog({ naming, onSave, onCancel }: NameNoteDialogProps) {
  const { isMounted, isClosing } = useExitAnimation(!!naming);
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // Held while it fades out, so the dialog still says what it was asking.
  const asking = useRef(naming);
  if (naming) asking.current = naming;

  useEffect(() => {
    if (!naming) return;
    setName(naming.suggested);
    setProblem(null);
  }, [naming]);

  if (!isMounted || !asking.current) return null;

  function submit() {
    if (!naming) return;
    const wanted = name.trim();
    const complaint = nameProblem(withNoteExtension(wanted));
    if (complaint) {
      setProblem(complaint);
      return;
    }
    onSave(naming.path, wanted);
  }

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[18vh]",
        isClosing ? "animate-fade-out" : "animate-fade-in"
      )}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "w-[380px] max-w-full rounded-lg border border-zinc-700 bg-[var(--nuza-bg)] p-4 shadow-xl",
          isClosing ? "animate-panel-out" : "animate-panel-in"
        )}
      >
        <h2 className="text-sm font-semibold text-white">Save note</h2>
        <p className="mt-1 text-xs text-zinc-500">What should this note be called?</p>
        <input
          ref={input}
          // Mounted a render after the dialog is asked for, so it takes the
          // keyboard itself, with the name offered selected to type over.
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          value={name}
          aria-label="Note name"
          aria-invalid={problem ? true : undefined}
          placeholder="Untitled"
          onChange={(e) => {
            setName(e.target.value);
            if (problem) setProblem(null);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          className="mt-3 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-zinc-500"
        />
        <p className={cn("mt-1.5 min-h-4 text-xs", problem ? "text-red-400" : "text-zinc-600")}>
          {problem ?? (name.trim() ? withNoteExtension(name.trim()) : "")}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="cursor-pointer rounded-md px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            className="cursor-pointer rounded-md bg-[var(--nuza-accent)] px-3 py-1.5 text-sm text-black transition-opacity hover:opacity-90"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
