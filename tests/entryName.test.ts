import { describe, expect, test } from "bun:test";
import { nameProblem, newEntryProblem, withNoteExtension } from "../src/lib/entryName";

/** The problem, or "" when there is none, so a test can read as one line. */
function problem(name: string) {
  return nameProblem(name) ?? "";
}

describe("names that are fine", () => {
  test("an ordinary note", () => {
    expect(nameProblem("note.md")).toBeNull();
    expect(nameProblem("Notes from 2026 (draft).md")).toBeNull();
  });

  test("a folder with no extension", () => {
    expect(nameProblem("Journal")).toBeNull();
  });

  test("a name that is not in this alphabet", () => {
    expect(nameProblem("メモ.md")).toBeNull();
    expect(nameProblem("résumé.md")).toBeNull();
  });

  test("a dot in the middle is only an extension", () => {
    expect(nameProblem("v1.2.notes.md")).toBeNull();
  });

  test("surrounding whitespace is not the user's mistake to be told about", () => {
    expect(nameProblem("  note.md  ")).toBeNull();
  });
});

describe("names that would leave the vault", () => {
  // The bug this file exists for: `../../notes.md` was joined onto the parent
  // path and written outside the vault, and the row the sidebar then held
  // pointed somewhere the tree could not show.
  test("a relative path", () => {
    expect(problem("../../notes.md")).toContain("slash");
  });

  test("a path with a forward slash", () => {
    expect(problem("sub/note.md")).toContain("slash");
  });

  test("a path with a backslash", () => {
    expect(problem("sub\\note.md")).toContain("slash");
  });

  test("the directories themselves", () => {
    expect(problem(".")).toBe("That is not a name");
    expect(problem("..")).toBe("That is not a name");
  });
});

describe("names the filesystem would not keep as given", () => {
  test("a stream separator", () => {
    expect(problem("note.md:hidden")).toContain(":");
  });

  test("a wildcard", () => {
    expect(problem("draft?.md")).toContain("?");
    expect(problem("*.md")).toContain("*");
  });

  test("a control character", () => {
    expect(problem("note.md")).toContain("control");
  });

  test("a trailing dot or space, which Win32 drops silently", () => {
    expect(problem("report.")).toContain("end with");
    expect(problem("report .md ")).toBeFalsy();
  });

  test("a device name, whatever is put after it", () => {
    expect(problem("aux.md")).toContain("Windows");
    expect(problem("CON")).toContain("Windows");
    expect(problem("com9.md")).toContain("Windows");
    // Only the whole stem counts.
    expect(nameProblem("auxiliary.md")).toBeNull();
    expect(nameProblem("connections.md")).toBeNull();
  });

  test("a name longer than a filesystem component", () => {
    expect(nameProblem("a".repeat(255))).toBeNull();
    expect(problem("a".repeat(256))).toContain("too long");
    // Counted in bytes, because that is what the limit is.
    expect(problem("é".repeat(200))).toContain("too long");
  });
});

describe("names the tree could not show", () => {
  // The sidebar skips dot-entries, so one created here would be written and
  // then immediately invisible.
  test("a dotfile", () => {
    expect(problem(".gitignore")).toContain("dot");
  });

  test("nothing at all", () => {
    expect(problem("")).toBe("A name is needed");
    expect(problem("   ")).toBe("A name is needed");
  });
});

describe("withNoteExtension", () => {
  test("a name with no extension becomes a note", () => {
    expect(withNoteExtension("ideas")).toBe("ideas.md");
    expect(withNoteExtension("Meeting notes")).toBe("Meeting notes.md");
  });

  test("a dot that is not an extension does not count as one", () => {
    expect(withNoteExtension("v1.2")).toBe("v1.2.md");
    expect(withNoteExtension("Dr. Who")).toBe("Dr. Who.md");
  });

  test("a name that already has an extension is left alone", () => {
    expect(withNoteExtension("ideas.md")).toBe("ideas.md");
    expect(withNoteExtension("data.csv")).toBe("data.csv");
    expect(withNoteExtension("README.MD")).toBe("README.MD");
  });
});

describe("newEntryProblem", () => {
  test("a plain name, or a path of them, is fine", () => {
    expect(newEntryProblem("ideas")).toBeNull();
    expect(newEntryProblem("journal/2026/today")).toBeNull();
  });

  test("an empty folder in the path is not", () => {
    expect(newEntryProblem("journal//today")).toBe("A path cannot have an empty folder in it");
    expect(newEntryProblem("/today")).toBe("A path cannot have an empty folder in it");
    expect(newEntryProblem("journal/")).toBe("A path cannot have an empty folder in it");
  });

  test("each part is held to the rules for a name", () => {
    expect(newEntryProblem("journal/../x")).toBe("That is not a name");
    expect(newEntryProblem("journal/.hidden")).toBe("A name cannot start with a dot");
    expect(newEntryProblem("a\\b")).toBe("Use / between folders");
  });
});
