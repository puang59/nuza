import { syntaxTree } from "@codemirror/language";
import { ChangeSet, EditorState, Range, StateField, Text } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef, Tree } from "@lezer/common";
import { FrontmatterRange, frontmatterRange, readFrontmatter } from "./frontmatter";
import { mathSource } from "./math";
import { rendersHtml } from "./sanitize";
import {
  isLocalImageTarget,
  mediaSource,
  noteDirectory,
  resolveImageSource,
  safeExternalHref,
} from "./sources";
import { isImagePath } from "../media";
import { refreshEmbeds, vaultFiles } from "./embedIndex";
import { readAltSize } from "./imageSize";
import { readEmbed, readWikiLink, resolveEmbed } from "./wikiLinks";
import {
  BulletWidget,
  HtmlWidget,
  ImageWidget,
  LinkThumbnailWidget,
  MathWidget,
  PropertiesWidget,
  RuleWidget,
  TableAlignment,
  TableRow,
  TableWidget,
  TaskWidget,
} from "./widgets";

/** Markup that is out of the way entirely: replaced with nothing at all. */
const HIDDEN = Decoration.replace({});
/** Markup on the line being edited: still there, just stepped back. */
const DIMMED = Decoration.mark({ class: "cm-md-mark" });
const SETEXT_MARK = Decoration.mark({ class: "cm-md-setext-mark" });
const CODE_INFO = Decoration.mark({ class: "cm-md-code-info" });
const ORDERED_MARK = Decoration.mark({ class: "cm-md-ordered-mark" });

const QUOTE_LINE = Decoration.line({ class: "cm-md-quote" });
const TASK_DONE = Decoration.mark({ class: "cm-md-task-done" });
const RULE_LINE = Decoration.line({ class: "cm-md-mark" });
/** Math with the caret in it: the TeX as written, in the code face. */
const MATH_SOURCE = Decoration.mark({ class: "cm-md-math-source" });
const MATH_LINE = Decoration.line({ class: "cm-md-math-source" });
/** Frontmatter with the caret in it: plain text, and plainly not prose. */
const FRONTMATTER_LINE = Decoration.line({ class: "cm-md-frontmatter" });

const INLINE_CLASSES: Record<string, Decoration> = {
  StrongEmphasis: Decoration.mark({ class: "cm-md-strong" }),
  Emphasis: Decoration.mark({ class: "cm-md-em" }),
  Strikethrough: Decoration.mark({ class: "cm-md-strike" }),
  InlineCode: Decoration.mark({ class: "cm-md-inline-code" }),
  Tag: Decoration.mark({ class: "cm-md-tag" }),
};

const HEADING_LEVELS: Record<string, number> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
  SetextHeading1: 1,
  SetextHeading2: 2,
};

const HEADING_LINES = [1, 2, 3, 4, 5, 6].map((level) =>
  Decoration.line({ class: `cm-md-heading cm-md-h${level}` })
);

/**
 * Whether the raw markdown for this range should be shown rather than
 * rendered. The test is by line, not by character: put the caret anywhere on a
 * line and that whole line opens up, which is what makes editing feel like
 * editing text instead of poking at widgets.
 */
function isBeingEdited(state: EditorState, from: number, to: number) {
  const first = state.doc.lineAt(from);
  const last = to <= first.to ? first : state.doc.lineAt(to);
  return state.selection.ranges.some((range) => range.from <= last.to && range.to >= first.from);
}

/** Runs `visit` for every line a node covers, flagging the first and last. */
function eachLine(
  doc: Text,
  from: number,
  to: number,
  visit: (lineStart: number, isFirst: boolean, isLast: boolean) => void
) {
  let position = from;
  let first = true;

  for (;;) {
    const line = doc.lineAt(position);
    const isLast = line.to >= to;
    visit(line.from, first, isLast);
    if (isLast || line.to >= doc.length) break;
    position = line.to + 1;
    first = false;
  }
}

function findChild(node: SyntaxNode, name: string) {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) return child;
  }
  return null;
}

function hasAncestor(node: SyntaxNode, ...names: string[]) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (names.includes(parent.name)) return true;
  }
  return false;
}

