import { describe, expect, test } from "bun:test";
import { tabLabels, tabsToClose } from "../src/lib/tabLabels";

describe("tabLabels", () => {
  test("a tab is called by its file name, with no hint, while that is enough", () => {
    const labels = tabLabels(["/v/a.md", "/v/notes/b.md"]);
    expect(labels.get("/v/a.md")).toEqual({ name: "a.md" });
    expect(labels.get("/v/notes/b.md")).toEqual({ name: "b.md" });
  });

  test("two notes of the same name are told apart by their folders", () => {
    const labels = tabLabels(["/v/projects/README.md", "/v/notes/README.md", "/v/other.md"]);
    expect(labels.get("/v/projects/README.md")).toEqual({ name: "README.md", hint: "projects" });
    expect(labels.get("/v/notes/README.md")).toEqual({ name: "README.md", hint: "notes" });
    expect(labels.get("/v/other.md")?.hint).toBeUndefined();
  });

  test("goes further up when the folders share a name too", () => {
    const labels = tabLabels(["/v/a/docs/index.md", "/v/b/docs/index.md"]);
    expect(labels.get("/v/a/docs/index.md")?.hint).toBe("a/docs");
    expect(labels.get("/v/b/docs/index.md")?.hint).toBe("b/docs");
  });

  test("reads either kind of separator", () => {
    const labels = tabLabels(["C:\\v\\one\\n.md", "C:\\v\\two\\n.md"]);
    expect(labels.get("C:\\v\\one\\n.md")).toEqual({ name: "n.md", hint: "one" });
  });

  test("a note at the top beside one in a folder still gets told apart", () => {
    const labels = tabLabels(["n.md", "sub/n.md"]);
    expect(labels.get("sub/n.md")?.hint).toBe("sub");
    expect(labels.get("n.md")?.hint).toBeUndefined();
  });
});

describe("tabsToClose", () => {
  const tabs = ["a", "b", "c", "d"];

  test("the others are every tab but the one asked from", () => {
    expect(tabsToClose(tabs, "b", "others")).toEqual(["a", "c", "d"]);
  });

  test("to the right is everything after it, and nothing after the last", () => {
    expect(tabsToClose(tabs, "b", "right")).toEqual(["c", "d"]);
    expect(tabsToClose(tabs, "d", "right")).toEqual([]);
  });

  test("a tab that is not there closes nothing", () => {
    expect(tabsToClose(tabs, "z", "others")).toEqual([]);
  });
});
