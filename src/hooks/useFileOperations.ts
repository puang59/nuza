import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Extension } from "@codemirror/state";
import { FileEntry } from "@/lib/types";
import {
  addEntry,
  addFile,
  findEntry,
  joinPath,
  moveEntry as moveTreeEntry,
  removeEntry,
} from "@/lib/fileTree";
import { report } from "@/lib/notices";
import { readScratch, writeScratch } from "@/lib/scratch";
import { readSession, writeSession } from "@/lib/session";
import { ATTACHMENT_EVENT, announceAttachment, fileNameOf, writeMedia } from "@/lib/media";
import { isWithin, rewritePath } from "@/lib/path";
import { useDocuments } from "./useDocuments";

const UNTITLED_FILE = "untitled.md";

/** Announced by the backend when a note changes underneath the app. */
const FILE_CHANGED_EVENT = "file-changed";

/**
 * What the backend says when it refuses to write a note that has moved on
 * since it was read. Matched on rather than treated as any other failure: a
 * full disk is something to report, a conflict is something to ask about.
 */
const CHANGED_ON_DISK = "The note changed on disk";

/**
 * Whether a rejected write is the backend refusing to overwrite a note that
 * moved on disk. That one has a bar of its own and an answer to give, so it
 * is not reported as a failure on top of it.
 */
function isConflict(error: unknown) {
  return String(error).includes(CHANGED_ON_DISK);
}

/**
 * How long after an edit a note is written back to disk. Long enough that a
 * burst of typing is one write rather than thirty, short enough that little is
 * ever outstanding - and what is outstanding is written on the way out rather
 * than lost, since there is no prompt there to catch it.
 */
const AUTOSAVE_DELAY = 800;

interface UseFileOperationsOptions {
  /** Editor extensions that follow the app's settings. */
  preferences: Extension;
  /** Called after a folder is successfully opened, with the folder's path. */
  onFolderOpened?: (path: string) => void;
}

interface OpenedFolder {
  path: string;
  entries: FileEntry[];
}

