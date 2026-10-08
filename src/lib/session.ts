/**
 * The notes that were open when the app was last closed, per vault.
 *
 * Quitting an editor is rarely a decision to put the work away - it is the end
 * of the day, or a restart. Coming back to the same tabs, with the same one in
 * front, is what makes the app feel like somewhere you left something rather
 * than somewhere you start again.
 *
 * Only the paths are kept, and where the caret was in each. The notes
 * themselves are on disk and are read back when a tab is actually looked at,
 * so a vault full of open tabs costs nothing at launch beyond the one note in
 * front of you.
 */
export interface Session {
  /** The open tabs, in the order the strip had them. */
  open: string[];
  /** The tab that was in front. */
  current: string;
  /**
   * Where the caret was in each open note, as an offset into its text, so a
   * note comes back at the place it was left rather than at its first line.
   * Notes left at their start are not listed.
   */
  carets?: Record<string, number>;
}

export const EMPTY_SESSION: Session = { open: [], current: "" };

const STORAGE_KEY = "nuza:session";

/** How many vaults are remembered, so switching between a few of them works. */
const VAULT_LIMIT = 12;

type Sessions = Record<string, Session>;

/**
 * The parsed store, with the text it was parsed from. Parsing every vault's
 * session on each tab change would be wasteful, so the result is held - but it
 * is only reused while storage still holds exactly that text. Another window
 * of the app writes to the same store, and a copy held in this one would
 * otherwise go stale, and the next write from here would erase what that window
 * had recorded in the meantime.
 */
let cache: { raw: string | null; sessions: Sessions } | null = null;

/** The carets out of `stored` that belong to one of `paths` and are a place in a text. */
export function caretsFor(paths: readonly string[], stored: unknown): Record<string, number> {
  const kept: Record<string, number> = {};
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return kept;

  for (const path of paths) {
    const caret = (stored as Record<string, unknown>)[path];
    if (typeof caret === "number" && Number.isInteger(caret) && caret > 0) kept[path] = caret;
  }
  return kept;
}

/** Storage is a file anyone can edit, so what comes back is checked. */
function parseSessions(raw: string | null): Sessions {
  try {
    const stored: unknown = JSON.parse(raw ?? "{}");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};

    const sessions: Sessions = {};
    for (const [vault, value] of Object.entries(stored as Record<string, unknown>)) {
      const { open, current, carets } = (value ?? {}) as Partial<Session>;
      if (!Array.isArray(open)) continue;

      const paths = open.filter((path): path is string => typeof path === "string" && !!path);
      if (paths.length === 0) continue;

      sessions[vault] = {
        open: paths,
        current: typeof current === "string" && paths.includes(current) ? current : paths[0],
      };

      const kept = caretsFor(paths, carets);
      if (Object.keys(kept).length > 0) sessions[vault].carets = kept;
    }
    return sessions;
  } catch {
    return {};
  }
}

function readSessions(): Sessions {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage is blocked: nothing is remembered, and that is not an error.
  }
  if (cache && cache.raw === raw) return cache.sessions;

  const sessions = parseSessions(raw);
  cache = { raw, sessions };
  return sessions;
}

/** What was open in `vault` last time, or nothing if it has no record. */
export function readSession(vault: string): Session {
  return readSessions()[vault] ?? EMPTY_SESSION;
}

/**
 * Records what is open in `vault`. An empty list forgets the vault rather than
 * leaving an entry behind, which is also what keeps the list from growing past
 * the vaults still being used.
 */
export function writeSession(vault: string, session: Session) {
  if (!vault) return;

  // Read again from storage rather than trusted from before: only this vault's
  // entry is replaced, so what another window recorded for its own is kept.
  // Copied rather than edited in place, so a write that storage refuses does
  // not leave the cache claiming something that was never recorded.
  const sessions = { ...readSessions() };
  // Deleted and re-added rather than assigned, so the vault written to most
  // recently is always the last key - which is what makes trimming below
  // drop the vaults nobody has opened in the longest.
  delete sessions[vault];
  if (session.open.length > 0) sessions[vault] = session;

  const trimmed = Object.fromEntries(Object.entries(sessions).slice(-VAULT_LIMIT));

  try {
    const raw = JSON.stringify(trimmed);
    localStorage.setItem(STORAGE_KEY, raw);
    cache = { raw, sessions: trimmed };
  } catch (error) {
    console.error("Failed to record the open tabs:", error);
  }
}

/**
 * The tabs to reopen out of `session`, given which of its notes are still
 * `present` on disk: the ones that are gone are dropped, a note asked for by
 * name (`focus`) joins the rest and goes in front, and otherwise the note that
 * was in front last time is - or the first tab, if that one has gone.
 * `current` is undefined when there is nothing left to reopen.
 */
export function tabsToRestore(session: Session, present: readonly string[], focus?: string) {
  const there = new Set(present);
  const open = session.open.filter((path) => there.has(path));

  const asked = focus && there.has(focus) ? focus : undefined;
  if (asked && !open.includes(asked)) open.push(asked);

  const current: string | undefined = asked ?? (open.includes(session.current) ? session.current : open[0]);
  return { open, current };
}
