import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import Outline from "../src/components/Sidebar/Outline";

const noop = () => {};
const headings = [
  { level: 2, text: "Setup", from: 0 },
  { level: 3, text: "Install", from: 20 },
  { level: 2, text: "Usage", from: 60 },
];

describe("Outline", () => {
  test("lists the headings and marks the section in view", () => {
    const html = renderToStaticMarkup(
      <Outline headings={headings} active={1} isOpen onToggle={noop} onJump={noop} />
    );
    for (const heading of headings) expect(html).toContain(heading.text);
    const marked = html.split("<li").filter((row) => row.includes('aria-current="location"'));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain("Install");
  });

  // A note that starts at `##` is not set in by a level nobody wrote.
  test("sets rows in from the shallowest level the note uses", () => {
    const html = renderToStaticMarkup(
      <Outline headings={headings} active={-1} isOpen onToggle={noop} onJump={noop} />
    );
    expect(html).toContain("padding-left:0.5rem");
    expect(html).toContain("padding-left:1.25rem");
    expect(html).not.toContain('aria-current="location"');
  });

  test("says so when the note has no headings", () => {
    const html = renderToStaticMarkup(
      <Outline headings={[]} active={-1} isOpen onToggle={noop} onJump={noop} />
    );
    expect(html).toContain("No headings in this note.");
  });
});
