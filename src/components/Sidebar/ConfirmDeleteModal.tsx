import { useEffect } from "react";

export default function ConfirmDeleteModal({
  name,
  isDirectory,
  onConfirm,
  onCancel,
}: {
  name: string;
  isDirectory: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, onConfirm]);

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-panel-in w-[360px] max-w-full rounded-lg border border-zinc-700 bg-[#1E1E1E] p-5 shadow-xl"
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
