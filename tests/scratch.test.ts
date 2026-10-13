import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readScratch, writeScratch } from "../src/lib/scratch";

const data = new Map<string, string>();
const storage = {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => void data.set(key, value),
  removeItem: (key: string) => void data.delete(key),
};
(globalThis as unknown as { localStorage: typeof storage }).localStorage = storage;

/** Pretends to be running inside the window called `label`. */
function inWindow(label: string | null) {
  const scope = globalThis as unknown as { window?: unknown };
  if (label === null) delete scope.window;
  else
    scope.window = {
      __TAURI_INTERNALS__: { metadata: { currentWindow: { label }, currentWebview: { label } } },
    };
}

beforeEach(() => data.clear());
afterEach(() => inWindow(null));

describe("the untitled notes", () => {
  test("are kept by the main window", () => {
    inWindow("main");
    writeScratch({ "untitled.md": "a thought" });
    expect(readScratch()).toEqual({ "untitled.md": "a thought" });
  });

  test("are kept with no window to ask, as in a test", () => {
    writeScratch({ "untitled.md": "a thought" });
    expect(readScratch()).toEqual({ "untitled.md": "a thought" });
  });

  test("more than one can be kept at once", () => {
    inWindow("main");
    writeScratch({ "untitled.md": "the scratch note", "Untitled 1.md": "a second one" });
    expect(readScratch()).toEqual({ "untitled.md": "the scratch note", "Untitled 1.md": "a second one" });
  });

  test("none left with anything in them forgets the entry", () => {
    inWindow("main");
    writeScratch({ "untitled.md": "a thought" });
    writeScratch({ "untitled.md": "" });
    expect(data.has("nuza:scratch")).toBe(false);
  });

  test("a note with nothing in it is left out, even beside one that has", () => {
    inWindow("main");
    writeScratch({ "untitled.md": "a thought", "Untitled 1.md": "" });
    expect(readScratch()).toEqual({ "untitled.md": "a thought" });
  });

  test("another window starts empty, and does not take the main window's", () => {
    inWindow("main");
    writeScratch({ "untitled.md": "the main window's note" });

    inWindow("w-1");
    expect(readScratch()).toEqual({});
  });

  test("another window writing its own notes does not overwrite the main window's", () => {
    inWindow("main");
    writeScratch({ "untitled.md": "the main window's note" });

    inWindow("w-1");
    writeScratch({ "untitled.md": "typed in the other window" });
    writeScratch({});

    inWindow("main");
    expect(readScratch()).toEqual({ "untitled.md": "the main window's note" });
  });
});
