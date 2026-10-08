import { describe, expect, test } from "bun:test";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import { codeBlockAt, codeScroll, maxScroll, setCodeScroll } from "../src/lib/markdown/codeScroll";

const doc = [
  "intro",
  "",
  "```js",
  "const a = 1;",
  "```",
  "",
  "- item",
  "",
  "  ```",
  "  nested",
  "  ```",
  "",
  "end",
].join("\n");

function editor(text = doc) {
  const state = EditorState.create({ doc: text, extensions: [markdown({ extensions: GFM }), codeScroll] });
  ensureSyntaxTree(state, text.length, 1000);
  return state;
}

describe("codeBlockAt", () => {
  test("finds the block a place is in, at the top level of the note", () => {
    const state = editor();
    const block = codeBlockAt(state, doc.indexOf("const a"))!;
    expect(block.from).toBe(doc.indexOf("```js"));
    expect(codeBlockAt(state, 0)).toBeNull();
  });

  // Its lines are already set in by the list, and go on wrapping.
  test("leaves a block inside a list item alone", () => {
    expect(codeBlockAt(editor(), doc.indexOf("nested"))).toBeNull();
  });
});

describe("the scroll of a block", () => {
  const block = doc.indexOf("```js");

  test("is kept by where the block starts, and zero puts it back", () => {
    let state = editor().update({ effects: setCodeScroll.of({ block, offset: 120.4 }) }).state;
    expect(state.field(codeScroll).get(block)).toBe(120);

    state = state.update({ effects: setCodeScroll.of({ block, offset: 0 }) }).state;
    expect(state.field(codeScroll).size).toBe(0);
  });

  test("follows its block when text is added above it", () => {
    let state = editor().update({ effects: setCodeScroll.of({ block, offset: 80 }) }).state;
    state = state.update({ changes: { from: 0, insert: "more\n" } }).state;
    ensureSyntaxTree(state, state.doc.length, 1000);
    expect(state.field(codeScroll).get(block + 5)).toBe(80);
    expect(state.field(codeScroll).size).toBe(1);
  });

  test("goes when the block does", () => {
    let state = editor().update({ effects: setCodeScroll.of({ block, offset: 80 }) }).state;
    state = state.update({ changes: { from: block, to: block + 3, insert: "" } }).state;
    expect(state.field(codeScroll).size).toBe(0);
  });
});

describe("maxScroll", () => {
  test("is how far the longest line runs past the edge", () => {
    const lines = [
      { scrollWidth: 300, clientWidth: 300 },
      { scrollWidth: 520, clientWidth: 300 },
    ];
    expect(maxScroll(lines, 0)).toBe(220);
  });

  // A line pulled left reports that much less overflow.
  test("is the same however far the block is already scrolled", () => {
    expect(maxScroll([{ scrollWidth: 420, clientWidth: 300 }], 100)).toBe(220);
  });

  test("is nothing for a block that fits", () => {
    expect(maxScroll([{ scrollWidth: 300, clientWidth: 300 }], 0)).toBe(0);
    expect(maxScroll([], 0)).toBe(0);
  });
});
