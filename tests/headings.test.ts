import { describe, expect, test } from "bun:test";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import type { EditorView } from "@codemirror/view";
import {
  adjacentHeading,
  findHeading,
  headingSlug,
  jumpToHeading,
  nextHeading,
  previousHeading,
  readHeadings,
  sectionAt,
} from "../src/lib/markdown/headings";

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

describe("moving by heading", () => {
  const doc = "intro\n\n# One\n\ntext\n\n## Two\n\n```\n# not a heading\n```\n\n# Three\n\nend";
  const all = headings(doc);
  const at = (text: string) => doc.indexOf(text);

  test("reads the headings and not the hash inside a code fence", () => {
    expect(all.map((heading) => heading.text)).toEqual(["One", "Two", "Three"]);
  });

  test("sectionAt names the heading a place falls under", () => {
    expect(sectionAt(all, 0)).toBe(-1);
    expect(sectionAt(all, at("# One"))).toBe(0);
    expect(sectionAt(all, at("text"))).toBe(0);
    expect(sectionAt(all, at("# not a heading"))).toBe(1);
    expect(sectionAt(all, doc.length)).toBe(2);
    expect(sectionAt([], 10)).toBe(-1);
  });

  test("adjacentHeading steps to the next one down and the nearest one up", () => {
    expect(adjacentHeading(all, 0, 1)?.text).toBe("One");
    expect(adjacentHeading(all, at("# One"), 1)?.text).toBe("Two");
    expect(adjacentHeading(all, at("text"), -1)?.text).toBe("One");
    // From a heading's own line, "previous" is the one before it.
    expect(adjacentHeading(all, at("## Two"), -1)?.text).toBe("One");
    expect(adjacentHeading(all, at("# Three"), 1)).toBeNull();
    expect(adjacentHeading(all, 0, -1)).toBeNull();
  });

  /** An editor with its caret at `anchor`, recording where it is sent. */
  function editorAt(anchor: number) {
    const state = EditorState.create({
      doc,
      selection: { anchor },
      extensions: [markdown({ extensions: GFM })],
    });
    const sent: { selection?: { anchor: number } }[] = [];
    const view = {
      state,
      dispatch: (spec: { selection?: { anchor: number } }) => void sent.push(spec),
      focus: () => {},
      dom: { isConnected: false },
    };
    return { view: view as unknown as EditorView, sent };
  }

  test("the commands put the caret at the end of the heading they move to", () => {
    const down = editorAt(at("text"));
    expect(nextHeading(down.view)).toBe(true);
    expect(down.sent[0].selection).toEqual({ anchor: at("## Two") + "## Two".length });

    const up = editorAt(at("end"));
    expect(previousHeading(up.view)).toBe(true);
    expect(up.sent[0].selection).toEqual({ anchor: at("# Three") + "# Three".length });
  });

  test("the commands do nothing past the last heading or above the first", () => {
    const last = editorAt(at("end"));
    expect(nextHeading(last.view)).toBe(false);
    expect(last.sent).toHaveLength(0);

    const first = editorAt(0);
    expect(previousHeading(first.view)).toBe(false);
    expect(first.sent).toHaveLength(0);
  });
});
