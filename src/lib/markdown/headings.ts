import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";

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
 * Takes `view` to the heading whose line starts at `from`: scrolled to the top
 * of the pane, the caret at the end of it, and the editor holding the keyboard.
 * The caret goes too because, left where it was, the first arrow key or
 * letter typed scrolled straight back to it.
 */
function goToHeading(view: EditorView, from: number, flash = true) {
  view.dispatch({
    selection: { anchor: view.state.doc.lineAt(from).to },
    effects: [
      EditorView.scrollIntoView(from, { y: "start", yMargin: 48 }),
      ...(flash ? [setFlash.of(from)] : []),
    ],
  });
  view.focus();
}

/**
 * Which heading's section `pos` is in: the index of the last heading that
 * starts at or before it, or -1 above the first heading.
 */
export function sectionAt(headings: readonly Heading[], pos: number) {
  let found = -1;
  for (let index = 0; index < headings.length; index++) {
    if (headings[index].from > pos) break;
    found = index;
  }
  return found;
}

/**
 * The heading to move to from a caret on the line starting at `lineStart`:
 * the next one below it, or the nearest one above. Null at either end.
 */
export function adjacentHeading(headings: readonly Heading[], lineStart: number, direction: 1 | -1) {
  if (direction === 1) return headings.find((heading) => heading.from > lineStart) ?? null;
  for (let index = headings.length - 1; index >= 0; index--) {
    if (headings[index].from < lineStart) return headings[index];
  }
  return null;
}

function moveByHeading(direction: 1 | -1) {
  return (view: EditorView) => {
    const head = view.state.selection.main.head;
    const heading = adjacentHeading(readHeadings(view.state), view.state.doc.lineAt(head).from, direction);
    if (!heading) return false;
    goToHeading(view, heading.from, false);
    return true;
  };
}

/** Moves to the next heading down the note. False when there is none. */
export const nextHeading = moveByHeading(1);
/** Moves to the nearest heading above the caret's line. False when there is none. */
export const previousHeading = moveByHeading(-1);

/** Takes `view` to the heading starting at `from`, for a row of the outline. */
export function jumpToHeadingAt(view: EditorView, from: number) {
  if (from < 0 || from > view.state.doc.length) return;
  goToHeading(view, view.state.doc.lineAt(from).from);
}

/** What the outline is told: a note's headings, and which section is in view. */
export interface Outline {
  headings: Heading[];
  /** Index into `headings` of the section at the top of the pane, or -1. */
  active: number;
  /**
   * Whether that section's own heading has scrolled out above the pane - which
   * is when it is worth saying, somewhere, which section this is.
   */
  headingOffscreen: boolean;
}

export const EMPTY_OUTLINE: Outline = { headings: [], active: -1, headingOffscreen: false };

/**
 * The headings a section sits under, outermost first, ending with its own:
 * "Setup", "Install", for the `### Install` under `## Setup`. Empty above the
 * first heading.
 */
export function headingPath(headings: readonly Heading[], active: number): Heading[] {
  if (active < 0 || active >= headings.length) return [];

  const path = [headings[active]];
  for (let index = active - 1; index >= 0; index--) {
    if (headings[index].level < path[0].level) path.unshift(headings[index]);
  }
  return path;
}

type OutlineListener = (view: EditorView, outline: Outline) => void;
const outlineListeners = new Set<OutlineListener>();

/** Hears about every editor's outline as it changes. Returns the way to stop. */
export function subscribeToOutline(listener: OutlineListener) {
  outlineListeners.add(listener);
  return () => void outlineListeners.delete(listener);
}

/** How long after the last edit the headings are read again. */
const OUTLINE_DELAY = 250;

/**
 * Keeps whoever is listening told about the note's headings and about which
 * of them the pane is in. The headings are read when the note is opened and
 * shortly after it stops being typed in - reading them walks the whole note -
 * and the section in view is worked out once a frame while scrolling, from
 * the heights the editor already knows.
 */
export const outlineReporter = ViewPlugin.fromClass(
  class {
    private headings: Heading[] = [];
    private active = -1;
    private headingOffscreen = false;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private frame = 0;

    constructor(private readonly view: EditorView) {
      view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
      // Not during construction: the editor is mid-update, and has not been
      // measured yet.
      this.timer = setTimeout(() => this.read(), 0);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.read(), OUTLINE_DELAY);
      } else if (update.geometryChanged) {
        this.onScroll();
      }
    }

    private read() {
      this.timer = null;
      this.headings = readHeadings(this.view.state);
      this.active = this.sectionInView();
      this.headingOffscreen = this.isHeadingOffscreen(this.active);
      this.tell();
    }

    private sectionInView() {
      if (this.headings.length === 0) return -1;
      const { scrollDOM, documentTop } = this.view;
      // A little way into the pane, so a heading at its very top counts as
      // the section being read rather than the one just left.
      const height = scrollDOM.getBoundingClientRect().top - documentTop + 64;
      return sectionAt(this.headings, this.view.lineBlockAtHeight(height).from);
    }

    /** Whether the heading at `index` is wholly above the top of the pane. */
    private isHeadingOffscreen(index: number) {
      const heading = this.headings[index];
      if (!heading || heading.from > this.view.state.doc.length) return false;
      const { scrollDOM, documentTop } = this.view;
      const top = scrollDOM.getBoundingClientRect().top - documentTop;
      return this.view.lineBlockAt(heading.from).bottom <= top;
    }

    private onScroll = () => {
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        const active = this.sectionInView();
        const headingOffscreen = this.isHeadingOffscreen(active);
        if (active === this.active && headingOffscreen === this.headingOffscreen) return;
        this.active = active;
        this.headingOffscreen = headingOffscreen;
        this.tell();
      });
    };

    private tell() {
      const outline = {
        headings: this.headings,
        active: this.active,
        headingOffscreen: this.headingOffscreen,
      };
      for (const listener of outlineListeners) listener(this.view, outline);
    }

    destroy() {
      if (this.timer) clearTimeout(this.timer);
      if (this.frame) cancelAnimationFrame(this.frame);
      this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    }
  }
);

/**
 * Scrolls `view` to the heading `wanted` and highlights it for a moment.
 * Returns whether there was such a heading - a link to one that is gone, or
 * was never written, leaves the note where it is.
 */
export function jumpToHeading(view: EditorView, wanted: string) {
  const heading = findHeading(readHeadings(view.state), wanted);
  if (!heading) return false;

  goToHeading(view, heading.from);

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
