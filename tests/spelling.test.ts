import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import { Tag } from "../src/lib/markdown/tags";
import { MathSyntax } from "../src/lib/markdown/math";
import { WikiEmbed, WikiLink } from "../src/lib/markdown/wikiLinks";
import { scanProse } from "../src/lib/markdown/spellScan";
import { createSpeller, editDistance, matchCase, tokens } from "../src/lib/spelling";

function dictionary(name: string) {
  const dir = `${import.meta.dir}/../node_modules/${name}`;
  return [readFileSync(`${dir}/index.aff`, "utf8"), readFileSync(`${dir}/index.dic`, "utf8")] as const;
}

const us = createSpeller(...dictionary("dictionary-en"));
const gb = createSpeller(...dictionary("dictionary-en-gb"));

/** The words of `text` that `speller` underlines, as written. */
function wrong(text: string, speller = us) {
  return tokens(text).flatMap((token) =>
    speller.misspelled(token.text).map(([from, to]) => token.text.slice(from, to))
  );
}

describe("tokens", () => {
  const words = (text: string) => tokens(text).map((token) => token.text);

  test("finds words with their positions", () => {
    expect(tokens("one two", 10)).toEqual([
      { from: 10, to: 13, text: "one" },
      { from: 14, to: 17, text: "two" },
    ]);
  });

  test("keeps contractions, possessives and hyphenated words whole", () => {
    expect(words("don't it’s well-known dogs'")).toEqual(["don't", "it’s", "well-known", "dogs"]);
  });

  test("leaves out single letters", () => {
    expect(words("a b word")).toEqual(["word"]);
  });

  test("leaves out identifiers, acronyms and mixed capitals", () => {
    expect(words("camelCase PascalCase iPhone JavaScript NASA HTML snake_case")).toEqual([]);
  });

  test("leaves out words with digits stuck to them", () => {
    expect(words("h2o 3rd 10th v2 abc123 x86")).toEqual([]);
  });

  test("leaves out URLs, paths, addresses and file names", () => {
    expect(
      words(
        "https://foo.example/bar www.thing.com me@thing.com src/lib/thing ~/notes/todo /etc/hosts main.rs Node.js"
      )
    ).toEqual([]);
  });

  test("keeps the words either side of a lone slash", () => {
    expect(words("and/or")).toEqual(["and"]);
  });

  test("leaves out snake_case but not _emphasis_", () => {
    expect(words("snake_case _emphasis_ __init__")).toEqual(["emphasis", "init"]);
  });

  test("leaves out @handles and $variables", () => {
    expect(words("@someone $HOME")).toEqual([]);
  });

  test("leaves other scripts alone", () => {
    expect(words("日本語 Привет")).toEqual([]);
    expect(words("日本abc")).toEqual([]);
  });

  test("keeps accented Latin words", () => {
    expect(words("café naïve")).toEqual(["café", "naïve"]);
  });
});

describe("the dictionary", () => {
  test("accepts ordinary prose", () => {
    expect(wrong("The quick brown fox doesn't jump over well-known fences. Hello, it’s fine.")).toEqual([]);
  });

  test("accepts sentence case and capitals", () => {
    expect(wrong("Hello World. Apple pie.")).toEqual([]);
  });

  test("finds common typos", () => {
    expect(wrong("I recieve teh seperate definately wierd things")).toEqual([
      "recieve",
      "teh",
      "seperate",
      "definately",
      "wierd",
    ]);
  });

  test("accepts everyday computing words the dictionary lacks", () => {
    expect(wrong("Ok, nuza reads the json from the repo's readme on github")).toEqual([]);
  });

  test("follows the chosen spelling", () => {
    expect(wrong("colour", us)).toEqual(["colour"]);
    expect(wrong("colour", gb)).toEqual([]);
    expect(wrong("color", gb)).toEqual(["color"]);
    expect(wrong("color", us)).toEqual([]);
  });

  test("judges a hyphenated word by its parts and underlines only the wrong one", () => {
    expect(wrong("a well-known fact")).toEqual([]);
    expect(wrong("a well-knwon fact")).toEqual(["knwon"]);
    const [token] = tokens("well-knwon");
    expect(us.misspelled(token.text)).toEqual([[5, 10]]);
  });

  test("a personal word is accepted in any case, with its possessive", () => {
    const own = createSpeller(...dictionary("dictionary-en"), ["Zzyzx"]);
    expect(wrong("zzyzx Zzyzx Zzyzx's zzyzx’s", own)).toEqual([]);
    expect(wrong("zzyzx Zzyzx")).toEqual(["zzyzx", "Zzyzx"]);
  });

  test("ignore accepts a word from then on", () => {
    const speller = createSpeller(...dictionary("dictionary-en"));
    expect(wrong("zzyzx", speller)).toEqual(["zzyzx"]);
    speller.ignore("Zzyzx");
    expect(wrong("zzyzx", speller)).toEqual([]);
  });

  test("suggests corrections in the case of the word", () => {
    expect(us.suggest("recieve")[0]).toBe("receive");
    expect(us.suggest("Recieve")[0]).toBe("Receive");
    expect(us.suggest("RECIEVE")[0]).toBe("RECEIVE");
  });
});

