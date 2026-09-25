import { splitOnHighlight } from "@/lib/fileSearch";

/**
 * A file name with the characters the query matched picked out. Shared by the
 * explorer's inline search and the quick-open palette so a match looks the
 * same wherever it is shown.
 */
export default function MatchedText({ name, highlight }: { name: string; highlight: number[] }) {
  const runs = splitOnHighlight(name, highlight);

  return (
    <>
      {runs.map((run, index) =>
        // splitOnHighlight always starts with an unmatched run, so the odd
        // ones are the matches.
        index % 2 === 1 ? (
          <mark key={index} className="bg-transparent font-medium text-[var(--nuza-accent)]">
            {run}
          </mark>
        ) : (
          run
        )
      )}
    </>
  );
}
