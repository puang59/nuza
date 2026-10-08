import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import SectionGuides from "../src/components/SectionGuides";
import { headingPath } from "../src/lib/markdown/headings";

const headings = [
  { level: 1, text: "Guide", from: 0 },
  { level: 2, text: "Setup", from: 10 },
  { level: 3, text: "Install", from: 20 },
  { level: 3, text: "Configure", from: 30 },
  { level: 2, text: "Usage", from: 40 },
  { level: 5, text: "Aside", from: 50 },
];
const noop = () => {};

describe("headingPath", () => {
  test("is the headings a section sits under, outermost first", () => {
    expect(headingPath(headings, 3).map((heading) => heading.text)).toEqual(["Guide", "Setup", "Configure"]);
    expect(headingPath(headings, 4).map((heading) => heading.text)).toEqual(["Guide", "Usage"]);
    expect(headingPath(headings, 0).map((heading) => heading.text)).toEqual(["Guide"]);
  });

  test("is empty above the first heading", () => {
    expect(headingPath(headings, -1)).toEqual([]);
    expect(headingPath([], 0)).toEqual([]);
  });

  // A note that skips a level still has a path through the levels it has.
  test("follows the levels that are there", () => {
    expect(headingPath(headings, 5).map((heading) => heading.text)).toEqual(["Guide", "Usage", "Aside"]);
  });
});

describe("SectionGuides", () => {
  test("marks each heading down to the third level, and the one in view", () => {
    const html = renderToStaticMarkup(
      <SectionGuides outline={{ headings, active: 2, headingOffscreen: false }} onJump={noop} />
    );
    expect(html.match(/<button/g)).toHaveLength(5);
    expect(html).not.toContain('aria-label="Aside"');
    const current = html.split("<button").filter((mark) => mark.includes('aria-current="location"'));
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('aria-label="Install"');
  });

  test("names the section only once its heading has scrolled away", () => {
    const shown = renderToStaticMarkup(
      <SectionGuides outline={{ headings, active: 2, headingOffscreen: true }} onJump={noop} />
    );
    expect(shown).toContain("Back to this section");
    const hidden = renderToStaticMarkup(
      <SectionGuides outline={{ headings, active: 2, headingOffscreen: false }} onJump={noop} />
    );
    expect(hidden).not.toContain("Back to this section");
  });

  test("is not there for a note with fewer than two headings", () => {
    const html = renderToStaticMarkup(
      <SectionGuides
        outline={{ headings: headings.slice(0, 1), active: 0, headingOffscreen: true }}
        onJump={noop}
      />
    );
    expect(html).toBe("");
  });
});
