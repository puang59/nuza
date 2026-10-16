import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { Speller, tokens } from "../spelling";
import { frontmatterRange } from "./frontmatter";

/** Syntax nodes whose text is not prose. */
const NOT_PROSE = new Set([
  "FencedCode",
  "CodeBlock",
  "InlineCode",
  "CodeText",
  "CodeInfo",
  "URL",
  "Autolink",
  "LinkLabel",
  "HTMLBlock",
  "HTMLTag",
  "CommentBlock",
  "Comment",
  "ProcessingInstruction",
  "WikiLink",
  "WikiEmbed",
  "Tag",
  "InlineMath",
  "BlockMath",
]);

export interface Misspelling {
  from: number;
  to: number;
}

/**
 * The misspelled words between `from` and `to` of a note, in order. Code,
 * links, wiki-links, tags, maths, HTML and the frontmatter are none of a
 * dictionary's business and are passed over.
 *
 * `leaveAlone` is the caret, while a word is being typed: the word it is in or
 * touching is skipped, and `held` says one was.
 */
export function scanProse(
  state: EditorState,
  speller: Speller,
  from: number,
  to: number,
  leaveAlone: number | null = null
) {
  const found: Misspelling[] = [];
  let held = false;

  const front = frontmatterRange(state.doc);
  const start = Math.max(from, front ? front.to + 1 : 0);
  if (start >= to) return { found, held };

  const tree = syntaxTree(state);

  for (const token of tokens(state.doc.sliceString(start, to), start)) {
    if (leaveAlone !== null && leaveAlone >= token.from && leaveAlone <= token.to) {
      held = true;
      continue;
    }

    let prose = true;
    for (let node: SyntaxNode | null = tree.resolveInner(token.from, 1); node; node = node.parent) {
      if (NOT_PROSE.has(node.name)) {
        prose = false;
        break;
      }
    }
    if (!prose) continue;

    for (const [begin, end] of speller.misspelled(token.text)) {
      found.push({ from: token.from + begin, to: token.from + end });
    }
  }

  return { found, held };
}
