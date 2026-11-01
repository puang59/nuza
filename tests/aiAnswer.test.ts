import { describe, expect, test } from "bun:test";
import {
  forDisplay,
  isWebLink,
  parseAnswer,
  parseInline,
  withoutThinking,
} from "../src/lib/ai/answerMarkdown";
import { FRAMING_PHRASES, buildFollowUp, buildPrompt } from "../src/lib/ai/prompt";

describe("an answer's Markdown", () => {
  test("paragraphs, headings, lists and code come out as blocks", () => {
    const blocks = parseAnswer(
      "## Summary\n\nTwo things:\n\n- first\n- second\n\n```ts\nconst a = 1;\n```\n\n1. one\n2. two"
    );
    expect(blocks.map((block) => block.type)).toEqual(["heading", "paragraph", "list", "code", "list"]);
    expect(blocks[2]).toMatchObject({ ordered: false, items: [[{ text: "first" }], [{ text: "second" }]] });
    expect(blocks[3]).toEqual({ type: "code", language: "ts", text: "const a = 1;" });
    expect(blocks[4]).toMatchObject({ ordered: true });
  });

  test("emphasis, code and links inside a line", () => {
    expect(parseInline("a **bold** and *soft* `x` [docs](https://example.com)")).toEqual([
      { type: "text", text: "a " },
      { type: "strong", children: [{ type: "text", text: "bold" }] },
      { type: "text", text: " and " },
      { type: "em", children: [{ type: "text", text: "soft" }] },
      { type: "text", text: " " },
      { type: "code", text: "x" },
      { type: "text", text: " " },
      { type: "link", href: "https://example.com", children: [{ type: "text", text: "docs" }] },
    ]);
  });

  test("markup that looks like HTML stays text", () => {
    const blocks = parseAnswer('<img src=x onerror="alert(1)"> <script>bad()</script>');
    expect(blocks).toEqual([
      {
        type: "paragraph",
        children: [{ type: "text", text: '<img src=x onerror="alert(1)"> <script>bad()</script>' }],
      },
    ]);
  });

  test("only web addresses are links anyone can open", () => {
    expect(isWebLink("https://example.com")).toBe(true);
    expect(isWebLink("http://example.com")).toBe(true);
    for (const href of ["javascript:alert(1)", "file:///etc/hosts", "nuza-media://x", "data:text/html,hi"]) {
      expect(isWebLink(href)).toBe(false);
    }
  });

  test("an unclosed code block runs to the end rather than being lost", () => {
    expect(parseAnswer("```\nstill streaming")).toEqual([
      { type: "code", language: "", text: "still streaming" },
    ]);
  });

  test("a lone asterisk is not emphasis", () => {
    expect(parseInline("2 * 3 = 6")).toEqual([{ type: "text", text: "2 * 3 = 6" }]);
  });
});

describe("an answer as it is shown", () => {
  test("never shows nuza's framing, even when the agent recites it", () => {
    const framing = buildPrompt(
      {
        agent: "Claude Code",
        question: "hello there",
        context: {
          title: "plan.md",
          note: "Ship in March.",
          selection: { from: 0, to: 4 },
          trimmed: true,
          omittedLines: 3,
          selectionOnly: false,
        },
        intent: "ask",
        declined: [{ find: "a", replace: "b" }],
      },
      "e72bcccb7ec"
    );
    const shown = forDisplay(`You said: ${framing}`);
    for (const phrase of FRAMING_PHRASES) expect(shown).not.toContain(phrase);
    expect(shown).not.toContain("e72bcccb7ec");
    expect(shown).not.toContain("⟦");
    // The writer's own words survive.
    expect(shown).toContain("Ship in March.");
    expect(shown).toContain("hello there");
  });

  test("every phrase it looks for is one the framing really uses", () => {
    const full = [
      buildPrompt(
        {
          agent: "Codex",
          question: "?",
          context: {
            title: "a.md",
            note: "x",
            selection: { from: 0, to: 1 },
            trimmed: true,
            omittedLines: 1,
            selectionOnly: false,
          },
          intent: "ask",
          declined: [{ find: "a", replace: "b" }],
          instructions: "Be brief.",
          memory: ["British spelling"],
          history: [{ question: "Earlier?", answer: "Yes." }],
        },
        "n0"
      ),
      buildPrompt({
        agent: "Codex",
        question: "?",
        context: {
          title: "a.md",
          note: "x",
          selection: null,
          trimmed: true,
          omittedLines: 0,
          selectionOnly: true,
        },
        intent: "edit",
      }),
      buildFollowUp({ agent: "Codex", question: "?", context: null, intent: "ask" }),
      buildPrompt({
        agent: "Codex",
        question: "?",
        context: null,
        intent: "ask",
        extras: [{ title: "b.md", text: "y" }],
      }),
    ].join("\n");
    for (const phrase of FRAMING_PHRASES) expect(full).toContain(phrase);
  });

  test("an ordinary answer is left as it is", () => {
    const answer = "The release slips to **March**.\n\n- Beta first\n- Then GA";
    expect(forDisplay(answer)).toBe(answer);
  });
});

describe("reasoning a model writes into its answer", () => {
  test("a whole think block goes", () => {
    expect(withoutThinking("<think>Hm, the user wants...</think>\n\nShorter.")).toBe("Shorter.");
  });

  test("so does what came before a closing tag that was never opened", () => {
    expect(withoutThinking("Let me do these tasks.</think>Done: both failed.")).toBe("Done: both failed.");
  });

  test("and a think block still being written", () => {
    expect(withoutThinking("Here it is.\n<think>maybe also")).toBe("Here it is.\n");
  });

  test("an answer without any is left as it is", () => {
    expect(withoutThinking("Use `<b>` for bold.")).toBe("Use `<b>` for bold.");
  });
});

describe("tables and math in an answer", () => {
  test("a table is read with its alignment, and an escaped pipe stays in its cell", () => {
    const blocks = parseAnswer(
      "Steps:\n\n| Step | Done |\n| :--- | :---: |\n| Sign `a\\|b` | No |\n| Notarise | Yes |\n\nAfter."
    );
    const table = blocks.find((block) => block.type === "table");
    expect(table).toBeDefined();
    if (table?.type !== "table") return;
    expect(table.align).toEqual(["left", "center"]);
    expect(table.header).toEqual([[{ type: "text", text: "Step" }], [{ type: "text", text: "Done" }]]);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0][0]).toEqual([
      { type: "text", text: "Sign " },
      { type: "code", text: "a|b" },
    ]);
    expect(blocks.at(-1)).toEqual({ type: "paragraph", children: [{ type: "text", text: "After." }] });
  });

  test("a line with a pipe but no rule under it is prose", () => {
    expect(parseAnswer("this | that").map((block) => block.type)).toEqual(["paragraph"]);
  });

  test("inline TeX by the editor's rules, and money is not math", () => {
    expect(parseInline("so $x^2$ grows")).toEqual([
      { type: "text", text: "so " },
      { type: "math", text: "x^2" },
      { type: "text", text: " grows" },
    ]);
    expect(parseInline("it cost $5 and $10")).toEqual([{ type: "text", text: "it cost $5 and $10" }]);
    expect(parseInline("$ x $")).toEqual([{ type: "text", text: "$ x $" }]);
  });

  test("a $$ block is kept as TeX", () => {
    expect(parseAnswer("$$\nE = mc^2\n$$")).toEqual([{ type: "code", language: "tex", text: "E = mc^2" }]);
    expect(parseAnswer("$$a+b$$")).toEqual([{ type: "code", language: "tex", text: "a+b" }]);
  });
});
