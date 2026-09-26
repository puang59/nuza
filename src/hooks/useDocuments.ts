import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Compartment, EditorState, Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { basicSetup } from "@uiw/codemirror-extensions-basic-setup";
import { directoryOf, liveMarkdown, noteDirectory, vaultDirectory } from "@/lib/markdown";
import { countDocument, DocumentStats, EMPTY_DOCUMENT_STATS } from "@/lib/documentStats";

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
 * How long typing has to stop before the words are counted again. Counting
 * walks the whole document, so it waits for a pause rather than joining in on
 * every keystroke; the character count and the caret position come for free
 * and are published immediately.
 */
const COUNT_DELAY = 250;

/** Settings that change while the app is running: the font, and Vim mode. */
const preferences = new Compartment();
/** The open note's own directory, which its relative image paths resolve against. */
const location = new Compartment();

interface UseDocumentsOptions {
  /** Extensions that follow the app's settings. */
  preferences: Extension;
  /** The document the editor opens on. */
  initialPath: string;
  /** The open folder, where dropped and pasted files are filed. */
  vault: string;
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
export function useDocuments({ preferences: settings, initialPath, vault }: UseDocumentsOptions) {
  const container = useRef<HTMLDivElement>(null);
  const states = useRef(new Map<string, EditorState>());
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
  const latestSettings = useRef(settings);
  const latestVault = useRef(vault);
  /** Set while a document is being swapped in, so the swap is not read as an edit. */
  const swapping = useRef(false);
  const [dirtyPaths, setDirtyPaths] = useState<ReadonlySet<string>>(() => new Set());

  // Statistics are pushed to whoever is showing them rather than held as state
  // here: the footer changes on every keystroke, and nothing else should have
  // to re-render because of it.
  const listeners = useRef(new Set<(stats: DocumentStats) => void>());
  const latestStats = useRef<DocumentStats>(EMPTY_DOCUMENT_STATS);
  const countTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const publish = useCallback((stats: DocumentStats) => {
    latestStats.current = stats;
    for (const listener of listeners.current) listener(stats);
  }, []);

  const scheduleCount = useCallback(() => {
    if (countTimer.current) clearTimeout(countTimer.current);
    countTimer.current = setTimeout(() => {
      countTimer.current = null;
      const doc = editor.current?.state.doc;
      if (doc) publish({ ...latestStats.current, ...countDocument(doc) });
    }, COUNT_DELAY);
  }, [publish]);

  const reportStats = useCallback(
    (state: EditorState) => {
      const head = state.selection.main.head;
      const line = state.doc.lineAt(head);
      publish({
        ...latestStats.current,
        characters: state.doc.length,
        line: line.number,
        column: head - line.from + 1,
      });
      scheduleCount();
    },
    [publish, scheduleCount]
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
      if (update.docChanged && !swapping.current) {
        const path = currentPath.current;
        setDirtyPaths((paths) => (paths.has(path) ? paths : new Set(paths).add(path)));
      }
      if (update.docChanged || update.selectionSet) reportStats(update.state);
    });
  }

  const stateFor = useCallback((path: string, content: string) => {
    const existing = states.current.get(path);
    if (existing) return existing;

    const created = EditorState.create({
      doc: content,
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

  useLayoutEffect(() => {
    if (!container.current) return;

    const view = new EditorView({
      state: stateFor(currentPath.current, ""),
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
  }, [settings]);

  // Opening a folder changes where the open note files its attachments, and
  // gives a scratch note somewhere to resolve its links from.
  useEffect(() => {
    latestVault.current = vault;
    editor.current?.dispatch({ effects: location.reconfigure(placeOf(currentPath.current, vault)) });
  }, [vault]);

  /**
   * Shows `path`, creating its document from `content` if it has none yet.
   * `null` content means "the document is already in memory" - it is not an
   * invitation to invent an empty one.
   */
  const open = useCallback(
    (path: string, content: string | null) => {
      const view = editor.current;
      if (!view) return;

      // A note with nothing behind it renders as empty, and an empty note that
      // is then typed into is autosaved over the file on disk a second later.
      // Refusing here leaves the editor on the document it already had, which
      // is wrong on screen but recoverable; the blank is neither.
      if (content === null && !states.current.has(path)) {
        throw new Error(`open(${path}) with no content and no document in memory`);
      }

      swapping.current = true;
      // The live state lives in the view, not the map, so park it before it is
      // replaced - this is a reference, not a copy of the text.
      states.current.set(currentPath.current, view.state);
      currentPath.current = path;

      view.setState(stateFor(path, content ?? ""));
      view.dispatch({
        effects: [
          preferences.reconfigure(latestSettings.current),
          location.reconfigure(placeOf(path, latestVault.current)),
        ],
      });
      swapping.current = false;
      setViewGeneration((generation) => generation + 1);
      reportStats(view.state);
      // Opening a note is a request to write in it, so the caret goes there
      // rather than leaving the sidebar holding focus.
      view.focus();
    },
    [stateFor, reportStats]
  );

  /** Whether `path` has already been read off disk. */
  const isOpen = useCallback((path: string) => states.current.has(path), []);

  /**
   * The document as text. This is the one operation that costs something in
   * proportion to the document's length, which is why it is only ever called
   * when the content has to leave the editor.
   */
  const read = useCallback((path: string) => {
    const state = path === currentPath.current ? editor.current?.state : states.current.get(path);
    return state?.doc.toString() ?? "";
  }, []);

  /**
   * A handle on the document as it stands, for a save to hold on to. The text
   * is immutable, so a new object here means an edit landed - which is how a
   * save that has just written to disk tells whether what it wrote is still
   * what the editor holds, rather than clearing the dirty flag over a
   * keystroke that arrived while the write was in flight.
   */
  const revision = useCallback((path: string) => {
    const state = path === currentPath.current ? editor.current?.state : states.current.get(path);
    return state?.doc ?? null;
  }, []);

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
    for (const path of Array.from(states.current.keys())) {
      if (matches(path)) states.current.delete(path);
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
    viewGeneration,
    dirtyPaths,
    subscribeToStats,
    open,
    isOpen,
    read,
    revision,
    markSaved,
    forget,
    rewrite,
  };
}
