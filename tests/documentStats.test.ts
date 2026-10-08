import { describe, expect, test } from "bun:test";
import { Text } from "@codemirror/state";
import { countDocument, countSelection, readingMinutes } from "../src/lib/documentStats";

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

describe("markup is not prose", () => {
  test("frontmatter is skipped entirely", () => {
    const doc = count("---\ntitle: My Note\nauthor: me\n---\nreal words here");
    expect(doc.words).toBe(3);
  });

  test("an unclosed opener at the top is content, not frontmatter", () => {
    expect(count("---\nand then words").words).toBe(3);
  });

  test("rules, fences and table delimiters carry no words", () => {
    expect(count("---").words).toBe(0);
    expect(count("***").words).toBe(0);
    expect(count("```").words).toBe(0);
    expect(count("| --- | --- |").words).toBe(0);
    expect(count("```js\nconst x = 1;\n```").words).toBe(3);
  });

  test("table rows count their cells, not their pipes", () => {
    expect(count("| name | qty |").words).toBe(2);
  });

  test("markers and hashes do not count", () => {
    expect(count("# Heading").words).toBe(1);
    expect(count("### Deep heading").words).toBe(2);
    expect(count("- item one").words).toBe(2);
    expect(count("1. ordered two").words).toBe(2);
    expect(count("> quoted thought").words).toBe(2);
    expect(count("- [ ] a task here").words).toBe(3);
    expect(count("- [x] a done task").words).toBe(3);
  });

  test("link labels count, targets do not", () => {
    expect(count("[the docs](https://example.com/very/long/path)").words).toBe(2);
    expect(count("![alt text](img.png)").words).toBe(2);
    expect(count("[ref][other]").words).toBe(1);
    expect(count("[ref]: https://example.com").words).toBe(0);
    expect(count("see https://example.com/page for more").words).toBe(3);
  });

  test("punctuation alone is not a word", () => {
    expect(count("--- *** ``` |").words).toBe(0);
    expect(count("wait... really?!").words).toBe(2);
  });

  test("apostrophes keep a word together", () => {
    expect(count("don't stop").words).toBe(2);
  });
});

describe("CJK text", () => {
  test("each CJK character is its own word", () => {
    expect(count("\u4f60\u597d\u4e16\u754c").words).toBe(4);
    expect(count("\u3053\u3093\u306b\u3061\u306f").words).toBe(5);
  });

  test("mixed CJK and latin counts both", () => {
    expect(count("\u4f60\u597dworld").words).toBe(3);
  });

  test("CJK needs no spaces to be many words", () => {
    expect(count("\u4eca\u65e5\u306f\u5929\u6c17\u304c\u826f\u3044").words).toBe(8);
  });
});

describe("scripts that do put spaces between words", () => {
  test("Korean is counted by its spaces, not by the syllable", () => {
    expect(count("\uc548\ub155\ud558\uc138\uc694 \uc138\uacc4").words).toBe(2);
  });
});

describe("footnotes and reference definitions", () => {
  test("a footnote's text is prose, its label is not", () => {
    expect(count("[^1]: three more words").words).toBe(3);
  });

  test("a link reference definition is only a target", () => {
    expect(count("[docs]: https://example.com").words).toBe(0);
  });
});

describe("frontmatter and paragraphs", () => {
  test("frontmatter does not start or hold a paragraph", () => {
    const doc = count("---\ntitle: x\n---\nfirst paragraph\n\nsecond");
    expect(doc.paragraphs).toBe(2);
    expect(doc.words).toBe(3);
  });

  test("a rule between paragraphs separates them", () => {
    expect(count("one\n---\ntwo").paragraphs).toBe(2);
  });
});

