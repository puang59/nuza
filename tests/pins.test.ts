import { describe, expect, test } from "bun:test";
import { forgetPins, movePins, readPins, togglePin } from "../src/lib/pins";

describe("readPins", () => {
  test("keeps lists of paths per vault and drops anything else", () => {
    expect(readPins({ "/v": ["/v/a.md", 3, "", "/v/a.md"], "/w": "x" })).toEqual({ "/v": ["/v/a.md"] });
    expect(readPins(null)).toEqual({});
    expect(readPins(["/v/a.md"])).toEqual({});
  });
});

describe("togglePin", () => {
  test("pins in order, and unpins", () => {
    let pins = togglePin({}, "/v", "/v/a.md");
    pins = togglePin(pins, "/v", "/v/b.md");
    expect(pins).toEqual({ "/v": ["/v/a.md", "/v/b.md"] });
    expect(togglePin(pins, "/v", "/v/a.md")).toEqual({ "/v": ["/v/b.md"] });
    expect(togglePin({ "/v": ["/v/a.md"] }, "/v", "/v/a.md")).toEqual({});
  });

  test("each vault has its own", () => {
    expect(togglePin({ "/v": ["/v/a.md"] }, "/w", "/w/a.md")).toEqual({
      "/v": ["/v/a.md"],
      "/w": ["/w/a.md"],
    });
  });
});

describe("movePins and forgetPins", () => {
  test("a renamed note, or a moved folder, takes its pins along", () => {
    const pins = { "/v": ["/v/a.md", "/v/dir/b.md"] };
    expect(movePins(pins, "/v/a.md", "/v/c.md")).toEqual({ "/v": ["/v/c.md", "/v/dir/b.md"] });
    expect(movePins(pins, "/v/dir", "/v/other/dir")).toEqual({ "/v": ["/v/a.md", "/v/other/dir/b.md"] });
  });

  test("nothing to follow returns the same object", () => {
    const pins = { "/v": ["/v/a.md"] };
    expect(movePins(pins, "/v/x.md", "/v/y.md")).toBe(pins);
    expect(forgetPins(pins, "/v/x.md")).toBe(pins);
  });

  test("deleting a note or its folder unpins it", () => {
    expect(forgetPins({ "/v": ["/v/a.md", "/v/dir/b.md"] }, "/v/dir")).toEqual({ "/v": ["/v/a.md"] });
    expect(forgetPins({ "/v": ["/v/a.md"] }, "/v/a.md")).toEqual({});
  });
});
