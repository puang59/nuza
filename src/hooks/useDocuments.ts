import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Compartment, EditorState, Extension, StateEffect, Text } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { basicSetup } from "@uiw/codemirror-extensions-basic-setup";
import { directoryOf, liveMarkdown, noteDirectory, vaultDirectory } from "@/lib/markdown";
import { documentsToEvict } from "@/lib/documentCache";
import {
  countDocument,
  countSelection,
  DocumentStats,
  EMPTY_DOCUMENT_STATS,
  recount,
  WordTally,
} from "@/lib/documentStats";

/**
 * Nothing in the margins and nothing highlighted: the rendered markdown is the
 * only thing on screen worth looking at.
 */
const writingSurface: Extension = [
  basicSetup({
    lineNumbers: false,
    foldGutter: false,
    highlightActiveLine: false,
    highlightActiveLineGutter: false,
  }),
  keymap.of([indentWithTab]),
  liveMarkdown,
];

/**
 * How long a note that has just been opened waits for its first word count.
 * That count walks the whole note, so it is left for a moment rather than
 * joining in with the swap; every edit after it is counted on the keystroke,
 * a few lines at a time.
 */
const COUNT_DELAY = 250;

/**
 * The longest selection counted as it changes. Dragging one out reports on
 * every move of the mouse, and counting the words of a selection means going
 * through all of it - so past this it waits, like the first count of a note,
 * for the selection to stop moving.
 */
const SELECTION_COUNT_LIMIT = 20_000;

/** Settings that change while the app is running: the font, and Vim mode. */
const preferences = new Compartment();
/** The open note's own directory, which its relative image paths resolve against. */
const location = new Compartment();

interface UseDocumentsOptions {
  /** Extensions that follow the app's settings. */
  preferences: Extension;
  /** The document the editor opens on. */
  initialPath: string;
  /** What that document starts with, for a scratch note carried over. */
  initialContent?: string;
  /** The open folder, where dropped and pasted files are filed. */
  vault: string;
  /** The notes with a tab. Their documents are always kept. */
  openPaths: readonly string[];
}

/**
 * Where a note resolves its relative links from, and where anything dropped on
 * it is filed. A scratch note has no directory of its own, so it borrows the
 * open folder's rather than leaving its images unresolvable.
 */
function placeOf(path: string, vault: string): Extension {
  return [noteDirectory.of(directoryOf(path) || vault), vaultDirectory.of(vault)];
}

/**
 * The open documents - one CodeMirror state each, rather than one string each.
 *
 * This is what keeps a long document cheap to work with. The text is never
 * assembled into a string on the way through: typing goes straight into the
 * editor, switching tabs hands it a state object it already holds, and the
 * document is only flattened when something outside the editor genuinely needs
 * it, which is to say on save. Each file keeps its own undo history and cursor
 * as a side effect of owning its state.
 */
