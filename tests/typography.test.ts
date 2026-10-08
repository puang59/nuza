import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CONTENT_WIDTH,
  DEFAULT_LINE_HEIGHT,
  MAX_CONTENT_WIDTH,
  MAX_LINE_HEIGHT,
  MIN_CONTENT_WIDTH,
  MIN_LINE_HEIGHT,
  applyTypography,
  clampContentWidth,
  clampLineHeight,
} from "../src/lib/fonts";

describe("text column width", () => {
  test("the default is the width the column has always had", () => {
    // 44rem at the app's 16px root.
    expect(DEFAULT_CONTENT_WIDTH).toBe(44 * 16);
  });

  test("is held between its limits, and whole", () => {
    expect(clampContentWidth(100)).toBe(MIN_CONTENT_WIDTH);
    expect(clampContentWidth(99999)).toBe(MAX_CONTENT_WIDTH);
    expect(clampContentWidth(800.4)).toBe(800);
    expect(clampContentWidth(Number.NaN)).toBe(DEFAULT_CONTENT_WIDTH);
  });
});

describe("line height", () => {
  test("is held between its limits", () => {
    expect(clampLineHeight(0.5)).toBe(MIN_LINE_HEIGHT);
    expect(clampLineHeight(9)).toBe(MAX_LINE_HEIGHT);
    expect(clampLineHeight(Number.NaN)).toBe(DEFAULT_LINE_HEIGHT);
  });

  // A slider and a round trip through storage are both good at this.
  test("comes back as a clean step, not a float\u2019s idea of one", () => {
    expect(clampLineHeight(1.7500000000000002)).toBe(1.75);
    expect(clampLineHeight(1.3 + 0.05 * 3)).toBe(1.45);
    expect(clampLineHeight(1.62)).toBe(1.6);
  });
});

describe("applyTypography", () => {
  test("hands both measurements to the stylesheet, clamped", () => {
    const set = new Map<string, string>();
    const root = { style: { setProperty: (name: string, value: string) => void set.set(name, value) } };

    applyTypography(root as unknown as HTMLElement, { contentWidth: 900, lineHeight: 1.5 });
    expect(set.get("--nuza-measure")).toBe("900px");
    expect(set.get("--nuza-line-height")).toBe("1.5");

    applyTypography(root as unknown as HTMLElement, { contentWidth: 10, lineHeight: 50 });
    expect(set.get("--nuza-measure")).toBe(`${MIN_CONTENT_WIDTH}px`);
    expect(set.get("--nuza-line-height")).toBe(String(MAX_LINE_HEIGHT));
  });
});
