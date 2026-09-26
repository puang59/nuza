import { describe, expect, test } from "bun:test";
import { Text } from "@codemirror/state";
import { countDocument, readingMinutes } from "../src/lib/documentStats";

const count = (text: string) => countDocument(Text.of(text.split("\n")));

describe("countDocument", () => {
  test("an empty document has nothing in it", () => {
    expect(count("")).toEqual({ words: 0, paragraphs: 0, characters: 0 });
  });

  test("counts words across runs of whitespace", () => {
    expect(count("one two   three\tfour").words).toBe(4);
  });

  test("a blank line starts a new paragraph", () => {
    expect(count("one two\n\nthree four").paragraphs).toBe(2);
    expect(count("one two\nstill the same one").paragraphs).toBe(1);
  });

  test("leading and trailing blank lines do not invent paragraphs", () => {
    expect(count("\n\nonly one\n\n").paragraphs).toBe(1);
  });

  test("characters is the document length, newlines included", () => {
    expect(count("ab\ncd").characters).toBe(5);
  });
});

describe("readingMinutes", () => {
  test("nothing to read takes no time", () => {
    expect(readingMinutes(0)).toBe(0);
  });

  test("anything at all rounds up to a minute", () => {
    expect(readingMinutes(1)).toBe(1);
  });

  test("scales at roughly 200 words a minute", () => {
    expect(readingMinutes(400)).toBe(2);
  });
});
