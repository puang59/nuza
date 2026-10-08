import type { EditorView } from "@codemirror/view";
import type { MarkdownConfig } from "@lezer/markdown";
import { tags } from "@lezer/highlight";

/**
 * `[[wiki-links]]`: a link to another note by its name, which is how notes in
 * a vault point at each other. `[[note]]` links by name, `[[folder/note]]` by
 * path from the vault's root, `[[note|label]]` shows the label in its place,
 * and a `#heading` after the name - or on its own, for one in the same note -
 * goes on to that heading once the note is open.
 */

const OPEN_BRACKET = 91;
const CLOSE_BRACKET = 93;
const NEWLINE = 10;

/** The parser extension: a `WikiLink` node, its `[[` and `]]` as `WikiLinkMark`s. */
export const WikiLink: MarkdownConfig = {
  defineNodes: [
    { name: "WikiLink", style: tags.link },
    { name: "WikiLinkMark", style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: "WikiLink",
      // Ahead of ordinary links, which would otherwise read `[[a]]` as a
      // bracket followed by a link reference to `a`.
      before: "Link",
      parse(cx, next, pos) {
        if (next !== OPEN_BRACKET || cx.char(pos + 1) !== OPEN_BRACKET) return -1;

        let end = pos + 2;
        for (; end < cx.end; end++) {
          const char = cx.char(end);
          if (char === CLOSE_BRACKET) break;
          if (char === OPEN_BRACKET || char === NEWLINE) return -1;
        }
        // Nothing between the brackets, or no `]]` to close them.
        if (end === pos + 2 || cx.char(end) !== CLOSE_BRACKET || cx.char(end + 1) !== CLOSE_BRACKET)
          return -1;

        return cx.addElement(
          cx.elt("WikiLink", pos, end + 2, [
            cx.elt("WikiLinkMark", pos, pos + 2),
            cx.elt("WikiLinkMark", end, end + 2),
          ])
        );
      },
    },
  ],
};

/** What is between the brackets: the note named, the label shown, and any heading. */
export function readWikiLink(inner: string) {
  const bar = inner.indexOf("|");
  const reference = (bar < 0 ? inner : inner.slice(0, bar)).trim();
  const label = bar < 0 ? null : inner.slice(bar + 1).trim() || null;
  const hash = reference.indexOf("#");
  return {
    target: (hash < 0 ? reference : reference.slice(0, hash)).trim(),
    heading: hash < 0 ? null : reference.slice(hash + 1).trim() || null,
    label,
  };
}

/** A path from the vault's root, forward slashes, lower case and no `.md`, for comparing. */
function comparable(path: string, root: string) {
  const relative = path.startsWith(root) ? path.slice(root.length) : path;
  return relative.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.md$/i, "").toLowerCase();
}

function folderOf(path: string) {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index < 0 ? "" : path.slice(0, index);
}

/**
 * The note a wiki-link points at, out of `notes` - the vault's markdown files,
 * as full paths - or null when there is none.
 *
 * A target with a slash in it is a path from the vault's root; one without is
 * a name, matched against every note's file name. Both ignore case and a
 * trailing `.md`. Where a name belongs to several notes, the one beside the
 * linking note wins, then the one nearest the root, then the first by path.
 */
export function resolveWikiLink(target: string, notes: string[], root: string, fromDirectory: string) {
  const wanted = target.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.md$/i, "").toLowerCase();
  if (!wanted) return null;

  const byPath = wanted.includes("/");
  const matches = notes.filter((note) => {
    const path = comparable(note, root);
    return byPath ? path === wanted : path.slice(path.lastIndexOf("/") + 1) === wanted;
  });
  if (matches.length <= 1) return matches[0] ?? null;

  const depth = (note: string) => comparable(note, root).split("/").length;
  return matches.slice().sort((a, b) => {
    const besideA = folderOf(a) === fromDirectory ? 0 : 1;
    const besideB = folderOf(b) === fromDirectory ? 0 : 1;
    return besideA - besideB || depth(a) - depth(b) || a.localeCompare(b);
  })[0];
}

/** Sent on the window when a wiki-link is followed, for whoever opens notes. */
export const WIKI_LINK_EVENT = "nuza-wiki-link";

export interface WikiLinkRequest {
  /** The note named, or empty for a link to a heading in the note it is written in. */
  target: string;
  /** The heading to go on to once the note is open. */
  heading: string | null;
  /** The folder of the note the link is in, which a name is resolved against first. */
  fromDirectory: string;
  /**
   * The editor the link was followed in. With the split open there are two,
   * and a link to a heading "in this note" means the note in that one.
   */
  view?: EditorView;
}

export function followWikiLink(request: WikiLinkRequest) {
  window.dispatchEvent(new CustomEvent<WikiLinkRequest>(WIKI_LINK_EVENT, { detail: request }));
}

/** A wiki-link written in some note, as `list_wiki_links` returns it. */
export interface WikiLinkRef {
  from: string;
  /** What is between the brackets, as written. */
  target: string;
  line: number;
  preview: string;
}

/**
 * The links in the vault that lead to `path`: each resolved by the same rules
 * following it would use, from the folder of the note it is written in. A
 * note's links to itself are left out. In path and then line order.
 */
export function backlinksTo(path: string, links: WikiLinkRef[], notes: string[], root: string) {
  return links
    .filter((link) => {
      if (link.from === path) return false;
      const { target } = readWikiLink(link.target);
      return resolveWikiLink(target, notes, root, folderOf(link.from)) === path;
    })
    .sort((a, b) => a.from.localeCompare(b.from) || a.line - b.line);
}

/**
 * What to write between the brackets to link `path` from a note in
 * `fromDirectory`: the note's name where that finds it, and its path from the
 * vault's root where another note of the same name would be found first.
 */
export function wikiTargetFor(path: string, notes: string[], root: string, fromDirectory: string) {
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1).replace(/\.md$/i, "");
  if (resolveWikiLink(name, notes, root, fromDirectory) === path) return name;

  const relative = path.startsWith(root) ? path.slice(root.length) : path;
  return relative.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.md$/i, "");
}

/** The link to insert: `[[target]]`, or `[[target|label]]` with the selection as the label. */
export function wikiLinkText(target: string, selected: string) {
  const label = selected
    .replace(/\s*\n\s*/g, " ")
    .replace(/[[\]|]/g, "")
    .trim();
  return label && label !== target ? `[[${target}|${label}]]` : `[[${target}]]`;
}
