/**
 * The notes that were open when the app was last closed, per vault.
 *
 * Quitting an editor is rarely a decision to put the work away - it is the end
 * of the day, or a restart. Coming back to the same tabs, with the same one in
 * front, is what makes the app feel like somewhere you left something rather
 * than somewhere you start again.
 *
 * Only the paths are kept. The notes themselves are on disk and are read back
 * when a tab is actually looked at, so a vault full of open tabs costs nothing
 * at launch beyond the one note in front of you.
 */
export interface Session {
  /** The open tabs, in the order the strip had them. */
  open: string[];
  /** The tab that was in front. */
  current: string;
}

export const EMPTY_SESSION: Session = { open: [], current: "" };

const STORAGE_KEY = "nuza:session";

/** How many vaults are remembered, so switching between a few of them works. */
const VAULT_LIMIT = 12;

type Sessions = Record<string, Session>;

/** Storage is a file anyone can edit, so what comes back is checked. */
function readSessions(): Sessions {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};

    const sessions: Sessions = {};
    for (const [vault, value] of Object.entries(stored as Record<string, unknown>)) {
      const { open, current } = (value ?? {}) as Partial<Session>;
      if (!Array.isArray(open)) continue;

      const paths = open.filter((path): path is string => typeof path === "string" && !!path);
      if (paths.length === 0) continue;

      sessions[vault] = {
        open: paths,
        current: typeof current === "string" && paths.includes(current) ? current : paths[0],
      };
    }
    return sessions;
  } catch {
    return {};
  }
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

  try {
    const sessions = readSessions();
    // Deleted and re-added rather than assigned, so the vault written to most
    // recently is always the last key - which is what makes trimming below
    // drop the vaults nobody has opened in the longest.
    delete sessions[vault];
    if (session.open.length > 0) sessions[vault] = session;

    const entries = Object.entries(sessions).slice(-VAULT_LIMIT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch (error) {
    console.error("Failed to record the open tabs:", error);
  }
}
