import { FileEntry } from "./types";

export interface FileMatch {
  entry: FileEntry;
  /** Folders between the opened root and this file, for the dimmed second half of the row. */
  directory: string;
  /** Indices in `entry.name` that the query matched, for highlighting. */
  highlight: number[];
  score: number;
}

/** Results past this many are noise in a sidebar you have to scroll. */
const RESULT_LIMIT = 50;

/**
 * Matches `query` as a subsequence of `text` - so "mdrn" finds
 * "markdown-rendering" - and scores how convincing the match is. Returns null
 * when a query character is missing entirely.
 */
function fuzzyMatch(text: string, query: string) {
  const haystack = text.toLowerCase();
  const indices: number[] = [];
  let score = 0;
  let cursor = 0;

  for (const char of query) {
    const found = haystack.indexOf(char, cursor);
    if (found < 0) return null;

    // Runs of adjacent characters, and characters landing at the start of a
    // word, are what separate the name you meant from an accidental
    // subsequence buried in a long path.
    if (indices.length > 0 && found === indices[indices.length - 1] + 1) score += 8;
    if (found === 0 || /[^a-z0-9]/.test(haystack[found - 1])) score += 6;
    score -= Math.min(found - cursor, 4);

    indices.push(found);
    cursor = found + 1;
  }

  // All else equal, the shorter name is the one that was meant.
  return { indices, score: score - text.length / 20 };
}

function walkFiles(
  entries: FileEntry[],
  trail: string[],
  visit: (entry: FileEntry, trail: string[]) => void
) {
  for (const entry of entries) {
    if (entry.isDirectory) {
      if (entry.children) walkFiles(entry.children, [...trail, entry.name], visit);
    } else {
      visit(entry, trail);
    }
  }
}

/**
 * Files in the tree that match `query`, best first. A hit on the file's own
 * name always outranks one that only came together across the folders leading
 * to it, so typing part of a filename does not bury it under its neighbours.
 */
export function searchFiles(entries: FileEntry[], query: string): FileMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const matches: FileMatch[] = [];

  walkFiles(entries, [], (entry, trail) => {
    const directory = trail.join("/");

    const byName = fuzzyMatch(entry.name, needle);
    if (byName) {
      matches.push({ entry, directory, highlight: byName.indices, score: byName.score + 25 });
      return;
    }

    // Fall back to the whole path, so "ideas/draft" finds a file the name
    // alone never would. Nothing is highlighted - the match is not in the name.
    const byPath = fuzzyMatch(`${directory}/${entry.name}`, needle);
    if (byPath) matches.push({ entry, directory, highlight: [], score: byPath.score });
  });

  return matches.sort((a, b) => b.score - a.score).slice(0, RESULT_LIMIT);
}

/**
 * Splits a name into alternating unmatched/matched runs, so the row can render
 * the match without reasoning about indices itself. Always starts unmatched,
 * which may be an empty string.
 */
export function splitOnHighlight(name: string, highlight: number[]) {
  if (highlight.length === 0) return [name];

  const runs: string[] = [];
  const marked = new Set(highlight);
  let current = "";
  let inMatch = false;

  for (let index = 0; index < name.length; index++) {
    const isMatch = marked.has(index);
    if (isMatch !== inMatch) {
      runs.push(current);
      current = "";
      inMatch = isMatch;
    }
    current += name[index];
  }
  runs.push(current);

  return runs;
}
