import { describe, expect, test } from "bun:test";
import {
  addEntry,
  addFile,
  ensureDirectory,
  findEntry,
  hasUnavailable,
  isRead,
  moveEntry,
  nameOf,
  parentOf,
  removeEntry,
  setChildren,
  sortTree,
  touchEntry,
  mergeListing,
  readFolders,
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

describe("sortTree", () => {
  const file = (name: string, modified?: number, created?: number) => ({
    name,
    path: `/v/${name}`,
    isDirectory: false,
    modified,
    created,
  });
  const tree = [
    {
      name: "b-dir",
      path: "/v/b-dir",
      isDirectory: true,
      modified: 1,
      children: [file("x.md", 5), file("y.md", 9)],
    },
    { name: "a-dir", path: "/v/a-dir", isDirectory: true, modified: 2, children: [] },
    file("old.md", 10, 100),
    file("new.md", 30, 50),
    file("mid.md", 20),
  ];
  const names = (entries: { name: string }[]) => entries.map((entry) => entry.name);

  test("name order is the tree itself", () => {
    expect(sortTree(tree, "name")).toBe(tree);
  });

  test("by date modified: folders first, newest first, all the way down", () => {
    const sorted = sortTree(tree, "modified");
    expect(names(sorted)).toEqual(["a-dir", "b-dir", "new.md", "mid.md", "old.md"]);
    expect(names(sorted[1].children!)).toEqual(["y.md", "x.md"]);
  });

  test("by date created, falling back to modified where there is none", () => {
    expect(names(sortTree(tree, "created").slice(2))).toEqual(["old.md", "new.md", "mid.md"]);
  });

  test("a file with no time yet is the newest, and two of them go by name", () => {
    const withNew = [...tree, file("zz-made.md"), file("aa-made.md")];
    expect(names(sortTree(withNew, "modified")).slice(2, 4)).toEqual(["aa-made.md", "zz-made.md"]);
  });
});

describe("touchEntry", () => {
  test("marks a nested file as written now, leaving the rest alone", () => {
    const tree = [
      {
        name: "d",
        path: "/v/d",
        isDirectory: true,
        children: [{ name: "n.md", path: "/v/d/n.md", isDirectory: false, modified: 1 }],
      },
    ];
    const touched = touchEntry(tree, "/v", "/v/d/n.md", 42);
    expect(touched[0].children![0].modified).toBe(42);
    expect(tree[0].children[0].modified).toBe(1);
  });

  test("gives the same tree back for a note it does not list", () => {
    const tree = [{ name: "a.md", path: "/v/a.md", isDirectory: false }];
    expect(touchEntry(tree, "/v", "untitled.md")).toBe(tree);
  });
});

/** A vault read a folder at a time: `deep` has been listed but not opened. */
function lazyTree(): FileEntry[] {
  return [
    { name: "deep", path: "/v/deep", isDirectory: true },
    {
      name: "notes",
      path: "/v/notes",
      isDirectory: true,
      children: [
        { name: "inner", path: "/v/notes/inner", isDirectory: true },
        { name: "a.md", path: "/v/notes/a.md", isDirectory: false },
      ],
    },
  ];
}

describe("a tree read a folder at a time", () => {
  test("a folder with no children has not been read, and one with none has", () => {
    const [deep, notes] = lazyTree();
    expect(isRead(deep)).toBe(false);
    expect(isRead(notes)).toBe(true);
    expect(isRead({ name: "empty", path: "/v/empty", isDirectory: true, children: [] })).toBe(true);
  });

  test("setChildren fills in a folder that was only listed", () => {
    const children: FileEntry[] = [{ name: "x.md", path: "/v/deep/x.md", isDirectory: false }];
    const next = setChildren(lazyTree(), ROOT, "/v/deep", children);
    expect(findEntry(next, "/v/deep")?.children).toEqual(children);
    expect(findEntry(next, "/v/deep/x.md")?.name).toBe("x.md");
  });

  test("setChildren reaches a folder inside one that has been read", () => {
    const children: FileEntry[] = [{ name: "y.md", path: "/v/notes/inner/y.md", isDirectory: false }];
    const before = lazyTree();
    const next = setChildren(before, ROOT, "/v/notes/inner", children);
    expect(findEntry(next, "/v/notes/inner/y.md")?.name).toBe("y.md");
    // The rest of the tree is carried over, not copied.
    expect(next[0]).toBe(before[0]);
  });

  test("setChildren does not go through a folder that has not been read", () => {
    const before = lazyTree();
    const next = setChildren(before, ROOT, "/v/deep/under", []);
    expect(next[0]).toBe(before[0]);
    expect(isRead(next[0])).toBe(false);
  });

  test("setChildren for the root is the whole tree", () => {
    const top: FileEntry[] = [{ name: "z.md", path: "/v/z.md", isDirectory: false }];
    expect(setChildren(lazyTree(), ROOT, ROOT, top)).toBe(top);
  });

  test("a note added under a folder that has not been read is left for when it is", () => {
    const entry: FileEntry = { name: "new.md", path: "/v/deep/new.md", isDirectory: false };
    const next = addEntry(lazyTree(), ROOT, entry);
    // Giving it a `children` of just this one note would make the folder look
    // read, and hide everything else that is in it.
    expect(isRead(next[0])).toBe(false);
  });

  test("a note added under a folder that has been read goes in", () => {
    const entry: FileEntry = { name: "new.md", path: "/v/notes/new.md", isDirectory: false };
    expect(findEntry(addEntry(lazyTree(), ROOT, entry), "/v/notes/new.md")).not.toBeNull();
  });

  test("a file landing somewhere never opened does not invent the folders above it", () => {
    const next = addFile(lazyTree(), ROOT, "/v/deep/media/pic.png");
    expect(findEntry(next, "/v/deep/media/pic.png")).toBeNull();
    expect(isRead(next[0])).toBe(false);
  });

  test("moving a folder that has not been read keeps it that way", () => {
    const next = moveEntry(lazyTree(), ROOT, "/v/deep", "/v/renamed");
    const moved = findEntry(next, "/v/renamed");
    expect(moved?.name).toBe("renamed");
    expect(isRead(moved!)).toBe(false);
  });

  test("sorting by date leaves a folder that has not been read unread", () => {
    const sorted = sortTree(lazyTree(), "modified");
    expect(isRead(sorted.find((entry) => entry.name === "deep")!)).toBe(false);
  });

  test("touching a note in a folder that has not been read changes nothing", () => {
    const before = lazyTree();
    expect(touchEntry(before, ROOT, "/v/deep/a.md")).toBe(before);
  });
});

describe("hasUnavailable", () => {
  test("is true when a row of the folder did not answer", () => {
    const folder: FileEntry = {
      name: "cloud",
      path: "/v/cloud",
      isDirectory: true,
      children: [
        { name: "here.md", path: "/v/cloud/here.md", isDirectory: false },
        { name: "away.md", path: "/v/cloud/away.md", isDirectory: false, unavailable: true },
      ],
    };
    expect(hasUnavailable(folder)).toBe(true);
    expect(hasUnavailable({ ...folder, children: folder.children!.slice(0, 1) })).toBe(false);
  });

  test("is false for a folder that has not been read", () => {
    expect(hasUnavailable({ name: "d", path: "/v/d", isDirectory: true })).toBe(false);
  });
});

describe("mergeListing", () => {
  const file = (path: string, modified = 1) => ({
    name: path.slice(path.lastIndexOf("/") + 1),
    path,
    isDirectory: false,
    modified,
  });
  const folder = (path: string, children?: ReturnType<typeof file>[]) => ({
    name: path.slice(path.lastIndexOf("/") + 1),
    path,
    isDirectory: true,
    ...(children && { children }),
  });

  test("takes in what is new and lets go of what is gone", () => {
    const had = [file("/v/a.md"), file("/v/gone.md")];
    const merged = mergeListing(had, [file("/v/a.md"), file("/v/new.md")]);
    expect(merged.map((entry) => entry.path)).toEqual(["/v/a.md", "/v/new.md"]);
  });

  // A listing never looks inside the folders it lists. Taken as it is, it
  // would fold shut every folder that had been opened.
  test("a folder that had been read keeps what was read of it", () => {
    const inside = [file("/v/notes/x.md")];
    const had = [folder("/v/notes", inside), file("/v/a.md")];
    const merged = mergeListing(had, [folder("/v/notes"), file("/v/a.md"), file("/v/b.md")]);
    expect(merged[0].children).toBe(inside);
  });

  test("a folder whose own row changed still keeps its contents", () => {
    const inside = [file("/v/notes/x.md")];
    const had = [{ ...folder("/v/notes", inside), modified: 1 }];
    const merged = mergeListing(had, [{ ...folder("/v/notes"), modified: 2 }]);
    expect(merged[0].modified).toBe(2);
    expect(merged[0].children).toBe(inside);
  });

  test("hands back the same rows, and the same list, when nothing changed", () => {
    const had = [folder("/v/notes", []), file("/v/a.md")];
    expect(mergeListing(had, [folder("/v/notes"), file("/v/a.md")])).toBe(had);

    const merged = mergeListing(had, [folder("/v/notes"), file("/v/a.md", 2)]);
    expect(merged).not.toBe(had);
    expect(merged[0]).toBe(had[0]);
    expect(merged[1].modified).toBe(2);
  });

  test("a file that became a folder of the same name does not inherit anything", () => {
    const merged = mergeListing([file("/v/thing")], [folder("/v/thing")]);
    expect(merged[0].isDirectory).toBe(true);
    expect(merged[0].children).toBeUndefined();
  });
});

describe("readFolders", () => {
  test("lists the folders that have been read, parents first, and none that have not", () => {
    const tree = [
      {
        name: "a",
        path: "/v/a",
        isDirectory: true,
        children: [
          { name: "deep", path: "/v/a/deep", isDirectory: true, children: [] },
          { name: "unread", path: "/v/a/unread", isDirectory: true },
        ],
      },
      { name: "b", path: "/v/b", isDirectory: true },
      { name: "n.md", path: "/v/n.md", isDirectory: false },
    ];
    expect(readFolders(tree)).toEqual(["/v/a", "/v/a/deep"]);
  });
});
