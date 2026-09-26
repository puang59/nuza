import { describe, expect, test } from "bun:test";
import { isWithin, rewritePath } from "../src/lib/path";

describe("isWithin", () => {
  test("a path is within itself", () => {
    expect(isWithin("/v/a.md", "/v/a.md")).toBe(true);
  });

  test("a descendant is within its ancestor, either separator", () => {
    expect(isWithin("/v/notes/a.md", "/v/notes")).toBe(true);
    expect(isWithin("C:\\v\\notes\\a.md", "C:\\v\\notes")).toBe(true);
  });

  test("a sibling that merely shares a prefix is not", () => {
    expect(isWithin("/v/notes-archive/a.md", "/v/notes")).toBe(false);
  });
});

describe("rewritePath", () => {
  test("moves a renamed file", () => {
    expect(rewritePath("/v/a.md", "/v/a.md", "/v/b.md")).toBe("/v/b.md");
  });

  test("carries descendants along with a renamed folder", () => {
    expect(rewritePath("/v/notes/sub/x.md", "/v/notes", "/v/archive")).toBe("/v/archive/sub/x.md");
  });

  test("leaves unrelated paths alone", () => {
    expect(rewritePath("/other/z.md", "/v/a.md", "/v/b.md")).toBe("/other/z.md");
    expect(rewritePath("/v/notes-archive/x.md", "/v/notes", "/v/gone")).toBe("/v/notes-archive/x.md");
  });

  // The reason this module exists: String.replace reads these in its
  // replacement, so renaming a note to one of them used to rewrite every open
  // tab's path into nonsense.
  test.each([["/v/costs $' stuff.md"], ["/v/$& total.md"], ["/v/100$ and $1.md"], ["/v/$`x.md"]])(
    "treats %s as literal text",
    (to) => {
      expect(rewritePath("/v/a.md", "/v/a.md", to)).toBe(to);
    }
  );

  test("keeps dollar patterns literal for descendants too", () => {
    expect(rewritePath("/v/deep/n.md", "/v/deep", "/v/$`x")).toBe("/v/$`x/n.md");
  });

  test("supports Windows separators", () => {
    expect(rewritePath("C:\\v\\notes\\f.md", "C:\\v\\notes", "C:\\v\\$1")).toBe("C:\\v\\$1\\f.md");
  });
});
