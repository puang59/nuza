import { describe, expect, test } from "bun:test";
import {
  DEFAULT_APPEARANCE,
  THEMES,
  appearanceVariables,
  isThemeChoice,
  paletteFor,
} from "../src/lib/appearance";

describe("appearanceVariables by theme", () => {
  test("paints the dark theme as it always was", () => {
    const vars = appearanceVariables(DEFAULT_APPEARANCE, true, "dark");
    expect(vars["--nuza-bg"]).toBe(THEMES.dark.background);
    expect(vars["--nuza-fg"]).toBe(THEMES.dark.foreground);
    expect(vars["--nuza-accent"]).toBe(DEFAULT_APPEARANCE.accent);
    expect(vars["--nuza-syntax-string"]).toBe("#96FF96");
  });

  test("swaps the background and ink as a pair for light", () => {
    const vars = appearanceVariables(DEFAULT_APPEARANCE, true, "light");
    expect(vars["--nuza-bg"]).toBe(THEMES.light.background);
    expect(vars["--nuza-fg"]).toBe(THEMES.light.foreground);
  });

  test("takes the accent down on light, as a colour more can be worked out from", () => {
    const vars = appearanceVariables({ ...DEFAULT_APPEARANCE, accent: "#FF9696" }, true, "light");
    expect(vars["--nuza-accent"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(vars["--nuza-accent"]).not.toBe("#FF9696");
    // Everything derived from the accent follows the darker one.
    expect(vars["--nuza-accent-wash"]).toBe(
      `rgba(${parseInt(vars["--nuza-accent"].slice(1, 3), 16)}, ${parseInt(vars["--nuza-accent"].slice(3, 5), 16)}, ${parseInt(vars["--nuza-accent"].slice(5, 7), 16)}, 0.24)`
    );
  });

  test("gives headings more contrast than body text on either theme", () => {
    for (const theme of ["dark", "light"] as const) {
      const vars = appearanceVariables(DEFAULT_APPEARANCE, true, theme);
      expect(vars["--nuza-heading"]).not.toBe(vars["--nuza-fg"]);
    }
  });
});

describe("isThemeChoice", () => {
  test("takes the three choices and nothing else", () => {
    expect(["dark", "light", "system"].every(isThemeChoice)).toBe(true);
    expect(isThemeChoice("sepia")).toBe(false);
    expect(isThemeChoice(undefined)).toBe(false);
  });
});

describe("chosen colours", () => {
  test("a readable pair is used as chosen", () => {
    const appearance = {
      ...DEFAULT_APPEARANCE,
      palettes: { dark: { background: "#101820", text: "#F0E6D2" } },
    };
    expect(paletteFor(appearance, "dark")).toEqual({
      background: "#101820",
      foreground: "#F0E6D2",
      putBack: null,
    });
    expect(appearanceVariables(appearance, true, "dark")["--nuza-bg"]).toBe("#101820");
  });

  test("text too close to the background gives way to the theme's own", () => {
    const appearance = { ...DEFAULT_APPEARANCE, palettes: { dark: { text: "#2A2A2A" } } };
    expect(paletteFor(appearance, "dark")).toEqual({
      background: "#1E1E1E",
      foreground: "#D4D4D8",
      putBack: "text",
    });
  });

  test("a background nothing can be read on gives way too", () => {
    const appearance = {
      ...DEFAULT_APPEARANCE,
      palettes: { dark: { background: "#C8C8C8", text: "#D0D0D0" } },
    };
    expect(paletteFor(appearance, "dark")).toEqual({
      background: "#1E1E1E",
      foreground: "#D0D0D0",
      putBack: "background",
    });
  });

  test("each theme keeps its own", () => {
    const appearance = { ...DEFAULT_APPEARANCE, palettes: { dark: { background: "#000000" } } };
    expect(paletteFor(appearance, "light").background).toBe("#FBFBFA");
  });
});
