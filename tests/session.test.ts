import { beforeEach, describe, expect, test } from "bun:test";
import { caretsFor, readSession, tabsToRestore, writeSession } from "../src/lib/session";

/** A `localStorage` that two "windows" can share, as two real ones do. */
function fakeStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
  };
}

const storage = fakeStorage();
(globalThis as unknown as { localStorage: typeof storage }).localStorage = storage;

const KEY = "nuza:session";

/** What a different window of the app records, straight into the shared store. */
function writtenByAnotherWindow(vault: string, open: string[]) {
  const stored = JSON.parse(storage.getItem(KEY) ?? "{}");
  stored[vault] = { open, current: open[0] };
  storage.setItem(KEY, JSON.stringify(stored));
}

beforeEach(() => storage.clear());

describe("session store", () => {
  test("remembers what was open in a vault", () => {
    writeSession("/a", { open: ["/a/1.md", "/a/2.md"], current: "/a/2.md" });
    expect(readSession("/a")).toEqual({ open: ["/a/1.md", "/a/2.md"], current: "/a/2.md" });
  });

  test("knows nothing of a vault never written", () => {
    expect(readSession("/nowhere").open).toEqual([]);
  });

  test("a write from here keeps what another window recorded for its own vault", () => {
    writeSession("/a", { open: ["/a/1.md"], current: "/a/1.md" });
    // The other window records its tabs. This window has read the store before
    // that and holds a copy of it.
    writtenByAnotherWindow("/b", ["/b/1.md"]);

    writeSession("/a", { open: ["/a/1.md", "/a/2.md"], current: "/a/2.md" });

    expect(readSession("/b").open).toEqual(["/b/1.md"]);
    expect(readSession("/a").open).toEqual(["/a/1.md", "/a/2.md"]);
  });

  test("a read sees what another window has written since", () => {
    writeSession("/a", { open: ["/a/1.md"], current: "/a/1.md" });
    expect(readSession("/b").open).toEqual([]);

    writtenByAnotherWindow("/b", ["/b/9.md"]);
    expect(readSession("/b").open).toEqual(["/b/9.md"]);
  });

  test("another window changing this vault's own entry is what is read, not a stale copy", () => {
    writeSession("/a", { open: ["/a/1.md"], current: "/a/1.md" });
    writtenByAnotherWindow("/a", ["/a/other.md"]);
    expect(readSession("/a").open).toEqual(["/a/other.md"]);
  });

  test("an empty list forgets the vault, and only that one", () => {
    writeSession("/a", { open: ["/a/1.md"], current: "/a/1.md" });
    writeSession("/b", { open: ["/b/1.md"], current: "/b/1.md" });
    writeSession("/a", { open: [], current: "" });
    expect(readSession("/a").open).toEqual([]);
    expect(readSession("/b").open).toEqual(["/b/1.md"]);
  });

  test("keeps the most recently written vaults when there are too many", () => {
    for (let n = 0; n < 15; n++) writeSession(`/v${n}`, { open: [`/v${n}/a.md`], current: `/v${n}/a.md` });
    expect(readSession("/v0").open).toEqual([]);
    expect(readSession("/v14").open).toEqual(["/v14/a.md"]);
  });

  test("a damaged store is an empty one", () => {
    storage.setItem(KEY, "{not json");
    expect(readSession("/a").open).toEqual([]);
    writeSession("/a", { open: ["/a/1.md"], current: "/a/1.md" });
    expect(readSession("/a").open).toEqual(["/a/1.md"]);
  });

  test("a note that is not a string, or a current tab that is not open, is put right", () => {
    storage.setItem(KEY, JSON.stringify({ "/a": { open: ["/a/1.md", 7, ""], current: "/gone.md" } }));
    expect(readSession("/a")).toEqual({ open: ["/a/1.md"], current: "/a/1.md" });
  });
});

describe("tabsToRestore", () => {
  const session = { open: ["/v/a.md", "/v/folder/b.md", "/v/folder/deep/c.md"], current: "/v/folder/b.md" };

  test("keeps the tabs for notes in folders, not only the ones at the top of the vault", () => {
    expect(tabsToRestore(session, session.open)).toEqual({ open: session.open, current: "/v/folder/b.md" });
  });

  test("drops the notes that are gone, and falls back to the first tab when the one in front went", () => {
    expect(tabsToRestore(session, ["/v/a.md", "/v/folder/deep/c.md"])).toEqual({
      open: ["/v/a.md", "/v/folder/deep/c.md"],
      current: "/v/a.md",
    });
  });

  test("puts a note asked for by name in front, adding a tab for it if it had none", () => {
    expect(tabsToRestore(session, [...session.open, "/v/new.md"], "/v/new.md")).toEqual({
      open: [...session.open, "/v/new.md"],
      current: "/v/new.md",
    });
    expect(tabsToRestore(session, session.open, "/v/a.md").current).toBe("/v/a.md");
  });

  test("ignores a note asked for that is not there", () => {
    expect(tabsToRestore(session, session.open, "/v/missing.md")).toEqual({
      open: session.open,
      current: "/v/folder/b.md",
    });
  });

  test("has nothing in front when nothing is left", () => {
    expect(tabsToRestore(session, [])).toEqual({ open: [], current: undefined });
  });

  test("leaves the stored session as it was", () => {
    const before = JSON.stringify(session);
    tabsToRestore(session, session.open, "/v/new.md");
    expect(JSON.stringify(session)).toBe(before);
  });
});

describe("where the caret was", () => {
  test("is kept with the tabs and read back", () => {
    writeSession("/v", { open: ["/v/a.md", "/v/b.md"], current: "/v/a.md", carets: { "/v/a.md": 120 } });
    expect(readSession("/v").carets).toEqual({ "/v/a.md": 120 });
  });

  test("a session from before carets were kept reads as one with none", () => {
    storage.setItem(KEY, JSON.stringify({ "/v": { open: ["/v/a.md"], current: "/v/a.md" } }));
    expect(readSession("/v").carets).toBeUndefined();
  });

  test("only a place in the text of an open note is taken from storage", () => {
    const stored = {
      "/v/a.md": 12,
      "/v/closed.md": 5,
      "/v/b.md": -3,
      "/v/c.md": "7",
      "/v/d.md": 1.5,
      "/v/e.md": 0,
    };
    expect(caretsFor(["/v/a.md", "/v/b.md", "/v/c.md", "/v/d.md", "/v/e.md"], stored)).toEqual({
      "/v/a.md": 12,
    });
    expect(caretsFor(["/v/a.md"], null)).toEqual({});
    expect(caretsFor(["/v/a.md"], [1, 2])).toEqual({});
  });
});
