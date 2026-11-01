import { describe, expect, test } from "bun:test";
import { insertNewlineAndIndent } from "@codemirror/commands";
import { insertNewlineContinueMarkupCommand, markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { GFM } from "@lezer/markdown";
import { htmlKeepsIndentation } from "../src/lib/markdown/htmlIndent";
import { insertNewLine } from "../src/lib/markdown/lists";

const enter = insertNewLine(insertNewlineContinueMarkupCommand({ nonTightLists: false }));

/**
 * Presses enter in `marked`, where `|` is the caret, and returns the note with
 * the caret marked the same way. What the markdown command passes on goes to
 * the plain newline, as it does in the editor's keymap.
 */
function pressEnter(marked: string, extensions: Extension = []) {
  const caret = marked.indexOf("|");
  let state = EditorState.create({
    doc: marked.replace("|", ""),
    selection: EditorSelection.cursor(caret),
    extensions: [markdown({ extensions: [GFM] }), extensions],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  const view = {
    get state() {
      return state;
    },
    dispatch: (transaction: { state: EditorState }) => (state = transaction.state),
  } as unknown as EditorView;

  if (!enter(view)) insertNewlineAndIndent(view);
  const head = state.selection.main.head;
  const text = state.doc.toString();
  return `${text.slice(0, head)}|${text.slice(head)}`;
}

describe("enter at the end of a list", () => {
  test("leaves a blank line, so the next sentence is not part of the last point", () => {
    expect(pressEnter("- one\n- two\n- |")).toBe("- one\n- two\n\n|");
  });

  test("does the same for a numbered list and a task list", () => {
    expect(pressEnter("1. one\n2. |")).toBe("1. one\n\n|");
    expect(pressEnter("- [ ] one\n- [ ] |")).toBe("- [ ] one\n\n|");
  });

  test("a lone empty point just loses its marker", () => {
    expect(pressEnter("- |")).toBe("|");
  });

  test("an empty nested point steps out a level rather than leaving the list", () => {
    expect(pressEnter("- one\n  - two\n  - |")).toBe("- one\n  - two\n- |");
  });
});

describe("enter under a list", () => {
  test("a sentence written straight under a list carries on as prose", () => {
    expect(pressEnter("- item\ntext|")).toBe("- item\ntext\n|");
  });

  test("a line carried on inside a point still starts the next point", () => {
    expect(pressEnter("- item\n  more|")).toBe("- item\n  more\n- |");
  });
});

describe("enter in a quote", () => {
  test("carries the quote on", () => {
    expect(pressEnter("> quoted|")).toBe("> quoted\n> |");
  });

  test("on an empty quote line, leaves the quote with a blank line behind", () => {
    expect(pressEnter("> quoted\n> |")).toBe("> quoted\n\n|");
  });
});

describe("enter in HTML", () => {
  test("does not indent the line after an opening tag", () => {
    expect(pressEnter("<div>|", htmlKeepsIndentation)).toBe("<div>\n|");
    expect(pressEnter("<div>|</div>", htmlKeepsIndentation)).toBe("<div>\n|\n</div>");
  });

  test("keeps the indentation the line was typed with", () => {
    expect(pressEnter("<div>\n  <p>hi</p>|", htmlKeepsIndentation)).toBe("<div>\n  <p>hi</p>\n  |");
  });
});
