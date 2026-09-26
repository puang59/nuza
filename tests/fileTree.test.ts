import { describe, expect, test } from "bun:test";
import {
  addEntry,
  addFile,
  ensureDirectory,
  findEntry,
  moveEntry,
  nameOf,
  parentOf,
  removeEntry,
} from "../src/lib/fileTree";
import type { FileEntry } from "../src/lib/types";

const ROOT = "/v";

function tree(): FileEntry[] {
  return [
    {
      name: "notes",
      path: "/v/notes",
      isDirectory: true,
      children: [{ name: "a.md", path: "/v/notes/a.md", isDirectory: false }],
    },
    { name: "b.md", path: "/v/b.md", isDirectory: false },
  ];
}

describe("parentOf / nameOf", () => {
  test("split either separator", () => {
    expect(parentOf("/v/notes/a.md")).toBe("/v/notes");
    expect(nameOf("/v/notes/a.md")).toBe("a.md");
    expect(parentOf("C:\\v\\a.md")).toBe("C:\\v");
    expect(nameOf("C:\\v\\a.md")).toBe("a.md");
  });

  test("a bare name has no parent", () => {
    expect(parentOf("a.md")).toBe("");
  });
});

describe("findEntry", () => {
  test("finds at the root and nested", () => {
    expect(findEntry(tree(), "/v/b.md")?.name).toBe("b.md");
    expect(findEntry(tree(), "/v/notes/a.md")?.name).toBe("a.md");
  });

  test("returns null for something not there", () => {
    expect(findEntry(tree(), "/v/nope.md")).toBeNull();
  });
});

describe("addEntry", () => {
  test("inserts into a directory and keeps directories first, then name order", () => {
    const next = addEntry(tree(), ROOT, { name: "A.md", path: "/v/notes/A.md", isDirectory: false });
    const names = findEntry(next, "/v/notes")!.children!.map((c) => c.name);
    expect(names).toEqual(["a.md", "A.md"]);
  });

  test("inserts at the root", () => {
    const next = addEntry(tree(), ROOT, { name: "zzz", path: "/v/zzz", isDirectory: true, children: [] });
    expect(next.map((e) => e.name)).toEqual(["notes", "zzz", "b.md"]);
  });

  test("leaves untouched subtrees referentially identical", () => {
    const before = tree();
    const next = addEntry(before, ROOT, { name: "c.md", path: "/v/c.md", isDirectory: false });
    expect(next.find((e) => e.name === "notes")).toBe(before.find((e) => e.name === "notes"));
  });
});

describe("removeEntry", () => {
  test("drops a nested file", () => {
    expect(findEntry(removeEntry(tree(), ROOT, "/v/notes/a.md"), "/v/notes/a.md")).toBeNull();
  });

  test("drops a directory and everything under it", () => {
    const next = removeEntry(tree(), ROOT, "/v/notes");
    expect(findEntry(next, "/v/notes")).toBeNull();
    expect(findEntry(next, "/v/notes/a.md")).toBeNull();
  });
});

describe("moveEntry", () => {
  test("rewrites the entry's own path and its descendants'", () => {
    const next = moveEntry(tree(), ROOT, "/v/notes", "/v/archive");
    expect(findEntry(next, "/v/notes")).toBeNull();
    expect(findEntry(next, "/v/archive")?.name).toBe("archive");
    expect(findEntry(next, "/v/archive/a.md")?.name).toBe("a.md");
  });

  test("moving something absent is a no-op", () => {
    const before = tree();
    expect(moveEntry(before, ROOT, "/v/nope", "/v/other")).toBe(before);
  });
});

describe("ensureDirectory / addFile", () => {
  test("creates the folder a new file landed in", () => {
    const next = addFile(tree(), ROOT, "/v/media/pic.png");
    expect(findEntry(next, "/v/media")?.isDirectory).toBe(true);
    expect(findEntry(next, "/v/media/pic.png")?.name).toBe("pic.png");
  });

  test("creates intermediate folders too", () => {
    const next = ensureDirectory(tree(), ROOT, "/v/one/two/three");
    expect(findEntry(next, "/v/one")).not.toBeNull();
    expect(findEntry(next, "/v/one/two")).not.toBeNull();
    expect(findEntry(next, "/v/one/two/three")).not.toBeNull();
  });

  test("adding a file that is already there changes nothing", () => {
    const before = tree();
    expect(addFile(before, ROOT, "/v/b.md")).toBe(before);
  });
});