/** How deeply a bullet list is nested, so each level gets its own glyph. */
function listDepth(list: SyntaxNode) {
  let depth = 0;
  for (let parent = list.parent; parent; parent = parent.parent) {
    if (parent.name === "BulletList" || parent.name === "OrderedList") depth++;
  }
  return depth;
}

/** `:---`, `:---:` and `---:` in the delimiter row, read per column. */
function parseAlignment(delimiterRow: string): TableAlignment[] {
  return delimiterRow
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell, index, cells) => !(cell === "" && (index === 0 || index === cells.length - 1)))
    .map((cell) => {
      const left = cell.startsWith(":");
      const right = cell.endsWith(":");
      if (left && right) return "center";
      if (right) return "right";
      if (left) return "left";
      return null;
    });
}

/**
 * The cells of one table row, empty ones included.
 *
 * The parser only makes a node for a cell with something in it: `| a |  | c |`
 * is three cells to anyone reading it and two `TableCell`s to the tree, which
 * drew `c` under the second column and left nowhere to type into the gap. So
 * the cells are the stretches between the row's pipes - not counting before a
 * leading pipe or after a trailing one - and an empty stretch is a cell with
 * no text, placed just after the space a pipe is usually padded with.
 */
function rowCells(doc: Text, row: SyntaxNode, origin: number): TableRow["cells"] {
  const pipes: SyntaxNode[] = [];
  const filled: SyntaxNode[] = [];
  for (let node = row.firstChild; node; node = node.nextSibling) {
    if (node.name === "TableDelimiter") pipes.push(node);
    else if (node.name === "TableCell") filled.push(node);
  }

  const stretches: [number, number][] = [];
  let start = row.from;
  for (const pipe of pipes) {
    stretches.push([start, pipe.from]);
    start = pipe.to;
  }
  stretches.push([start, row.to]);
  if (pipes.length && pipes[0].from === row.from) stretches.shift();
  if (pipes.length && pipes[pipes.length - 1].to === row.to) stretches.pop();

  return stretches.map(([from, to]) => {
    const cell = filled.find((node) => node.from >= from && node.to <= to);
    if (cell) return { text: doc.sliceString(cell.from, cell.to), offset: cell.from - origin };
    const at = to > from && doc.sliceString(from, from + 1) === " " ? from + 1 : from;
    return { text: "", offset: at - origin };
  });
}

/**
 * Pulls a GFM table out of the syntax tree. Returns null for tables nested
 * inside a quote or a list item, where replacing whole lines would swallow the
 * enclosing markup along with the table.
 */
function readTable(state: EditorState, table: SyntaxNode, origin: number) {
  if (hasAncestor(table, "Blockquote", "ListItem")) return null;

  const rows: TableRow[] = [];
  let alignment: TableAlignment[] = [];

  for (let child = table.firstChild; child; child = child.nextSibling) {
    // The delimiter row is the only `TableDelimiter` that is a direct child of
    // the table; the rest are the `|` separators inside each row.
    if (child.name === "TableDelimiter") {
      alignment = parseAlignment(state.doc.sliceString(child.from, child.to));
      continue;
    }
    if (child.name !== "TableHeader" && child.name !== "TableRow") continue;

    rows.push({ cells: rowCells(state.doc, child, origin), header: child.name === "TableHeader" });
  }

  if (!rows.length) return null;

  // Identity of the rendered result, so the table is only rebuilt when its
  // contents or positions actually move.
  const key = [
    alignment.join(","),
    ...rows.map((row) => `${row.header}:${row.cells.map((cell) => `${cell.offset}=${cell.text}`).join("|")}`),
  ].join("//");

  return { rows, alignment, key };
}

/**
 * The alt text of an `![alt](src)`, taken from between the tree's own `![` and
 * `]` marks. Reading it off the source with a regex meant stopping at the
 * first `]`, which is a bracket the alt text is perfectly entitled to contain.
 */
function imageAltText(doc: Text, image: SyntaxNode) {
  const marks: SyntaxNode[] = [];
  for (let child = image.firstChild; child && marks.length < 2; child = child.nextSibling) {
    if (child.name === "LinkMark") marks.push(child);
  }
  return marks.length === 2 ? doc.sliceString(marks[0].to, marks[1].from) : "";
}

