import { EditorState, Extension, Range, Text } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";

/**
 * The part of zen mode that lives in the editor: everything but the paragraph
 * being written steps back.
 *
 * With the chrome gone the note is all there is on screen, and the rest of the
 * note is the next distraction. So the lines around the caret stay at full
 * strength and the others are dimmed - still readable, still there to glance
 * at, but not asking to be read.
 */

/**
 * The paragraph `pos` is in: the run of lines with something on them around
 * it, by line number. On a blank line it is that line alone.
 */
export function paragraphAt(doc: Text, pos: number): { first: number; last: number } {
  const here = doc.lineAt(Math.max(0, Math.min(pos, doc.length)));
  if (!/\S/.test(here.text)) return { first: here.number, last: here.number };

  let first = here.number;
  while (first > 1 && /\S/.test(doc.line(first - 1).text)) first--;
  let last = here.number;
  while (last < doc.lines && /\S/.test(doc.line(last + 1).text)) last++;
  return { first, last };
}

const HERE = Decoration.line({ class: "cm-zen-here" });

/** Marks the lines of every paragraph a caret or selection touches. */
function currentLines(state: EditorState): DecorationSet {
  const marked = new Set<number>();
  for (const range of state.selection.ranges) {
    const from = paragraphAt(state.doc, range.from).first;
    const to = paragraphAt(state.doc, range.to).last;
    for (let number = from; number <= to; number++) marked.add(number);
  }

  const out: Range<Decoration>[] = Array.from(marked)
    .sort((a, b) => a - b)
    .map((number) => HERE.range(state.doc.line(number).from));
  return Decoration.set(out);
}

const paragraphFocus = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = currentLines(view.state);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet) this.decorations = currentLines(update.state);
    }
  },
  { decorations: (plugin) => plugin.decorations }
);

const focusTheme = EditorView.theme({
  /* Every block of the note, the drawn ones included - a table or a picture
     is as much "the rest of the note" as a line of text is. */
  ".cm-content > *": {
    opacity: "0.32",
    transition: "opacity 220ms ease",
  },
  ".cm-content > .cm-zen-here": { opacity: "1" },
  "@media (prefers-reduced-motion: reduce)": {
    ".cm-content > *": { transition: "none" },
  },
});

/** Dims everything but the paragraph being written. Part of zen mode. */
export const zenFocus: Extension = [paragraphFocus, focusTheme];
