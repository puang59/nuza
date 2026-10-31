import { describe, expect, test } from "bun:test";
import { dropOwnWrites, isOwnWrite, noteOwnWrite, type OwnWrites } from "../src/lib/ownWrites";

describe("own writes", () => {
  test("knows what it has written to a note, and nothing about another", () => {
    const writes: OwnWrites = new Map();
    noteOwnWrite(writes, "/v/a.md", "one");
    expect(isOwnWrite(writes, "/v/a.md", "one")).toBe(true);
    expect(isOwnWrite(writes, "/v/a.md", "two")).toBe(false);
    expect(isOwnWrite(writes, "/v/b.md", "one")).toBe(false);
  });

  // A report of the first save can be read after the second has gone out.
  test("still knows an earlier write while a later one is in flight", () => {
    const writes: OwnWrites = new Map();
    noteOwnWrite(writes, "/v/a.md", "one");
    noteOwnWrite(writes, "/v/a.md", "one two");
    expect(isOwnWrite(writes, "/v/a.md", "one")).toBe(true);
    expect(isOwnWrite(writes, "/v/a.md", "one two")).toBe(true);
  });

  test("keeps only the latest few", () => {
    const writes: OwnWrites = new Map();
    for (const text of ["a", "b", "c"]) noteOwnWrite(writes, "/v/a.md", text, 2);
    expect(isOwnWrite(writes, "/v/a.md", "a")).toBe(false);
    expect(isOwnWrite(writes, "/v/a.md", "c")).toBe(true);
  });

  test("writing the same text again does not crowd the others out", () => {
    const writes: OwnWrites = new Map();
    for (const text of ["a", "b", "b", "b"]) noteOwnWrite(writes, "/v/a.md", text, 2);
    expect(isOwnWrite(writes, "/v/a.md", "a")).toBe(true);
  });

  // Somebody else sets the note back to something the app once wrote: that is
  // an edit, and has to be seen as one.
  test("forgets a note once it is seen to hold something else", () => {
    const writes: OwnWrites = new Map();
    noteOwnWrite(writes, "/v/a.md", "one");
    dropOwnWrites(writes, "/v/a.md");
    expect(isOwnWrite(writes, "/v/a.md", "one")).toBe(false);
  });
});
