import { describe, expect, test } from "bun:test";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, foldEffect, foldedRanges } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import { foldedAt, sectionFolding, sectionOf } from "../src/lib/markdown/folding";

const doc = ["# One", "", "text", "", "## Sub", "", "more", "", "# Two", "", "end", "", "# Empty"].join("\n");

function editor() {
  const state = EditorState.create({ doc, extensions: [markdown({ extensions: GFM }), sectionFolding] });
  ensureSyntaxTree(state, doc.length, 1000);
  return state;
}

describe("sections", () => {
  test("a heading's section runs to the next heading of its level or higher", () => {
    const state = editor();
    const one = sectionOf(state, 0)!;
    expect(state.sliceDoc(one.from, one.to)).toBe("\n\ntext\n\n## Sub\n\nmore");

    const sub = sectionOf(state, doc.indexOf("## Sub"))!;
    expect(state.sliceDoc(sub.from, sub.to)).toBe("\n\nmore");
  });

  test("a heading with nothing under it, and a line that is not a heading, have none", () => {
    const state = editor();
    expect(sectionOf(state, doc.indexOf("# Empty"))).toBeNull();
    expect(sectionOf(state, doc.indexOf("text"))).toBeNull();
  });

  test("a folded section is found again from its heading", () => {
    const state = editor();
    const section = sectionOf(state, doc.indexOf("# Two"))!;
    const folded = state.update({ effects: foldEffect.of(section) }).state;

    expect(foldedAt(folded, doc.indexOf("# Two"))).toEqual(section);
    expect(foldedAt(folded, 0)).toBeNull();
    expect(foldedRanges(folded).size).toBe(1);
  });
});
