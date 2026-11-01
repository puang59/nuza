/**
 * What a file or folder in the vault is allowed to be called.
 *
 * The inline row in the sidebar used to hand whatever was typed straight to
 * `create_file` and `rename_entry`, which joined it onto the parent path: a
 * name of `../../notes.md` wrote a file outside the vault, and the row the
 * sidebar then held pointed somewhere the tree could not show, so the file
 * vanished until the next restart. The backend refuses those now, but a
 * refusal arriving as a notice after the row has closed is a poor way to
 * learn that a slash is not allowed - so the same rules are checked here,
 * while the name is still being typed and can still be corrected.
 *
 * Windows' rules are applied everywhere, not only on Windows. A vault is very
 * often a synced folder, and a note called `aux.md` or `report.` is one that
 * cannot be checked out on a machine that is not this one - being told about
 * it here is better than the vault breaking on someone else's laptop.
 */

/** Names Win32 hands to a device rather than a file, whatever the extension. */
const RESERVED = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, n) => `com${n + 1}`),
  ...Array.from({ length: 9 }, (_, n) => `lpt${n + 1}`),
]);

/** The characters Win32 keeps: `:` is an NTFS stream, the rest are wildcards. */
const FORBIDDEN = ['"', "*", ":", "<", ">", "?", "|"];

/**
 * Most filesystems cap a single component at 255 bytes. Counted in UTF-8, so
 * a name of emoji runs out where the filesystem does rather than later.
 */
const MAX_BYTES = 255;

/** A character no path should carry: C0, and delete. */
function isControl(character: string) {
  const code = character.codePointAt(0) ?? 0;
  return code < 0x20 || code === 0x7f;
}

/**
 * Why `name` cannot be used, in words that can go straight on screen, or
 * `null` if there is nothing wrong with it.
 */
export function nameProblem(name: string): string | null {
  const trimmed = name.trim();

  if (!trimmed) return "A name is needed";
  if (trimmed === "." || trimmed === "..") return "That is not a name";

  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return "A name cannot contain a slash";
  }

  const forbidden = FORBIDDEN.find((character) => trimmed.includes(character));
  if (forbidden) return `A name cannot contain ${forbidden}`;

  // Tabs, newlines and the rest survive in a filename on Unix, and make a row
  // in the tree that cannot be told apart from its neighbours.
  if (Array.from(trimmed).some(isControl)) return "A name cannot contain control characters";

  // The sidebar does not list dot-directories or dotfiles - a note created as
  // one would be written and then immediately invisible.
  if (trimmed.startsWith(".")) return "A name cannot start with a dot";

  // Win32 drops these on the way to disk, so the file lands under a name that
  // is neither the one asked for nor the one checked against what is there.
  if (/[. ]$/.test(trimmed)) return "A name cannot end with a dot or a space";

  const stem = trimmed.split(".")[0];
  if (RESERVED.has(stem.toLowerCase())) return `"${stem}" is a name Windows keeps for itself`;

  if (new TextEncoder().encode(trimmed).length > MAX_BYTES) return "That name is too long";

  return null;
}

/**
 * `name` as a note's file name: given `.md` unless it already ends in an
 * extension. An extension has a letter in it, so `v1.2` and `Dr. Who` become
 * notes, and `data.csv` is left as it was asked for.
 */
export function withNoteExtension(name: string): string {
  return /\.(?=[a-z0-9]*[a-z])[a-z0-9]{1,6}$/i.test(name) ? name : `${name}.md`;
}
