import { StateEffect, Text } from "@codemirror/state";

/**
 * The files of the open vault, for finding the one an embed names.
 *
 * An embed is written by name - `![[photo.png]]` - and which file that is
 * depends on what else is in the vault, which the editor's own state knows
 * nothing about. It is kept here, for the window, rather than in every
 * document's state: there is one vault to a window, and the list can be tens
 * of thousands of paths long.
 */
let vault: { root: string; files: readonly string[] } = { root: "", files: [] };

export function setVaultFiles(root: string, files: readonly string[]) {
  vault = { root, files };
}

export function vaultFiles() {
  return vault;
}

/**
 * Tells an editor that the list has changed, or that the note it is showing
 * was drawn against an older one, so its embeds are worked out again.
 */
export const refreshEmbeds = StateEffect.define<null>();

/** Whether a note has any embeds in it at all, without joining it into one string. */
export function hasEmbeds(doc: Text) {
  const lines = doc.iter();
  while (!lines.next().done) {
    if (!lines.lineBreak && lines.value.includes("![[")) return true;
  }
  return false;
}
