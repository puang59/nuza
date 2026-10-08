import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import GettingStarted from "../src/components/GettingStarted";
import { describeStartingPoint, startingPoints } from "../src/lib/gettingStarted";
import { KEYMAP_ACTIONS, KeymapAction } from "../src/lib/keymaps";
import type { DocumentStats } from "../src/lib/documentStats";

const bindings = Object.fromEntries(
  KEYMAP_ACTIONS.map((action) => [action.id, action.defaultBinding])
) as Record<KeymapAction, string>;

/** A stats subscription that says the note has `characters` in it. */
const withCharacters = (characters: number) => (listener: (stats: DocumentStats) => void) => {
  listener({ words: 0, characters, paragraphs: 0, line: 1, column: 1 });
  return () => {};
};

function render(props: { onScratch: boolean; hasVault: boolean }) {
  return renderToStaticMarkup(
    <GettingStarted {...props} subscribeToStats={withCharacters(0)} bindings={bindings} onRun={() => {}} />
  );
}

describe("startingPoints", () => {
  test("with no folder open, the way in is opening one", () => {
    expect(startingPoints(false).map((point) => point.action)).toEqual(["open-folder", "open-settings"]);
  });

  test("with a folder open, it is a note to write in and a way to find the others", () => {
    const actions = startingPoints(true).map((point) => point.action);
    expect(actions.slice(0, 2)).toEqual(["new-note", "quick-open"]);
    expect(actions).not.toContain("open-folder");
  });

  test("every one of them is an action that exists", () => {
    const known = new Set(KEYMAP_ACTIONS.map((action) => action.id));
    for (const point of [...startingPoints(true), ...startingPoints(false)])
      expect(known.has(point.action)).toBe(true);
  });
});

describe("describeStartingPoint", () => {
  test("puts the keys in brackets, as they are written on each platform", () => {
    expect(describeStartingPoint("Create new note", "mod+n", true)).toBe("Create new note (\u2318N)");
    expect(describeStartingPoint("Create new note", "mod+n", false)).toBe("Create new note (Ctrl+N)");
  });

  test("an action with no keys is just its name", () => {
    expect(describeStartingPoint("Settings", "", true)).toBe("Settings");
  });
});

describe("GettingStarted", () => {
  test("shows the ways in on an empty scratch note", () => {
    const html = render({ onScratch: true, hasVault: false });
    expect(html).toContain("Open a folder");
    expect(html).toContain("Or just start typing");
  });

  test("offers a new note once a folder is open", () => {
    const html = render({ onScratch: true, hasVault: true });
    expect(html).toContain("Create new note");
    expect(html).toContain("Go to file");
  });

  test("is not there over a note that is a file", () => {
    expect(render({ onScratch: false, hasVault: true })).toBe("");
  });
});
