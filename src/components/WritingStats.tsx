import { memo } from "react";
import { readingMinutes } from "@/lib/documentStats";
import { StatsSubscription, useDocumentStats } from "@/hooks/useDocumentStats";

/**
 * The footer for writing without Vim: no bar, no chrome, no mode to keep track
 * of - just how much has been written, set quietly enough to be ignored while
 * the words are still coming.
 */
function WritingStats({ subscribeToStats }: { subscribeToStats: StatsSubscription }) {
  const { words, characters, paragraphs } = useDocumentStats(subscribeToStats);

  const counts = [
    [words, "word"],
    [characters, "character"],
    [paragraphs, "paragraph"],
  ] as const;

  return (
    <div className="flex h-7 shrink-0 items-center justify-end gap-5 px-5 text-xs text-zinc-500 relative z-10">
      {characters > 0 &&
        counts.map(([value, noun]) => (
          <span key={noun}>
            {value.toLocaleString()} {noun}
            {value === 1 ? "" : "s"}
          </span>
        ))}
      {words > 0 && <span>{readingMinutes(words)} min read</span>}
    </div>
  );
}

export default memo(WritingStats);
