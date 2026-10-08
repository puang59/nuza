import { memo } from "react";
import { useNoteTimes } from "@/hooks/useNoteTimes";
import { fullDate, timeAgo } from "@/lib/relativeTime";

interface NoteAgeProps {
  /** The open note, or null for one with no file. */
  path: string | null;
  /** Whether everything typed in it has been written to disk. */
  saved: boolean;
}

/**
 * "Edited 5 minutes ago", for the footer: when the open note was last changed
 * on disk, with the exact time - and when the note was made - a hover away.
 */
function NoteAge({ path, saved }: NoteAgeProps) {
  const { times, now } = useNoteTimes(path, saved);
  if (!times?.modified) return null;

  const title = [
    `Edited ${fullDate(times.modified)}`,
    ...(times.created ? [`Created ${fullDate(times.created)}`] : []),
  ].join("\n");

  return (
    <span title={title} className="tabular-nums">
      Edited {timeAgo(times.modified, now)}
    </span>
  );
}

export default memo(NoteAge);
