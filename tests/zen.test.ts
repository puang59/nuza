import { describe, expect, test } from "bun:test";
import { Text } from "@codemirror/state";
import { paragraphAt } from "../src/lib/markdown/zen";

const doc = Text.of([
  "# Title",
  "",
  "first line",
  "second line",
  "third line",
  "",
  "",
  "- a",
  "- b",
  "",
  "last",
]);
const at = (text: string) => doc.toString().indexOf(text);

describe("paragraphAt", () => {
  test("is the run of lines with something on them around the caret", () => {
    expect(paragraphAt(doc, at("second"))).toEqual({ first: 3, last: 5 });
    expect(paragraphAt(doc, at("first"))).toEqual({ first: 3, last: 5 });
    expect(paragraphAt(doc, at("third") + 5)).toEqual({ first: 3, last: 5 });
  });

  test("a list is one paragraph, and a heading on its own is one too", () => {
    expect(paragraphAt(doc, at("- b"))).toEqual({ first: 8, last: 9 });
    expect(paragraphAt(doc, 0)).toEqual({ first: 1, last: 1 });
  });

  test("a blank line is that line alone", () => {
    expect(paragraphAt(doc, at("third line") + "third line".length + 1)).toEqual({ first: 6, last: 6 });
  });

  test("the first and last lines of the note do not run off its ends", () => {
    expect(paragraphAt(doc, doc.length)).toEqual({ first: 11, last: 11 });
    expect(paragraphAt(doc, 9999)).toEqual({ first: 11, last: 11 });
    expect(paragraphAt(Text.of([""]), 0)).toEqual({ first: 1, last: 1 });
  });
});
