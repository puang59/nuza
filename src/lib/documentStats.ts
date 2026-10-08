import { ChangeSet, Text } from "@codemirror/state";
import { frontmatterRange } from "./markdown/frontmatter";

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

/**
 * Scripts written without spaces between words, where each character counts:
 * kana, and the Han ideographs Chinese and Japanese share. Korean is left out
 * on purpose - it puts spaces between its words, and is counted by them.
 */
const UNSPACED = /[\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * Words in a piece of text.
 *
 * Whitespace splits tokens; inside a token every kana or Han character counts as
 * its own word, and the rest counts as one word when it carries a letter or a
 * digit - so `---`, `**` and `|` contribute nothing while `don't` stays one.
 */
export function countWordsIn(text: string): number {
  let words = 0;
  for (const token of text.split(/\s+/)) {
    if (!token) continue;
    let cjk = 0;
    let rest = "";
    for (const ch of token) {
      if (UNSPACED.test(ch)) cjk++;
      else rest += ch;
    }
    words += cjk;
    if (HAS_LETTER_OR_DIGIT.test(rest)) words++;
  }
  return words;
}

/**
 * The line with markdown structure taken out: link and image targets,
 * task markers, bare URLs, table pipes and the punctuation shells around
 * what is left. What remains is what should be read as words.
 */
function stripMarkup(line: string): string {
  let s = line;
  if (/^\s*(```|~~~)/.test(s)) return "";
  s = s.replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, "");
  s = s.replace(/^\s*\d+[.)]\s+/, "");
  // A footnote's text is prose; a link reference definition is only a target.
  s = s.replace(/^\s*\[\^[^\]\n]+\]:\s*/, "");
  if (/^\s*\[[^\]\n]+]:\s+\S+/.test(s)) return "";
  s = s.replace(/!?\[([^\]]*)\]\([^)\n]*\)/g, "$1");
  s = s.replace(/!?\[([^\]]*)\]\[[^\]\n]*\]/g, "$1");
  s = s.replace(/\b(?:https?:\/\/|www\.)\S+/g, " ");
  s = s.replace(/\|/g, " ");
  return s;
}

/** Words a line contributes: nothing for frontmatter or markup-only lines. */
function lineWords(text: string, lineNumber: number, frontmatterEnd: number): number {
  if (lineNumber <= frontmatterEnd) return 0;
  return countWordsIn(stripMarkup(text));
}

/**
 * The last line of the properties block, or 0 when there is none - by the
 * same reading the editor draws it with, so what is counted as prose is what
 * is shown as prose.
 */
function frontmatterEnd(doc: Text): number {
  return frontmatterRange(doc)?.closingLine ?? 0;
}

/**
 * Words and paragraphs in the document.
 *
 * Walks lines as CodeMirror holds them. Frontmatter and lines that are only
 * markup - rules, fences, table delimiter rows, reference definitions - carry
 * no words and do not hold a paragraph open, so the count reads like the prose
 * does. Still proportional to the document's length, so callers run it when
 * typing has stopped rather than on the keystroke itself.
 */
export function countDocument(doc: Text) {
  const frontmatter = frontmatterEnd(doc);
  let words = 0;
  let paragraphs = 0;
  let previousContent = false;

  for (let n = 1; n <= doc.lines; n++) {
    const line = lineWords(doc.line(n).text, n, frontmatter);
    words += line;
    if (line > 0) {
      if (!previousContent) paragraphs++;
      previousContent = true;
    } else {
      previousContent = false;
    }
  }

  return { words, paragraphs, characters: doc.length };
}

/** Words and characters in the selected text, shown in place of the document's. */
export function countSelection(text: string): { words: number; characters: number } {
  let words = 0;
  for (const line of text.split("\n")) words += countWordsIn(stripMarkup(line));
  return { words, characters: text.length };
}

/** Words and paragraphs, the part of the count that edits can change. */
export interface WordTally {
  words: number;
  paragraphs: number;
}

/** Past this many lines touched by one edit, counting afresh is no dearer. */
const RECOUNT_LIMIT = 5000;

/**
 * What lines `first` to `last` add to the count. A word never runs across a
 * line, and a paragraph starts at the first line carrying words after one
 * that does not - so each line's share depends on nothing but itself and the
 * line above, with frontmatter read from the same document.
 */
function tallyLines(doc: Text, first: number, last: number): WordTally {
  const frontmatter = frontmatterEnd(doc);
  let words = 0;
  let paragraphs = 0;
  let previousContent = false;

  if (first > 1) {
    previousContent = lineWords(doc.line(first - 1).text, first - 1, frontmatter) > 0;
  }

  for (let number = first; number <= last; number++) {
    const line = lineWords(doc.line(number).text, number, frontmatter);
    words += line;
    if (line > 0) {
      if (!previousContent) paragraphs++;
      previousContent = true;
    } else {
      previousContent = false;
    }
  }

  return { words, paragraphs };
}

/**
 * The count of `after`, from the count of `before` and the edit between them.
 *
 * Only the lines the edit touched are counted again, along with the line after
 * them, whose paragraph can start or stop with a word appearing above it -
 * that line is the same text either side of the edit. Everything else is
 * carried over. An edit touching thousands of lines is counted afresh.
 */
export function recount(before: Text, after: Text, changes: ChangeSet, tally: WordTally): WordTally {
  let fromA = Infinity;
  let toA = -1;
  let fromB = Infinity;
  let toB = -1;
  changes.iterChangedRanges((changeFromA, changeToA, changeFromB, changeToB) => {
    fromA = Math.min(fromA, changeFromA);
    toA = Math.max(toA, changeToA);
    fromB = Math.min(fromB, changeFromB);
    toB = Math.max(toB, changeToB);
  });
  if (toA < 0) return tally;

  // Closing a properties block, or breaking one open, changes what the lines
  // inside it count for - lines the edit itself never touched - so an edit
  // that moves where the block ends is counted afresh. One that stays inside
  // a block it leaves standing changes nothing: none of it is prose.
  const frontA = frontmatterEnd(before);
  const frontB = frontmatterEnd(after);
  const afresh = () => {
    const { words, paragraphs } = countDocument(after);
    return { words, paragraphs };
  };
  if (frontA !== frontB) return afresh();
  if (frontA > 0 && before.lineAt(fromA).number <= frontA) {
    const inside = before.lineAt(toA).number <= frontA && after.lineAt(toB).number <= frontB;
    return inside ? tally : afresh();
  }

  const firstA = before.lineAt(fromA).number;
  const lastA = Math.min(before.lineAt(toA).number + 1, before.lines);
  const firstB = after.lineAt(fromB).number;
  const lastB = Math.min(after.lineAt(toB).number + 1, after.lines);

  if (lastA - firstA + (lastB - firstB) > RECOUNT_LIMIT) return afresh();

  const removed = tallyLines(before, firstA, lastA);
  const added = tallyLines(after, firstB, lastB);
  return {
    words: tally.words - removed.words + added.words,
    paragraphs: tally.paragraphs - removed.paragraphs + added.paragraphs,
  };
}
