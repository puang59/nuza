import { describe, expect, test } from "bun:test";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { followsCaret, typewriterScrolling } from "../src/lib/markdown/scrolling";

const state = () => EditorState.create({ doc: "one\ntwo\nthree", extensions: [typewriterScrolling] });
// The effect a scroll request is made of, to pick it out of a transaction's.
const scrollEffect = EditorView.scrollIntoView(0).type;
const scrolls = (transaction: { effects: readonly { is(type: unknown): boolean }[] }) =>
  transaction.effects.filter((effect) => effect.is(scrollEffect)).length;

describe("typewriter scrolling", () => {
  test("follows typing and the caret moved from the keyboard", () => {
    const typed = state().update({ changes: { from: 3, insert: "!" }, userEvent: "input.type" });
    expect(followsCaret(typed)).toBe(true);
    expect(scrolls(typed)).toBe(1);

    const moved = state().update({ selection: EditorSelection.cursor(8), userEvent: "select" });
    expect(scrolls(moved)).toBe(1);
  });

  // The place clicked is already where the eye is.
  test("leaves a click or a drag where it is", () => {
    const clicked = state().update({ selection: EditorSelection.cursor(8), userEvent: "select.pointer" });
    expect(followsCaret(clicked)).toBe(false);
    expect(scrolls(clicked)).toBe(0);
  });

  test("leaves alone what is not the caret moving, or not the user\u2019s doing", () => {
    expect(scrolls(state().update({}))).toBe(0);
    // A change made by the app itself: a checkbox ticked, a table cell written.
    expect(scrolls(state().update({ changes: { from: 0, insert: "x" } }))).toBe(0);
  });
});
