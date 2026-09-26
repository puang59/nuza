import { syntaxTree } from "@codemirror/language";
import { EditorState, Line, Range, StateEffect, StateField, Text } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { contentStart } from "./lists";

/**
 * List items that hang, rather than falling back to the margin.
 *
 * A point that runs past the end of the line - wrapped, or carried on with
 * shift+enter - used to start again under its own bullet, which reads as a new
 * paragraph rather than as more of the same point. Every line of an item is
 * indented to where its text begins instead, so the item stays one block with
 * the marker sitting out to its left.
 *
 * How far that is cannot be worked out from the source: the marker is drawn as
 * a bullet or a checkbox rather than as the characters it was typed as, and
 * the text is set in whichever proportional font is chosen, where no two
 * characters are the same width. So it is measured off the rendered line - but
 * only once per distinct prefix, since "- ", "  - " and "1. " are a handful of
 * shapes repeated down the document. The measurements are cached in the state
 * and thrown away when the font moves under them.
 */

/** What sits in front of a line's text: a marker, or a run of indentation. */
interface Prefix {
  /**
   * Identity for the cache. The same characters are not always drawn to the
   * same width - a nested bullet is set further out than the one above it -
   * so how the prefix is drawn is part of the key, and an empty key stands
   * for a line with nothing in front of its text at all.
   */
  key: string;
  /** Start of the line the prefix is on. */
  from: number;
  /** Where the prefix ends, which is the point measured to. */
  to: number;
}

/** A line of a list item, and the two widths it is laid out from. */
interface ListLine {
  from: number;
  /** This line's own prefix, which its first row is pulled back by. */
  prefix: Prefix;
  /** The item's first-line prefix: where every row of the item lines up. */
  anchor: Prefix;
  /** Whether a quote is already indenting this line, which is added to. */
  quoted: boolean;
}

interface Widths {
  /**
   * The editor's character width when these were taken. It moves whenever the
   * font or its size does - including when a webfont finishes loading - and
   * every measurement moves with it, so the cache is dropped rather than kept.
   */
  scale: number;
  widths: ReadonlyMap<string, number>;
}

const EMPTY_WIDTHS: Widths = { scale: 0, widths: new Map() };

/** Prefixes that have now been measured off the rendered document. */
const measured = StateEffect.define<{ scale: number; widths: [string, number][] }>();

const prefixWidths = StateField.define<Widths>({
  create: () => EMPTY_WIDTHS,

  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(measured)) continue;

      const widths = new Map(effect.value.scale === value.scale ? value.widths : []);
      for (const [key, width] of effect.value.widths) widths.set(key, width);
      value = { scale: effect.value.scale, widths };
    }
    return value;
  },
});

/** How deeply the item is nested, which is what widens a nested bullet. */
function depthOf(item: SyntaxNode) {
  let depth = -1;
  for (let node: SyntaxNode | null = item.parent; node; node = node.parent) {
    if (node.name === "BulletList" || node.name === "OrderedList") depth++;
  }
  return Math.max(0, depth);
}

/** Whether the line sits inside a quote, which indents it by 1em of its own. */
function isQuoted(item: SyntaxNode) {
  for (let node: SyntaxNode | null = item.parent; node; node = node.parent) {
    if (node.name === "Blockquote") return true;
  }
  return false;
}

/** The indentation a continuation line already carries in the source. */
function indentEnd(doc: Text, line: Line) {
  let at = line.from;
  while (at < line.to && /[ \t]/.test(doc.sliceString(at, at + 1))) at++;
  return at;
}

function prefixOf(doc: Text, from: number, to: number, kind: string): Prefix {
  return { key: from === to ? "" : `${kind}:${doc.sliceString(from, to)}`, from, to };
}

/** Every line of every list item overlapping the given stretch of document. */
function listLines(state: EditorState, from: number, to: number): ListLine[] {
  const doc = state.doc;
  const lines: ListLine[] = [];
  const firstVisible = doc.lineAt(from).number;
  const lastVisible = doc.lineAt(to).number;

  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name !== "ListItem") return;

      const item = node.node;
      const opening = doc.lineAt(item.from);
      const text = contentStart(doc, item, opening);
      if (text === null) return;

      // A nested bullet is drawn further out than the one above it, so the
      // same characters do not always come to the same width.
      const anchor = prefixOf(doc, opening.from, text, `${depthOf(item)}`);
      const quoted = isQuoted(item);

      // Lines that belong to a list nested inside this one are that item's to
      // indent, not this one's.
      const nested: SyntaxNode[] = [];
      for (let child = item.firstChild; child; child = child.nextSibling) {
        if (child.name === "BulletList" || child.name === "OrderedList") nested.push(child);
      }

      const last = Math.min(doc.lineAt(item.to).number, lastVisible);
      for (let number = Math.max(opening.number, firstVisible); number <= last; number++) {
        const line = doc.line(number);
        if (nested.some((child) => child.from <= line.to && child.to >= line.from)) continue;

        lines.push({
          from: line.from,
          prefix: number === opening.number ? anchor : prefixOf(doc, line.from, indentEnd(doc, line), "ws"),
          anchor,
          quoted,
        });
      }
    },
  });

  return lines;
}

