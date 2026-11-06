import { describe, expect, test } from "bun:test";
import { VIM_BAR_PRESETS, resolveVimBarColor, vimBarBadge, vimBarColors } from "../src/lib/vimBar";

describe("vim bar colours", () => {
  test("Classic is what the bar always was", () => {
    expect(vimBarColors({ preset: "classic" })).toEqual({
      normal: "#9696FF",
      insert: "#96FF96",
      visual: "#FFFF96",
      replace: "#FF9696",
      clock: "accent",
    });
  });

  test("an unknown preset, or nothing stored, falls back to Classic", () => {
    expect(vimBarColors({ preset: "gone" })).toEqual(VIM_BAR_PRESETS[0].colors);
    expect(vimBarColors(null)).toEqual(VIM_BAR_PRESETS[0].colors);
  });

  test("a custom colour that is not a colour gives way to Classic's", () => {
    const colors = vimBarColors({
      preset: "custom",
      custom: { normal: "#123456", insert: "nope", visual: "ink", replace: "#FF0000", clock: "accent" },
    });
    expect(colors.normal).toBe("#123456");
    expect(colors.insert).toBe("#96FF96");
    expect(colors.visual).toBe("ink");
  });

  test("a preset keeps the custom colours for when Custom is picked again", () => {
    const custom = {
      normal: "#123456",
      insert: "#96FF96",
      visual: "#FFFF96",
      replace: "#FF9696",
      clock: "accent",
    };
    expect(vimBarColors({ preset: "nord", custom }).normal).toBe("#88C0D0");
    expect(vimBarColors({ preset: "custom", custom }).normal).toBe("#123456");
  });

  test("badge ink is whichever of black and white reads on it", () => {
    expect(vimBarBadge("#FFFF96").color).toBe("#000000");
    expect(vimBarBadge("#1E1E2E").color).toBe("#FFFFFF");
    expect(vimBarBadge("ink")).toEqual({ background: "var(--nuza-fg)", color: "var(--nuza-bg)" });
  });

  test("the colours that follow the window resolve for the picker", () => {
    const window = { accent: "#FF9696", ink: "#D4D4D8" };
    expect(resolveVimBarColor("accent", window)).toBe("#FF9696");
    expect(resolveVimBarColor("ink", window)).toBe("#D4D4D8");
    expect(resolveVimBarColor("#123456", window)).toBe("#123456");
  });
});