/** Tags that never have a closing partner, so they render on their own. */
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

type Build = {
  state: EditorState;
  /** The stretch being decorated. Nothing is kept from outside it. */
  from: number;
  to: number;
  directory: string;
  out: Range<Decoration>[];
  /**
   * End of the properties block, whose lines are YAML rather than markdown and
   * so are left to `decorateFrontmatter`. Nodes that sit entirely inside it are
   * skipped; one that merely spans it - the document node, above all - is not,
   * or the whole note would be skipped along with its metadata.
   */
  frontmatterEnd: number;
  /**
   * End of the last range swallowed by a widget. Inline HTML is rendered as a
   * run of sibling nodes rather than one subtree, so the nodes inside that run
   * have to be skipped by position instead of by returning false.
   */
  coveredUntil: number;
  /**
   * Where each opening tag's partner ends, by the opener's start, for every
   * run of inline HTML paired so far in this build. Keyed by the parent's
   * span, since that is what holds the run.
   */
  tagPairs: Map<string, Map<number, number>>;
};

const OPENING_TAG = /^<([a-zA-Z][\w-]*)(\s|>|\/)/;
const CLOSING_TAG = /^<\/([a-zA-Z][\w-]*)\s*>$/;

/**
 * Every opening tag among `parent`'s children matched to the end of the tag
 * that closes it, nesting counted per tag name. One pass over the run: a
 * search forward from each opener would walk the rest of the run once per
 * tag in it. An opener with no partner is left out, and so is left as plain
 * text rather than guessed at.
 */
export function pairTags(doc: Text, parent: SyntaxNode) {
  const pairs = new Map<number, number>();
  const open = new Map<string, number[]>();

  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.name !== "HTMLTag") continue;
    const text = doc.sliceString(child.from, child.to);

    const closing = CLOSING_TAG.exec(text);
    if (closing) {
      const start = open.get(closing[1].toLowerCase())?.pop();
      if (start !== undefined) pairs.set(start, child.to);
      continue;
    }

    const opening = OPENING_TAG.exec(text);
    if (!opening || text.endsWith("/>")) continue;
    const tag = opening[1].toLowerCase();
    if (VOID_TAGS.has(tag)) continue;

    const stack = open.get(tag);
    if (stack) stack.push(child.from);
    else open.set(tag, [child.from]);
  }

  return pairs;
}

/** The end of the tag that closes the one at `open`, or -1 when there is none. */
function findClosingTag(build: Build, open: SyntaxNode) {
  const parent = open.parent;
  if (!parent) return -1;

  const key = `${parent.from}:${parent.to}`;
  let pairs = build.tagPairs.get(key);
  if (!pairs) {
    pairs = pairTags(build.state.doc, parent);
    build.tagPairs.set(key, pairs);
  }

  return pairs.get(open.from) ?? -1;
}

