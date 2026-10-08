import { describe, expect, test } from "bun:test";
import { EditorSelection, EditorState, StateCommand } from "@codemirror/state";
import {
  insertLink,
  readPrefix,
  setHeading,
  toggleBlockquote,
  toggleBold,
  toggleBulletList,
  toggleInlineCode,
  toggleItalic,
  toggleNumberedList,
  toggleStrikethrough,
  toggleTaskList,
} from "../src/lib/markdown/formatting";

/**
 * Runs `command` on `doc`, where `[` and `]` mark the selection (or `|` a
 * caret), and returns the result marked the same way.
 */
function run(command: StateCommand, marked: string) {
  const caret = marked.indexOf("|");
  const from = caret >= 0 ? caret : marked.indexOf("[");
  const to = caret >= 0 ? caret : marked.indexOf("]") - 1;
  const doc = marked.replace(/[[\]|]/g, "");

  let state = EditorState.create({ doc, selection: EditorSelection.range(from, to) });
  command({ state, dispatch: (transaction) => (state = transaction.state) });

  const { from: a, to: b } = state.selection.main;
  const text = state.doc.toString();
  return a === b
    ? `${text.slice(0, a)}|${text.slice(a)}`
    : `${text.slice(0, a)}[${text.slice(a, b)}]${text.slice(b)}`;
}

describe("toggleBold", () => {
  test("wraps a selection, keeping the words selected", () => {
    expect(run(toggleBold, "a [word] b")).toBe("a **[word]** b");
  });

  test("unwraps a selection sitting inside the stars", () => {
    expect(run(toggleBold, "a **[word]** b")).toBe("a [word] b");
  });

  test("unwraps a selection that takes the stars in", () => {
    expect(run(toggleBold, "a [**word**] b")).toBe("a [word] b");
  });

  test("puts a pair of stars round the caret, and takes an empty pair away", () => {
    expect(run(toggleBold, "a | b")).toBe("a **|** b");
    expect(run(toggleBold, "a **|** b")).toBe("a | b");
  });

  test("leaves the italic standing in bold italic", () => {
    expect(run(toggleBold, "***[word]***")).toBe("*[word]*");
  });
});

describe("toggleItalic", () => {
  test("wraps and unwraps with one star", () => {
    expect(run(toggleItalic, "[word]")).toBe("*[word]*");
    expect(run(toggleItalic, "*[word]*")).toBe("[word]");
  });

  test("adds a star inside bold rather than stripping one off it", () => {
    expect(run(toggleItalic, "**[word]**")).toBe("***[word]***");
  });

  test("takes the italic out of bold italic, leaving the bold", () => {
    expect(run(toggleItalic, "***[word]***")).toBe("**[word]**");
  });
});

describe("insertLink", () => {
  test("makes selected text the label, with the caret in the target", () => {
    expect(run(insertLink, "see [the docs] now")).toBe("see [the docs](|) now");
  });

  test("makes a selected URL the target, with the caret in the label", () => {
    expect(run(insertLink, "[https://example.com]")).toBe("[|](https://example.com)");
  });

  test("with nothing selected, leaves the caret in an empty label", () => {
    expect(run(insertLink, "a | b")).toBe("a [|]() b");
  });
});

describe("toggleInlineCode and toggleStrikethrough", () => {
  test("wrap a selection and unwrap it again", () => {
    expect(run(toggleInlineCode, "a [word] b")).toBe("a `[word]` b");
    expect(run(toggleInlineCode, "a `[word]` b")).toBe("a [word] b");
    expect(run(toggleStrikethrough, "a [word] b")).toBe("a ~~[word]~~ b");
    expect(run(toggleStrikethrough, "a ~~[word]~~ b")).toBe("a [word] b");
  });

  test("unwrap a selection that takes the markers in", () => {
    expect(run(toggleStrikethrough, "a [~~word~~] b")).toBe("a [word] b");
  });

  test("put a pair round the caret to type into, and take an empty pair away", () => {
    expect(run(toggleInlineCode, "a | b")).toBe("a `|` b");
    expect(run(toggleInlineCode, "a `|` b")).toBe("a | b");
  });
});

