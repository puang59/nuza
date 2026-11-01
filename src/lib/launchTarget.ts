import { directoryOf } from "@/lib/markdown/sources";
import { isWithin } from "@/lib/path";

/**
 * What `nuza <path>` asked for, as the backend resolved it: a folder to open
 * as the vault, or a note to open in one.
 */
export interface OpenTarget {
  kind: "folder" | "file";
  path: string;
  /**
   * For a note moved into a window of its own: the vault it is in. The window
   * opens that folder with the note alone in it, rather than the note's own
   * folder with whatever tabs the vault had.
   */
  vault?: string;
  /** A note opened on its own, from outside any open vault: its window shows the editor alone. */
  single?: boolean;
}

export type OpenPlan =
  /**
   * Switch to this folder, with this note in front where there is one - and
   * as the only tab, with the vault's own tabs left alone, where `alone` says.
   * `single` makes it a window for the note on its own, with the editor and
   * nothing else.
   */
  | { folder: string; focus?: string; alone?: boolean; single?: boolean }
  /** A note from outside the open vault: it gets a window of its own. */
  | { window: string }
  /** The note is in the vault that is open: just bring it up. */
  | { select: string };

/**
 * What to do about `target`, given the vault that is open (or none).
 *
 * A folder is the vault. A note in the open vault is brought up. A note from
 * anywhere else is a note on its own - a file opened from Finder, or with
 * `nuza <file>` - and gets a window with the editor and nothing else, rather
 * than taking the open vault's place: a new window when one is open, this one
 * when nothing is. The app only reads inside a window's folder, so the note's
 * folder comes with it. Asking for the folder that is already open does
 * nothing, rather than putting away the tabs that are.
 */
export function planOpen(target: OpenTarget, rootPath: string | null): OpenPlan | null {
  if (target.kind === "folder") return target.path === rootPath ? null : { folder: target.path };

  if (rootPath && isWithin(target.path, rootPath)) return { select: target.path };
  if (target.vault) return { folder: target.vault, focus: target.path, alone: true };
  if (rootPath && !target.single) return { window: target.path };
  return { folder: directoryOf(target.path), focus: target.path, alone: true, single: true };
}
