import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "cn";
import { useExitAnimation } from "@/hooks/useExitAnimation";
import { matchesForPaths, searchFiles } from "@/lib/fileSearch";
import { FileEntry } from "@/lib/types";
import { FileIcon } from "@/lib/utils";
import MatchedText from "./MatchedText";

interface FileSearchPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  data: FileEntry[];
  /** Files already open as tabs, shown first before anything has been typed. */
  openPaths: string[];
  /** Notes opened lately, newest first - shown after the open tabs. */
  recentPaths: string[];
  currentFile: string;
  /** `beside` is Cmd/Ctrl+Enter: open it in the split rather than in front. */
  onSelect: (path: string, beside?: boolean) => void;
  /** What the search box asks for. */
  placeholder?: string;
  /** Only markdown notes - for picking a note to link to. */
  notesOnly?: boolean;
}

/**
 * Quick open: a floating search that reaches any file in the folder without
 * the sidebar being open at all. Translucent over the document rather than
 * opaque, so it reads as sitting above the note you were just reading.
 */
function FileSearchPalette({
  isOpen,
  onClose,
  data,
  openPaths,
  recentPaths,
  currentFile,
  onSelect,
  placeholder = "Search files",
  notesOnly = false,
}: FileSearchPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const { isMounted, isClosing } = useExitAnimation(isOpen);
  const listRef = useRef<HTMLUListElement>(null);

  // Every open starts fresh: a palette that remembers last time's query makes
  // you clear it before you can use it.
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [isOpen]);

  const matches = useMemo(() => {
    if (!isMounted) return [];
    // With nothing typed, the open tabs are the most likely destinations,
    // and then whatever was open lately and has since been closed.
    const found = query.trim()
      ? searchFiles(data, query)
      : matchesForPaths(data, [...new Set([...openPaths, ...recentPaths])]);
    return notesOnly ? found.filter((match) => /\.md$/i.test(match.entry.name)) : found;
  }, [isMounted, data, openPaths, recentPaths, query, notesOnly]);

  useEffect(() => {
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, matches]);

  function choose(path: string, beside = false) {
    onSelect(path, beside);
    onClose();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => Math.min(Math.max(index + step, 0), matches.length - 1));
      return;
    }

    if (event.key === "Enter" && matches[activeIndex]) {
      event.preventDefault();
      // Not for the link picker, whose choice is a note to point at.
      choose(matches[activeIndex].entry.path, !notesOnly && (event.metaKey || event.ctrlKey));
    }
  }

  if (!isMounted) return null;

  const noun = notesOnly ? "note" : "file";
  const hint = query.trim() ? `No ${noun}s match.` : `Type to find a ${noun}.`;

  return (
    <div
      onClick={onClose}
      className={cn(
        "fixed inset-0 z-50 flex items-start justify-center bg-black/25 px-4 pb-4 pt-[14vh]",
        isClosing ? "animate-fade-out" : "animate-fade-in"
      )}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className={cn(
          // Frosted rather than tinted: the blur is what keeps a background
          // this transparent legible, and the shade above the window's own
          // makes it read as floating rather than cut into the surface.
          "flex w-[460px] max-w-full flex-col overflow-hidden nuza-palette rounded-xl border border-white/10 bg-[#262628]/65 shadow-2xl backdrop-blur-2xl",
          isClosing ? "animate-palette-out" : "animate-palette-in"
        )}
      >
        <div className="flex shrink-0 items-center gap-2 px-3 py-2 leading-5">
          <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          <input
            autoFocus
            value={query}
            placeholder={placeholder}
            aria-label="Quick open"
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-zinc-500"
          />
        </div>

        {matches.length === 0 ? (
          <p className="border-t border-white/5 px-3 py-4 text-center text-xs text-zinc-500">{hint}</p>
        ) : (
          <ul ref={listRef} className="max-h-[280px] min-h-0 overflow-y-auto border-t border-white/5 p-1">
            {matches.map((match, index) => (
              <li key={match.entry.path}>
                <button
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(match.entry.path)}
                  title={match.directory ? `${match.directory}/${match.entry.name}` : match.entry.name}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-5 transition-colors",
                    index === activeIndex ? "bg-white/8" : "hover:bg-white/5",
                    currentFile === match.entry.path ? "text-white" : "text-zinc-200"
                  )}
                >
                  <FileIcon name={match.entry.name} />
                  <span className="truncate">
                    <MatchedText name={match.entry.name} highlight={match.highlight} />
                  </span>
                  {match.directory && (
                    <span className="ml-auto min-w-0 shrink truncate pl-3 text-right text-[11px] text-zinc-500">
                      {match.directory}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default memo(FileSearchPalette);
