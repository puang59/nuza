import { indentService, syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";

/** The blocks of a note that are HTML, written into the prose rather than fenced off as code. */
const HTML_BLOCKS = new Set(["HTMLBlock", "CommentBlock", "ProcessingInstructionBlock"]);

/**
 * HTML in a note keeps the indentation it was typed with. Markdown hands an
 * HTML block to the HTML grammar, which indents like a code editor - a new
 * line after `<div>` came in two spaces, and a closing tag was pulled back
 * out - in what is still a note. Returning null leaves enter to carry the
 * line's own indentation on, and stops typing from re-indenting the line.
 *
 * Fenced code is not touched: there, the language's indentation is the point.
 */
export const htmlKeepsIndentation = indentService.of((context, pos) => {
  for (let node: SyntaxNode | null = syntaxTree(context.state).resolve(pos, -1); node; node = node.parent) {
    if (HTML_BLOCKS.has(node.name)) return null;
  }
  return undefined;
});