function decorateNode(node: SyntaxNodeRef, build: Build): boolean | undefined {
  const { state, directory, out } = build;
  const { name, from, to } = node;
  const doc = state.doc;

  if (to <= build.frontmatterEnd) return false;
  if (from < build.coveredUntil) return false;

  const headingLevel = HEADING_LEVELS[name];
  if (headingLevel) {
    // A setext heading is two lines, and its second line is `---` or `===`,
    // which is also how a list starts. `- ` under a paragraph parses as a
    // heading underline right up until the item has some text in it, so
    // rendering one while that line is being typed makes the paragraph above
    // jump to heading size and back every time a list is started under it.
    if (name.startsWith("Setext")) {
      const underline = findChild(node.node, "HeaderMark");
      if (underline && isBeingEdited(state, underline.from, underline.to)) return;
    }
    out.push(HEADING_LINES[headingLevel - 1].range(doc.lineAt(from).from));
    return;
  }

  if (name === "HeaderMark") {
    // A setext underline is a line of its own; hiding it would fold two lines
    // into one, so it is dimmed down to a rule instead - but left as plain
    // text while it is the line being typed on, for the reason above.
    if (hasAncestor(node.node, "SetextHeading1", "SetextHeading2")) {
      if (!isBeingEdited(state, from, to)) out.push(SETEXT_MARK.range(from, to));
      return;
    }
    if (isBeingEdited(state, from, to)) {
      out.push(DIMMED.range(from, to));
      return;
    }

    const line = doc.lineAt(from);
    const leading = doc.sliceString(line.from, from).trim() === "";
    let start = from;
    let end = to;

    if (leading) {
      // Swallow the indent before the hashes and the space after them, so the
      // heading text starts exactly where the column does.
      start = line.from;
      while (end < line.to && doc.sliceString(end, end + 1) === " ") end++;
    } else {
      // A closing `##` takes the space in front of it instead.
      while (start > line.from && doc.sliceString(start - 1, start) === " ") start--;
    }

    if (start < end) out.push(HIDDEN.range(start, end));
    return;
  }

  if (name === "Blockquote") {
    // Only the lines being decorated: a quote can be the whole note, and
    // every line of it is marked the same way whichever part is redone.
    eachLine(doc, Math.max(from, build.from), Math.min(to, build.to), (lineStart) =>
      out.push(QUOTE_LINE.range(lineStart))
    );
    return;
  }

  if (name === "QuoteMark") {
    if (isBeingEdited(state, from, to)) {
      out.push(DIMMED.range(from, to));
      return;
    }
    const line = doc.lineAt(from);
    const end = to < line.to && doc.sliceString(to, to + 1) === " " ? to + 1 : to;
    out.push(HIDDEN.range(from, end));
    return;
  }

  if (name === "ListMark") {
    const item = node.node.parent;
    const list = item?.parent;
    if (list?.name !== "BulletList") {
      out.push(ORDERED_MARK.range(from, to));
      return;
    }
    // A checkbox is marker enough for a task; a bullet in front of it is just
    // a second thing to look at.
    if (item && findChild(item, "Task")) out.push(HIDDEN.range(from, to));
    else out.push(Decoration.replace({ widget: new BulletWidget(listDepth(list)) }).range(from, to));
    return;
  }

  if (name === "TaskMarker") {
    const checked = /^\[[xX]\]$/.test(doc.sliceString(from, to));
    out.push(Decoration.replace({ widget: new TaskWidget(checked) }).range(from, to));

    // Strike the text, not the line: a line decoration draws the rule straight
    // through the checkbox, since the rule is painted across everything in the
    // box it is set on - replaced elements included.
    const task = node.node.parent;
    const textFrom = doc.sliceString(to, to + 1) === " " ? to + 1 : to;
    if (checked && task && task.to > textFrom) out.push(TASK_DONE.range(textFrom, task.to));
    return;
  }

  if (
    name === "EmphasisMark" ||
    name === "StrikethroughMark" ||
    name === "LinkMark" ||
    name === "LinkTitle"
  ) {
    out.push((isBeingEdited(state, from, to) ? DIMMED : HIDDEN).range(from, to));
    return;
  }

  if (name === "CodeMark") {
    // Folding a fence away leaves its line empty rather than gone, which is
    // where the code block gets its top and bottom padding from.
    out.push((isBeingEdited(state, from, to) ? DIMMED : HIDDEN).range(from, to));
    return;
  }

  if (name === "CodeInfo") {
    out.push(CODE_INFO.range(from, to));
    return;
  }

  if (name === "URL") {
    // A bare autolink is its own label; only the target of a `[...](...)` is
    // redundant once the link renders.
    const parent = node.node.parent?.name;
    if (parent === "Link" || parent === "Image") {
      out.push((isBeingEdited(state, from, to) ? DIMMED : HIDDEN).range(from, to));
    }
    return;
  }

  if (name === "InlineMath") {
    if (isBeingEdited(state, from, to)) {
      out.push(MATH_SOURCE.range(from, to));
      return false;
    }
    out.push(
      Decoration.replace({ widget: new MathWidget(mathSource(doc.sliceString(from, to)), false) }).range(
        from,
        to
      )
    );
    return false;
  }

  if (name === "BlockMath") {
    const first = doc.lineAt(from);
    const last = doc.lineAt(to);
    if (isBeingEdited(state, from, to)) {
      eachLine(doc, from, to, (lineStart) => out.push(MATH_LINE.range(lineStart)));
      return false;
    }
    out.push(
      Decoration.replace({
        widget: new MathWidget(mathSource(doc.sliceString(from, to)), true),
        block: true,
      }).range(first.from, last.to)
    );
    return false;
  }

  if (name === "WikiEmbed") {
    // Being edited, it is all there to edit, with the brackets dimmed.
    if (isBeingEdited(state, from, to)) {
      out.push(DIMMED.range(from, from + 3), DIMMED.range(to - 2, to));
      return false;
    }

    const { target, width, alt } = readEmbed(doc.sliceString(from + 3, to - 2));
    // Only pictures are drawn. An embedded note, or anything else, is left
    // as the text it is rather than shown as a picture that is not there.
    if (!isImagePath(target)) return false;

    const { root, files } = vaultFiles();
    const file = resolveEmbed(target, files, root, directory);
    out.push(
      Decoration.replace({
        widget: new ImageWidget(file ? mediaSource(file) : "", alt ?? target, width),
      }).range(from, to)
    );
    return false;
  }

  if (name === "WikiLink") {
    const inner = doc.sliceString(from + 2, to - 2);
    const { target, heading, label } = readWikiLink(inner);
    const link = Decoration.mark({
      class: "cm-md-link cm-md-wikilink",
      attributes:
        heading === null
          ? { "data-wikilink": target }
          : { "data-wikilink": target, "data-wikilink-heading": heading },
    });

    // Being edited, it is all there to edit, with the brackets dimmed.
    if (isBeingEdited(state, from, to)) {
      out.push(DIMMED.range(from, from + 2), DIMMED.range(to - 2, to), link.range(from + 2, to - 2));
      return false;
    }

    // Otherwise the brackets go, and so does the target when a label stands
    // in for it - what is left reads as a link.
    const shown = label ? from + 2 + inner.indexOf("|") + 1 : from + 2;
    out.push(HIDDEN.range(from, shown), link.range(shown, to - 2), HIDDEN.range(to - 2, to));
    return false;
  }

  if (name === "Link" || name === "Autolink") {
    const urlNode = name === "Link" ? findChild(node.node, "URL") : null;
    const target = urlNode
      ? doc.sliceString(urlNode.from, urlNode.to)
      : doc.sliceString(from, to).replace(/^<|>$/g, "");
    const href = safeExternalHref(target);
    // `#heading` has no scheme to open, but it is a link to somewhere in this note.
    const anchor = target.startsWith("#") ? target.slice(1) : null;
    out.push(
      Decoration.mark({
        class: "cm-md-link",
        attributes: href ? { "data-href": href } : anchor ? { "data-anchor": anchor } : undefined,
      }).range(from, to)
    );

    // A link to a picture in the vault gets a small one beside it, unless the
    // caret is in the link: then it is the markdown that is being edited.
    const source =
      urlNode && !isBeingEdited(state, from, to) && isLocalImageTarget(target)
        ? resolveImageSource(target, directory)
        : null;
    if (source) {
      const [open, close] = [...node.node.getChildren("LinkMark")];
      const label = open && close ? doc.sliceString(open.to, close.from) : "";
      out.push(Decoration.widget({ widget: new LinkThumbnailWidget(source, label), side: 1 }).range(to));
    }
    return;
  }

  if (name === "Image") {
    if (isBeingEdited(state, from, to)) return;
    const urlNode = findChild(node.node, "URL");
    const source = urlNode && resolveImageSource(doc.sliceString(urlNode.from, urlNode.to), directory);
    if (!source) return;
    // `![a dog|300](dog.png)`: the width rides on the end of the alt text.
    const sized = readAltSize(imageAltText(doc, node.node));
    out.push(
      Decoration.replace({
        widget: new ImageWidget(source, sized.alt, sized.width),
      }).range(from, to)
    );
    return false;
  }

  if (name === "FencedCode" || name === "CodeBlock") {
    eachLine(doc, from, to, (lineStart, isFirst, isLast) => {
      const classes = ["cm-md-code-line"];
      if (isFirst) classes.push("cm-md-code-first");
      if (isLast) classes.push("cm-md-code-last");
      out.push(Decoration.line({ class: classes.join(" ") }).range(lineStart));
    });
    return;
  }

  if (name === "HorizontalRule") {
    const line = doc.lineAt(from);
    if (isBeingEdited(state, from, to)) {
      out.push(RULE_LINE.range(line.from));
      return;
    }
    out.push(Decoration.replace({ widget: new RuleWidget(), block: true }).range(line.from, line.to));
    return false;
  }

  if (name === "HTMLBlock") {
    if (isBeingEdited(state, from, to)) return false;

    const html = doc.sliceString(from, to);
    if (!rendersHtml(html, directory)) return false;

    out.push(
      Decoration.replace({
        widget: new HtmlWidget(html, directory, true),
        block: true,
      }).range(doc.lineAt(from).from, doc.lineAt(to).to)
    );
    return false;
  }

  if (name === "HTMLTag") {
    const source = doc.sliceString(from, to);
    const tag = /^<([a-zA-Z][\w-]*)/.exec(source)?.[1]?.toLowerCase();
    // A closing tag is reached through its opener; on its own it is nothing.
    if (!tag) return;

    const end = source.endsWith("/>") || VOID_TAGS.has(tag) ? to : findClosingTag(build, node.node);
    if (end < 0 || isBeingEdited(state, from, end)) return;

    const html = doc.sliceString(from, end);
    if (!rendersHtml(html, directory)) return;

    out.push(Decoration.replace({ widget: new HtmlWidget(html, directory, false) }).range(from, end));
    build.coveredUntil = end;
    return false;
  }

  if (name === "Comment" || name === "CommentBlock") {
    out.push(DIMMED.range(from, to));
    return false;
  }

  if (name === "Table") {
    const table = readTable(state, node.node, doc.lineAt(from).from);
    if (!table || isBeingEdited(state, from, to)) return;

    out.push(
      Decoration.replace({
        widget: new TableWidget(table.rows, table.alignment, table.key),
        block: true,
      }).range(doc.lineAt(from).from, doc.lineAt(to).to)
    );
    return false;
  }

  const inlineClass = INLINE_CLASSES[name];
  if (inlineClass) out.push(inlineClass.range(from, to));
  return;
}

