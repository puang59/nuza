import { beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

// The sanitiser's whole job is rebuilding DOM, so it needs one to rebuild
// into. happy-dom is the document here; in the app it is the webview's.
beforeAll(() => {
  const window = new Window();
  globalThis.document = window.document as unknown as Document;
  globalThis.DOMParser = window.DOMParser as unknown as typeof DOMParser;
  globalThis.Node = window.Node as unknown as typeof Node;
});

/** The sanitised HTML, as markup, for asserting against. */
async function sanitize(html: string, directory = "/vault/notes") {
  const { sanitizeHtml } = await import("../src/lib/markdown/sanitize");
  const wrapper = document.createElement("div");
  wrapper.appendChild(sanitizeHtml(html, directory));
  return wrapper;
}

describe("links", () => {
  // The reason this file exists: a real anchor in the webview has nowhere to
  // come back from. A click on one used to replace the whole app with the
  // remote page, unsaved buffers and all.
  test("an anchor is rebuilt as the span the editor's link handler reads", async () => {
    const clean = await sanitize('<a href="https://example.com">click me</a>');

    expect(clean.querySelector("a")).toBeNull();
    const link = clean.querySelector("span");
    expect(link?.getAttribute("data-href")).toBe("https://example.com");
    expect(link?.className).toBe("cm-md-link");
    expect(link?.textContent).toBe("click me");
  });

  test("a link with no usable href is left as plain text", async () => {
    const clean = await sanitize('<a href="javascript:alert(1)">click me</a>');

    expect(clean.querySelector("[data-href]")).toBeNull();
    expect(clean.querySelector(".cm-md-link")).toBeNull();
    expect(clean.textContent).toBe("click me");
  });

  test("the note cannot dress something else up as a link", async () => {
    const clean = await sanitize('<a class="cm-md-task" href="www.example.com">x</a>');
    const link = clean.querySelector("span");

    expect(link?.className).toBe("cm-md-link");
    // A bare domain is still a link, and still only opened deliberately.
    expect(link?.getAttribute("data-href")).toBe("https://www.example.com");
  });

  test("nested content survives the rewrite", async () => {
    const clean = await sanitize('<a href="https://example.com"><strong>bold</strong> link</a>');

    expect(clean.querySelector("span strong")?.textContent).toBe("bold");
    expect(clean.querySelector("span")?.getAttribute("data-href")).toBe("https://example.com");
  });
});

describe("tags", () => {
  test("a tag that is not on the list does not appear", async () => {
    const clean = await sanitize("<script>alert(1)</script><p>after</p>");

    expect(clean.querySelector("script")).toBeNull();
    expect(clean.querySelector("p")?.textContent).toBe("after");
  });

  test("an iframe is dropped, contents and all", async () => {
    const clean = await sanitize('<iframe src="https://example.com"></iframe>');

    expect(clean.querySelector("iframe")).toBeNull();
    expect(clean.childNodes.length).toBe(0);
  });
});

describe("attributes", () => {
  test("event handlers are not attributes anything keeps", async () => {
    const clean = await sanitize('<p onclick="alert(1)" title="kept">text</p>');
    const paragraph = clean.querySelector("p");

    expect(paragraph?.getAttribute("onclick")).toBeNull();
    expect(paragraph?.getAttribute("title")).toBe("kept");
  });

  test("a style that lifts an element out of the flow is dropped", async () => {
    const clean = await sanitize('<div style="position: fixed; top: 0">x</div>');

    expect(clean.querySelector("div")?.getAttribute("style")).toBeNull();
  });

  test("ordinary styling is left alone", async () => {
    const clean = await sanitize('<div style="color: red">x</div>');

    expect(clean.querySelector("div")?.getAttribute("style")).toBe("color: red");
  });
});
