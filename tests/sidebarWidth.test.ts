import { describe, expect, test } from "bun:test";
import { MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, clampWidth } from "../src/hooks/useResizableSidebar";

describe("sidebar width", () => {
  // The four view names need this much to read in full.
  test("is never narrower than its view names need", () => {
    expect(MIN_SIDEBAR_WIDTH).toBeGreaterThanOrEqual(224);
    expect(clampWidth(40)).toBe(MIN_SIDEBAR_WIDTH);
  });

  // A width kept by a build with a narrower minimum comes back within today's.
  test("a width from storage is held to the limits", () => {
    expect(clampWidth(160)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampWidth(300)).toBe(300);
    expect(clampWidth(9000)).toBe(MAX_SIDEBAR_WIDTH);
    expect(clampWidth(Number.NaN)).toBeGreaterThanOrEqual(MIN_SIDEBAR_WIDTH);
  });
});
