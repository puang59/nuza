import { describe, expect, test } from "bun:test";
import { TITLE_PROMPT, withoutUntouchedPrompt } from "../src/lib/titlePrompt";

describe("withoutUntouchedPrompt", () => {
  test("the prompt alone is written as nothing", () => {
    expect(withoutUntouchedPrompt(TITLE_PROMPT)).toBe("");
    expect(withoutUntouchedPrompt("#\n")).toBe("");
  });

  test("anything typed is kept as it is", () => {
    expect(withoutUntouchedPrompt("# Groceries")).toBe("# Groceries");
    expect(withoutUntouchedPrompt("# \n\nsome text")).toBe("# \n\nsome text");
    expect(withoutUntouchedPrompt("")).toBe("");
  });
});
