import { ChangeSpec, EditorSelection, EditorState, Line, StateCommand, Text } from "@codemirror/state";

/**
 * Bold, italic and links from the keyboard.
 *
 * Emphasis is written with `*` - two for bold, one for italic, three for both
 * - and toggling works by counting the stars on either side of the selection:
 * an even run of two or more is bold, an odd run is italic, three is both. So
 * italic toggled inside `**word**` adds a star rather than stripping one off
 * the bold, and bold toggled inside `***word***` leaves the italic standing.
 */

/** How many `*` sit directly before `from` and directly after `to`. */
function starsAround(doc: Text, from: number, to: number) {
  let before = 0;
  while (from - before > 0 && doc.sliceString(from - before - 1, from - before) === "*") before++;
  let after = 0;
  while (to + after < doc.length && doc.sliceString(to + after, to + after + 1) === "*") after++;
  return Math.min(before, after);
}

/** How many `*` the text itself opens and closes with. */
function starsWithin(text: string) {
  let count = 0;
  while (count * 2 < text.length && text[count] === "*" && text[text.length - 1 - count] === "*") count++;
  return count;
}

const isBold = (stars: number) => stars >= 2;
const isItalic = (stars: number) => stars % 2 === 1;

function toggleEmphasis(width: 1 | 2): StateCommand {
  const has = width === 2 ? isBold : isItalic;

  return ({ state, dispatch }) => {
    const change = state.changeByRange((range) => {
      const { from, to } = range;
      const text = state.sliceDoc(from, to);

      // The stars are part of the selection: `**word**` selected whole.
      const inside = starsWithin(text);
      if (!range.empty && has(inside) && text.length > inside * 2) {
        return {
          changes: [
            { from, to: from + width },
            { from: to - width, to },
          ],
          range: EditorSelection.range(from, to - width * 2),
        };
      }

      // The stars are around the selection, or around the caret.
      if (has(starsAround(state.doc, from, to))) {
        return {
          changes: [
            { from: from - width, to: from },
            { from: to, to: to + width },
          ],
          range: EditorSelection.range(from - width, to - width),
        };
      }

      const marker = "*".repeat(width);
      return {
        changes: [
          { from, insert: marker },
          { from: to, insert: marker },
        ],
        range: EditorSelection.range(from + width, to + width),
      };
    });

    dispatch(state.update(change, { scrollIntoView: true, userEvent: "input.format" }));
    return true;
  };
}

export const toggleBold = toggleEmphasis(2);
export const toggleItalic = toggleEmphasis(1);

const URL = /^(https?:\/\/|mailto:|www\.)\S+$/i;

/**
 * Wraps the selection in a link and leaves the caret where the rest of it
 * goes: selected text becomes the label with the caret in the empty target,
 * a selected URL becomes the target with the caret in the empty label, and
 * with nothing selected both are empty and the caret is in the label.
 */
export const insertLink: StateCommand = ({ state, dispatch }) => {
  const change = state.changeByRange(({ from, to }) => {
    const text = state.sliceDoc(from, to);

    if (text && URL.test(text.trim())) {
      return { changes: { from, to, insert: `[](${text.trim()})` }, range: EditorSelection.cursor(from + 1) };
    }
    const insert = `[${text}]()`;
    const caret = text ? from + insert.length - 1 : from + 1;
    return { changes: { from, to, insert }, range: EditorSelection.cursor(caret) };
  });

  dispatch(state.update(change, { scrollIntoView: true, userEvent: "input.format" }));
  return true;
};

/**
 * Wraps the selection in `marker` on both sides, or takes the pair away if it
 * is already there - around the selection, or as its first and last characters.
 * With nothing selected the pair goes round the caret, ready to be typed into.
 */
function toggleWrap(marker: string): StateCommand {
  const width = marker.length;

  return ({ state, dispatch }) => {
    const change = state.changeByRange((range) => {
      const { from, to } = range;
      const text = state.sliceDoc(from, to);

      if (text.length >= width * 2 && text.startsWith(marker) && text.endsWith(marker)) {
        return {
          changes: [
            { from, to: from + width },
            { from: to - width, to },
          ],
          range: EditorSelection.range(from, to - width * 2),
        };
      }

      const before = state.sliceDoc(Math.max(0, from - width), from);
      const after = state.sliceDoc(to, Math.min(state.doc.length, to + width));
      if (before === marker && after === marker) {
        return {
          changes: [
            { from: from - width, to: from },
            { from: to, to: to + width },
          ],
          range: EditorSelection.range(from - width, to - width),
        };
      }

      return {
        changes: [
          { from, insert: marker },
          { from: to, insert: marker },
        ],
        range: EditorSelection.range(from + width, to + width),
      };
    });

    dispatch(state.update(change, { scrollIntoView: true, userEvent: "input.format" }));
    return true;
  };
}

export const toggleInlineCode = toggleWrap("`");
export const toggleStrikethrough = toggleWrap("~~");

/** What a line starts with, as far as these commands are concerned. */
interface LinePrefix {
  /** Leading whitespace, kept whatever the line is turned into. */
  indent: string;
  kind: "plain" | "heading" | "bullet" | "numbered" | "task" | "quote";
  /** How many `#`s, for a heading. */
  level: number;
  /** Where the line's own text starts, as an offset into it. */
  length: number;
}

const HEADING = /^(#{1,6})[ \t]+/;
const TASK = /^[-*+][ \t]+\[[ xX]\][ \t]+/;
const BULLET = /^[-*+][ \t]+/;
const NUMBERED = /^\d+[.)][ \t]+/;
const QUOTE = /^>[ \t]?/;

