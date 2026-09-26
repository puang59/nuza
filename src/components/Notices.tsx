import { useEffect } from "react";
import { cn } from "cn";
import { X } from "lucide-react";
import { Notice } from "@/lib/notices";

interface NoticeRowProps {
  notice: Notice;
  onDismiss: () => void;
  hold: number;
}

function NoticeRow({ notice, onDismiss, hold }: NoticeRowProps) {
  useEffect(() => {
    // Already leaving: let the exit run rather than asking for it again.
    if (notice.leaving) return;

    const timer = setTimeout(onDismiss, hold);
    return () => clearTimeout(timer);
  }, [notice.leaving, onDismiss, hold]);

  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto flex w-[320px] max-w-full items-start gap-3 rounded-lg border border-zinc-700 bg-[var(--nuza-bg)] px-3 py-2.5 shadow-xl",
        notice.leaving ? "animate-notice-out" : "animate-notice-in"
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm text-zinc-100">{notice.message}</p>
        {/* What the backend said, kept as its own line: it is the part that
            says which file, or that something is already there. */}
        {notice.reason && <p className="mt-0.5 text-xs break-words text-zinc-400">{notice.reason}</p>}
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="mt-0.5 cursor-pointer rounded p-0.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

interface NoticesProps {
  notices: Notice[];
  onDismiss: (id: number) => void;
  hold: number;
}

/**
 * What the app has to say, in the corner it says it from.
 *
 * Bottom right, out of the way of both the text and the sidebar, and not
 * taking the caret with it - a failed save should not also cost you your
 * place in the note, so nothing here takes focus and the stack itself does
 * not accept the pointer between its rows.
 */
export default function Notices({ notices, onDismiss, hold }: NoticesProps) {
  if (notices.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 bottom-12 z-50 flex flex-col items-end gap-2">
      {notices.map((notice) => (
        <NoticeRow key={notice.id} notice={notice} hold={hold} onDismiss={() => onDismiss(notice.id)} />
      ))}
    </div>
  );
}
