import { Text } from "@codemirror/state";

/** What the footer knows about the open document. */
export interface DocumentStats {
  words: number;
  characters: number;
  paragraphs: number;
  /** Caret position, 1-based, the way an editor reports it. */
  line: number;
  column: number;
}

export const EMPTY_DOCUMENT_STATS: DocumentStats = {
  words: 0,
  characters: 0,
  paragraphs: 0,
  line: 1,
  column: 1,
};

/** Words per minute for the reading estimate - the usual figure for prose. */
const READING_SPEED = 200;

export function readingMinutes(words: number) {
  return words === 0 ? 0 : Math.max(1, Math.round(words / READING_SPEED));
}

function isSpace(code: number) {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12 || code === 11;
}

/**
 * Words and paragraphs in the document.
 *
 * Walks the text in the chunks CodeMirror already holds rather than joining it
 * into one string first, which on a long document would cost more than the
 * counting does. Still proportional to the document's length, so callers run it
 * when typing has stopped rather than on the keystroke itself.
 */
export function countDocument(doc: Text) {
  let words = 0;
  let paragraphs = 0;
  let inWord = false;
  let lineHasContent = false;
  let afterBlankLine = true;

  const iter = doc.iter();
  while (!iter.next().done) {
    if (iter.lineBreak) {
      if (!lineHasContent) afterBlankLine = true;
      lineHasContent = false;
      inWord = false;
      continue;
    }

    const chunk = iter.value;
    for (let i = 0; i < chunk.length; i++) {
      if (isSpace(chunk.charCodeAt(i))) {
        inWord = false;
        continue;
      }

      lineHasContent = true;
      if (afterBlankLine) {
        paragraphs++;
        afterBlankLine = false;
      }
      if (!inWord) {
        inWord = true;
        words++;
      }
    }
  }

  return { words, paragraphs, characters: doc.length };
}
