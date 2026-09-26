import { describe, expect, test } from "bun:test";
import { rewritePath } from "../src/lib/path";

describe("rewritePath", () => {
  test("treats dollar patterns in the new path literally", () => {
    expect(rewritePath("/notes/costs.md", "/notes/costs.md", "/notes/costs $' stuff.md")).toBe(
      "/notes/costs $' stuff.md"
    );
    expect(rewritePath("/notes/folder/child.md", "/notes/folder", "/notes/$& archive")).toBe(
      "/notes/$& archive/child.md"
    );
  });

  test("does not rewrite paths outside the renamed entry", () => {
    expect(rewritePath("/notes/folder-old/file.md", "/notes/folder", "/notes/archive")).toBe(
      "/notes/folder-old/file.md"
    );
  });

  test("supports Windows separators", () => {
    expect(rewritePath("C:\\notes\\folder\\file.md", "C:\\notes\\folder", "C:\\notes\\$1")).toBe(
      "C:\\notes\\$1\\file.md"
    );
  });
});
