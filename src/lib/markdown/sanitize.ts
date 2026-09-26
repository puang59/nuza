import { resolveImageSource, safeExternalHref } from "./sources";

/**
 * A note is a file on disk that anything could have written, and the editor
 * runs inside a WebView with Tauri's API on `window`. So HTML from a note is
 * never handed to `innerHTML`: it is parsed into an inert document, then a
 * fresh copy is built from the tags and attributes on these lists. Anything
 * not named here - `<script>`, `<iframe>`, every `on*` handler - is dropped
 * rather than escaped, so a tag that is not understood simply does not appear.
 */
const ALLOWED_TAGS = new Set([
  "a",
  "abbr",
  "audio",
  "b",
  "big",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "details",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "picture",
  "pre",
  "q",
  "s",
  "samp",
  "section",
  "small",
  "source",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "u",
  "ul",
  "video",
  "wbr",
]);

const ALLOWED_ATTRIBUTES = new Set([
  "align",
  "alt",
  "class",
  "cite",
  "colspan",
  "controls",
  "datetime",
  "dir",
  "height",
  "href",
  "lang",
  "loop",
  "muted",
  "open",
  "poster",
  "reversed",
  "rowspan",
  "span",
  "src",
  "start",
  "style",
  "title",
  "type",
  "width",
]);

/** Attributes holding a URL, which have to clear the scheme check as well. */
const URL_ATTRIBUTES = new Set(["href", "src", "poster"]);

/**
 * Inline CSS cannot run script, but it can lift an element out of the flow and
 * cover the window. Declarations that position, import or fetch are dropped;
 * ordinary colour and spacing rules pass.
 */
const UNSAFE_STYLE = /(^|[;\s])(position|behavior)\s*:|url\s*\(|expression\s*\(|@import|javascript:/i;

function sanitizeStyle(value: string) {
  return UNSAFE_STYLE.test(value) ? null : value;
}

function sanitizeUrl(name: string, value: string, directory: string) {
  if (name === "href") return safeExternalHref(value);
  return resolveImageSource(value, directory);
}

function sanitizeElement(element: Element, directory: string) {
  const tag = element.tagName.toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) return null;

  const clean = document.createElement(tag);

  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    if (!ALLOWED_ATTRIBUTES.has(name)) continue;

    let value: string | null = attribute.value;
    if (name === "style") value = sanitizeStyle(value);
    else if (URL_ATTRIBUTES.has(name)) value = sanitizeUrl(name, value, directory);

    if (value !== null) clean.setAttribute(name, value);
  }

  return clean;
}

function sanitizeNode(node: Node, directory: string): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue ?? "");
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const clean = sanitizeElement(node as Element, directory);
  if (!clean) return null;

  for (const child of Array.from(node.childNodes)) {
    const cleanChild = sanitizeNode(child, directory);
    if (cleanChild) clean.appendChild(cleanChild);
  }

  return clean;
}

/**
 * Turns a run of HTML from a note into DOM that is safe to insert. Parsing
 * happens in a document that never runs anything, and only the rebuilt copy
 * reaches the page. `src` paths are resolved against the note's own directory,
 * so `<img src="diagram.png">` works the same as the markdown spelling.
 */
export function sanitizeHtml(html: string, directory: string) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const fragment = document.createDocumentFragment();

  for (const child of Array.from(parsed.body.childNodes)) {
    const clean = sanitizeNode(child, directory);
    if (clean) fragment.appendChild(clean);
  }

  return fragment;
}

/** Whether any of this HTML survives sanitising - if not, leave the source alone. */
export function rendersAnything(fragment: DocumentFragment) {
  return (
    fragment.childNodes.length > 0 && (fragment.textContent?.trim() !== "" || !!fragment.querySelector("*"))
  );
}