/**
 * The properties block, drawn as the form it is. The fields edit the YAML
 * underneath directly, so unlike the rest of the rendered document this does
 * not fall back to its source when the caret arrives - there is nowhere for the
 * caret to arrive.
 *
 * Either way the markdown parser's reading of these lines is thrown away: to
 * the parser a `---` beneath a line of text is a heading underline, which is
 * what turns a note's metadata into a wall of headings.
 */
function decorateFrontmatter(state: EditorState, range: FrontmatterRange, out: Range<Decoration>[]) {
  const properties = readFrontmatter(state.doc, range);

  // Nesting, lists, a value carried across lines: honest YAML that a
  // two-column form would misrepresent, so it stays text.
  if (!properties) {
    eachLine(state.doc, range.from, range.to, (lineStart) => out.push(FRONTMATTER_LINE.range(lineStart)));
    return;
  }

  const key = properties.map((property) => `${property.key}=${property.value}`).join("|");

  out.push(
    Decoration.replace({
      widget: new PropertiesWidget(properties, `${properties.length}//${key}`),
      block: true,
    }).range(range.from, range.to)
  );
}

/** Decorations for the part of `state` between `from` and `to`, in document order. */
function decorationsIn(state: EditorState, from: number, to: number) {
  const build: Build = {
    state,
    from,
    to,
    directory: state.facet(noteDirectory),
    out: [],
    coveredUntil: -1,
    frontmatterEnd: -1,
    tagPairs: new Map(),
  };

  const front = frontmatterRange(state.doc);
  if (front) {
    // Everything the parser made of those lines is thrown away.
    build.frontmatterEnd = front.to;
    if (from <= front.to) decorateFrontmatter(state, front, build.out);
  }

  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => decorateNode(node, build),
  });

  // Left unsorted for the caller to sort: a pre-order walk hands us a block's
  // line decoration after the inline decorations that belong to it, so the
  // ranges do not arrive in document order.
  //
  // The walk enters every node that overlaps the stretch, the blocks around it
  // included, and one of those may decorate lines well outside it. Those are
  // already in the set being updated, and adding them again would double them.
  return build.out.filter((range) => range.from <= to && range.to >= from);
}

