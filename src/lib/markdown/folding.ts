import {
  codeFolding,
  foldEffect,
  foldable,
  foldedRanges,
  syntaxTree,
  unfoldEffect,
} from "@codemirror/language";
import { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";

/**
 * Folding a note by its headings.
 *
 * A long note is easier to move around in with the sections you are not
 * working on put away. Each heading gets a small chevron in the margin beside
 * it, shown when the heading is pointed at, which folds everything up to the
 * next heading of the same level or higher; a folded section leaves its
 * heading and a small mark to open it again by. The keys CodeMirror already
 * had for this go on working, and so does unfolding by moving the caret, a
 * search or a link into what is folded.
 */

/** The section under the heading on the line at `lineStart`, if it has one to fold. */
export function sectionOf(state: EditorState, lineStart: number) {
  const line = state.doc.lineAt(lineStart);
  return foldable(state, line.from, line.to);
}

/** The folded range that starts at the end of the heading's line, if it is folded. */
export function foldedAt(state: EditorState, lineStart: number) {
  const end = state.doc.lineAt(lineStart).to;
  let found: { from: number; to: number } | null = null;
  foldedRanges(state).between(end, end, (from, to) => {
    if (from === end) found = { from, to };
  });
  return found as { from: number; to: number } | null;
}

/** Folds the section under a heading, or opens it again. False where there is nothing to fold. */
export function toggleSection(view: EditorView, lineStart: number) {
  const folded = foldedAt(view.state, lineStart);
  if (folded) {
    view.dispatch({ effects: unfoldEffect.of(folded) });
    return true;
  }
  const section = sectionOf(view.state, lineStart);
  if (!section) return false;
  view.dispatch({ effects: foldEffect.of(section) });
  return true;
}

class FoldChevron extends WidgetType {
  constructor(readonly folded: boolean) {
    super();
  }

  eq(other: FoldChevron) {
    return other.folded === this.folded;
  }

  toDOM(view: EditorView) {
    const button = document.createElement("span");
    button.className = this.folded ? "cm-md-fold cm-md-fold-closed" : "cm-md-fold";
    button.setAttribute("role", "button");
    button.setAttribute("aria-label", this.folded ? "Unfold section" : "Fold section");
    button.title = this.folded ? "Unfold section" : "Fold section";
    button.textContent = "›";

    // Pressed rather than clicked, and kept from moving the caret: folding a
    // section is not a request to edit its heading.
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleSection(view, view.state.doc.lineAt(view.posAtDOM(button)).from);
    });
    return button;
  }

  ignoreEvent() {
    return true;
  }
}

const OPEN = Decoration.widget({ widget: new FoldChevron(false), side: -1 });
const CLOSED = Decoration.widget({ widget: new FoldChevron(true), side: -1 });

/** A chevron for every heading on screen that has a section under it. */
function chevrons(view: EditorView): DecorationSet {
  const { state } = view;
  const out: Range<Decoration>[] = [];

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        if (!/^(ATX|Setext)Heading\d$/.test(node.name)) return;
        const line = state.doc.lineAt(node.from);
        if (foldedAt(state, line.from)) out.push(CLOSED.range(line.from));
        else if (sectionOf(state, line.from)) out.push(OPEN.range(line.from));
        return false;
      },
    });
  }

  return Decoration.set(out, true);
}

const foldChevrons = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = chevrons(view);
    }

    update(update: ViewUpdate) {
      const folded = update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(foldEffect) || effect.is(unfoldEffect))
      );
      if (
        update.docChanged ||
        update.viewportChanged ||
        folded ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = chevrons(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations }
);

const foldTheme = EditorView.theme({
  /* Out in the margin beside the heading, where it takes no room from the
     text and does not move it. Set at about half the heading's size, with a
     line height that makes its box as tall as the heading's own line - which
     is what puts it level with the middle of the heading at every level. */
  ".cm-md-heading": { position: "relative" },
  ".cm-md-fold": {
    position: "absolute",
    left: "-1.35em",
    width: "1.2em",
    textAlign: "center",
    fontSize: "0.55em",
    fontWeight: "400",
    lineHeight: "2.364",
    color: "var(--nuza-muted)",
    cursor: "pointer",
    opacity: "0",
    transform: "rotate(90deg)",
    transition: "opacity 120ms ease, transform 140ms ease, color 120ms ease",
    userSelect: "none",
  },
  ".cm-md-heading:hover .cm-md-fold": { opacity: "0.7" },
  ".cm-md-fold:hover": { color: "var(--nuza-accent)", opacity: "1 !important" },
  /* A folded section's chevron stays, pointing at what is put away: it is
     the only sign on the heading that there is more under it. */
  ".cm-md-fold.cm-md-fold-closed": { opacity: "0.7", transform: "none" },
  ".cm-md-fold-more": {
    marginLeft: "0.5em",
    padding: "0 0.45em",
    borderRadius: "0.4em",
    fontSize: "0.6em",
    fontWeight: "400",
    verticalAlign: "middle",
    color: "var(--nuza-muted)",
    backgroundColor: "var(--nuza-surface)",
    cursor: "pointer",
  },
  ".cm-md-fold-more:hover": { color: "var(--nuza-accent)" },
  "@media (prefers-reduced-motion: reduce)": {
    ".cm-md-fold": { transition: "none" },
  },
});

/** Folding by heading: the mark a folded section leaves, the chevrons, and their look. */
export const sectionFolding: Extension = [
  codeFolding({
    placeholderDOM(_view, onclick) {
      const more = document.createElement("span");
      more.className = "cm-md-fold-more";
      more.textContent = "⋯";
      more.title = "Unfold section";
      more.setAttribute("aria-label", "Unfold section");
      more.onclick = onclick;
      return more;
    },
  }),
  foldChevrons,
  foldTheme,
];
