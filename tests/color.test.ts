import { describe, expect, test } from "bun:test";
import { hexToHsv, hsvToHex, normalizeHex } from "../src/lib/color";

describe("normalizeHex", () => {
  test("accepts three and six digits, with or without the hash", () => {
    expect(normalizeHex("#F96")).toBe("#ff9966");
    expect(normalizeHex("ff9696")).toBe("#ff9696");
    expect(normalizeHex("  #AbCdEf ")).toBe("#abcdef");
  });

  test("rejects anything else", () => {
    expect(normalizeHex("#ff")).toBeNull();
    expect(normalizeHex("#gggggg")).toBeNull();
    expect(normalizeHex("")).toBeNull();
  });
});

describe("hsv round trip", () => {
  test("primaries land on their hues", () => {
    expect(hexToHsv("#ff0000")).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv("#00ff00").h).toBe(120);
    expect(hexToHsv("#0000ff").h).toBe(240);
    expect(hexToHsv("#000000")).toEqual({ h: 0, s: 0, v: 0 });
  });

  test("every colour comes back as it went in", () => {
    for (const hex of ["#ff9696", "#1e1e2e", "#abcdef", "#ffffff", "#7f7f7f", "#010203"]) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });

  test("hue wraps and saturation clamps", () => {
    expect(hsvToHex({ h: 360, s: 1, v: 1 })).toBe("#ff0000");
    expect(hsvToHex({ h: 0, s: 2, v: 1 })).toBe("#ff0000");
  });
});
