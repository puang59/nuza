import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Compartment, EditorState, Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { basicSetup } from "@uiw/codemirror-extensions-basic-setup";
import { directoryOf, liveMarkdown, noteDirectory } from "@/lib/markdown";

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

/** Settings that change while the app is running: the font, and Vim mode. */
const preferences = new Compartment();
/** The open note's own directory, which its relative image paths resolve against. */
const location = new Compartment();

interface UseDocumentsOptions {
  /** Extensions that follow the app's settings. */
  preferences: Extension;
  /** The document the editor opens on. */
  initialPath: string;
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
export function useDocuments({ preferences: settings, initialPath }: UseDocumentsOptions) {
  const container = useRef<HTMLDivElement>(null);
  const states = useRef(new Map<string, EditorState>());
  /** The editor, as a ref for callbacks and as state for effects that follow it. */
  const editor = useRef<EditorView | null>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const currentPath = useRef(initialPath);
  const latestSettings = useRef(settings);
  /** Set while a document is being swapped in, so the swap is not read as an edit. */
  const swapping = useRef(false);
  const [dirtyPaths, setDirtyPaths] = useState<ReadonlySet<string>>(() => new Set());

  /**
   * Flags the open document as having drifted from disk. This runs on every
   * keystroke, so once the flag is up it does nothing at all - returning the
   * same set tells React there is nothing to re-render. Comparing the buffer
   * against what was written would mean walking the whole document instead.
   */
  const trackEdits = useRef<Extension>(null);
  if (!trackEdits.current) {
    trackEdits.current = EditorView.updateListener.of((update) => {
      if (!update.docChanged || swapping.current) return;
      const path = currentPath.current;
      setDirtyPaths((paths) => (paths.has(path) ? paths : new Set(paths).add(path)));
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
        location.of(noteDirectory.of(directoryOf(path))),
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

    return () => {
      // The state stays in the map, so a remount picks every document back up
      // exactly where it was left.
      states.current.set(currentPath.current, view.state);
      view.destroy();
      editor.current = null;
      setView(null);
    };
  }, [stateFor]);

  // A document created before the settings changed still carries the old ones
  // in its compartment, so opening one reapplies them rather than trusting this.
  useEffect(() => {
    latestSettings.current = settings;
    editor.current?.dispatch({ effects: preferences.reconfigure(settings) });
  }, [settings]);

  /** Shows `path`, creating its document from `content` if it has none yet. */
  const open = useCallback(
    (path: string, content: string | null) => {
      const view = editor.current;
      if (!view) return;

      swapping.current = true;
      // The live state lives in the view, not the map, so park it before it is
      // replaced - this is a reference, not a copy of the text.
      states.current.set(currentPath.current, view.state);
      currentPath.current = path;

      view.setState(stateFor(path, content ?? ""));
      view.dispatch({
        effects: [
          preferences.reconfigure(latestSettings.current),
          location.reconfigure(noteDirectory.of(directoryOf(path))),
        ],
      });
      swapping.current = false;
      // Opening a note is a request to write in it, so the caret goes there
      // rather than leaving the sidebar holding focus.
      view.focus();
    },
    [stateFor]
  );

  /** Whether `path` has already been read off disk. */
  const isOpen = useCallback((path: string) => states.current.has(path), []);

  /**
   * The document as text. This is the one operation that costs something in
   * proportion to the document's length, which is why it is only ever called
   * when the content has to leave the editor.
   */
  const read = useCallback(
    (path: string) => {
      const state = path === currentPath.current ? editor.current?.state : states.current.get(path);
      return state?.doc.toString() ?? "";
    },
    []
  );

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
  const rewrite = useCallback(
    (rename: (path: string) => string) => {
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
          effects: location.reconfigure(noteDirectory.of(directoryOf(current))),
        });
      }

      setDirtyPaths((paths) => new Set(Array.from(paths, rename)));
    },
    []
  );

  return { container, view, dirtyPaths, open, isOpen, read, markSaved, forget, rewrite };
}
