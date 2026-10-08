import { describe, expect, test } from "bun:test";
import { planOpen } from "../src/lib/launchTarget";

const folder = (path: string) => ({ kind: "folder" as const, path });
const file = (path: string) => ({ kind: "file" as const, path });

describe("planOpen", () => {
  test("a folder becomes the vault", () => {
    expect(planOpen(folder("/notes"), null)).toEqual({ folder: "/notes" });
    expect(planOpen(folder("/notes"), "/other")).toEqual({ folder: "/notes" });
  });

  test("the folder that is already open is left as it is", () => {
    expect(planOpen(folder("/notes"), "/notes")).toBeNull();
  });

  test("a note in the open vault is just brought up", () => {
    expect(planOpen(file("/notes/a/b.md"), "/notes")).toEqual({ select: "/notes/a/b.md" });
  });

  test("a note elsewhere brings its own folder", () => {
    expect(planOpen(file("/other/b.md"), "/notes")).toEqual({ folder: "/other", focus: "/other/b.md" });
    expect(planOpen(file("/other/b.md"), null)).toEqual({ folder: "/other", focus: "/other/b.md" });
  });

  test("a folder whose name only starts like the vault's is not inside it", () => {
    expect(planOpen(file("/notes-old/b.md"), "/notes")).toEqual({
      folder: "/notes-old",
      focus: "/notes-old/b.md",
    });
  });

  test("reads a Windows path", () => {
    expect(planOpen(file("C:\\notes\\a.md"), "C:\\notes")).toEqual({ select: "C:\\notes\\a.md" });
    expect(planOpen(file("D:\\x\\a.md"), "C:\\notes")).toEqual({ folder: "D:\\x", focus: "D:\\x\\a.md" });
  });

  // A note moved into a window of its own: that window has nothing open yet,
  // and opens the vault the note is in with the note alone in it.
  test("a note sent to its own window opens its vault, alone", () => {
    const moved = { kind: "file" as const, path: "/notes/sub/a.md", vault: "/notes" };
    expect(planOpen(moved, null)).toEqual({ folder: "/notes", focus: "/notes/sub/a.md", alone: true });
  });

  test("in a window that already has that vault, it is just brought up", () => {
    const moved = { kind: "file" as const, path: "/notes/sub/a.md", vault: "/notes" };
    expect(planOpen(moved, "/notes")).toEqual({ select: "/notes/sub/a.md" });
  });
});
