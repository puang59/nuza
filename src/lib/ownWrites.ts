/**
 * What the app itself has written to each note lately, newest last.
 *
 * The watcher can report a save back to the window that made it, and by the
 * time that report is read the writer has often typed on, so the file no
 * longer matches the buffer. Matching what is on disk against what was just
 * written is how that is told apart from somebody else's edit.
 */
export type OwnWrites = Map<string, string[]>;

/** How many writes per note are remembered - more than can be in flight at once. */
export const OWN_WRITES_KEPT = 4;

/** Notes that `content` is about to be written to `path`. */
export function noteOwnWrite(writes: OwnWrites, path: string, content: string, kept = OWN_WRITES_KEPT) {
  const seen = (writes.get(path) ?? []).filter((text) => text !== content);
  writes.set(path, [...seen, content].slice(-kept));
}

/** Whether `content` is something the app wrote to `path` itself. */
export function isOwnWrite(writes: OwnWrites, path: string, content: string) {
  return writes.get(path)?.includes(content) ?? false;
}

/**
 * Forgets what was written to `path`. Called once the file is seen to hold
 * something else: from then on an old write turning up again is a change.
 */
export function dropOwnWrites(writes: OwnWrites, path: string) {
  writes.delete(path);
}
