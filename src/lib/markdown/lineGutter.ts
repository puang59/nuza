import { syntaxTree } from "@codemirror/language";
import { EditorState, Extension, RangeSet, RangeSetBuilder, StateField, Text } from "@codemirror/state";
import {
  EditorView,
  GutterMarker,
  gutterLineClass,
  gutterWidgetClass,
  highlightActiveLineGutter,
  lineNumberWidgetMarker,
  lineNumbers,
} from "@codemirror/view";
import { frontmatterRange } from "./frontmatter";
import { CODE_FONT_FAMILY } from "./theme";
import { TableWidget } from "./widgets";

/**
 * Line numbers for a rendered note.
 *
 * CodeMirror's own gutter assumes every line is a line of code: one size, one
 * line height, a number per line. A rendered note is none of that. A heading
 * is twice the size with room above it, a code block is set smaller in another
 * face, and the properties block and a table are drawn as a single widget each
 * - so the stock numbers floated above their headings, sat a pixel off every
 * ordinary line, and counted the rows of things that no longer look like rows.
 */

/** How big a number is, against the text it sits beside. */
const NUMBER_SCALE = 0.8;

/**
 * The size and spacing of each kind of line the numbers have to line up with,
 * as the theme sets them. Headings carry their room above as padding, which
 * the gutter element repeats so the number starts where the heading does.
 */
const LINE_KINDS: Record<string, { size: number; lineHeight: number; padTop?: number; font?: string }> = {
  h1: { size: 1.9, lineHeight: 1.3, padTop: 0.55 },
  h2: { size: 1.52, lineHeight: 1.3, padTop: 0.6 },
  h3: { size: 1.28, lineHeight: 1.3, padTop: 0.65 },
  h4: { size: 1.12, lineHeight: 1.3, padTop: 0.7 },
  h5: { size: 1, lineHeight: 1.3, padTop: 0.75 },
  h6: { size: 0.92, lineHeight: 1.3, padTop: 0.8 },
  code: { size: 0.9, lineHeight: 1.75, font: CODE_FONT_FAMILY },
  /* A rendered table: its first row of text sits below the wrapper's 0.5em
     and the header cell's 0.4em of padding. */
  table: { size: 0.94, lineHeight: 1.5, padTop: (0.5 + 0.4 * 0.94) / 0.94 },
};

class LineKind extends GutterMarker {
  constructor(readonly elementClass: string) {
    super();
  }
}

const KIND_MARKERS: Record<string, GutterMarker> = Object.fromEntries(
  Object.keys(LINE_KINDS).map((kind) => [kind, new LineKind(`cm-gutter-${kind}`)])
);

/** Blocks that hold no headings or code, so the walk need not go inside them. */
const LEAF_BLOCKS = new Set(["Paragraph", "Table", "HTMLBlock", "LinkReference", "HorizontalRule"]);

/** Which lines are headings or code, for the gutter to size their numbers to. */
function lineKinds(state: EditorState) {
  const builder = new RangeSetBuilder<GutterMarker>();
  const doc = state.doc;

  syntaxTree(state).iterate({
    enter(node) {
      const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(node.name);
      if (heading) {
        builder.add(doc.lineAt(node.from).from, doc.lineAt(node.from).from, KIND_MARKERS[`h${heading[1]}`]);
        return false;
      }
      if (node.name === "FencedCode" || node.name === "CodeBlock") {
        const last = doc.lineAt(node.to).number;
        for (let number = doc.lineAt(node.from).number; number <= last; number++) {
          const start = doc.line(number).from;
          builder.add(start, start, KIND_MARKERS.code);
        }
        return false;
      }
      if (LEAF_BLOCKS.has(node.name)) return false;
    },
  });

  return builder.finish();
}

const lineKindField = StateField.define<RangeSet<GutterMarker>>({
  create: lineKinds,
  update(kinds, transaction) {
    const treeMoved = syntaxTree(transaction.startState) !== syntaxTree(transaction.state);
    return transaction.docChanged || treeMoved ? lineKinds(transaction.state) : kinds;
  },
  provide: (field) => gutterLineClass.from(field),
});

/** The end of each document's properties block, worked out once per version of it. */
const frontmatterEnds = new WeakMap<Text, number>();

function frontmatterEnd(doc: Text) {
  let end = frontmatterEnds.get(doc);
  if (end === undefined) {
    end = frontmatterRange(doc)?.to ?? -1;
    frontmatterEnds.set(doc, end);
  }
  return end;
}

/**
 * The number shown for a line, or nothing. The properties block is metadata
 * rather than part of the note, and is drawn as a form, so it goes unnumbered.
 * A table is one thing on screen, so only its first line carries a number.
 * Every other line keeps its real number, the one the status bar and Vim's
 * `:12` agree on.
 */
