import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";

/**
 * A note's headings, and the way a link to one gets there: `[[note#heading]]`,
 * `[[#heading]]` and `[text](#heading)` all end up here.
 */

export interface Heading {
  level: number;
  /** The heading as it reads, without its `#`s and without inline markup. */
  text: string;
  /** Where the heading's line starts. */
  from: number;
}

/** Inline markup taken off a heading so that what is compared is what is read. */
function plain(text: string) {
  return text
    .replace(/!?\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "");
}

/** Case and spacing flattened, which is how a heading is looked for. */
function normalise(text: string) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * The anchor a heading has on the web - lower case, punctuation gone, spaces
 * as hyphens - so that `[text](#my-heading)` finds "My Heading" the way it
 * would anywhere else.
 */
export function headingSlug(text: string) {
  return normalise(text)
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/ /g, "-");
}

/** Every heading in the note, in order. */
export function readHeadings(state: EditorState): Heading[] {
  const doc = state.doc;
  // A tree that has not reached the end of a long note yet would have the
  // headings below that point missing, so it is given a moment to finish.
  const tree = ensureSyntaxTree(state, doc.length, 200);
  if (!tree) return [];

  const headings: Heading[] = [];
  tree.iterate({
    enter(node) {
      const atx = /^ATXHeading([1-6])$/.exec(node.name);
      const setext = /^SetextHeading([12])$/.exec(node.name);
      if (!atx && !setext) return;

      const line = doc.lineAt(node.from);
      const raw = atx
        ? doc
            .sliceString(node.from, node.to)
            .replace(/^#{1,6}[ \t]*/, "")
            .replace(/[ \t]+#+[ \t]*$/, "")
        : line.text;
      const text = plain(raw).replace(/\s+/g, " ").trim();
      if (text) headings.push({ level: Number((atx ?? setext)![1]), text, from: line.from });
      return false;
    },
  });
  return headings;
}

/** The heading `wanted` names: by its text, or by its anchor. The first, where several match. */
export function findHeading(headings: Heading[], wanted: string): Heading | null {
  const text = normalise(wanted);
  if (!text) return null;
  const slug = headingSlug(wanted);

  return (
    headings.find((heading) => normalise(heading.text) === text) ??
    headings.find((heading) => headingSlug(heading.text) === slug) ??
    null
  );
}

/** How long a heading keeps its highlight once a link has brought you to it. */
const FLASH_MS = 1400;

const setFlash = StateEffect.define<number | null>();

const flashTimers = new WeakMap<EditorView, ReturnType<typeof setTimeout>>();

const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(flash, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setFlash)) {
        return effect.value === null
          ? Decoration.none
          : Decoration.set(Decoration.line({ class: "cm-md-flash" }).range(effect.value));
      }
    }
    return transaction.docChanged ? Decoration.none : flash;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** The highlight a jump leaves on the heading; its look is `.cm-md-flash` in App.css. */
export const headingFlash = flashField;

/**
 * Scrolls `view` to the heading `wanted` and highlights it for a moment.
 * Returns whether there was such a heading - a link to one that is gone, or
 * was never written, leaves the note where it is.
 */
export function jumpToHeading(view: EditorView, wanted: string) {
  const heading = findHeading(readHeadings(view.state), wanted);
  if (!heading) return false;

  view.dispatch({
    // The caret goes too, to the end of the heading: left where the link was,
    // the first arrow key or letter typed scrolled straight back to it.
    selection: { anchor: view.state.doc.lineAt(heading.from).to },
    effects: [
      EditorView.scrollIntoView(heading.from, { y: "start", yMargin: 48 }),
      setFlash.of(heading.from),
    ],
  });
  view.focus();

  // One timer to a view: a second jump inside the first's time takes the
  // first's timer with it, so it is not cut short by it.
  clearTimeout(flashTimers.get(view));
  flashTimers.set(
    view,
    setTimeout(() => {
      if (view.dom.isConnected) view.dispatch({ effects: setFlash.of(null) });
    }, FLASH_MS)
  );
  return true;
}
