import { syntaxTree } from "@codemirror/language";
import { ChangeSpec, EditorSelection, EditorState, Line, Text } from "@codemirror/state";
import { Command } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

/** The first child of `node` with the given name, or null. */
export function firstChild(node: SyntaxNode, name: string) {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) return child;
  }
  return null;
}

/** The innermost list item `pos` sits in, or null if it is not in one. */
export function listItemAt(state: EditorState, pos: number): SyntaxNode | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (node.name === "ListItem") return node;
  }
  return null;
}

/** Everything up to and including the item's marker and the space after it. */
function markerEnd(doc: Text, item: SyntaxNode, line: Line) {
  const mark = firstChild(item, "ListMark");
  if (!mark) return null;

  let at = mark.to;
  while (at < line.to && doc.sliceString(at, at + 1) === " ") at++;
  return at;
}

/**
 * Where the item's text starts on its opening line, past the marker and past
 * a task's checkbox - which is drawn in front of the text and so is part of
 * what the text is set in from.
 */
export function contentStart(doc: Text, item: SyntaxNode, line: Line) {
  const end = markerEnd(doc, item, line);
  if (end === null) return null;

  const marker = firstChild(item, "Task") && firstChild(firstChild(item, "Task")!, "TaskMarker");
  if (!marker) return end;

  let at = marker.to;
  while (at < line.to && doc.sliceString(at, at + 1) === " ") at++;
  return at;
}

/**
 * The whitespace that carries a line on inside `item`: the item's marker,
 * blanked out.
 *
 * Deliberately measured to the end of the marker rather than to the text - a
 * task's continuation indented past its checkbox as well would be four columns
 * further in than the item's content starts, which is where markdown stops
 * reading a line as prose and starts reading it as a code block. A quote's
 * `>` is kept rather than blanked, since a line that leaves it out has left
 * the quote.
 */
function continuation(doc: Text, item: SyntaxNode) {
  const line = doc.lineAt(item.from);
  const end = markerEnd(doc, item, line);
  if (end === null) return null;

  return doc.sliceString(line.from, end).replace(/[^\t>]/g, " ");
}

/**
 * Carries the point on to a second line, the way shift+enter is expected to:
 * the text continues underneath itself rather than starting a bullet of its
 * own, which is what plain enter is for.
 *
 * Returns false anywhere that is not a list, leaving the key to whatever else
 * is bound to it.
 */
export const continueListItem: Command = (view) => {
  const { state } = view;
  const items = state.selection.ranges.map((range) => listItemAt(state, range.head));
  if (!items.some(Boolean)) return false;

  let index = 0;
  const change = state.changeByRange((range) => {
    const item = items[index++];
    const indent = item ? continuation(state.doc, item) : null;
    const insert = state.lineBreak + (indent ?? "");

    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(range.from + insert.length),
    };
  });

  view.dispatch(state.update(change, { scrollIntoView: true, userEvent: "input" }));
  return true;
};

/**
 * The marker that starts the point after `item`, taken from the item's own
 * line so that it carries whatever is in front of it: the indentation of a
 * nested list, and the `>` of a quote.
 */
function nextMarker(doc: Text, item: SyntaxNode) {
  const line = doc.lineAt(item.from);
  const end = markerEnd(doc, item, line);
  if (end === null) return null;

  const marker = doc.sliceString(line.from, end);
  // A task carries on as a task, with an empty box rather than a copy of
  // whichever state this one is in.
  if (firstChild(item, "Task")) return `${marker}[ ] `;

  // A numbered point carries on from this one's number.
  return marker.replace(/\d+(?=[.)]\s*$)/, (number) => String(Number(number) + 1));
}

/** The number a `1.`-style item leads with, and where it sits. */
function itemNumber(doc: Text, item: SyntaxNode) {
  return /^(\s*)(\d+)(?=[.)])/.exec(doc.sliceString(item.from, item.from + 12));
}

/**
 * Moves the numbers of the points after `item` up by one, for a point being
 * inserted between them. Stops at the first one that was already out of
 * sequence: a list somebody has numbered 1. 1. 1. is left as they wrote it.
 */