function buildDecorations(state: EditorState): DecorationSet {
  return Decoration.set(decorationsIn(state, 0, state.doc.length), true);
}

/** A stretch of the document whose decorations have to be worked out again. */
type Span = { from: number; to: number };

/**
 * The most lines a list or a quote is redone in one piece. Past this, the
 * part of it around an edit is redone instead.
 */
const BLOCK_LINE_BUDGET = 400;

/**
 * Blocks whose decorations are decided line by line or item by item - a
 * bullet by its own item and how deep that sits, a quote line by being in a
 * quote - so a long one can be redone in part. Everything else, a table or a
 * fenced code block, is decided as a whole and always redone whole.
 */
const DIVISIBLE_BLOCKS = new Set(["BulletList", "OrderedList", "ListItem", "Blockquote"]);

function lineSpan(doc: Text, node: SyntaxNode) {
  return doc.lineAt(node.to).number - doc.lineAt(node.from).number + 1;
}

function tooLong(doc: Text, node: SyntaxNode) {
  return DIVISIBLE_BLOCKS.has(node.name) && lineSpan(doc, node) > BLOCK_LINE_BUDGET;
}

/** The top-level block `pos` sits in, or null outside any. */
function topLevelBlock(tree: Tree, pos: number) {
  let node = tree.resolveInner(pos, 1);
  if (!node.parent) return null;
  while (node.parent && node.parent.parent) node = node.parent;
  return node;
}

