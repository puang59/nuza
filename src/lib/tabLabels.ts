/**
 * What each tab is called.
 *
 * A tab shows its note's file name, which is enough until two notes of the
 * same name are open - `projects/README.md` and `notes/README.md` - and the
 * strip has two tabs nobody can tell apart. Those get a hint beside the name:
 * the folder each is in, or as much of the path above it as it takes to tell
 * them apart.
 */
export interface TabLabel {
  name: string;
  /** Set only where the name alone is not enough. */
  hint?: string;
}

function segments(path: string) {
  return path.split(/[\\/]+/).filter(Boolean);
}

export function tabLabels(paths: readonly string[]): Map<string, TabLabel> {
  const labels = new Map<string, TabLabel>();
  const byName = new Map<string, string[]>();

  for (const path of paths) {
    const parts = segments(path);
    const name = parts[parts.length - 1] ?? path;
    labels.set(path, { name });
    byName.set(name, [...(byName.get(name) ?? []), path]);
  }

  for (const sharing of byName.values()) {
    if (sharing.length < 2) continue;

    // The folders above each, nearest first.
    const above = new Map(sharing.map((path) => [path, segments(path).slice(0, -1).reverse()]));
    const deepest = Math.max(...Array.from(above.values(), (folders) => folders.length));

    // As few folders as tell every one of them apart; all of them if nothing does.
    let depth = 1;
    const hintAt = (path: string, count: number) => above.get(path)!.slice(0, count).reverse().join("/");
    while (depth < deepest && new Set(sharing.map((path) => hintAt(path, depth))).size < sharing.length)
      depth++;

    for (const path of sharing) {
      const hint = hintAt(path, depth);
      if (hint) labels.get(path)!.hint = hint;
    }
  }

  return labels;
}

/**
 * The tabs a "close" from one tab's menu takes away: the others, or the ones
 * to its right. The tab itself always stays.
 */
export function tabsToClose(paths: readonly string[], path: string, which: "others" | "right"): string[] {
  const index = paths.indexOf(path);
  if (index === -1) return [];
  return which === "others" ? paths.filter((other) => other !== path) : paths.slice(index + 1);
}
