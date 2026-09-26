import { useEffect, useRef } from "react";
import { cn } from "cn";
import { FileMatch } from "@/lib/fileSearch";
import { FileIcon } from "@/lib/utils";
import MatchedText from "../MatchedText";

interface SearchResultsProps {
  matches: FileMatch[];
  activeIndex: number;
  currentFile: string;
  onHover: (index: number) => void;
  onSelect: (path: string) => void;
}

export default function SearchResults({
  matches,
  activeIndex,
  currentFile,
  onHover,
  onSelect,
}: SearchResultsProps) {
  const listRef = useRef<HTMLUListElement>(null);

  // Keep the keyboard-selected row visible without yanking the list around.
  useEffect(() => {
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (matches.length === 0) {
    return <p className="animate-fade-in mt-6 text-center text-xs text-zinc-600">No files match.</p>;
  }

  return (
    <ul ref={listRef} className="animate-fade-in space-y-0.5">
      {matches.map((match, index) => (
        <li key={match.entry.path}>
          <button
            onMouseEnter={() => onHover(index)}
            onClick={() => onSelect(match.entry.path)}
            title={match.directory ? `${match.directory}/${match.entry.name}` : match.entry.name}
            className={cn(
              "flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
              index === activeIndex
                ? "bg-zinc-800 text-white"
                : currentFile === match.entry.path
                  ? "text-white"
                  : "text-zinc-400"
            )}
          >
            <FileIcon name={match.entry.name} />
            <span className="truncate">
              <MatchedText name={match.entry.name} highlight={match.highlight} />
            </span>
            {match.directory && (
              <span className="ml-auto min-w-0 shrink truncate pl-2 text-right text-[11px] text-zinc-600">
                {match.directory}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
