import { describe, expect, test } from "bun:test";
import { matchesForPaths, searchFiles, splitOnHighlight } from "../src/lib/fileSearch";
import type { FileEntry } from "../src/lib/types";

const vault: FileEntry[] = [
  {
    name: "essays",
    path: "/v/essays",
    isDirectory: true,
    children: [
      { name: "markdown-rendering.md", path: "/v/essays/markdown-rendering.md", isDirectory: false },
      { name: "draft.md", path: "/v/essays/draft.md", isDirectory: false },
    ],
  },
  { name: "index.md", path: "/v/index.md", isDirectory: false },
];

describe("searchFiles", () => {
  test("an empty query matches nothing", () => {
    expect(searchFiles(vault, "   ")).toEqual([]);
  });

  test("matches a subsequence, not just a substring", () => {
    expect(searchFiles(vault, "mdrn")[0].entry.name).toBe("markdown-rendering.md");
  });

  test("a hit on the name outranks one that only came together across the path", () => {
    expect(searchFiles(vault, "draft")[0].entry.path).toBe("/v/essays/draft.md");
  });

  test("finds a file by its folder plus its name", () => {
    expect(searchFiles(vault, "essaysdraft").some((m) => m.entry.name === "draft.md")).toBe(true);
  });

  test("highlight indices point into the name", () => {
    const [match] = searchFiles(vault, "idx");
    expect(match.entry.name).toBe("index.md");
    expect(match.highlight.every((i) => i >= 0 && i < match.entry.name.length)).toBe(true);
  });

  test("a character that is not there matches nothing", () => {
    expect(searchFiles(vault, "zzzz")).toEqual([]);
  });
});

describe("matchesForPaths", () => {
  // Three paths, in an order that is neither the tree's walk order nor its
  // reverse - with two it is possible to pass this by accident.
  test("keeps the order it was given", () => {
    const open = ["/v/index.md", "/v/essays/markdown-rendering.md", "/v/essays/draft.md"];
    expect(matchesForPaths(vault, open).map((m) => m.entry.path)).toEqual(open);
  });

  test("drops paths the tree does not have", () => {
    expect(matchesForPaths(vault, ["/v/gone.md"])).toEqual([]);
  });

  test("carries the folder trail for the dimmed half of the row", () => {
    expect(matchesForPaths(vault, ["/v/essays/draft.md"])[0].directory).toBe("essays");
  });
});

describe("splitOnHighlight", () => {
  test("no highlight is one unmatched run", () => {
    expect(splitOnHighlight("abc", [])).toEqual(["abc"]);
  });

  test("alternates unmatched and matched, starting unmatched", () => {
    expect(splitOnHighlight("abc", [0])).toEqual(["", "a", "bc"]);
    expect(splitOnHighlight("abc", [1])).toEqual(["a", "b", "c"]);
  });

  test("the runs always reassemble into the original", () => {
    expect(splitOnHighlight("markdown", [0, 1, 4]).join("")).toBe("markdown");
  });
});
