import { syntaxTree } from "@codemirror/language";
import { EditorState, Range, StateField, Text } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import { rendersAnything, sanitizeHtml } from "./sanitize";
import { noteDirectory, resolveImageSource, safeExternalHref } from "./sources";
import {
  BulletWidget,
  HtmlWidget,
  ImageWidget,
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

const INLINE_CLASSES: Record<string, Decoration> = {
  StrongEmphasis: Decoration.mark({ class: "cm-md-strong" }),
  Emphasis: Decoration.mark({ class: "cm-md-em" }),
  Strikethrough: Decoration.mark({ class: "cm-md-strike" }),
  InlineCode: Decoration.mark({ class: "cm-md-inline-code" }),
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
 * Pulls a GFM table out of the syntax tree. Returns null for tables nested
 * inside a quote or a list item, where replacing whole lines would swallow the
 * enclosing markup along with the table.
 */
function readTable(state: EditorState, table: SyntaxNode) {
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

    const cells = [];
    for (let cell = child.firstChild; cell; cell = cell.nextSibling) {
      if (cell.name !== "TableCell") continue;
      cells.push({ text: state.doc.sliceString(cell.from, cell.to), from: cell.from });
    }
    rows.push({ cells, header: child.name === "TableHeader" });
  }

  if (!rows.length) return null;

  // Identity of the rendered result, so the table is only rebuilt when its
  // contents or positions actually move.
  const key = [
    alignment.join(","),
    ...rows.map((row) => `${row.header}:${row.cells.map((cell) => `${cell.from}=${cell.text}`).join("|")}`),
  ].join("//");

  return { rows, alignment, key };
}

/** The alt text of an `![alt](src)`, read from the source rather than the tree. */
function imageAltText(source: string) {
  return /^!\[([^\]]*)\]/.exec(source)?.[1] ?? "";
}

/** Tags that never have a closing partner, so they render on their own. */
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source",
  "track", "wbr",
]);

type Build = {
  state: EditorState;
  directory: string;
  out: Range<Decoration>[];
  /**
   * End of the last range swallowed by a widget. Inline HTML is rendered as a
   * run of sibling nodes rather than one subtree, so the nodes inside that run
   * have to be skipped by position instead of by returning false.
   */
  coveredUntil: number;
};

/**
 * The end of the tag that closes `<tag>`, searching forward through siblings
 * and counting nesting, or -1 when the run is unbalanced - in which case it is
 * left as plain text rather than guessed at.
 */
function findClosingTag(doc: Text, open: SyntaxNode, tag: string) {
  const opening = new RegExp(`^<${tag}(\\s|>|/)`, "i");
  const closing = new RegExp(`^</${tag}\\s*>$`, "i");
  let depth = 1;

  for (let sibling = open.nextSibling; sibling; sibling = sibling.nextSibling) {
    if (sibling.name !== "HTMLTag") continue;
    const text = doc.sliceString(sibling.from, sibling.to);

    if (closing.test(text)) {
      depth--;
      if (depth === 0) return sibling.to;
    } else if (opening.test(text) && !text.endsWith("/>")) {
      depth++;
    }
  }

  return -1;
}

function decorateNode(node: SyntaxNodeRef, build: Build): boolean | undefined {
  const { state, directory, out } = build;
  const { name, from, to } = node;
  const doc = state.doc;

  if (from < build.coveredUntil) return false;

  const headingLevel = HEADING_LEVELS[name];
  if (headingLevel) {
    out.push(HEADING_LINES[headingLevel - 1].range(doc.lineAt(from).from));
    return;
  }

  if (name === "HeaderMark") {
    // A setext underline is a line of its own; hiding it would fold two lines
    // into one, so it is dimmed down to a rule instead.
    if (hasAncestor(node.node, "SetextHeading1", "SetextHeading2")) {
      out.push(SETEXT_MARK.range(from, to));
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
    eachLine(doc, from, to, (lineStart) => out.push(QUOTE_LINE.range(lineStart)));
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
    out.push(Decoration.replace({ widget: new TaskWidget(checked, from, to) }).range(from, to));

    // Strike the text, not the line: a line decoration draws the rule straight
    // through the checkbox, since the rule is painted across everything in the
    // box it is set on - replaced elements included.
    const task = node.node.parent;
    const textFrom = doc.sliceString(to, to + 1) === " " ? to + 1 : to;
    if (checked && task && task.to > textFrom) out.push(TASK_DONE.range(textFrom, task.to));
    return;
  }

  if (name === "EmphasisMark" || name === "StrikethroughMark" || name === "LinkMark" || name === "LinkTitle") {
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

  if (name === "Link" || name === "Autolink") {
    const urlNode = name === "Link" ? findChild(node.node, "URL") : null;
    const target = urlNode
      ? doc.sliceString(urlNode.from, urlNode.to)
      : doc.sliceString(from, to).replace(/^<|>$/g, "");
    const href = safeExternalHref(target);
    out.push(
      Decoration.mark({
        class: "cm-md-link",
        attributes: href ? { "data-href": href } : undefined,
      }).range(from, to)
    );
    return;
  }

  if (name === "Image") {
    if (isBeingEdited(state, from, to)) return;
    const urlNode = findChild(node.node, "URL");
    const source = urlNode && resolveImageSource(doc.sliceString(urlNode.from, urlNode.to), directory);
    if (!source) return;
    out.push(
      Decoration.replace({
        widget: new ImageWidget(source, imageAltText(doc.sliceString(from, to))),
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
    if (!rendersAnything(sanitizeHtml(html, directory))) return false;

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

    const end =
      source.endsWith("/>") || VOID_TAGS.has(tag) ? to : findClosingTag(doc, node.node, tag);
    if (end < 0 || isBeingEdited(state, from, end)) return;

    const html = doc.sliceString(from, end);
    if (!rendersAnything(sanitizeHtml(html, directory))) return;

    out.push(Decoration.replace({ widget: new HtmlWidget(html, directory, false) }).range(from, end));
    build.coveredUntil = end;
    return false;
  }

  if (name === "Comment" || name === "CommentBlock") {
    out.push(DIMMED.range(from, to));
    return false;
  }

  if (name === "Table") {
    const table = readTable(state, node.node);
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

function buildDecorations(state: EditorState): DecorationSet {
  const build: Build = {
    state,
    directory: state.facet(noteDirectory),
    out: [],
    coveredUntil: -1,
  };

  syntaxTree(state).iterate({
    enter: (node) => decorateNode(node, build),
  });

  // Sorted on the way in rather than built with a RangeSetBuilder: a pre-order
  // walk hands us a block's line decoration after the inline decorations that
  // belong to it, so the ranges do not arrive in document order.
  return Decoration.set(build.out, true);
}

/**
 * The rendered document. This lives in a state field rather than a view plugin
 * because rules and tables are replaced with *block* widgets, and CodeMirror
 * only accepts those from state - it has to know a line's height before it
 * decides what to draw.
 */
export const liveMarkdownPreview = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(state),

  update(decorations, transaction) {
    const changed =
      transaction.docChanged ||
      !transaction.state.selection.eq(transaction.startState.selection) ||
      syntaxTree(transaction.state) !== syntaxTree(transaction.startState) ||
      transaction.state.facet(noteDirectory) !== transaction.startState.facet(noteDirectory);

    return changed ? buildDecorations(transaction.state) : decorations;
  },

  provide: (field) => EditorView.decorations.from(field),
});