export function readPrefix(text: string): LinePrefix {
  const indent = /^[ \t]*/.exec(text)![0];
  const rest = text.slice(indent.length);
  const found = (kind: LinePrefix["kind"], match: RegExpExecArray, level = 0): LinePrefix => ({
    indent,
    kind,
    level,
    length: indent.length + match[0].length,
  });

  const heading = HEADING.exec(rest);
  if (heading) return found("heading", heading, heading[1].length);
  const task = TASK.exec(rest);
  if (task) return found("task", task);
  const bullet = BULLET.exec(rest);
  if (bullet) return found("bullet", bullet);
  const numbered = NUMBERED.exec(rest);
  if (numbered) return found("numbered", numbered);
  const quote = QUOTE.exec(rest);
  if (quote) return found("quote", quote);
  return { indent, kind: "plain", level: 0, length: indent.length };
}

/** The lines the selection touches, each once, in order. */
function selectedLines(state: EditorState): Line[] {
  const lines: Line[] = [];
  for (const range of state.selection.ranges) {
    const last = state.doc.lineAt(range.to).number;
    for (let number = state.doc.lineAt(range.from).number; number <= last; number++) {
      if (lines.length && lines[lines.length - 1].number >= number) continue;
      lines.push(state.doc.line(number));
    }
  }
  return lines;
}

/**
 * Rewrites what the selected lines start with. `marker` is given each line -
 * its place among those being changed, and what it starts with now - and says
 * what it should start with instead, after its indentation.
 *
 * Blank lines are left alone unless one is all that is selected: turning a
 * paragraph break into an empty bullet is never what was meant, while a
 * bullet on the empty line the caret is on is exactly what was.
 */
function relabelLines(
  state: EditorState,
  dispatch: (transaction: ReturnType<EditorState["update"]>) => void,
  marker: (index: number, prefix: LinePrefix) => string
) {
  const all = selectedLines(state);
  const lines = all.length > 1 ? all.filter((line) => /\S/.test(line.text)) : all;
  if (lines.length === 0) return false;

  const changes: ChangeSpec[] = lines.map((line, index) => {
    const prefix = readPrefix(line.text);
    return {
      from: line.from + prefix.indent.length,
      to: line.from + prefix.length,
      insert: marker(index, prefix),
    };
  });

  const changeSet = state.changes(changes);
  // Carried past what was put in front of it, so a caret at the start of a
  // line ends up after its new marker rather than before it.
  const selection = EditorSelection.create(
    state.selection.ranges.map((range) =>
      EditorSelection.range(changeSet.mapPos(range.anchor, 1), changeSet.mapPos(range.head, 1))
    ),
    state.selection.mainIndex
  );

  dispatch(state.update({ changes: changeSet, selection, scrollIntoView: true, userEvent: "input.format" }));
  return true;
}

/** Whether every selected line with something on it is already of `kind`. */
function allAre(state: EditorState, kind: LinePrefix["kind"], level?: number) {
  const lines = selectedLines(state).filter((line) => /\S/.test(line.text));
  return (
    lines.length > 0 &&
    lines.every((line) => {
      const prefix = readPrefix(line.text);
      return prefix.kind === kind && (level === undefined || prefix.level === level);
    })
  );
}

/**
 * Makes the selected lines headings of `level`, or plain text again for level
 * 0 - and for the level they already are, so the same chord puts a heading on
 * and takes it off. A list or quote marker in the way is replaced: a line is
 * one or the other.
 */
export function setHeading(level: number): StateCommand {
  return ({ state, dispatch }) => {
    const off = level === 0 || allAre(state, "heading", level);
    return relabelLines(state, dispatch, () => (off ? "" : `${"#".repeat(level)} `));
  };
}

/** Turns the selected lines into a list of one kind, or back into plain lines if they are one. */
function toggleList(kind: "bullet" | "numbered" | "task", marker: (index: number) => string): StateCommand {
  return ({ state, dispatch }) => {
    const off = allAre(state, kind);
    return relabelLines(state, dispatch, (index) => (off ? "" : marker(index)));
  };
}

export const toggleBulletList = toggleList("bullet", () => "- ");
export const toggleNumberedList = toggleList("numbered", (index) => `${index + 1}. `);
export const toggleTaskList = toggleList("task", () => "- [ ] ");

/**
 * Quotes the selected lines, or unquotes them if every one is quoted. Unlike
 * the others this goes in front of whatever the line already starts with: a
 * quoted list is a list, quoted.
 */
export const toggleBlockquote: StateCommand = ({ state, dispatch }) => {
  const lines = selectedLines(state);
  const quoted = lines.every((line) => QUOTE.test(line.text.trimStart()));

  const changes: ChangeSpec[] = lines.map((line) => {
    const indent = /^[ \t]*/.exec(line.text)![0].length;
    if (!quoted) return { from: line.from + indent, insert: "> " };
    const mark = QUOTE.exec(line.text.slice(indent))![0];
    return { from: line.from + indent, to: line.from + indent + mark.length };
  });

  const changeSet = state.changes(changes);
  const selection = EditorSelection.create(
    state.selection.ranges.map((range) =>
      EditorSelection.range(changeSet.mapPos(range.anchor, 1), changeSet.mapPos(range.head, 1))
    ),
    state.selection.mainIndex
  );
  dispatch(state.update({ changes: changeSet, selection, scrollIntoView: true, userEvent: "input.format" }));
  return true;
};
