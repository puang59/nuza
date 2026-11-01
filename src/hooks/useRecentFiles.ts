import { useCallback, useMemo } from "react";
import { isWithin, rewritePath } from "@/lib/path";
import { readRecent, recordRecent } from "@/lib/recentFiles";
import { usePersistedState } from "./usePersistedState";

/** The notes opened most recently, newest first, and the way to add one. */
export function useRecentFiles() {
  const [stored, setStored] = usePersistedState<string[]>("recentFiles", []);

  // Memoised, since the list is a prop of a memoised palette.
  const recent = useMemo(() => readRecent(stored), [stored]);

  const record = useCallback(
    (path: string) =>
      setStored((list) => {
        const current = readRecent(list);
        // Already in front: nothing to write, and nothing to re-render.
        return current[0] === path ? list : recordRecent(current, path);
      }),
    [setStored]
  );

  /** The list follows a note, or a folder of them, that was renamed or moved. */
  const move = useCallback(
    (from: string, to: string) =>
      setStored((list) => {
        const moved = readRecent(list).map((path) => rewritePath(path, from, to));
        return moved.some((path, index) => path !== list[index]) ? moved : list;
      }),
    [setStored]
  );

  /** A deleted note, or everything in a deleted folder, leaves the list. */
  const forget = useCallback(
    (gone: string) =>
      setStored((list) => {
        const kept = readRecent(list).filter((path) => !isWithin(path, gone));
        return kept.length === list.length ? list : kept;
      }),
    [setStored]
  );

  return { recent, record, move, forget };
}
