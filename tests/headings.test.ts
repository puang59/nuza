import { describe, expect, test } from "bun:test";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import type { EditorView } from "@codemirror/view";
import { findHeading, headingSlug, jumpToHeading, readHeadings } from "../src/lib/markdown/headings";

function headings(doc: string) {
  return readHeadings(EditorState.create({ doc, extensions: [markdown({ extensions: GFM })] }));
}

describe("readHeadings", () => {
  test("reads each level, in order, with where its line starts", () => {
    const doc = "# One\n\ntext\n\n## Two\n### Three ###\n";
    expect(headings(doc)).toEqual([
      { level: 1, text: "One", from: 0 },
      { level: 2, text: "Two", from: doc.indexOf("## Two") },
      { level: 3, text: "Three", from: doc.indexOf("### Three") },
    ]);
  });

  test("reads underlined headings", () => {
    expect(headings("Title\n=====\n\nSub\n---\n").map((h) => [h.level, h.text])).toEqual([
      [1, "Title"],
      [2, "Sub"],
    ]);
  });

  test("reads a heading as it is shown, without its markup", () => {
    expect(headings("## A **bold** [link](https://x.y) and [[note|alias]] `code`\n")[0].text).toBe(
      "A bold link and alias code"
    );
  });

  test("leaves out what only looks like a heading", () => {
    expect(headings("```\n# not a heading\n```\n\n#nospace\n")).toEqual([]);
  });
});

describe("headingSlug", () => {
  test("lower-cases, drops punctuation and hyphenates", () => {
    expect(headingSlug("My Heading, Part 2!")).toBe("my-heading-part-2");
  });

  test("keeps letters of any script", () => {
    expect(headingSlug("Überblick  über")).toBe("überblick-über");
  });
});

describe("findHeading", () => {
  const found = headings("# Intro\n\n## Setup Steps\n\n## Setup Steps\n");

  test("finds a heading by its text, ignoring case and spacing", () => {
    expect(findHeading(found, "  setup   STEPS ")?.level).toBe(2);
  });

  test("finds a heading by its anchor", () => {
    expect(findHeading(found, "setup-steps")?.text).toBe("Setup Steps");
  });

  test("takes the first where several match", () => {
    expect(findHeading(found, "Setup Steps")).toBe(found[1]);
  });

  test("finds nothing for a heading that is not there, or an empty one", () => {
    expect(findHeading(found, "Missing")).toBeNull();
    expect(findHeading(found, "  ")).toBeNull();
  });
});

describe("jumpToHeading", () => {
  /** As much of an editor as a jump needs: a state, and somewhere to send the move. */
  function editor(doc: string) {
    const state = EditorState.create({ doc, extensions: [markdown({ extensions: GFM })] });
    const sent: { selection?: { anchor: number } }[] = [];
    const view = {
      state,
      dispatch: (spec: { selection?: { anchor: number } }) => void sent.push(spec),
      focus: () => {},
      dom: { isConnected: false },
    };
    return { view: view as unknown as EditorView, sent };
  }

  // Left where the link was, the caret pulled the note straight back there
  // on the next key press.
  test("takes the caret to the heading as well as the view", () => {
    const doc = "[[#Second]]\n\n# First\n\ntext\n\n## Second\n\nmore";
    const { view, sent } = editor(doc);

    expect(jumpToHeading(view, "second")).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].selection).toEqual({ anchor: doc.indexOf("## Second") + "## Second".length });
  });

  test("moves nothing for a heading that is not there", () => {
    const { view, sent } = editor("# First\n");
    expect(jumpToHeading(view, "missing")).toBe(false);
    expect(sent).toHaveLength(0);
  });
});