/**
 * The rendered width of a prefix, taken from the line it is on.
 *
 * This stays the same once the indent below has been applied - the line is
 * pushed right by as much as its first row is pulled left - so measuring an
 * indented line gives the same answer as measuring a bare one, and the two
 * never chase each other.
 */
function widthOf(view: EditorView, prefix: Prefix) {
  const start = view.coordsAtPos(prefix.from, 1);
  const end = view.coordsAtPos(prefix.to, 1);
  if (!start || !end) return null;
  return Math.max(0, Math.round((end.left - start.left) * 100) / 100);
}

/**
 * The editor's character width, rounded. Everything measured moves with it, so
 * it stands in for "the font as it is right now" - but it is a measurement
 * itself, and rounding keeps a hair of movement in it from reading as a new
 * font every frame.
 */
function scaleOf(view: EditorView) {
  return Math.round(view.defaultCharacterWidth * 100) / 100;
}

/** The width a prefix is laid out at, or undefined until it has been measured. */
function widthFor({ widths }: Widths, prefix: Prefix) {
  return prefix.key === "" ? 0 : widths.get(prefix.key);
}

/**
 * The negative `text-indent` is what lets the marker hang: the line as a whole
 * moves right to where its text starts, and its first row alone is pulled back
 * out by the width of the marker in front of it.
 *
 * A quoted line is already carrying the 1em the theme gives `.cm-md-quote`,
 * and an inline style would replace it rather than add to it - so where that
 * applies it is written back in, and the quote keeps its rule against the
 * margin instead of being pushed out by the list inside it.
 */
function indentDecoration(indent: number, hang: number, quoted: boolean) {
  const start = quoted ? `calc(1em + ${indent}px)` : `${indent}px`;
  return Decoration.line({
    attributes: { style: `padding-left:${start};text-indent:${-hang}px` },
  });
}

function build(view: EditorView): DecorationSet {
  const known = view.state.field(prefixWidths);
  const out: Range<Decoration>[] = [];

  for (const { from, to } of view.visibleRanges) {
    for (const line of listLines(view.state, from, to)) {
      const indent = widthFor(known, line.anchor);
      const hang = widthFor(known, line.prefix);
      // Nothing is drawn from a guess: an unmeasured line is left flush for
      // the one frame it takes for its width to come back.
      if (indent === undefined || hang === undefined || indent === 0) continue;

      out.push(indentDecoration(indent, hang, line.quoted).range(line.from));
    }
  }

  return Decoration.set(out, true);
}

export const listIndentation = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    /**
     * What was last sent off to be remembered. A measurement that refuses to
     * settle would otherwise be dispatched, rebuilt and measured again on
     * every frame; asking for the same widths at the same font twice running
     * means the answer is not going to change.
     */
    dispatched = "";
    /** False once the editor has gone, so a measurement in flight lets go. */
    alive = true;

    constructor(view: EditorView) {
      this.decorations = build(view);
      this.measure(view);
    }

    update(update: ViewUpdate) {
      if (
        !update.docChanged &&
        !update.viewportChanged &&
        !update.geometryChanged &&
        update.startState.field(prefixWidths) === update.state.field(prefixWidths)
      ) {
        return;
      }

      this.decorations = build(update.view);
      this.measure(update.view);
    }

    /**
     * Takes the width of any prefix on screen that has not been measured at
     * this font yet, and puts it in the state for the next build to lay out
     * from. Nothing is dispatched when there is nothing new to say, which is
     * what keeps this from feeding itself.
     */
    measure(view: EditorView) {
      const known = view.state.field(prefixWidths);
      const scale = scaleOf(view);
      const wanted = new Map<string, Prefix>();

      for (const { from, to } of view.visibleRanges) {
        for (const line of listLines(view.state, from, to)) {
          for (const prefix of [line.anchor, line.prefix]) {
            if (prefix.key === "" || wanted.has(prefix.key)) continue;
            if (known.scale === scale && known.widths.has(prefix.key)) continue;
            wanted.set(prefix.key, prefix);
          }
        }
      }

      if (wanted.size === 0) return;

      view.requestMeasure({
        read: () => Array.from(wanted.values(), (prefix) => [prefix.key, widthOf(view, prefix)] as const),
        write: (taken) => {
          const widths = taken.filter((entry): entry is [string, number] => entry[1] !== null);
          if (widths.length === 0) return;

          const signature = `${scale}|${widths.map(([key]) => key).join("\u0000")}`;
          if (signature === this.dispatched) return;

          this.dispatched = signature;
          // The editor is mid-update while a measurement is being written
          // back, and will not take a transaction there. The microtask right
          // after the measure cycle is still inside the same frame, so the
          // indent lands before anything is painted.
          queueMicrotask(() => {
            if (this.alive) view.dispatch({ effects: measured.of({ scale, widths }) });
          });
        },
      });
    }

    destroy() {
      this.alive = false;
    }
  },
  { decorations: (plugin) => plugin.decorations }
);

/** The indent, and the cache of measurements it lays out from. */
export const listIndent = [prefixWidths, listIndentation];
