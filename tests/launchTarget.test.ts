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

  test("a note from elsewhere gets a window of its own, rather than taking the vault's place", () => {
    expect(planOpen(file("/other/b.md"), "/notes")).toEqual({ window: "/other/b.md" });
  });

  test("in a window with nothing open, a note on its own opens there, with its folder", () => {
    const single = { folder: "/other", focus: "/other/b.md", alone: true, single: true };
    expect(planOpen(file("/other/b.md"), null)).toEqual(single);
    expect(planOpen({ ...file("/other/b.md"), single: true }, "/somewhere")).toEqual(single);
  });

  test("a folder whose name only starts like the vault's is not inside it", () => {
    expect(planOpen(file("/notes-old/b.md"), "/notes")).toEqual({ window: "/notes-old/b.md" });
  });

  test("reads a Windows path", () => {
    expect(planOpen(file("C:\\notes\\a.md"), "C:\\notes")).toEqual({ select: "C:\\notes\\a.md" });
    expect(planOpen(file("D:\\x\\a.md"), "C:\\notes")).toEqual({ window: "D:\\x\\a.md" });
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

// With a drive open as the vault, `nuza D:\notes\a.md` used to be read as a
// note outside it and re-root the window onto `D:\notes`, putting away every
// tab the session had.
describe("a vault at a drive or filesystem root", () => {
  test("a note in it is selected, not opened as its own folder", () => {
    expect(planOpen({ kind: "file", path: "C:\\notes\\a.md" }, "C:\\")).toEqual({
      select: "C:\\notes\\a.md",
    });
    expect(planOpen({ kind: "file", path: "/notes/a.md" }, "/")).toEqual({ select: "/notes/a.md" });
  });

  test("a note on another drive gets a window of its own", () => {
    expect(planOpen({ kind: "file", path: "D:\\a.md" }, "C:\\")).toEqual({ window: "D:\\a.md" });
  });
});
