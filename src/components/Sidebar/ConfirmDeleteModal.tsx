import { useEffect, useRef } from "react";
import { cn } from "cn";
import { useExitAnimation } from "@/hooks/useExitAnimation";

interface ConfirmDeleteModalProps {
  /** What is being deleted, or null when nothing is. */
  target: { name: string; isDirectory: boolean } | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDeleteModal({ target, onConfirm, onCancel }: ConfirmDeleteModalProps) {
  const { isMounted, isClosing } = useExitAnimation(!!target);

  // The target is cleared the moment the dialog starts closing, but the dialog
  // still has to say what it was asking about while it fades out - so hold on
  // to the last thing we were given.
  const asking = useRef(target);
  if (target) asking.current = target;

  useEffect(() => {
    // Only while it is really open: a stray Enter during the fade out would
    // otherwise delete something the dialog has already been dismissed for.
    if (!target) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [target, onCancel, onConfirm]);

  if (!isMounted || !asking.current) return null;

  const { name, isDirectory } = asking.current;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4",
        isClosing ? "animate-fade-out" : "animate-fade-in"
      )}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "w-[360px] max-w-full rounded-lg border border-zinc-700 bg-[#1E1E1E] p-5 shadow-xl",
          isClosing ? "animate-panel-out" : "animate-panel-in"
        )}
      >
        <h2 className="text-sm font-semibold text-white">Delete {isDirectory ? "folder" : "file"}</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Are you sure you want to delete <span className="text-zinc-200">"{name}"</span>?
          {isDirectory && " This will delete all of its contents."} This action cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="cursor-pointer rounded-md px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="cursor-pointer rounded-md bg-red-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-red-500"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