export function gutterNumber(lineNumber: number, state: EditorState) {
  // The gutter also asks for a number past the end - 9, 99, 999 - to size its
  // width by, which is no line at all.
  if (lineNumber < 1 || lineNumber > state.doc.lines) return String(lineNumber);
  const line = state.doc.line(lineNumber);
  if (line.from <= frontmatterEnd(state.doc)) return "";

  for (let node = syntaxTree(state).resolveInner(line.from, 1); node.parent; node = node.parent) {
    if (node.name === "Table")
      return state.doc.lineAt(node.from).number === lineNumber ? String(lineNumber) : "";
  }
  return String(lineNumber);
}

class NumberText extends GutterMarker {
  constructor(readonly text: string) {
    super();
  }

  eq(other: NumberText) {
    return other.text === this.text;
  }

  toDOM() {
    return document.createTextNode(this.text);
  }
}

/**
 * A number for a block drawn as one widget - a rendered table, a run of HTML, a
 * rule. The stock gutter leaves these blank, which left a hole in the count
 * wherever the note had something rendered; each gets its first line's number
 * instead, the same rule a table follows while it is being edited as text.
 */
const widgetNumbers = lineNumberWidgetMarker.of((view, _widget, block) => {
  const line = view.state.doc.lineAt(block.from);
  const text = gutterNumber(line.number, view.state);
  return text ? new NumberText(text) : null;
});

/**
 * A drawn table's number lines up with its header row. Only the widget gets
 * this: a table being edited is lines of text, and its first line an ordinary
 * one.
 */
const tableWidgetClass = gutterWidgetClass.of((_view, widget) =>
  widget instanceof TableWidget ? KIND_MARKERS.table : null
);

/**
 * Each number is set small, and shares a baseline with an invisible strut the
 * size of the line beside it - the line box is the strut's, so the number sits
 * on the same baseline as the text rather than being centred in a box of its
 * own height. A heading's strut is heading-sized and pushed down by the same
 * room the heading has above it.
 */
function gutterTheme() {
  const strut = (size: number, lineHeight: number, font?: string) => ({
    content: '"\\200b"',
    fontSize: `${size / NUMBER_SCALE}em`,
    lineHeight: String(lineHeight),
    ...(font ? { fontFamily: font } : {}),
  });

  const kinds = Object.fromEntries(
    Object.entries(LINE_KINDS).flatMap(([kind, { size, lineHeight, padTop, font }]) => [
      [`.cm-lineNumbers .cm-gutterElement.cm-gutter-${kind}::before`, strut(size, lineHeight, font)],
      [
        `.cm-lineNumbers .cm-gutterElement.cm-gutter-${kind}`,
        { paddingTop: padTop ? `${(padTop * size) / NUMBER_SCALE}em` : "0" },
      ],
    ])
  );

  return EditorView.theme({
    /* No panel of its own: the numbers sit on the page like the text does.
       The gutter and the column are centred together, so the gap between
       them stays the same however wide the window is. */
    ".cm-gutters": {
      backgroundColor: "transparent",
      border: "none",
      color: "var(--nuza-muted)",
      marginLeft: "auto",
      paddingRight: "1.75rem",
    },
    ".cm-gutters ~ .cm-content": {
      marginLeft: "0",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      fontSize: `${NUMBER_SCALE}em`,
      lineHeight: "0",
      padding: "0",
      minWidth: "1.5em",
      opacity: "0.45",
      fontVariantNumeric: "tabular-nums",
      transition: "opacity 120ms ease",
    },
    ".cm-lineNumbers .cm-gutterElement::before": strut(1, 1.75),
    ...kinds,
    /* The line the caret is on reads a little stronger, which is the one
       number anyone is likely to be looking for. */
    ".cm-lineNumbers .cm-gutterElement.cm-activeLineGutter": {
      backgroundColor: "transparent",
      opacity: "0.85",
    },
    /* A heading with the caret on it shows its #s, hung in the margin where
       its number is: the number steps aside for them rather than the two
       being drawn over each other. */
    ...Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map((level) => [
        `.cm-lineNumbers .cm-gutterElement.cm-activeLineGutter.cm-gutter-h${level}`,
        { opacity: "0" },
      ])
    ),
  });
}

/** Line numbers that line up with, and make sense for, a rendered note. */
export const noteLineNumbers: Extension = [
  lineNumbers({ formatNumber: gutterNumber }),
  widgetNumbers,
  tableWidgetClass,
  highlightActiveLineGutter(),
  lineKindField,
  gutterTheme(),
];