/**
 * The outermost block `pos` sits in - a paragraph, a list, a fenced code block.
 * Rebuilding is done a block at a time because a block's decorations are
 * decided together: a table's rows, a quote's lines, the run of text a fence
 * swallows. Re-doing half of one would leave the other half stale.
 *
 * With `budgeted`, the climb stops short of a list or quote longer than
 * `BLOCK_LINE_BUDGET` lines, at the largest block inside it that is not.
 * In a note that is one long outline the outermost block is the note, and
 * a keystroke would otherwise redo all of it; an item's bullet does not
 * depend on one two thousand lines away.
 */
function enclosingBlock(doc: Text, tree: Tree, pos: number, budgeted: boolean): Span {
  let node = tree.resolveInner(pos, 1);
  if (!node.parent) return { from: pos, to: pos };
  // Between the items of a long list, or on a quote's blank line, the node
  // found is the long block itself - and the line is all there is to redo.
  if (budgeted && tooLong(doc, node)) return { from: pos, to: pos };

  while (node.parent && node.parent.parent) {
    if (budgeted && tooLong(doc, node.parent)) break;
    node = node.parent;
  }
  return { from: node.from, to: node.to };
}

/** Grows `span` to whole lines, and to the blocks those lines belong to. */
function widen(state: EditorState, tree: Tree, span: Span, budgeted: boolean): Span {
  const length = state.doc.length;
  const start = state.doc.lineAt(Math.max(0, Math.min(span.from, length)));
  const end = state.doc.lineAt(Math.max(0, Math.min(span.to, length)));
  const head = enclosingBlock(state.doc, tree, start.from, budgeted);
  const tail = enclosingBlock(state.doc, tree, end.to, budgeted);

  // A block inside a quote starts after the `>` rather than at the start of
  // its line, and a span that starts mid-line would throw away the quote
  // mark in front of it without the walk ever coming back for it.
  return {
    from: state.doc.lineAt(Math.max(0, Math.min(start.from, head.from))).from,
    to: state.doc.lineAt(Math.min(length, Math.max(end.to, tail.to))).to,
  };
}

/**
 * Whether every top-level block an edit touched is the same block after it:
 * the same kind, starting and ending where the old one maps to.
 */
function keepsTopLevelBlocks(
  startState: EditorState,
  oldTree: Tree,
  state: EditorState,
  newTree: Tree,
  changes: ChangeSet
) {
  let kept = true;

  changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (!kept) return;
    for (const [a, b] of [
      [fromA, fromB],
      [toA, toB],
    ]) {
      const before = topLevelBlock(oldTree, Math.min(a, startState.doc.length));
      const after = topLevelBlock(newTree, Math.min(b, state.doc.length));
      if (!before || !after) {
        if (before !== after) kept = false;
        continue;
      }
      if (
        before.name !== after.name ||
        changes.mapPos(before.from, -1) !== after.from ||
        changes.mapPos(before.to, 1) !== after.to
      ) {
        kept = false;
      }
    }
  });

  return kept;
}