function renumber(doc: Text, item: SyntaxNode, changes: ChangeSpec[]) {
  let previous = -1;

  for (let node: SyntaxNode | null = item; node; node = node.nextSibling) {
    if (node.name !== "ListItem") continue;

    const match = itemNumber(doc, node);
    if (!match) return;

    const number = Number(match[2]);
    if (previous >= 0) {
      if (number !== previous + 1) return;
      changes.push({
        from: node.from + match[1].length,
        to: node.from + match[0].length,
        insert: String(number + 1),
      });
    }
    previous = number;
  }
}

/**
 * Enter on a line that was carried on from a point: a new point, rather than
 * another line of the one above.
 *
 * Left to itself, the markdown command repeats the indentation instead - it
 * reads the line as prose inside the item, which it is - and a list you have
 * carried a point on in quietly stops producing bullets. An empty carried-on
 * line is left alone: that is the way out of the list, and the command below
 * already knows what to do with it.
 */
const startListItem: Command = (view) => {
  const { state } = view;
  const { doc } = state;
  const ranges = state.selection.ranges;

  const items = ranges.map((range) => {
    if (!range.empty) return null;

    const item = listItemAt(state, range.head);
    const line = doc.lineAt(range.head);
    if (!item || item.from >= line.from || !/\S/.test(line.text)) return null;
    // A line set in by less than the item's own text is one markdown only
    // counts as part of the point because nothing came between them - a
    // sentence written straight under a list. It is prose, and enter carries
    // on as prose rather than starting a bullet nobody asked for.
    const indent = continuation(doc, item);
    if (indent === null || /^[\s>]*/.exec(line.text)![0].length < indent.length) return null;
    return item;
  });

  if (!items.some(Boolean)) return false;

  let index = 0;
  const change = state.changeByRange((range) => {
    const item = items[index++];
    const marker = item && nextMarker(doc, item);
    if (!marker) return { range };

    const changes: ChangeSpec[] = [];
    if (item.parent?.name === "OrderedList") renumber(doc, item, changes);

    const insert = state.lineBreak + marker;
    changes.push({ from: range.from, to: range.to, insert });

    return { changes, range: EditorSelection.cursor(range.from + insert.length) };
  });

  view.dispatch(state.update(change, { scrollIntoView: true, userEvent: "input" }));
  return true;
};

/**
 * Enter on a carried-on line left empty: the way back out of the list, the
 * same as enter on an item you have left empty. The indentation goes and the
 * caret stays where it is, on a line that is no longer part of the point
 * above it.
 *
 * The markdown command cannot do this one itself: a line of nothing but
 * spaces is not parsed as part of the item, so there is no list in sight from
 * where the caret is standing - which is why it has to be read off the line
 * before.
 */
const leaveListItem: Command = (view) => {
  const { state } = view;
  const { doc } = state;

  const blank = state.selection.ranges.map((range) => {
    if (!range.empty) return false;

    const line = doc.lineAt(range.head);
    if (range.head !== line.to || !line.text || /\S/.test(line.text)) return false;
    return line.from > 0 && !!listItemAt(state, doc.lineAt(line.from - 1).to);
  });

  if (!blank.some(Boolean)) return false;

  let index = 0;
  const change = state.changeByRange((range) => {
    if (!blank[index++]) return { range };

    const line = doc.lineAt(range.head);
    return {
      changes: { from: line.from, to: range.head, insert: "" },
      range: EditorSelection.cursor(line.from),
    };
  });

  view.dispatch(state.update(change, { scrollIntoView: true, userEvent: "delete" }));
  return true;
};

/** A point with nothing in it yet: the marker, perhaps a task's box, and no text. */
const EMPTY_ITEM = /^\s*([-+*]|\d+[.)])(\s+\[[ xX]\])?\s*$/;
/** A line of a quote with nothing in it: one `>` and no text. */
const EMPTY_QUOTE = /^\s*>\s*$/;

