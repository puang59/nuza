import { describe, expect, test } from "bun:test";
import { changelogUrl } from "../src/hooks/useAppUpdater";

describe("the changelog", () => {
  test("opens the notes of the version being run", () => {
    expect(changelogUrl("1.2.0")).toBe("https://github.com/puang59/nuza/releases/tag/app-v1.2.0");
  });

  test("falls back to every release when the version is not known", () => {
    expect(changelogUrl(null)).toBe("https://github.com/puang59/nuza/releases");
  });
});
