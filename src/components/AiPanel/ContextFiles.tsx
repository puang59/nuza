import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { cn } from "cn";
import { relativePath } from "@/lib/media";

interface ContextFilesProps {
  /** Every note in the open vault. */
  notes: readonly string[];
  vault: string | null;
  /** The note the editor is on, which always goes. */
  current: string | null;
  picked: readonly string[];
  onToggle: (path: string) => void;
}

/**
 * The vault's notes, to tick the ones that should go with the next questions
 * as well as the note that is open. Narrowed as a name is typed; the open note
 * leads the list, already included.
 */
export default function ContextFiles({ notes, vault, current, picked, onToggle }: ContextFilesProps) {
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const matching = notes.filter(
      (path) =>
        !needle ||
        relativePath(vault ?? "", path)
          .toLowerCase()
          .includes(needle)
    );
    // The open note first, then what is picked, then the rest in path order.
    const rank = (path: string) => (path === current ? 0 : picked.includes(path) ? 1 : 2);
    return [...matching].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).slice(0, 300);
  }, [notes, vault, filter, current, picked]);

  if (!vault) {
    return (
      <p className="animate-ai-in px-1 pt-2 text-xs text-gray-500">Open a folder to pick notes from it.</p>
    );
  }

  return (
    <div className="animate-ai-in flex min-h-0 flex-1 flex-col gap-1.5">
      <label className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/50 px-2 py-1 transition-colors focus-within:border-zinc-600">
        <Search size={12} className="shrink-0 text-gray-500" aria-hidden />
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Find a note"
          aria-label="Find a note to include"
          className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-gray-600"
        />
      </label>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {shown.map((path) => {
          const isCurrent = path === current;
          const isPicked = isCurrent || picked.includes(path);
          const relative = relativePath(vault, path);
          const slash = relative.lastIndexOf("/");
          return (
            <li key={path}>
              <button
                type="button"
                disabled={isCurrent}
                onClick={() => onToggle(path)}
                title={isCurrent ? "The open note always goes" : relative}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors disabled:cursor-default",
                  isPicked ? "text-gray-200" : "text-gray-400 hover:bg-zinc-800/50 hover:text-gray-200"
                )}
              >
                <span
                  className={cn(
                    "flex size-3.5 shrink-0 items-center justify-center rounded border transition-colors",
                    isPicked ? "border-transparent bg-zinc-300 text-black" : "border-zinc-600"
                  )}
                >
                  {isPicked && <Check size={10} strokeWidth={3} />}
                </span>
                <span className="truncate">{relative.slice(slash + 1).replace(/\.md$/i, "")}</span>
                {slash > 0 && (
                  <span className="ml-auto shrink-0 truncate pl-2 text-gray-600">
                    {relative.slice(0, slash)}
                  </span>
                )}
                {isCurrent && <span className="ml-auto shrink-0 pl-2 text-gray-600">open</span>}
              </button>
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-1.5 py-2 text-xs text-gray-600">No notes match.</li>}
      </ul>
    </div>
  );
}
