import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import ChangedOnDisk from "../src/components/ChangedOnDisk";

const noop = () => {};

describe("ChangedOnDisk", () => {
  test("says nothing when there is nothing to ask", () => {
    expect(renderToStaticMarkup(<ChangedOnDisk path={null} onReload={noop} onKeepMine={noop} />)).toBe("");
  });

  test("offers both copies of a note that changed on disk", () => {
    const html = renderToStaticMarkup(<ChangedOnDisk path="/v/note.md" onReload={noop} onKeepMine={noop} />);
    expect(html).toContain("changed on disk");
    expect(html).toContain("Use the file");
    expect(html).toContain("Keep my edits");
  });

  // There is no copy on disk to take, so "Use the file" is not an answer.
  test("offers to put back or let go of a note whose file has gone", () => {
    const html = renderToStaticMarkup(
      <ChangedOnDisk path="/v/note.md" missing onReload={noop} onKeepMine={noop} onDiscard={noop} />
    );
    expect(html).toContain("no longer on disk");
    expect(html).toContain("Save it here again");
    expect(html).toContain("Close without saving");
    expect(html).not.toContain("Use the file");
  });
});
