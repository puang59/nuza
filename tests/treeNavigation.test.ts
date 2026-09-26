import { beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

beforeAll(() => {
  const window = new Window();
  globalThis.document = window.document as unknown as Document;
  globalThis.HTMLElement = window.HTMLElement as unknown as typeof HTMLElement;
});

/**
 * A tree shaped the way the sidebar draws one: a folder is a `<details>` whose
 * `<summary>` carries the row, with its children in the `<ul>` after it.
 */
function tree(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

const VAULT = `
  <ul>
    <li>
      <details open>
        <summary data-path="/v/notes">notes</summary>
        <ul>
          <li><button data-path="/v/notes/a.md">a.md</button></li>
          <li>
            <details>
              <summary data-path="/v/notes/deep">deep</summary>
              <ul><li><button data-path="/v/notes/deep/b.md">b.md</button></li></ul>
            </details>
          </li>
        </ul>
      </details>
    </li>
    <li><button data-path="/v/top.md">top.md</button></li>
  </ul>
`;

const paths = (rows: HTMLElement[]) => rows.map((row) => row.getAttribute("data-path"));

describe("visibleRows", () => {
  test("reads the rows in the order they are drawn", async () => {
    const { visibleRows } = await import("../src/lib/treeNavigation");

    expect(paths(visibleRows(tree(VAULT)))).toEqual([
      "/v/notes",
      "/v/notes/a.md",
      "/v/notes/deep",
      "/v/top.md",
    ]);
  });

  // The row of a closed folder stays: it is the summary that is on screen, and
  // only what comes after it that is folded away.
  test("keeps a closed folder's own row and drops what is inside it", async () => {
    const { visibleRows } = await import("../src/lib/treeNavigation");
    const rows = visibleRows(tree(VAULT));

    expect(paths(rows)).toContain("/v/notes/deep");
    expect(paths(rows)).not.toContain("/v/notes/deep/b.md");
  });

  test("a folded top-level folder hides everything under it", async () => {
    const { visibleRows } = await import("../src/lib/treeNavigation");
    const root = tree(VAULT);
    root.querySelector("details")?.removeAttribute("open");

    expect(paths(visibleRows(root))).toEqual(["/v/notes", "/v/top.md"]);
  });
});

describe("rowAfter", () => {
  test("moves one row at a time", async () => {
    const { rowAfter, visibleRows } = await import("../src/lib/treeNavigation");
    const rows = visibleRows(tree(VAULT));

    expect(rowAfter(rows, rows[0], 1)?.getAttribute("data-path")).toBe("/v/notes/a.md");
    expect(rowAfter(rows, rows[2], -1)?.getAttribute("data-path")).toBe("/v/notes/a.md");
  });

  test("stops at either end rather than wrapping", async () => {
    const { rowAfter, visibleRows } = await import("../src/lib/treeNavigation");
    const rows = visibleRows(tree(VAULT));

    expect(rowAfter(rows, rows[0], -1)).toBe(rows[0]);
    expect(rowAfter(rows, rows[rows.length - 1], 1)).toBe(rows[rows.length - 1]);
  });

  test("starts at the near end when it is coming from nowhere", async () => {
    const { rowAfter, visibleRows } = await import("../src/lib/treeNavigation");
    const rows = visibleRows(tree(VAULT));

    expect(rowAfter(rows, null, 1)).toBe(rows[0]);
    expect(rowAfter(rows, null, -1)).toBe(rows[rows.length - 1]);
    expect(rowAfter([], null, 1)).toBeUndefined();
  });
});

describe("parentRow", () => {
  test("a nested row finds the folder it sits in", async () => {
    const { parentRow, visibleRows } = await import("../src/lib/treeNavigation");
    const root = tree(VAULT);
    const [, file] = visibleRows(root);

    expect(parentRow(file, root)?.getAttribute("data-path")).toBe("/v/notes");
  });

  test("a folder row finds the folder above it, not itself", async () => {
    const { parentRow, visibleRows } = await import("../src/lib/treeNavigation");
    const root = tree(VAULT);
    const deep = visibleRows(root)[2];

    expect(parentRow(deep, root)?.getAttribute("data-path")).toBe("/v/notes");
  });

  test("a top-level row has none", async () => {
    const { parentRow, visibleRows } = await import("../src/lib/treeNavigation");
    const root = tree(VAULT);
    const rows = visibleRows(root);

    expect(parentRow(rows[0], root)).toBeNull();
    expect(parentRow(rows[rows.length - 1], root)).toBeNull();
  });
});

describe("folderOf", () => {
  test("tells a folder row from a file row", async () => {
    const { folderOf, visibleRows } = await import("../src/lib/treeNavigation");
    const rows = visibleRows(tree(VAULT));

    expect(folderOf(rows[0])?.tagName).toBe("DETAILS");
    expect(folderOf(rows[1])).toBeNull();
  });
});