export function useDocuments({
  preferences: settings,
  initialPath,
  initialContent = "",
  vault,
  openPaths,
}: UseDocumentsOptions) {
  const container = useRef<HTMLDivElement>(null);
  /** Every document held, least recently shown first. */
  const states = useRef(new Map<string, EditorState>());
  /**
   * Where each document was scrolled to when it was last put away. The state
   * remembers the caret; this is the other half of "where I was", which lives
   * in the view and would otherwise be lost every time a tab is switched -
   * leaving the note switched to at whatever height the last one was left at.
   */
  const scrolls = useRef(new Map<string, StateEffect<unknown>>());
  /** The editor, as a ref for callbacks and as state for effects that follow it. */
  const editor = useRef<EditorView | null>(null);
  const [view, setView] = useState<EditorView | null>(null);
  /**
   * Counts the times the view has been handed a new document. Extensions that
   * keep an object of their own per view - Vim's adapter, for one - are rebuilt
   * at that point, so anything holding on to one has to go and fetch it again.
   */
  const [viewGeneration, setViewGeneration] = useState(0);
  const currentPath = useRef(initialPath);
  /**
   * The split: a second editor beside the first, showing one note of its own.
   * A note is in one pane at a time, so every document still has exactly one
   * live state - in whichever view is showing it, or parked in `states`.
   */
  const sideContainer = useRef<HTMLDivElement>(null);
  const sideEditor = useRef<EditorView | null>(null);
  const [sideView, setSideView] = useState<EditorView | null>(null);
  const sidePathRef = useRef<string | null>(null);
  const [sidePath, setSidePath] = useState<string | null>(null);
  /**
   * Only ever the text the editor was first mounted with. The first document
   * has to be created with its content rather than opened with it: `open`
   * parks the live state under its own path on the way past, which for the
   * document already on screen means `stateFor` finds that one and the content
   * argument is never looked at.
   */
  const firstContent = useRef(initialContent);
  const latestSettings = useRef(settings);
  const latestVault = useRef(vault);
  /** Set while a document is being swapped in, so the swap is not read as an edit. */
  const swapping = useRef(false);
  const [dirtyPaths, setDirtyPaths] = useState<ReadonlySet<string>>(() => new Set());
  const latestDirty = useRef(dirtyPaths);
  const latestOpen = useRef(openPaths);

  /**
   * Lets go of the documents nobody needs, past a limit: closed, saved, and
   * not looked at in a while. Reopening one of those is a read from disk,
   * which is where its text is anyway - what goes is its undo history.
   *
   * A tab, a note with unsaved edits and the note on screen are never let go
   * of, so a closed tab with edits in it still comes back with them. So is the
   * scratch note, which has no file to come back from.
   */
  const evict = useCallback(() => {
    const open = new Set(latestOpen.current);
    const keep = (path: string) =>
      path === currentPath.current ||
      path === sidePathRef.current ||
      path === initialPath ||
      open.has(path) ||
      latestDirty.current.has(path);

    for (const path of documentsToEvict(states.current.keys(), keep)) {
      states.current.delete(path);
      scrolls.current.delete(path);
    }
  }, [initialPath]);

  // Tracked in a layout effect so the next eviction sees a keystroke's dirty
  // flag before anything else can run, and rerun when either list shrinks - a
  // tab closing or a note being saved can both leave a document unneeded.
  useLayoutEffect(() => {
    latestDirty.current = dirtyPaths;
    latestOpen.current = openPaths;
    evict();
  }, [dirtyPaths, openPaths, evict]);

  // Statistics are pushed to whoever is showing them rather than held as state
  // here: the footer changes on every keystroke, and nothing else should have
  // to re-render because of it.
  const listeners = useRef(new Set<(stats: DocumentStats) => void>());
  const latestStats = useRef<DocumentStats>(EMPTY_DOCUMENT_STATS);
  const countTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The word count, and the version of the document it is the count of. */
  const tally = useRef<(WordTally & { doc: Text }) | null>(null);

  const publish = useCallback((stats: DocumentStats) => {
    latestStats.current = stats;
    for (const listener of listeners.current) listener(stats);
  }, []);

  /**
   * The count fields for whatever is on screen: a selection's own words and
   * characters stand in for the document's, and the document's paragraphs
   * carry on either way. Shared by the debounced count and the per-edit
   * report so neither can publish the other's shape.
   *
   * A long selection's words are only counted when `settled` - until then the
   * number already showing is left where it is.
   */
  const statsPartial = useCallback((state: EditorState, settled = false) => {
    const counted = tally.current?.doc === state.doc ? tally.current : null;
    const { from, to, empty } = state.selection.main;
    if (empty) {
      return {
        ...(counted && { words: counted.words, paragraphs: counted.paragraphs }),
        characters: state.doc.length,
      };
    }

    const selected =
      settled || to - from <= SELECTION_COUNT_LIMIT ? countSelection(state.doc.sliceString(from, to)) : null;
    return {
      ...(counted && { paragraphs: counted.paragraphs }),
      ...(selected && { words: selected.words }),
      characters: to - from,
    };
  }, []);

  const scheduleCount = useCallback(() => {
    if (countTimer.current) clearTimeout(countTimer.current);
    countTimer.current = setTimeout(() => {
      countTimer.current = null;
      const state = editor.current?.state;
      if (!state) return;
      // Asked for by a long selection as well as by a note with no count yet,
      // and only the second of those needs the note counted again.
      if (tally.current?.doc !== state.doc) {
        const { words, paragraphs } = countDocument(state.doc);
        tally.current = { doc: state.doc, words, paragraphs };
      }
      publish({ ...latestStats.current, ...statsPartial(state, true) });
    }, COUNT_DELAY);
  }, [publish, statsPartial]);

  const reportStats = useCallback(
    (state: EditorState) => {
      const head = state.selection.main.head;
      const line = state.doc.lineAt(head);
      const counted = tally.current?.doc === state.doc ? tally.current : null;
      publish({
        ...latestStats.current,
        ...statsPartial(state),
        line: line.number,
        column: head - line.from + 1,
      });
      // A document with no count yet - one just swapped in - is counted in
      // full once things settle, and so is a selection too long to count on
      // every move of it.
      const { from, to } = state.selection.main;
      if (!counted || to - from > SELECTION_COUNT_LIMIT) scheduleCount();
    },
    [publish, scheduleCount, statsPartial]
  );

  /** Adds a listener for the open document's statistics, called straight away. */
  const subscribeToStats = useCallback((listener: (stats: DocumentStats) => void) => {
    listeners.current.add(listener);
    listener(latestStats.current);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  /**
   * Flags the open document as having drifted from disk. This runs on every
   * keystroke, so once the flag is up it does nothing at all - returning the
   * same set tells React there is nothing to re-render. Comparing the buffer
   * against what was written would mean walking the whole document instead.
   */
  const trackEdits = useRef<Extension>(null);
  if (!trackEdits.current) {
    trackEdits.current = EditorView.updateListener.of((update) => {
      // The footer counts the main pane's note; the split's edits are the
      // note's own business, and only have to be known about as unsaved.
      const inSide = update.view === sideEditor.current;

      // Carry the word count across the edit rather than counting again: only
      // the lines it touched are looked at.
      const counted = tally.current;
      if (!inSide && update.docChanged && counted?.doc === update.startState.doc) {
        const next = recount(counted.doc, update.state.doc, update.changes, counted);
        tally.current = { doc: update.state.doc, ...next };
      }
      if (update.docChanged && !swapping.current) {
        const path = inSide ? sidePathRef.current : currentPath.current;
        if (path) setDirtyPaths((paths) => (paths.has(path) ? paths : new Set(paths).add(path)));
      }
      if (!inSide && (update.docChanged || update.selectionSet)) reportStats(update.state);
    });
  }

  const stateFor = useCallback((path: string, content: string, anchor?: number) => {
    const existing = states.current.get(path);
    if (existing) return existing;

    const created = EditorState.create({
      doc: content,
      // Clamped: a caret kept from another day may be past the end of a note
      // that has been cut short since.
      selection: anchor === undefined ? undefined : { anchor: Math.min(anchor, content.length) },
      extensions: [
        writingSurface,
        trackEdits.current!,
        location.of(placeOf(path, latestVault.current)),
        preferences.of(latestSettings.current),
      ],
    });
    states.current.set(path, created);
    return created;
  }, []);

  /**
   * Puts `view` where the note at `path` was left: at the height it was
   * scrolled to when it was put away, or - for one opened afresh, or changed
   * underneath since - with its caret in the middle of the pane. A note with
   * no history starts at the top.
   */
  const settleScroll = useCallback((view: EditorView, path: string) => {
    const snapshot = scrolls.current.get(path);
    if (snapshot) {
      view.dispatch({ effects: snapshot });
      return;
    }
    const head = view.state.selection.main.head;
    if (head > 0) view.dispatch({ effects: EditorView.scrollIntoView(head, { y: "center" }) });
    else view.scrollDOM.scrollTop = 0;
  }, []);

  useLayoutEffect(() => {
    if (!container.current) return;

    const view = new EditorView({
      state: stateFor(currentPath.current, firstContent.current),
      parent: container.current,
    });
    editor.current = view;
    setView(view);
    view.focus();
    reportStats(view.state);

    return () => {
      if (countTimer.current) clearTimeout(countTimer.current);
      // The state stays in the map, so a remount picks every document back up
      // exactly where it was left.
      states.current.set(currentPath.current, view.state);
      view.destroy();
      editor.current = null;
      setView(null);
    };
  }, [stateFor, reportStats]);

  // A document created before the settings changed still carries the old ones
  // in its compartment, so opening one reapplies them rather than trusting this.
  useEffect(() => {
    latestSettings.current = settings;
    editor.current?.dispatch({ effects: preferences.reconfigure(settings) });
    sideEditor.current?.dispatch({ effects: preferences.reconfigure(settings) });
  }, [settings]);

  // Opening a folder changes where the open note files its attachments, and
  // gives a scratch note somewhere to resolve its links from.
  useEffect(() => {
    latestVault.current = vault;
    editor.current?.dispatch({ effects: location.reconfigure(placeOf(currentPath.current, vault)) });
    if (sidePathRef.current) {
      sideEditor.current?.dispatch({ effects: location.reconfigure(placeOf(sidePathRef.current, vault)) });
    }
  }, [vault]);

  /** Puts the split's live state away in `states`, as the main pane's is on a swap. */
  const parkSide = useCallback(() => {
    const view = sideEditor.current;
    const path = sidePathRef.current;
    if (view && path) {
      states.current.delete(path);
      states.current.set(path, view.state);
      scrolls.current.set(path, view.scrollSnapshot());
    }
  }, []);

  // The split's editor lives for as long as the split is open - not per note,
  // so that a rename, which only changes the path, does not rebuild it from a
  // parked copy of the text that has since moved on.
  const hasSide = sidePath !== null;
  useLayoutEffect(() => {
    const parent = sideContainer.current;
    const path = sidePathRef.current;
    const state = path ? states.current.get(path) : undefined;
    if (!hasSide || !parent || !state) return;

    const view = new EditorView({ state, parent });
    sideEditor.current = view;
    setSideView(view);
    if (path) settleScroll(view, path);
    view.focus();

    return () => {
      view.destroy();
      sideEditor.current = null;
      setSideView(null);
    };
  }, [hasSide, settleScroll]);

  /**
   * Shows `path` in the split, beside the note in the main pane, creating its
   * document from `content` if it has none yet. Whatever the split showed is
   * put away as the main pane's note is on a swap. Returns false for the note
   * the main pane is showing: it cannot be in both.
   */
  const openSide = useCallback(
    (path: string, content: string | null, anchor?: number) => {
      if (path === currentPath.current) return false;
      if (content === null && !states.current.has(path)) {
        throw new Error(`openSide(${path}) with no content and no document in memory`);
      }

      parkSide();
      const next = stateFor(path, content ?? "", anchor);
      states.current.delete(path);
      states.current.set(path, next);
      sidePathRef.current = path;

      const view = sideEditor.current;
      if (view) {
        swapping.current = true;
        view.setState(next);
        view.dispatch({
          effects: [
            preferences.reconfigure(latestSettings.current),
            location.reconfigure(placeOf(path, latestVault.current)),
          ],
        });
        swapping.current = false;
        settleScroll(view, path);
        view.focus();
      }
      setSidePath(path);
      evict();
      return true;
    },
    [stateFor, parkSide, evict, settleScroll]
  );

  /** Closes the split. Its note is kept, with its edits, as a closed tab's is. */
  const closeSide = useCallback(() => {
    parkSide();
    sidePathRef.current = null;
    setSidePath(null);
  }, [parkSide]);

  /**
   * Shows `path`, creating its document from `content` if it has none yet.
   * `null` content means "the document is already in memory" - it is not an
   * invitation to invent an empty one.
   */
  const open = useCallback(
    (path: string, content: string | null, anchor?: number) => {
      const view = editor.current;
      if (!view) return;

      // A note with nothing behind it renders as empty, and an empty note that
      // is then typed into is autosaved over the file on disk a second later.
      // Refusing here leaves the editor on the document it already had, which
      // is wrong on screen but recoverable; the blank is neither.
      if (content === null && !states.current.has(path)) {
        throw new Error(`open(${path}) with no content and no document in memory`);
      }

      // A note in the split that is asked for here moves across: it is parked
      // as it stands, and the split closes behind it.
      if (path === sidePathRef.current) closeSide();

      swapping.current = true;
      // The live state lives in the view, not the map, so park it before it is
      // replaced - this is a reference, not a copy of the text. Re-inserted
      // rather than updated, so the map's order stays the order of use.
      states.current.delete(currentPath.current);
      states.current.set(currentPath.current, view.state);
      scrolls.current.set(currentPath.current, view.scrollSnapshot());
      currentPath.current = path;

      const next = stateFor(path, content ?? "", anchor);
      states.current.delete(path);
      states.current.set(path, next);
      view.setState(next);
      view.dispatch({
        effects: [
          preferences.reconfigure(latestSettings.current),
          location.reconfigure(placeOf(path, latestVault.current)),
        ],
      });
      swapping.current = false;
      settleScroll(view, path);
      setViewGeneration((generation) => generation + 1);
      reportStats(view.state);
      evict();
      // Opening a note is a request to write in it, so the caret goes there
      // rather than leaving the sidebar holding focus.
      view.focus();
    },
    [stateFor, reportStats, evict, closeSide, settleScroll]
  );

  /**
   * Puts `content` in place of whatever is held for `path`, keeping the caret
   * where it still fits.
   *
   * For a note that has moved on disk with nothing unsaved to lose: what is
   * held is no longer what the tab claims to be showing, and of the two copies
   * the one on disk is the newer. A note with edits in it is never replaced
   * this way - that one has to be asked about.
   */
  const replace = useCallback(
    (path: string, content: string) => {
      const showing = path === currentPath.current;
      const inSide = !showing && path === sidePathRef.current;
      const previous = showing
        ? editor.current?.state
        : inSide
          ? sideEditor.current?.state
          : states.current.get(path);
      const anchor = Math.min(previous?.selection.main.anchor ?? 0, content.length);

      states.current.delete(path);
      // Taken of a text that is no longer the note's.
      scrolls.current.delete(path);
      const next = stateFor(path, content, anchor);

      const view = inSide ? sideEditor.current : editor.current;
      if ((!showing && !inSide) || !view) return;

      // The swap is not an edit, and must not mark the note dirty - it is the
      // opposite: the note has just caught up with the file.
      swapping.current = true;
      view.setState(next);
      view.dispatch({
        effects: [
          preferences.reconfigure(latestSettings.current),
          location.reconfigure(placeOf(path, latestVault.current)),
        ],
      });
      swapping.current = false;
      // The split has no Vim adapter to rebuild and no footer to update.
      if (inSide) return;
      setViewGeneration((generation) => generation + 1);
      reportStats(view.state);
    },
    [stateFor, reportStats]
  );

  /** The path of the document the editor is showing right now. */
  const showing = useCallback(() => currentPath.current, []);

  /** The path of the note the split is showing, or null with no split. */
  const showingSide = useCallback(() => sidePathRef.current, []);

  /** Whether `path` has already been read off disk. */
  const isOpen = useCallback((path: string) => states.current.has(path), []);

  /** The state of `path` as it stands: in the view showing it, or put away. */
  const liveState = useCallback(
    (path: string) =>
      path === currentPath.current
        ? editor.current?.state
        : path === sidePathRef.current
          ? sideEditor.current?.state
          : states.current.get(path),
    []
  );

  /**
   * The document as text. This is the one operation that costs something in
   * proportion to the document's length, which is why it is only ever called
   * when the content has to leave the editor.
   */
  const read = useCallback((path: string) => liveState(path)?.doc.toString() ?? "", [liveState]);

  /**
   * A handle on the document as it stands, for a save to hold on to. The text
   * is immutable, so a new object here means an edit landed - which is how a
   * save that has just written to disk tells whether what it wrote is still
   * what the editor holds, rather than clearing the dirty flag over a
   * keystroke that arrived while the write was in flight.
   */
  const revision = useCallback((path: string) => liveState(path)?.doc ?? null, [liveState]);

  /** Where the caret is in `path`, for coming back to another day; undefined if it is not held. */
  const caretOf = useCallback((path: string) => liveState(path)?.selection.main.head, [liveState]);

  const markSaved = useCallback((path: string) => {
    setDirtyPaths((paths) => {
      if (!paths.has(path)) return paths;
      const next = new Set(paths);
      next.delete(path);
      return next;
    });
  }, []);

  /** Throws away every document matching `matches`, e.g. after a delete. */
  const forget = useCallback((matches: (path: string) => boolean) => {
    // A note that is gone cannot stay in the split. Nothing is parked: what is
    // being forgotten is the point.
    if (sidePathRef.current && matches(sidePathRef.current)) {
      sidePathRef.current = null;
      setSidePath(null);
    }
    for (const path of Array.from(states.current.keys())) {
      if (matches(path)) states.current.delete(path);
    }
    for (const path of Array.from(scrolls.current.keys())) {
      if (matches(path)) scrolls.current.delete(path);
    }
    setDirtyPaths((paths) => {
      const next = new Set(Array.from(paths).filter((path) => !matches(path)));
      return next.size === paths.size ? paths : next;
    });
  }, []);

  /** Re-keys documents after a path changed on disk, keeping their contents. */
  const rewrite = useCallback((rename: (path: string) => string) => {
    for (const [path, state] of Array.from(states.current.entries())) {
      const renamed = rename(path);
      if (renamed === path) continue;
      states.current.delete(path);
      states.current.set(renamed, state);
    }

    for (const [path, snapshot] of Array.from(scrolls.current.entries())) {
      const renamed = rename(path);
      if (renamed === path) continue;
      scrolls.current.delete(path);
      scrolls.current.set(renamed, snapshot);
    }

    const side = sidePathRef.current;
    if (side && rename(side) !== side) {
      const renamed = rename(side);
      sidePathRef.current = renamed;
      setSidePath(renamed);
      sideEditor.current?.dispatch({
        effects: location.reconfigure(placeOf(renamed, latestVault.current)),
      });
    }

    const current = rename(currentPath.current);
    if (current !== currentPath.current) {
      currentPath.current = current;
      editor.current?.dispatch({
        effects: location.reconfigure(placeOf(current, latestVault.current)),
      });
    }

    setDirtyPaths((paths) => new Set(Array.from(paths, rename)));
  }, []);

  return {
    container,
    view,
    sideContainer,
    sideView,
    sidePath,
    openSide,
    closeSide,
    showingSide,
    viewGeneration,
    dirtyPaths,
    subscribeToStats,
    open,
    replace,
    showing,
    isOpen,
    read,
    revision,
    caretOf,
    markSaved,
    forget,
    rewrite,
  };
}