describe("readPrefix", () => {
  test("names what a line starts with, and where its text begins", () => {
    expect(readPrefix("plain")).toMatchObject({ kind: "plain", length: 0 });
    expect(readPrefix("## Title")).toMatchObject({ kind: "heading", level: 2, length: 3 });
    expect(readPrefix("  - item")).toMatchObject({ kind: "bullet", indent: "  ", length: 4 });
    expect(readPrefix("- [x] done")).toMatchObject({ kind: "task", length: 6 });
    expect(readPrefix("12. twelfth")).toMatchObject({ kind: "numbered", length: 4 });
    expect(readPrefix("> said")).toMatchObject({ kind: "quote", length: 2 });
    // A hash with no space after it is a tag, not a heading.
    expect(readPrefix("#tag")).toMatchObject({ kind: "plain" });
  });
});

describe("setHeading", () => {
  test("makes the line a heading and leaves the caret in its text", () => {
    expect(run(setHeading(2), "some| words")).toBe("## some| words");
    expect(run(setHeading(1), "|words")).toBe("# |words");
  });

  test("changes the level, and the same level again takes it off", () => {
    expect(run(setHeading(3), "# Ti|tle")).toBe("### Ti|tle");
    expect(run(setHeading(3), "### Ti|tle")).toBe("Ti|tle");
  });

  test("level 0 takes any heading off", () => {
    expect(run(setHeading(0), "#### Ti|tle")).toBe("Ti|tle");
    expect(run(setHeading(0), "pl|ain")).toBe("pl|ain");
  });

  test("replaces a list marker rather than stacking on it", () => {
    expect(run(setHeading(2), "- an |item")).toBe("## an |item");
  });
});

describe("list toggles", () => {
  test("turn a line into a bullet and back", () => {
    expect(run(toggleBulletList, "an |item")).toBe("- an |item");
    expect(run(toggleBulletList, "- an |item")).toBe("an |item");
  });

  test("put a marker on the empty line the caret is on", () => {
    expect(run(toggleBulletList, "|")).toBe("- |");
    expect(run(toggleTaskList, "|")).toBe("- [ ] |");
  });

  test("number the selected lines in order, skipping the blank ones", () => {
    expect(run(toggleNumberedList, "[one\n\ntwo\nthree]")).toBe("1. [one\n\n2. two\n3. three]");
  });

  test("swap one kind of list for another instead of stacking markers", () => {
    expect(run(toggleNumberedList, "[- one\n- two]")).toBe("[1. one\n2. two]");
    expect(run(toggleTaskList, "1. on|e")).toBe("- [ ] on|e");

    // A task's brackets are also how `run` marks a selection, so this one is
    // set up by hand.
    let state = EditorState.create({ doc: "- [x] done", selection: EditorSelection.cursor(8) });
    toggleBulletList({ state, dispatch: (transaction) => (state = transaction.state) });
    expect(state.doc.toString()).toBe("- done");
    expect(state.selection.main.head).toBe(4);
  });

  test("keep a nested line's indentation", () => {
    expect(run(toggleTaskList, "  - nes|ted")).toBe("  - [ ] nes|ted");
    expect(run(toggleBulletList, "  - nes|ted")).toBe("  nes|ted");
  });

  test("only take the list off when every line is that kind", () => {
    expect(run(toggleBulletList, "[- one\ntwo]")).toBe("[- one\n- two]");
  });
});

describe("toggleBlockquote", () => {
  test("quotes every selected line, blank ones too, and unquotes them", () => {
    expect(run(toggleBlockquote, "[one\n\ntwo]")).toBe("> [one\n> \n> two]");
    expect(run(toggleBlockquote, "[> one\n>\n> two]")).toBe("[one\n\ntwo]");
  });

  test("goes in front of a list marker rather than replacing it", () => {
    expect(run(toggleBlockquote, "- it|em")).toBe("> - it|em");
  });
});
