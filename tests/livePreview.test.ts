import { describe, expect, test } from "bun:test";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { Compartment, EditorSelection, EditorState, RangeSet, TransactionSpec } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import { liveMarkdownPreview } from "../src/lib/markdown/livePreview";

const preview = new Compartment();

/**
 * A state with the whole document parsed, as the editor has it once it has
 * settled. The preview is only switched on after the parse, so its first build
 * is made from the complete tree rather than whatever the parser got through.
 */
function create(doc: string, cursor = 0) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: GFM }), preview.of([])],
    selection: EditorSelection.cursor(cursor),
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state.update({ effects: preview.reconfigure(liveMarkdownPreview) }).state;
}

/** Applies each edit in turn, the way typing does, keeping the tree complete. */
function edit(state: EditorState, specs: TransactionSpec[]) {
  for (const spec of specs) {
    state = state.update(spec).state;
    ensureSyntaxTree(state, state.doc.length, 5000);
  }
  return state;
}

/** Whether the incrementally kept decorations are the ones a fresh build makes. */
function matchesFreshBuild(state: EditorState) {
  const fresh = create(state.doc.toString(), state.selection.main.head);
  return RangeSet.eq([state.field(liveMarkdownPreview)], [fresh.field(liveMarkdownPreview)]);
}

const longList = Array.from({ length: 1200 }, (_, i) => `- item **${i}** with a [link](https://x.y)`).join(
  "\n"
);
const longQuote = Array.from({ length: 1200 }, (_, i) => `> line *${i}*`).join("\n");

describe("liveMarkdownPreview in a long block", () => {
  test("typing in the middle of a long list", () => {
    const start = create(longList);
    const at = start.doc.line(600).to;
    const state = edit(start, [
      { changes: { from: at, insert: " more" }, selection: { anchor: at + 5 } },
      { changes: { from: at + 5, insert: " *em*" }, selection: { anchor: at + 10 } },
    ]);
    expect(matchesFreshBuild(state)).toBe(true);
  });

  test("moving the caret through a long list", () => {
    const start = create(longList);
    const state = edit(start, [
      { selection: { anchor: start.doc.line(10).from + 4 } },
      { selection: { anchor: start.doc.line(900).from + 4 } },
    ]);
    expect(matchesFreshBuild(state)).toBe(true);
  });

  test("indenting an item into the one above", () => {
    const start = create(longList);
    const at = start.doc.line(700).from;
    const state = edit(start, [{ changes: { from: at, insert: "  " } }]);
    expect(matchesFreshBuild(state)).toBe(true);
  });

  test("splitting a long list with a paragraph", () => {
    const start = create(longList);
    const at = start.doc.line(500).to;
    const state = edit(start, [{ changes: { from: at, insert: "\n\nplain text\n" } }]);
    expect(matchesFreshBuild(state)).toBe(true);
  });

  test("turning a bullet list into an ordered one partway", () => {
    const start = create(longList);
    const at = start.doc.line(300).from;
    const state = edit(start, [{ changes: { from: at, to: at + 1, insert: "1." } }]);
    expect(matchesFreshBuild(state)).toBe(true);
  });

  test("typing in and ending a long quote", () => {
    const start = create(longQuote);
    const mid = start.doc.line(600).to;
    const typed = edit(start, [{ changes: { from: mid, insert: " word" }, selection: { anchor: mid + 5 } }]);
    expect(matchesFreshBuild(typed)).toBe(true);

    const line = typed.doc.line(800);
    const ended = edit(typed, [{ changes: { from: line.from, to: line.from + 2 } }]);
    expect(matchesFreshBuild(ended)).toBe(true);
  });

  test("opening a fence above a long list", () => {
    const start = create(`para\n\n${longList}`);
    const state = edit(start, [{ changes: { from: 0, insert: "```\n" } }]);
    expect(matchesFreshBuild(state)).toBe(true);
  });
});

describe("liveMarkdownPreview under random edits", () => {
  /** A small, seeded generator, so a failure replays the same way. */
  function random(seed: number) {
    return () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
  }

  const outline = Array.from({ length: 900 }, (_, i) => {
    const depth = "  ".repeat(i % 3);
    // Kept to one quote and nested ordered runs, so the list either side
    // stays longer than the line budget and the partial rebuild is exercised.
    if (i === 450) return `> quoted - [ ] task ${i}`;
    if (i % 41 === 0 && i % 3 !== 0) return `${depth}1. ordered **${i}**`;
    return `${depth}- item \`${i}\` and *em*`;
  }).join("\n");

  for (const seed of [1, 2, 3, 4, 5]) {
    test(`seed ${seed} stays in step with a fresh build`, () => {
      const next = random(seed);
      const pieces = ["- ", "> ", "  ", "\n", "\n\n", "*", "`", "x", "1. ", "```\n", "[ ] "];
      let state = create(outline);

      for (let step = 0; step < 40; step++) {
        const length = state.doc.length;
        const at = Math.floor(next() * length);
        const roll = next();
        let spec: TransactionSpec;
        if (roll < 0.5) {
          const insert = pieces[Math.floor(next() * pieces.length)];
          spec = { changes: { from: at, insert }, selection: { anchor: at + insert.length } };
        } else if (roll < 0.8) {
          const to = Math.min(length, at + 1 + Math.floor(next() * 6));
          spec = { changes: { from: at, to }, selection: { anchor: at } };
        } else {
          spec = { selection: { anchor: at } };
        }

        state = edit(state, [spec]);
        expect(matchesFreshBuild(state)).toBe(true);
      }
    });
  }
});

describe("links typed into the text", () => {
  /** The `data-href` of every link the preview marks in `doc`, in order. */
  function hrefs(doc: string) {
    const found: string[] = [];
    const cursor = create(doc, doc.length).field(liveMarkdownPreview).iter();
    for (; cursor.value; cursor.next()) {
      const href = (cursor.value.spec as { attributes?: Record<string, string> }).attributes?.["data-href"];
      if (href) found.push(href);
    }
    return found;
  }

  test("a bare address, with or without a scheme, can be opened", () => {
    expect(hrefs("see www.preetham.top\n\nand https://example.com/a?b=1\n\nend")).toEqual([
      "https://www.preetham.top",
      "https://example.com/a?b=1",
    ]);
  });

  test("an email address opens the mail app", () => {
    expect(hrefs("Contact\n\ncontact@preetham.top\n\nend")).toEqual(["mailto:contact@preetham.top"]);
  });

  test("a link to a file is not taken for an email address", () => {
    expect(hrefs("[notes](notes@2024.md)\n\nend")).toEqual([]);
  });
});
