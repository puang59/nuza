import { describe, expect, test } from "bun:test";
import { extensionOf, isNotText, openerFor } from "../src/lib/openers";

describe("openerFor", () => {
  test("a note, and anything else that may be text, opens in the editor", () => {
    for (const path of ["/v/note.md", "/v/data.json", "/v/todo.txt", "/v/README", "/v/.gitignore"]) {
      expect(openerFor(path)).toBe("editor");
    }
  });

  test("a picture is shown", () => {
    for (const path of ["/v/a.png", "/v/media/Photo.JPG", "C:\\v\\b.webp", "/v/logo.svg"]) {
      expect(openerFor(path)).toBe("image");
    }
  });

  test("a document or a recording goes to the system", () => {
    for (const path of ["/v/paper.pdf", "/v/Talk.MP4", "/v/report.final.docx", "/v/song.flac"]) {
      expect(openerFor(path)).toBe("system");
    }
  });

  // "Open" on one of these is "run", and a vault can come from anywhere.
  test("nothing that could be run is handed to the system", () => {
    for (const path of ["/v/run.command", "/v/setup.sh", "/v/tool.exe", "/v/Thing.app", "/v/paper.pdf.sh"]) {
      expect(openerFor(path)).toBe("editor");
    }
  });
});

describe("extensionOf", () => {
  test("is what follows the last dot of the name, in lower case", () => {
    expect(extensionOf("/v/a.b/Note.MD")).toBe("md");
    expect(extensionOf("/v/a.b/noextension")).toBe("");
    expect(extensionOf("/v/.hidden")).toBe("");
    expect(extensionOf("C:\\v\\x.PDF")).toBe("pdf");
  });
});

describe("isNotText", () => {
  test("knows the backend's refusal to read a binary file as text", () => {
    expect(isNotText("stream did not contain valid UTF-8")).toBe(true);
    expect(isNotText("No such file or directory (os error 2)")).toBe(false);
  });
});
