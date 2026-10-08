import { describe, expect, test } from "bun:test";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, Text } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import { hasEmbeds } from "../src/lib/markdown/embedIndex";
import { WikiEmbed, WikiLink, readEmbed, resolveEmbed } from "../src/lib/markdown/wikiLinks";

function nodes(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: [GFM, WikiEmbed, WikiLink] })],
  });
  const found: string[] = [];
  ensureSyntaxTree(state, doc.length, 1000)!.iterate({
    enter(node) {
      if (node.name === "WikiEmbed" || node.name === "WikiLink" || node.name === "Image") {
        found.push(`${node.name}:${doc.slice(node.from, node.to)}`);
      }
    },
  });
  return found;
}

describe("the embed syntax", () => {
  test("is read as an embed, not as a bang and a link to a note", () => {
    expect(nodes("see ![[photo.png]] here")).toEqual(["WikiEmbed:![[photo.png]]"]);
  });

  test("leaves wiki-links and ordinary images as they were", () => {
    expect(nodes("[[note]] and ![alt](a.png)")).toEqual(["WikiLink:[[note]]", "Image:![alt](a.png)"]);
  });

  test("needs something between the brackets, and the brackets closed on the same line", () => {
    const embeds = (doc: string) => nodes(doc).filter((node) => node.startsWith("WikiEmbed"));
    expect(embeds("![[]]")).toEqual([]);
    expect(embeds("![[photo.png")).toEqual([]);
    expect(embeds("![[photo\n.png]]")).toEqual([]);
  });
});

describe("readEmbed", () => {
  test("reads the file, and a width or the words after the bar", () => {
    expect(readEmbed("photo.png")).toEqual({ target: "photo.png", width: null, alt: null });
    expect(readEmbed("photo.png|300")).toEqual({ target: "photo.png", width: 300, alt: null });
    expect(readEmbed(" media/photo.png | a dog ")).toEqual({
      target: "media/photo.png",
      width: null,
      alt: "a dog",
    });
    expect(readEmbed("photo.png|0")).toEqual({ target: "photo.png", width: null, alt: null });
  });
});

describe("resolveEmbed", () => {
  const root = "/v";
  const files = [
    "/v/media/photo.png",
    "/v/trip/photo.png",
    "/v/trip/day.md",
    "/v/Logo.PNG",
    "/v/a/b/deep.jpg",
  ];

  test("finds a file by its name anywhere in the vault, whatever the case", () => {
    expect(resolveEmbed("deep.jpg", files, root, "/v")).toBe("/v/a/b/deep.jpg");
    expect(resolveEmbed("logo.png", files, root, "/v")).toBe("/v/Logo.PNG");
  });

  test("prefers the one beside the note, then the one nearest the root", () => {
    expect(resolveEmbed("photo.png", files, root, "/v/trip")).toBe("/v/trip/photo.png");
    expect(resolveEmbed("photo.png", files, root, "/v")).toBe("/v/media/photo.png");
  });

  test("a target with a slash is a path from the vault's root", () => {
    expect(resolveEmbed("trip/photo.png", files, root, "/v")).toBe("/v/trip/photo.png");
    expect(resolveEmbed("/media/photo.png", files, root, "/v/trip")).toBe("/v/media/photo.png");
    expect(resolveEmbed("nowhere/photo.png", files, root, "/v")).toBeNull();
  });

  test("the extension is part of the name", () => {
    expect(resolveEmbed("photo.jpg", files, root, "/v")).toBeNull();
    expect(resolveEmbed("", files, root, "/v")).toBeNull();
  });
});

describe("hasEmbeds", () => {
  test("says whether a note has any, without joining it up", () => {
    expect(hasEmbeds(Text.of(["one", "two ![[a.png]]", "three"]))).toBe(true);
    expect(hasEmbeds(Text.of(["one", "![alt](a.png)", "[[note]]"]))).toBe(false);
  });
});
