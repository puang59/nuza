import { describe, expect, test } from "bun:test";
import { toAbsolute, toRelative } from "../src/lib/plugins/paths";

describe("paths a plugin gives", () => {
  test("are read as inside the vault, with either separator", () => {
    expect(toAbsolute("/vault", "notes/a.md")).toBe("/vault/notes/a.md");
    expect(toAbsolute("/vault/", "./notes//a.md")).toBe("/vault/notes/a.md");
    expect(toAbsolute("C:\\vault", "notes/a.md")).toBe("C:\\vault\\notes\\a.md");
  });

  test("can't leave the vault, or reach into nuza's own folder", () => {
    for (const path of [
      "../a.md",
      "notes/../../a.md",
      "/etc/passwd",
      "C:\\a.md",
      "\\\\server\\a",
      ".nuza/plugins.json",
      "",
      ".",
    ]) {
      expect(() => toAbsolute("/vault", path)).toThrow();
    }
  });
});

describe("paths a plugin is given", () => {
  test("are relative to the vault, with / between folders", () => {
    expect(toRelative("/vault", "/vault/notes/a.md")).toBe("notes/a.md");
    expect(toRelative("C:\\vault", "C:\\vault\\notes\\a.md")).toBe("notes/a.md");
  });

  test("are nothing for a path outside the vault, or in nuza's own folder", () => {
    expect(toRelative("/vault", "/vaulted/a.md")).toBeNull();
    expect(toRelative("/vault", "/elsewhere/a.md")).toBeNull();
    expect(toRelative("/vault", "/vault/.nuza/plugins.json")).toBeNull();
  });
});
