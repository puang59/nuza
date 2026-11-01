import { describe, expect, test } from "bun:test";
import { movableInto, outermost, rowsBetween } from "../src/lib/treeSelection";

describe("outermost", () => {
  test("drops what is inside another picked folder", () => {
    expect(outermost(["/v/a", "/v/a/x.md", "/v/b.md"])).toEqual(["/v/a", "/v/b.md"]);
  });

  test("keeps folders that only share a prefix", () => {
    expect(outermost(["/v/a", "/v/ab/x.md"])).toEqual(["/v/a", "/v/ab/x.md"]);
  });
});

describe("movableInto", () => {
  test("skips what is already in the folder", () => {
    expect(movableInto(["/v/in/a.md", "/v/b.md"], "/v/in")).toEqual(["/v/b.md"]);
  });

  test("skips a folder being put inside itself", () => {
    expect(movableInto(["/v/a", "/v/b.md"], "/v/a/sub")).toEqual(["/v/b.md"]);
    expect(movableInto(["/v/a"], "/v/a")).toEqual([]);
  });
});

describe("rowsBetween", () => {
  const order = ["/v/a", "/v/a/x.md", "/v/b.md", "/v/c.md"];

  test("either way round", () => {
    expect(rowsBetween(order, "/v/a/x.md", "/v/c.md")).toEqual(["/v/a/x.md", "/v/b.md", "/v/c.md"]);
    expect(rowsBetween(order, "/v/c.md", "/v/a/x.md")).toEqual(["/v/a/x.md", "/v/b.md", "/v/c.md"]);
  });

  test("an anchor that is no longer shown picks just the row", () => {
    expect(rowsBetween(order, "/v/gone.md", "/v/b.md")).toEqual(["/v/b.md"]);
  });
});
