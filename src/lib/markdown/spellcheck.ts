import { syntaxTree } from "@codemirror/language";
import { Extension, Facet, RangeSetBuilder, StateEffect } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { SpellLanguage, loadSpeller } from "../spellDictionaries";
import type { Speller } from "../spelling";
import { addUserWord, onUserWordsChanged, readUserWords } from "../userDictionary";
import { Misspelling, scanProse } from "./spellScan";

/**
 * Spell check: a wavy red line under the words of a note's prose that the
 * dictionary doesn't know. The fixes for a word are offered in the editor's
 * right-click menu - see `spellingAt`.
 *
 * Only prose is checked. Code, links, wiki-links, tags, maths, HTML and the
 * frontmatter are none of a dictionary's business, and a checker that
 * underlines them is one that gets turned off.
 */

/**
 * How long after the last keystroke the word being typed is left alone. Judged
 * halfway through, every word is a typo - `th`, `the`, `ther` - and a line that
 * flickers red under the caret is worse than no line at all.
 */
const TYPING_PAUSE = 700;

/** Never look at more text than this in one pass, whatever the viewport holds. */
const PASS_LIMIT = 60_000;

/** Suggestions offered in the menu. */
const SUGGESTION_COUNT = 5;

/** Asks every spell checker to look again - a dictionary arrived, or a word was accepted. */
const recheck = StateEffect.define<null>();

/** The dictionary in use. */
const language = Facet.define<SpellLanguage, SpellLanguage>({
  combine: (values) => values[0] ?? "en-US",
});

const misspelledMark = Decoration.mark({ class: "cm-misspelled" });

/** Every editor showing underlines - a split has two - so a word accepted in one clears from both. */
const checkers = new Set<SpellChecker>();

function refreshAll() {
  for (const checker of checkers) checker.refresh();
}

class SpellChecker {
  decorations: DecorationSet = Decoration.none;
  /** What `decorations` underlines, in order, for the right-click menu to find. */
  found: Misspelling[] = [];
  speller: Speller | null = null;
  private lastTyped = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;
  private stopWatching: () => void;

  constructor(readonly view: EditorView) {
    checkers.add(this);
    this.load(view.state.facet(language));

    // A word accepted in another window.
    this.stopWatching = onUserWordsChanged(() => {
      for (const word of readUserWords()) this.speller?.ignore(word);
      this.refresh();
    });
  }

  private load(wanted: SpellLanguage) {
    loadSpeller(wanted).then(
      (speller) => {
        // Not the dictionary asked for any more: the setting changed meanwhile.
        if (this.destroyed || this.view.state.facet(language) !== wanted) return;
        this.speller = speller;
        this.refresh();
      },
      (error) => console.error("Couldn't load the spelling dictionary:", error)
    );
  }

  update(update: ViewUpdate) {
    const wanted = update.state.facet(language);
    if (wanted !== update.startState.facet(language)) {
      this.speller = null;
      this.decorations = Decoration.none;
      this.found = [];
      this.load(wanted);
      return;
    }
    if (!this.speller) return;

    const typed = update.transactions.some((tr) => tr.isUserEvent("input") || tr.isUserEvent("delete"));
    if (typed) this.lastTyped = Date.now();

    const refreshed = update.transactions.some((tr) => tr.effects.some((effect) => effect.is(recheck)));
    const reparsed = syntaxTree(update.startState) !== syntaxTree(update.state);
    // Moving the caret off a word that was being typed is what lets it be judged.
    const settling = update.selectionSet && Date.now() - this.lastTyped < TYPING_PAUSE;

    if (update.docChanged || update.viewportChanged || refreshed || reparsed || settling) this.build();
  }

  /** Looks again from outside an update: a dictionary arrived, or a timer ran out. */
  refresh() {
    // Never dispatched from inside an update, which the editor refuses.
    queueMicrotask(() => {
      if (!this.destroyed) this.view.dispatch({ effects: recheck.of(null) });
    });
  }

  private build() {
    const { view, speller } = this;
    if (!speller) return;

    const { state } = view;
    const caret = state.selection.main;
    const holding = Date.now() - this.lastTyped < TYPING_PAUSE;

    const from = view.viewport.from;
    const to = Math.min(view.viewport.to, from + PASS_LIMIT);
    const { found, held } = scanProse(state, speller, from, to, holding && caret.empty ? caret.head : null);

    const builder = new RangeSetBuilder<Decoration>();
    for (const range of found) builder.add(range.from, range.to, misspelledMark);
    this.decorations = builder.finish();
    this.found = found;

    clearTimeout(this.timer);
    if (held) {
      this.timer = setTimeout(
        () => this.refresh(),
        Math.max(0, this.lastTyped + TYPING_PAUSE - Date.now()) + 20
      );
    }
  }

  at(pos: number) {
    return this.found.find((range) => range.from <= pos && pos <= range.to);
  }

  destroy() {
    this.destroyed = true;
    checkers.delete(this);
    clearTimeout(this.timer);
    this.stopWatching();
  }
}

const spellPlugin = ViewPlugin.fromClass(SpellChecker, {
  decorations: (checker) => checker.decorations,
});

/** A misspelled word under the pointer, and what can be done about it. */
export interface SpellingFix {
  /** Likely corrections, best first. */
  suggestions: string[];
  /** Selects the word, as a right click does in a native text field. */
  select(): void;
  replaceWith(suggestion: string): void;
  /** Accepts the word for good, in every note. */
  addToDictionary(): void;
  /** Accepts the word until the app is closed. */
  ignore(): void;
}

/**
 * The misspelled word at a point on screen, or null where there is none - or
 * where spell check is off. For the right-click menu to offer fixes.
 */
export function spellingAt(view: EditorView, x: number, y: number): SpellingFix | null {
  const checker = view.plugin(spellPlugin);
  const speller = checker?.speller;
  if (!checker || !speller) return null;

  const pos = view.posAtCoords({ x, y });
  const range = pos === null ? undefined : checker.at(pos);
  if (!range) return null;

  const word = view.state.sliceDoc(range.from, range.to);

  return {
    suggestions: speller.suggest(word).slice(0, SUGGESTION_COUNT),
    select() {
      view.dispatch({ selection: { anchor: range.from, head: range.to } });
    },
    replaceWith(suggestion) {
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: suggestion },
        selection: { anchor: range.from + suggestion.length },
        userEvent: "input.complete",
      });
      view.focus();
    },
    addToDictionary() {
      addUserWord(word);
      speller.ignore(word);
      refreshAll();
      view.focus();
    },
    ignore() {
      speller.ignore(word);
      refreshAll();
      view.focus();
    },
  };
}

/** Spell check, in `dictionary`'s spelling. */
export function spellcheck(dictionary: SpellLanguage): Extension {
  return [
    spellPlugin,
    language.of(dictionary),
    EditorView.baseTheme({
      ".cm-misspelled": {
        textDecoration: "underline wavy",
        textDecorationColor: "rgb(239 68 68 / 0.85)",
        textDecorationThickness: "1px",
        textUnderlineOffset: "3px",
        textDecorationSkipInk: "none",
      },
    }),
  ];
}