describe("countSelection", () => {
  test("counts the selected words and characters", () => {
    expect(countSelection("two words")).toEqual({ words: 2, characters: 9 });
  });

  test("markup inside a selection is stripped like the document", () => {
    expect(countSelection("## Head\n- item").words).toBe(2);
    expect(countSelection("## Head\n- item").characters).toBe(14);
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

describe("recount", () => {
  /** A seeded generator, so a failure replays the same way. */
  function random(seed: number) {
    return () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
  }

  test("keeps step with a full count through random edits", async () => {
    const { EditorState } = await import("@codemirror/state");
    const { recount } = await import("../src/lib/documentStats");
    const pieces = ["word ", " ", "\n", "\n\n", "two words", "\t", "x", ""];

    for (const seed of [1, 2, 3, 4]) {
      const next = random(seed);
      let state = EditorState.create({ doc: "first line\n\nsecond paragraph here\nstill it\n\nlast" });
      let tally = { words: countDocument(state.doc).words, paragraphs: countDocument(state.doc).paragraphs };

      for (let step = 0; step < 300; step++) {
        const length = state.doc.length;
        const from = Math.floor(next() * (length + 1));
        const to = Math.min(length, from + Math.floor(next() * 8));
        const insert = pieces[Math.floor(next() * pieces.length)];
        const transaction = state.update({ changes: { from, to: next() < 0.5 ? from : to, insert } });

        tally = recount(state.doc, transaction.state.doc, transaction.changes, tally);
        state = transaction.state;

        const full = countDocument(state.doc);
        expect(tally).toEqual({ words: full.words, paragraphs: full.paragraphs });
      }
    }
  });

  // The lines of a properties block count for nothing, and which lines those
  // are is decided by a `---` that may be nowhere near the edit: closing a
  // block, or breaking one open, changes the count of lines nobody touched.
  test("keeps step with a full count as a properties block comes and goes", async () => {
    const { EditorState } = await import("@codemirror/state");
    const { recount } = await import("../src/lib/documentStats");
    const pieces = [
      "word ",
      "\n",
      "---\n",
      "\n---",
      "---",
      "- [ ] ",
      "| a | b |\n",
      "\u4f60\u597d",
      "[x](y z) ",
      "",
    ];
    const start = "---\ntitle: a note\ntags: one two\n---\nfirst line\n\n- [ ] a task\nmore of it\n---\nlast";

    for (const seed of [5, 6, 7, 8, 9, 10]) {
      const next = random(seed);
      let state = EditorState.create({ doc: start });
      let tally = { words: countDocument(state.doc).words, paragraphs: countDocument(state.doc).paragraphs };

      for (let step = 0; step < 400; step++) {
        const length = state.doc.length;
        // Half the edits land in the first few lines, where the block is.
        const reach = next() < 0.5 ? Math.min(length, 40) : length;
        const from = Math.floor(next() * (reach + 1));
        const to = Math.min(length, from + Math.floor(next() * 12));
        const insert = pieces[Math.floor(next() * pieces.length)];
        const transaction = state.update({ changes: { from, to: next() < 0.5 ? from : to, insert } });

        tally = recount(state.doc, transaction.state.doc, transaction.changes, tally);
        state = transaction.state;

        const full = countDocument(state.doc);
        expect(tally).toEqual({ words: full.words, paragraphs: full.paragraphs });
      }
    }
  });

  test("typing inside a properties block leaves the count alone", async () => {
    const { EditorState } = await import("@codemirror/state");
    const { recount } = await import("../src/lib/documentStats");
    const state = EditorState.create({ doc: "---\ntitle: a\n---\nthree words here" });
    const tally = { words: 3, paragraphs: 1 };
    const transaction = state.update({ changes: { from: 12, insert: " longer title" } });
    expect(recount(state.doc, transaction.state.doc, transaction.changes, tally)).toBe(tally);
  });

  test("an edit that changes nothing changes nothing", async () => {
    const { ChangeSet } = await import("@codemirror/state");
    const { recount } = await import("../src/lib/documentStats");
    const doc = Text.of(["a b"]);
    const tally = { words: 2, paragraphs: 1 };
    expect(recount(doc, doc, ChangeSet.empty(doc.length), tally)).toBe(tally);
  });
});
