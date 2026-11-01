/**
 * What a new note opens with: a heading, waiting for the note's title. Left
 * untouched it is not worth keeping, and is written to disk as nothing - so a
 * note made and then thought better of is still an empty file.
 */
export const TITLE_PROMPT = "# ";

/** `content` as it should be written: empty, if it is only the untouched prompt. */
export function withoutUntouchedPrompt(content: string): string {
  return content.trim() === "#" ? "" : content;
}
