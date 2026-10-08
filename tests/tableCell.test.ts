import { describe, expect, test } from "bun:test";
import { escapeCell, unescapeCell } from "../src/lib/markdown/widgets";

describe("table cell text", () => {
  test("a pipe is escaped on the way into the table and read back as a pipe", () => {
    expect(escapeCell("a | b")).toBe("a \\| b");
    expect(unescapeCell("a \\| b")).toBe("a | b");
  });

  // What the cell's field does on every keystroke: it is filled with the
  // cell as it reads, and writes back what is typed. Escaping the source
  // itself turned `\|` into `\\|`, which is a backslash and a new column.
  test("editing a cell that holds a pipe leaves it one cell", () => {
    const source = "a \\| b";
    const typed = unescapeCell(source) + "c";
    expect(escapeCell(typed)).toBe("a \\| bc");
    expect(escapeCell(unescapeCell(source))).toBe(source);
  });

  test("a pasted newline does not start a new row", () => {
    expect(escapeCell("one\r\ntwo\nthree")).toBe("one two three");
  });
});