/** Overlapping spans folded together, in document order. */
function merge(spans: Span[]): Span[] {
  const sorted = spans.slice().sort((a, b) => a.from - b.from);
  const merged: Span[] = [];

  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.from <= last.to) last.to = Math.max(last.to, span.to);
    else merged.push({ ...span });
  }

  return merged;
}

/**
 * The rendered document. This lives in a state field rather than a view plugin
 * because rules and tables are replaced with *block* widgets, and CodeMirror
 * only accepts those from state - it has to know a line's height before it
 * decides what to draw.
 *
 * A state field sees the whole document rather than the part of it on screen,
 * so the work is kept down by only ever redoing the blocks that an edit or a
 * caret move could have changed, and carrying the rest across untouched. That
 * matters most on a long document, where rebuilding everything would put the
 * length of the file into the cost of a single keystroke.
 */
export const liveMarkdownPreview = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(state),

  update(decorations, transaction) {
    const { startState, state, changes } = transaction;
    const oldTree = syntaxTree(startState);
    const newTree = syntaxTree(state);

    // Parsing in the background hands us a tree for text nobody touched, and
    // there is no telling from here which part of it just became known - so
    // this is the one case still worth a walk of the whole document. It
    // happens while a file is being taken in, not while it is being written in.
    if (
      state.facet(noteDirectory) !== startState.facet(noteDirectory) ||
      (newTree !== oldTree && !transaction.docChanged) ||
      // Which file an embed names depends on what is in the vault, and that
      // has changed - or this note was last drawn before it was known.
      transaction.effects.some((effect) => effect.is(refreshEmbeds))
    ) {
      return buildDecorations(state);
    }

    const selectionMoved = !state.selection.eq(startState.selection);
    if (!transaction.docChanged && !selectionMoved) return decorations;

    // A long list or quote is only redone in part while the edit leaves it
    // standing as it was. One that an edit splits, joins, ends early or turns
    // into something else is decided afresh from top to bottom.
    const budgeted = keepsTopLevelBlocks(startState, oldTree, state, newTree, changes);

    // Both sides of the transaction have a say. What was edited or had the
    // caret in it needs redoing, and so does wherever those things were
    // before - the blocks they used to belong to are read differently now.
    const spans: Span[] = [];
    const carryOver = (span: Span) => {
      const widened = widen(startState, oldTree, span, budgeted);
      spans.push({ from: changes.mapPos(widened.from, -1), to: changes.mapPos(widened.to, 1) });
    };

    for (const range of startState.selection.ranges) carryOver(range);
    for (const range of state.selection.ranges) spans.push(widen(state, newTree, range, budgeted));
    changes.iterChangedRanges((fromA, toA, fromB, toB) => {
      carryOver({ from: fromA, to: toA });
      spans.push(widen(state, newTree, { from: fromB, to: toB }, budgeted));
    });

    // The properties block is decided as a whole - a caret arriving anywhere in
    // it swaps the entire thing between drawn and open - so anything touching
    // it takes all of it, in whichever of the two states it is longer.
    const before = frontmatterRange(startState.doc);
    const after = frontmatterRange(state.doc);
    const frontEnd = Math.max(after ? after.to : -1, before ? changes.mapPos(before.to, 1) : -1);
    if (frontEnd >= 0 && spans.some((span) => span.from <= frontEnd)) {
      spans.push({ from: 0, to: Math.min(frontEnd, state.doc.length) });
    }

    let updated = decorations.map(changes);
    for (const span of merge(spans)) {
      updated = updated.update({
        // Everything the span touches is thrown away and worked out again;
        // whole blocks are in there, so nothing half-decorated survives.
        filter: () => false,
        filterFrom: span.from,
        filterTo: span.to,
        add: decorationsIn(state, span.from, span.to),
        sort: true,
      });
    }

    return updated;
  },

  provide: (field) => EditorView.decorations.from(field),
});
