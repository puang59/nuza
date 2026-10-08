import { describe, expect, test } from "bun:test";
import { untitledName } from "../src/lib/noteName";

describe("untitledName", () => {
  test("is Untitled.md in a folder with nothing of that name", () => {
    expect(untitledName([])).toBe("Untitled.md");
    expect(untitledName(["notes.md", "Untitled.txt"])).toBe("Untitled.md");
  });

  test("counts up past the names already taken", () => {
    expect(untitledName(["Untitled.md"])).toBe("Untitled 1.md");
    expect(untitledName(["Untitled.md", "Untitled 1.md", "Untitled 3.md"])).toBe("Untitled 2.md");
  });

  test("does not tell names apart by case, as most filesystems do not", () => {
    expect(untitledName(["untitled.md", "UNTITLED 1.MD"])).toBe("Untitled 2.md");
  });

  // For a name that turned out to be taken after all: the next one along.
  test("can be asked for the next free name after the first", () => {
    expect(untitledName(["Untitled.md"], 1)).toBe("Untitled 2.md");
    expect(untitledName([], 2)).toBe("Untitled 2.md");
  });
});
