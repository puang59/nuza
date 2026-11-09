import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import ViewSwitcher, { readView } from "../src/components/Sidebar/ViewSwitcher";
import { sidebarViews } from "../src/lib/registries/sidebarViews";

describe("sidebar views", () => {
  test("offers the four views and marks the one that is showing", () => {
    const html = renderToStaticMarkup(<ViewSwitcher view="outline" onChange={() => {}} />);
    for (const label of ["Files", "Outline", "Tags", "Links"]) expect(html).toContain(`>${label}</button>`);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html.split("<button").find((tab) => tab.includes('aria-selected="true"'))).toContain("Outline");
    // The highlight sits behind the second of the four.
    expect(html).toContain("translateX(100%)");
  });

  test("anything in storage that is not a view reads as the files", () => {
    expect(readView("tags")).toBe("tags");
    expect(readView("graph")).toBe("files");
    expect(readView(null)).toBe("files");
    expect(readView(3)).toBe("files");
  });

  test("an added view reads as itself only while it is added", () => {
    expect(readView("kanban:board", ["kanban:board"])).toBe("kanban:board");
    expect(readView("kanban:board", [])).toBe("files");
  });

  test("offers added views after nuza's four, sharing the row equally", () => {
    const added = sidebarViews.register({ id: "kanban:board", label: "Board", mount() {} }, "kanban");
    try {
      const html = renderToStaticMarkup(<ViewSwitcher view="kanban:board" onChange={() => {}} />);
      expect(html).toContain(">Board</button>");
      expect(html).toContain("repeat(5, minmax(0, 1fr))");
      expect(html.split("<button").find((tab) => tab.includes('aria-selected="true"'))).toContain("Board");
      expect(html).toContain("translateX(400%)");
    } finally {
      added.dispose();
    }
  });
});