describe("suggestions", () => {
  test("put a swap of two letters first", () => {
    expect(us.suggest("teh")[0]).toBe("the");
    expect(us.suggest("adn")[0]).toBe("and");
  });

  test("put the closest words first", () => {
    expect(us.suggest("wrds").slice(0, 5)).toContain("words");
    expect(us.suggest("sentense")[0]).toBe("sentence");
    expect(us.suggest("definately")[0]).toBe("definitely");
  });

  test("do not offer acronyms for an ordinary word", () => {
    expect(us.suggest("wrds").filter((suggestion) => suggestion === suggestion.toUpperCase())).toEqual([]);
  });

  test("never include the word itself", () => {
    expect(us.suggest("recieve")).not.toContain("recieve");
  });
});

describe("editDistance", () => {
  test("counts additions, drops, changes and swaps as one edit each", () => {
    expect(editDistance("word", "word")).toBe(0);
    expect(editDistance("wrd", "word")).toBe(1);
    expect(editDistance("worrd", "word")).toBe(1);
    expect(editDistance("wurd", "word")).toBe(1);
    expect(editDistance("teh", "the")).toBe(1);
    expect(editDistance("", "abc")).toBe(3);
  });
});

describe("matchCase", () => {
  test("follows the original's capitals", () => {
    expect(matchCase("the", "Teh")).toBe("The");
    expect(matchCase("the", "TEH")).toBe("THE");
    expect(matchCase("the", "teh")).toBe("the");
    expect(matchCase("the", "T")).toBe("The");
  });
});

describe("scanProse", () => {
  function scan(doc: string, leaveAlone: number | null = null) {
    const state = EditorState.create({
      doc,
      extensions: [
        markdown({ extensions: [GFM, WikiEmbed, WikiLink, Tag, MathSyntax], codeLanguages: languages }),
      ],
    });
    ensureSyntaxTree(state, doc.length, 5000);
    const { found, held } = scanProse(state, us, 0, doc.length, leaveAlone);
    return { words: found.map((range) => doc.slice(range.from, range.to)), held };
  }

  test("underlines prose", () => {
    expect(scan("# Titel\n\nSome **bolld** and _itallic_ text.").words).toEqual([
      "Titel",
      "bolld",
      "itallic",
    ]);
  });

  test("passes over code, fenced and inline", () => {
    const doc = "Fine words `inlnie` here\n\n```js\nconst wrnog = 1;\n```\n\n    indnted code\n";
    expect(scan(doc).words).toEqual([]);
  });

  test("passes over URLs, link targets, wiki-links, tags and maths", () => {
    const doc = [
      "[a link](https://exmple.com/pgae) <https://autolnk.com>",
      "[[Mispelled Note]] ![[pictr.png]] #taggg $xyzz$",
      "",
      "$$",
      "qwerty",
      "$$",
    ].join("\n");
    expect(scan(doc).words).toEqual([]);
  });

  test("still checks the text of a link", () => {
    expect(scan("[a lnik](https://example.com)").words).toEqual(["lnik"]);
  });

  test("passes over the frontmatter", () => {
    expect(scan("---\ntitel: Mispelled\n---\n\nbody tetx").words).toEqual(["tetx"]);
  });

  test("passes over HTML", () => {
    expect(scan('<div clss="x">inside</div>\n\n<!-- cmment -->').words).toEqual([]);
  });

  test("leaves alone the word the caret is in or touching", () => {
    const doc = "wrds   fine";
    expect(scan(doc, 2)).toEqual({ words: [], held: true });
    expect(scan(doc, 4)).toEqual({ words: [], held: true });
    expect(scan(doc, 5)).toEqual({ words: ["wrds"], held: false });
    expect(scan(doc)).toEqual({ words: ["wrds"], held: false });
  });
});
