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
  test("draws a line and lists a name for each heading down to the third level", () => {
    const html = renderToStaticMarkup(
      <SectionGuides outline={{ headings, active: 2, headingOffscreen: false }} onJump={noop} />
    );
    // Five of the six: the fifth-level aside is too deep for the rail.
    expect(html.match(/<button/g)).toHaveLength(5);
    expect(html.match(/h-\[2px\]/g)).toHaveLength(5);
    expect(html).not.toContain(">Aside<");
    const current = html.split("<button").filter((name) => name.includes('aria-current="location"'));
    expect(current).toHaveLength(1);
    expect(current[0]).toContain(">Install<");
  });

  // The section in view can be deeper than the rail goes.
  test("lights the nearest heading above when the one in view is too deep to show", () => {
    const html = renderToStaticMarkup(
      <SectionGuides outline={{ headings, active: 5, headingOffscreen: false }} onJump={noop} />
    );
    const current = html.split("<button").filter((name) => name.includes('aria-current="location"'));
    expect(current).toHaveLength(1);
    expect(current[0]).toContain(">Usage<");
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
