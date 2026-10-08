import { memo } from "react";
import { readingMinutes } from "@/lib/documentStats";
import { StatsSubscription, useDocumentStats } from "@/hooks/useDocumentStats";
import NoteAge from "./NoteAge";

/**
 * The footer for writing without Vim: no bar, no chrome, no mode to keep track
 * of - just how much has been written, set quietly enough to be ignored while
 * the words are still coming.
 */
interface WritingStatsProps {
  subscribeToStats: StatsSubscription;
  /** The open note's file, or null for the scratch note. */
  notePath: string | null;
  /** Whether the note has nothing unsaved in it. */
  saved: boolean;
}

function WritingStats({ subscribeToStats, notePath, saved }: WritingStatsProps) {
  const { words, characters, paragraphs } = useDocumentStats(subscribeToStats);

  // Shown from the first empty note onwards: a counter that appears once you
  // have written enough to deserve one draws more attention than it saves.
  const counts = [
    [words, "word"],
    [characters, "character"],
    [paragraphs, "paragraph"],
  ] as const;

  return (
    <div className="animate-fade-in relative z-10 flex h-7 compact:h-6 shrink-0 items-center justify-end gap-5 px-5 text-xs text-zinc-500">
      <NoteAge path={notePath} saved={saved} />
      {counts.map(([value, noun]) => (
        <span key={noun} className="tabular-nums">
          {value.toLocaleString()} {noun}
          {value === 1 ? "" : "s"}
        </span>
      ))}
      <span className="tabular-nums">{readingMinutes(words)} min read</span>
    </div>
  );
}

export default memo(WritingStats);