/**
 * Where enter on an empty line ends a list or a quote, if it does: the empty
 * last point of a list with points above it, or the empty last line of a
 * quote. Null anywhere else, including a nested list - that one steps out a
 * level at a time, which the markdown command already does.
 */
function endOfBlock(state: EditorState, pos: number): Line | null {
  const { doc } = state;
  const line = doc.lineAt(pos);
  if (pos !== line.to || line.number === 1) return null;
  const above = doc.line(line.number - 1);

  if (EMPTY_ITEM.test(line.text)) {
    const item = listItemAt(state, pos);
    const list = item?.parent;
    if (!item || !list || doc.lineAt(item.from).number !== line.number) return null;
    if (list.parent?.name !== "Document") return null;
    if (item.nextSibling?.name === "ListItem" || item.prevSibling?.name !== "ListItem") return null;
    return line;
  }

  if (EMPTY_QUOTE.test(line.text) && /^\s*>/.test(above.text) && !listItemAt(state, pos)) return line;
  return null;
}

/**
 * Enter on the empty point at the end of a list, or the empty line at the end
 * of a quote: out of it, with a blank line left behind.
 *
 * Taking the marker away is not enough on its own. Markdown reads a line
 * written straight under a list or a quote as more of it, so the sentence
 * typed next would be drawn set in under the last point, or inside the quote.
 * A blank line is what ends one.
 */
const endBlock: Command = (view) => {
  const { state } = view;
  const ends = state.selection.ranges.map((range) => (range.empty ? endOfBlock(state, range.head) : null));
  if (!ends.some(Boolean)) return false;

  let index = 0;
  const change = state.changeByRange((range) => {
    const line = ends[index++];
    if (!line) return { range };
    return {
      changes: { from: line.from, to: line.to, insert: state.lineBreak },
      range: EditorSelection.cursor(line.from + state.lineBreak.length),
    };
  });

  view.dispatch(state.update(change, { scrollIntoView: true, userEvent: "input" }));
  return true;
};

/**
 * Enter with the caret at the start of a point's text, where that point sits
 * straight under a paragraph: an empty point opens above it, as anywhere
 * else, but after a blank line.
 *
 * Left to the markdown command, the empty point above was a bare `-` on the
 * line under the paragraph, which markdown reads as a heading's underline - so
 * the paragraph turned into a heading. A list after a blank line is the same
 * list, and its empty first point is only that.
 */
const openPointUnderParagraph: Command = (view) => {
  const { state } = view;
  const { doc } = state;
  const { main } = state.selection;
  if (state.selection.ranges.length > 1 || !main.empty) return false;

  const line = doc.lineAt(main.head);
  if (line.number === 1) return false;
  const item = listItemAt(state, main.head);
  if (!item || doc.lineAt(item.from).number !== line.number) return false;
  if (contentStart(doc, item, line) !== main.head || main.head === line.to) return false;

  const above = doc.line(line.number - 1);
  let inParagraph = false;
  for (let node: SyntaxNode | null = syntaxTree(state).resolve(above.to, -1); node; node = node.parent) {
    if (node.name === "Paragraph" && node.parent?.name === "Document") inParagraph = true;
  }
  if (!inParagraph) return false;

  const marker = doc.sliceString(line.from, main.head).trimEnd();
  const insert = state.lineBreak + marker + state.lineBreak;
  view.dispatch(
    state.update({
      changes: { from: line.from, insert },
      selection: EditorSelection.cursor(main.head + insert.length),
      scrollIntoView: true,
      userEvent: "input",
    })
  );
  return true;
};

/**
 * Enter, in a document that is mostly points: a new point where the markdown
 * command would carry the old one on, a way out of a carried-on line left
 * empty, a clean end to a list or a quote, and the markdown command everywhere
 * else - it is the one that knows how to renumber what follows and step out of
 * a nested list.
 */
export function insertNewLine(continueMarkup: Command): Command {
  return (view) =>
    startListItem(view) ||
    leaveListItem(view) ||
    endBlock(view) ||
    openPointUnderParagraph(view) ||
    continueMarkup(view);
}