/** Owns the editor's open documents and every Tauri file-system round trip. */
export function useFileOperations({ preferences, onFolderOpened }: UseFileOperationsOptions) {
  // Read once, on the way up: the editor is built around this, and a later
  // read would be of whatever the app has since written back.
  const [keptScratch] = useState(readScratch);
  const [currentFile, setCurrentFile] = useState<string>(UNTITLED_FILE);
  const [openPaths, setOpenPaths] = useState<string[]>([UNTITLED_FILE]);
  const [folderData, setFolderData] = useState<FileEntry[]>([]);
  const [rootPath, setRootPath] = useState<string | null>(null);
  /**
   * Notes that have changed on disk while there were unsaved edits in them
   * here. Nothing is written back to one of these until someone has said which
   * copy to keep.
   */
  const [conflicts, setConflicts] = useState<ReadonlySet<string>>(() => new Set());

  // Destructured rather than held as one object: every member is stable, so
  // the callbacks below keep their identity from one render to the next.
  const {
    container: editorContainer,
    view: editorView,
    viewGeneration,
    dirtyPaths,
    subscribeToStats,
    open: openDocument,
    replace: replaceDocument,
    isOpen: isDocumentOpen,
    read: readDocument,
    revision: documentRevision,
    markSaved,
    forget: forgetDocuments,
    rewrite: rewriteDocuments,
  } = useDocuments({
    preferences,
    initialPath: UNTITLED_FILE,
    initialContent: keptScratch,
    vault: rootPath ?? "",
  });

  // Vim's `:w` command runs outside of React, from a closure captured once
  // when the editor mounts, so it can't see state updates directly - it
  // reads through these refs instead to always get the latest value.
  const currentFileRef = useRef(currentFile);
  const rootPathRef = useRef(rootPath);
  const openPathsRef = useRef(openPaths);
  /** Open paths in most-recently-viewed order, so ctrl+tab can flip back. */
  const recentRef = useRef<string[]>([UNTITLED_FILE]);

  currentFileRef.current = currentFile;
  rootPathRef.current = rootPath;
  openPathsRef.current = openPaths;

  // A file dropped on the note is written by the editor itself, which has no
  // way back into React - it says so on the window instead, and the sidebar
  // puts the new row in without going back to disk for it.
  useEffect(() => {
    function onAttachment(event: Event) {
      const { path } = (event as CustomEvent<{ path: string }>).detail;
      setFolderData((tree) => addFile(tree, rootPathRef.current ?? "", path));
    }

    window.addEventListener(ATTACHMENT_EVENT, onAttachment);
    return () => window.removeEventListener(ATTACHMENT_EVENT, onAttachment);
  }, []);

  const flagConflict = useCallback((path: string) => {
    setConflicts((paths) => (paths.has(path) ? paths : new Set(paths).add(path)));
  }, []);

  const clearConflict = useCallback((path: string) => {
    setConflicts((paths) => {
      if (!paths.has(path)) return paths;
      const next = new Set(paths);
      next.delete(path);
      return next;
    });
  }, []);

  /** Copies dropped files into `directory`, e.g. from a drag onto the sidebar. */
  const attachFiles = useCallback(async (directory: string, files: File[]) => {
    for (const file of files) {
      try {
        const saved = await writeMedia(directory, file.name, file);
        announceAttachment(saved);
      } catch (error) {
        report(`Couldn't add "${file.name}" to the vault`, error);
      }
    }
  }, []);

  /**
   * Keeps the scratch note where it can be found again. It is the one document
   * with nowhere on disk to go, so "saved" for it means stored - which is also
   * why this lowers its dirty flag: the note is no longer ahead of the only
   * copy of itself that outlives the window.
   */
  const keepScratch = useCallback(() => {
    if (!isDocumentOpen(UNTITLED_FILE)) return;
    writeScratch(readDocument(UNTITLED_FILE));
    markSaved(UNTITLED_FILE);
  }, [isDocumentOpen, readDocument, markSaved]);

  /** Puts the editor back on the scratch document, text and all. */
  const resetToScratch = useCallback(() => {
    keepScratch();
    forgetDocuments((path) => path === UNTITLED_FILE);
    recentRef.current = [UNTITLED_FILE];
    setOpenPaths([UNTITLED_FILE]);
    setCurrentFile(UNTITLED_FILE);
    openDocument(UNTITLED_FILE, readScratch());
  }, [keepScratch, forgetDocuments, openDocument]);

  /**
   * The vault whose open tabs are being recorded, and whether the tabs on
   * screen are its own yet. Nothing is written while a folder is being taken
   * on: the tabs at that moment still belong to the folder being left, and
   * recording them would overwrite what the new one is about to restore.
   */
  const sessionVault = useRef<string | null>(null);
  const sessionReady = useRef(false);

  /**
   * Reopens the notes that were last open in `folder`, or leaves the editor on
   * a scratch note if there is nothing to reopen. Only the note in front is
   * read from disk - the other tabs are read when they are looked at, which is
   * what keeps a vault with twenty tabs open as quick to launch as an empty one.
   */
  const restoreSession = useCallback(
    async (folder: OpenedFolder) => {
      const session = readSession(folder.path);
      // Notes deleted or moved since last time are quietly dropped rather than
      // reopened as tabs onto nothing.
      const open = session.open.filter((path) => findEntry(folder.entries, path));
      const current = open.includes(session.current) ? session.current : open[0];

      try {
        if (!current) throw new Error("nothing to reopen");
        const content = await invoke<string>("read_file", { path: current });

        recentRef.current = [current, ...open.filter((path) => path !== current)];
        setOpenPaths(open);
        setCurrentFile(current);
        openDocument(current, content);
      } catch {
        resetToScratch();
      } finally {
        sessionReady.current = true;
      }
    },
    [openDocument, resetToScratch]
  );

  /** Switches the app over to a folder that has already been read. */
  const adoptFolder = useCallback(
    (folder: OpenedFolder) => {
      setRootPath(folder.path);
      setFolderData(folder.entries);

      // Before the documents go: the scratch note is not one of the tabs being
      // left behind with the old vault, it is the same note either side of the
      // switch. Forgetting it here is what used to throw it away.
      keepScratch();
      forgetDocuments(() => true);
      resetToScratch();

      sessionVault.current = folder.path;
      sessionReady.current = false;
      void restoreSession(folder);

      onFolderOpened?.(folder.path);
    },
    [keepScratch, forgetDocuments, resetToScratch, restoreSession, onFolderOpened]
  );

  // What is open, kept for next time. The scratch note is left out: it is not
  // a file, so there is nothing to reopen it from.
  useEffect(() => {
    if (!sessionReady.current || sessionVault.current !== rootPath || !rootPath) return;

    const open = openPaths.filter((path) => path !== UNTITLED_FILE);
    writeSession(rootPath, { open, current: open.includes(currentFile) ? currentFile : (open[0] ?? "") });
  }, [rootPath, openPaths, currentFile]);

  const openFolder = useCallback(async () => {
    try {
      const result = await invoke<OpenedFolder | null>("load_folder_picker");
      if (result) adoptFolder(result);
    } catch (error) {
      report("Couldn't open that folder", error);
    }
  }, [adoptFolder]);

  /**
   * Opens a folder the app already knows the path of, for the vault switcher.
   * Returns false if it could not be read - a vault whose folder has been
   * moved or deleted since it was last opened.
   */
  const openVault = useCallback(
    async (path: string) => {
      try {
        adoptFolder(await invoke<OpenedFolder>("open_folder", { path }));
        return true;
      } catch (error) {
        // The switcher says its own piece about a vault that has moved, and
        // offers to forget it - a notice on top of that is one too many.
        console.error("Failed to open vault:", error);
        return false;
      }
    },
    [adoptFolder]
  );

  /**
   * Writes one document that already has somewhere to go. The dirty flag is
   * only lowered if the text has not moved on since it was read, so an edit
   * made while the write was in flight stays flagged for the next one.
   */
  const writeDocument = useCallback(
    async (path: string, force = false) => {
      const before = documentRevision(path);

      try {
        await invoke("write_file", { path, content: readDocument(path), force });
      } catch (error) {
        // The note moved on disk while this one was being edited. Flagged
        // rather than retried: the next autosave would only be refused again,
        // and someone has to say which of the two copies to keep.
        if (isConflict(error)) flagConflict(path);
        throw error;
      }

      if (documentRevision(path) === before) markSaved(path);
      // What is on disk is this note now, whatever it was a moment ago.
      clearConflict(path);
    },
    [documentRevision, readDocument, markSaved, flagConflict, clearConflict]
  );

  const save = useCallback(async () => {
    try {
      const path = currentFileRef.current;

      if (path !== UNTITLED_FILE) {
        // Direct save if we already have a real file path
        await writeDocument(path);
      } else {
        const content = readDocument(path);
        // Otherwise, open the picker for a new file
        const savedPath = await invoke<string | null>("save_file_picker", { content });
        if (savedPath) {
          // The scratch tab becomes the saved file rather than spawning a second tab.
          rewriteDocuments((p) => (p === UNTITLED_FILE ? savedPath : p));
          // It has a file of its own now, and a kept copy left behind would
          // reappear as the scratch note the next time a vault is opened.
          writeScratch("");
          markSaved(savedPath);
          setCurrentFile(savedPath);
          setOpenPaths((paths) => paths.map((p) => (p === UNTITLED_FILE ? savedPath : p)));
          recentRef.current = recentRef.current.map((p) => (p === UNTITLED_FILE ? savedPath : p));
        }
      }
    } catch (error) {
      if (!isConflict(error)) report("Couldn't save this note", error);
    }
  }, [writeDocument, readDocument, markSaved, rewriteDocuments]);

  // Everything that has drifted from disk, so the timer below can see what is
  // outstanding without being restarted every time the set changes.
  const dirtyPathsRef = useRef(dirtyPaths);
  dirtyPathsRef.current = dirtyPaths;

  /**
   * Writes back every note that has somewhere to go. The scratch buffer is
   * left out: it has no path yet, and saving it would mean putting a dialog
   * in front of someone who only meant to type.
   */
  const conflictsRef = useRef(conflicts);
  conflictsRef.current = conflicts;

  const saveDirty = useCallback(async () => {
    const paths = Array.from(dirtyPathsRef.current).filter(
      // A note waiting on an answer is left exactly as it is, on both sides:
      // the edits stay in the tab and the newer file stays on disk.
      (path) => path !== UNTITLED_FILE && !conflictsRef.current.has(path)
    );

    await Promise.all(
      paths.map(async (path) => {
        try {
          await writeDocument(path);
        } catch (error) {
          // A note waiting on an answer already has the bar above it saying
          // so; the autosave being turned away is that bar working.
          if (!isConflict(error)) report(`Couldn't save "${fileNameOf(path)}"`, error);
        }
      })
    );
  }, [writeDocument]);

  /**
   * Everything that has drifted from where it is kept, put back: the notes to
   * their files, the scratch note to storage. This is what the autosave timer
   * runs, and what the app runs once more on the way out.
   */
  const flush = useCallback(async () => {
    keepScratch();
    await saveDirty();
  }, [keepScratch, saveDirty]);

  // The dirty set only changes identity when a path joins or leaves it, so
  // this schedules a write shortly after a note *becomes* dirty rather than
  // restarting on every keystroke - a run of typing is saved every
  // AUTOSAVE_DELAY rather than only once the typing stops.
  useEffect(() => {
    if (dirtyPaths.size === 0) return;

    const timer = setTimeout(() => void flush(), AUTOSAVE_DELAY);
    return () => clearTimeout(timer);
  }, [dirtyPaths, flush]);

  /**
   * A note has changed underneath the app - a sync client, a git checkout, a
   * second editor.
   *
   * One with nothing unsaved simply catches up: the tab is there to show the
   * file, and the file is the newer of the two. One with edits in it cannot be
   * resolved without being asked, so it is flagged and left alone - which is
   * also what stops the autosave from putting the stale buffer over the top of
   * what just arrived.
   */
  useEffect(() => {
    const listening = listen<string>(FILE_CHANGED_EVENT, async ({ payload: path }) => {
      // Only notes the app is actually holding. Everything else is the
      // sidebar's business, and it is not showing stale text of anything.
      if (!isDocumentOpen(path)) return;

      let content: string;
      try {
        content = await invoke<string>("read_file", { path });
      } catch {
        // Gone, or no longer readable. What is held here is the last copy of
        // it there is, so it stays.
        return;
      }

      // The app's own save, arriving back as news. Cheap to rule out, and
      // worth ruling out: replacing a document resets its undo history.
      if (content === readDocument(path)) return;

      if (dirtyPathsRef.current.has(path)) flagConflict(path);
      else replaceDocument(path, content);
    });

    return () => {
      void listening.then((stop) => stop());
    };
  }, [isDocumentOpen, readDocument, replaceDocument, flagConflict]);

  /** Takes the copy on disk, dropping the edits made here. */
  const reloadFromDisk = useCallback(
    async (path: string) => {
      try {
        replaceDocument(path, await invoke<string>("read_file", { path }));
        markSaved(path);
        clearConflict(path);
      } catch (error) {
        report(`Couldn't read "${fileNameOf(path)}" back from disk`, error);
      }
    },
    [replaceDocument, markSaved, clearConflict]
  );

  /** Keeps what is in the editor, over the top of the copy on disk. */
  const keepMine = useCallback(
    async (path: string) => {
      try {
        await writeDocument(path, true);
      } catch (error) {
        report(`Couldn't save "${fileNameOf(path)}"`, error);
      }
    },
    [writeDocument]
  );

  const selectFile = useCallback(
    async (path: string) => {
      try {
        if (path === currentFileRef.current) return;

        // Only a document that has never been opened costs a read; everything
        // else is already sitting in memory as editor state.
        const content = isDocumentOpen(path) ? null : await invoke<string>("read_file", { path });
        openDocument(path, content);

        setCurrentFile(path);
        setOpenPaths((paths) => (paths.includes(path) ? paths : [...paths, path]));
        recentRef.current = [path, ...recentRef.current.filter((p) => p !== path)];
      } catch (error) {
        report(`Couldn't open "${fileNameOf(path)}"`, error);
      }
    },
    [isDocumentOpen, openDocument]
  );

  /**
   * Closes a tab, falling back to its right-hand neighbour (then its left) so
   * focus lands somewhere predictable. The document itself is kept around, so
   * reopening a file restores unsaved edits rather than silently dropping them.
   */
  const closeFile = useCallback(
    (path: string) => {
      const paths = openPathsRef.current;
      const index = paths.indexOf(path);
      if (index === -1) return;

      const remaining = paths.filter((p) => p !== path);
      recentRef.current = recentRef.current.filter((p) => p !== path);

      if (remaining.length === 0) {
        resetToScratch();
        return;
      }

      setOpenPaths(remaining);
      if (path === currentFileRef.current) {
        void selectFile(remaining[index] ?? remaining[remaining.length - 1]);
      }
    },
    [resetToScratch, selectFile]
  );

  /** Moves `step` tabs along, wrapping at either end. */
  const cycleFile = useCallback(
    (step: number) => {
      const paths = openPathsRef.current;
      if (paths.length < 2) return;
      const index = paths.indexOf(currentFileRef.current);
      if (index === -1) return;
      const next = (index + step + paths.length) % paths.length;
      void selectFile(paths[next]);
    },
    [selectFile]
  );

  /**
   * Flips to the document viewed before this one, so repeated presses toggle
   * between a pair the way ctrl+tab does elsewhere.
   */
  const switchToRecent = useCallback(() => {
    const open = new Set(openPathsRef.current);
    const previous = recentRef.current.find((p) => p !== currentFileRef.current && open.has(p));
    if (previous) void selectFile(previous);
  }, [selectFile]);

  /** Jumps to a tab by position; `index` of -1 means the last one. */
  const jumpToFile = useCallback(
    (index: number) => {
      const paths = openPathsRef.current;
      const path = index === -1 ? paths[paths.length - 1] : paths[index];
      if (path) void selectFile(path);
    },
    [selectFile]
  );

  /** Rewrites cached documents and open tabs after a path changes on disk. */
  const rewritePaths = useCallback(
    (from: string, to: string) => {
      const rename = (path: string) => rewritePath(path, from, to);

      rewriteDocuments(rename);
      setOpenPaths((paths) => paths.map(rename));
      recentRef.current = recentRef.current.map(rename);
      if (isWithin(currentFileRef.current, from)) setCurrentFile(rename(currentFileRef.current));
    },
    [rewriteDocuments]
  );

  /**
   * Makes a note and opens it. Creating a file is a decision to write in it,
   * so the editor goes there rather than leaving a new empty row in the tree
   * for someone to go and click on.
   */
  const createFile = useCallback(
    async (parentPath: string, name: string) => {
      await invoke("create_file", { parentPath, name });
      const entry = { name, path: joinPath(parentPath, name), isDirectory: false };
      setFolderData((tree) => addEntry(tree, rootPathRef.current ?? "", entry));
      await selectFile(entry.path);
    },
    [selectFile]
  );

  const createFolder = useCallback(async (parentPath: string, name: string) => {
    await invoke("create_folder", { parentPath, name });
    const entry = { name, path: joinPath(parentPath, name), isDirectory: true, children: [] };
    setFolderData((tree) => addEntry(tree, rootPathRef.current ?? "", entry));
  }, []);

  const renameEntry = useCallback(
    async (path: string, newName: string) => {
      const newPath = await invoke<string>("rename_entry", { path, newName });
      setFolderData((tree) => moveTreeEntry(tree, rootPathRef.current ?? "", path, newPath));
      rewritePaths(path, newPath);
    },
    [rewritePaths]
  );

  const moveEntry = useCallback(
    async (path: string, targetDir: string) => {
      const newPath = await invoke<string>("move_entry", { path, targetDir });
      setFolderData((tree) => moveTreeEntry(tree, rootPathRef.current ?? "", path, newPath));
      rewritePaths(path, newPath);
    },
    [rewritePaths]
  );

  const deleteEntry = useCallback(
    async (path: string) => {
      await invoke("delete_entry", { path });
      setFolderData((tree) => removeEntry(tree, rootPathRef.current ?? "", path));

      forgetDocuments((open) => isWithin(open, path));

      const remaining = openPathsRef.current.filter((p) => !isWithin(p, path));
      recentRef.current = recentRef.current.filter((p) => !isWithin(p, path));

      if (remaining.length === 0) {
        resetToScratch();
        return;
      }

      setOpenPaths(remaining);
      // Through selectFile rather than straight at the editor: the tab being
      // fallen back on is very often one restored from a session and never
      // looked at, which means it has no document in memory yet and has to be
      // read from disk. Handing the editor a path with nothing behind it used
      // to put an empty note on screen, and the first keystroke after that
      // autosaved the blank over the real file.
      if (isWithin(currentFileRef.current, path)) void selectFile(remaining[0]);
    },
    [forgetDocuments, resetToScratch, selectFile]
  );

  return {
    editorContainer,
    editorView,
    viewGeneration,
    subscribeToStats,
    currentFile,
    openPaths,
    dirtyPaths,
    conflicts,
    folderData,
    rootPath,
    openFolder,
    openVault,
    save,
    saveDirty,
    flush,
    selectFile,
    closeFile,
    cycleFile,
    switchToRecent,
    jumpToFile,
    reloadFromDisk,
    keepMine,
    createFile,
    createFolder,
    renameEntry,
    moveEntry,
    deleteEntry,
    attachFiles,
  };
}
