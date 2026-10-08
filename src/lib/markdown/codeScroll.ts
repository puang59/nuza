import { syntaxTree } from "@codemirror/language";
import { EditorState, Extension, Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

/**
 * Code blocks that scroll sideways instead of wrapping.
 *
 * The editor wraps its lines, which is right for prose and wrong for code: a
 * long line broken mid-token loses its indentation, and anything laid out in
 * columns stops lining up. So a code block's lines do not wrap, and the block
 * moves sideways as one.
 *
 * There is no element around a block to scroll - its lines are siblings of
 * every other line in the note - so the block's position is kept here, one
 * offset to a block, and drawn by pulling each of its lines left by that
 * much. The caret and the selection are drawn from where the text really is,
 * so they move with it.
 *
 * Only blocks at the top level of the note are done this way. One inside a
 * list or a quote is already being set in by its own line styles, and goes on
 * wrapping as it did.
 */

/** The class a code line that scrolls is given by the live preview. */
export const SCROLLING_CODE_LINE = "cm-md-code-scroll";

/** Sets how far the block starting at `block` is scrolled; zero puts it back. */
export const setCodeScroll = StateEffect.define<{ block: number; offset: number }>();

/** The top-level code block `pos` is in, or null. */
export function codeBlockAt(state: EditorState, pos: number): SyntaxNode | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === "FencedCode" || node.name === "CodeBlock") {
      return node.parent && !node.parent.parent ? node : null;
    }
  }
  return null;
}

/** How far each scrolled block is scrolled, by where the block starts. */
export const codeScroll = StateField.define<ReadonlyMap<number, number>>({
  create: () => new Map(),

  update(offsets, transaction) {
    let next: Map<number, number> | null = null;
    const edit = () => (next ??= new Map(offsets));

    if (transaction.docChanged && offsets.size > 0) {
      // Each offset follows its block through the edit, and goes with it if
      // what is there afterwards is no longer the start of a code block.
      next = new Map();
      for (const [block, offset] of offsets) {
        const moved = transaction.changes.mapPos(block, 1);
        if (codeBlockAt(transaction.state, moved)?.from === moved) next.set(moved, offset);
      }
    }

    for (const effect of transaction.effects) {
      if (!effect.is(setCodeScroll)) continue;
      const { block, offset } = effect.value;
      if (offset > 0) edit().set(block, Math.round(offset));
      else edit().delete(block);
    }

    return next ?? offsets;
  },

  provide: (field) =>
    EditorView.decorations.from(field, (offsets) => (view) => scrolledLines(view.state, offsets)),
});

/** A line decoration for every line of every scrolled block. */
function scrolledLines(state: EditorState, offsets: ReadonlyMap<number, number>): DecorationSet {
  if (offsets.size === 0) return Decoration.none;

  const out: Range<Decoration>[] = [];
  for (const [block, offset] of offsets) {
    const node = codeBlockAt(state, block);
    if (!node || node.from !== block) continue;

    const pulled = Decoration.line({ attributes: { style: `text-indent:-${offset}px` } });
    const last = state.doc.lineAt(node.to).number;
    for (let number = state.doc.lineAt(node.from).number; number <= last; number++) {
      out.push(pulled.range(state.doc.line(number).from));
    }
  }
  return Decoration.set(out, true);
}

/** The lines of the block `line` belongs to, as they are drawn. */
function blockLines(line: HTMLElement): HTMLElement[] {
  const lines = [line];
  for (let prev = line.previousElementSibling; prev?.classList.contains(SCROLLING_CODE_LINE);) {
    lines.unshift(prev as HTMLElement);
    prev = prev.previousElementSibling;
  }
  for (let next = line.nextElementSibling; next?.classList.contains(SCROLLING_CODE_LINE);) {
    lines.push(next as HTMLElement);
    next = next.nextElementSibling;
  }
  return lines;
}

/**
 * How far a block can be scrolled: the width of its longest line beyond what
 * fits. A line already pulled left reports that much less overflow, so the
 * pull is added back on.
 */
export function maxScroll(widths: readonly { scrollWidth: number; clientWidth: number }[], offset: number) {
  return Math.max(0, ...widths.map((line) => line.scrollWidth + offset - line.clientWidth));
}

function scrollBy(view: EditorView, line: HTMLElement, delta: number) {
  const block = codeBlockAt(view.state, view.posAtDOM(line));
  if (!block) return false;

  const current = view.state.field(codeScroll).get(block.from) ?? 0;
  const offset = Math.max(0, Math.min(maxScroll(blockLines(line), current), current + delta));
  if (offset === current) return false;

  view.dispatch({ effects: setCodeScroll.of({ block: block.from, offset }) });
  return true;
}

/**
 * A sideways swipe over a code block - or the wheel with shift held - moves
 * the block. An up-and-down scroll is the note's, and is left to it.
 */
const wheelScrolls = EditorView.domEventHandlers({
  wheel(event, view) {
    const sideways = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
    if (sideways === 0 || Math.abs(sideways) < Math.abs(event.shiftKey ? 0 : event.deltaY)) return false;

    const line = (event.target as HTMLElement | null)?.closest<HTMLElement>(`.${SCROLLING_CODE_LINE}`);
    if (!line) return false;

    // Taken whether or not the block could move: a swipe that has reached the
    // end of a code block should not turn into the window going back a page.
    event.preventDefault();
    scrollBy(view, line, sideways);
    return true;
  },
});

/** How much of the block's edge is kept clear around the caret, in pixels. */
const CARET_MARGIN = 24;

/**
 * Keeps the caret in sight: typing past the right edge of a block, or moving
 * along a long line, brings the block along.
 */
const followCaret = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate) {
      if (!update.selectionSet && !update.docChanged) return;

      const { view } = update;
      const head = view.state.selection.main.head;
      const block = codeBlockAt(view.state, head);
      if (!block) return;

      view.requestMeasure({
        read: () => {
          const caret = view.coordsAtPos(head);
          const at = view.domAtPos(head).node;
          const line = (at instanceof HTMLElement ? at : at.parentElement)?.closest<HTMLElement>(
            `.${SCROLLING_CODE_LINE}`
          );
          if (!caret || !line) return null;

          const box = line.getBoundingClientRect();
          const current = view.state.field(codeScroll).get(block.from) ?? 0;
          let offset = current;
          if (caret.right > box.right - CARET_MARGIN) offset += caret.right - (box.right - CARET_MARGIN);
          else if (caret.left < box.left + CARET_MARGIN) offset -= box.left + CARET_MARGIN - caret.left;

          offset = Math.max(0, Math.min(maxScroll(blockLines(line), current), offset));
          return Math.abs(offset - current) < 1 ? null : offset;
        },
        write: (offset) => {
          if (offset === null) return;
          // The editor will not take a transaction in the middle of a measure.
          queueMicrotask(() => view.dispatch({ effects: setCodeScroll.of({ block: block.from, offset }) }));
        },
      });
    }
  }
);

const codeScrollTheme = EditorView.theme({
  /* One long line rather than several broken ones, cut off at the block's
     edge. `clip` rather than `hidden`: the line must not become a thing that
     scrolls by itself, out of step with the rest of its block. */
  [`.${SCROLLING_CODE_LINE}`]: {
    whiteSpace: "pre",
    overflowX: "clip",
    overflowWrap: "normal",
    wordBreak: "normal",
  },
});

/** Code blocks that scroll sideways as one, by swipe, shift+wheel or the caret. */
export const codeBlockScrolling: Extension = [codeScroll, wheelScrolls, followCaret, codeScrollTheme];
