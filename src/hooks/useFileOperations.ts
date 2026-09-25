import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Extension } from "@codemirror/state";
import { FileEntry } from "@/lib/types";
import { addEntry, joinPath, moveEntry as moveTreeEntry, removeEntry } from "@/lib/fileTree";
import { useDocuments } from "./useDocuments";

const UNTITLED_FILE = "untitled.md";

interface UseFileOperationsOptions {
  /** Editor extensions that follow the app's settings. */
  preferences: Extension;
  /** Called after a folder is successfully opened, e.g. to reveal the sidebar. */
  onFolderOpened?: () => void;
}

interface OpenedFolder {
  path: string;
  entries: FileEntry[];
}

/** True if `path` is `ancestor` itself, or lives somewhere underneath it. */
function isWithin(path: string, ancestor: string) {
  return path === ancestor || path.startsWith(ancestor + "/") || path.startsWith(ancestor + "\\");
}

/** Owns the editor's open documents and every Tauri file-system round trip. */
export function useFileOperations({ preferences, onFolderOpened }: UseFileOperationsOptions) {
  const [currentFile, setCurrentFile] = useState<string>(UNTITLED_FILE);
  const [openPaths, setOpenPaths] = useState<string[]>([UNTITLED_FILE]);
  const [folderData, setFolderData] = useState<FileEntry[]>([]);
  const [rootPath, setRootPath] = useState<string | null>(null);

  // Destructured rather than held as one object: every member is stable, so
  // the callbacks below keep their identity from one render to the next.
  const {
    container: editorContainer,
    view: editorView,
    dirtyPaths,
    open: openDocument,
    isOpen: isDocumentOpen,
    read: readDocument,
    markSaved,
    forget: forgetDocuments,
    rewrite: rewriteDocuments,
  } = useDocuments({ preferences, initialPath: UNTITLED_FILE });

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

  /** Puts the editor back on a single empty scratch document. */
  const resetToScratch = useCallback(() => {
    forgetDocuments((path) => path === UNTITLED_FILE);
    recentRef.current = [UNTITLED_FILE];
    setOpenPaths([UNTITLED_FILE]);
    setCurrentFile(UNTITLED_FILE);
    openDocument(UNTITLED_FILE, "");
  }, [forgetDocuments, openDocument]);

  const openFolder = useCallback(async () => {
    try {
      const result = await invoke<OpenedFolder | null>("load_folder_picker");
      if (result) {
        setRootPath(result.path);
        setFolderData(result.entries);

        forgetDocuments(() => true);
        resetToScratch();

        onFolderOpened?.();
      }
    } catch (error) {
      console.error("Failed to load folder:", error);
    }
  }, [forgetDocuments, resetToScratch, onFolderOpened]);

  const save = useCallback(async () => {
    try {
      const path = currentFileRef.current;
      const content = readDocument(path);

      if (path !== UNTITLED_FILE) {
        // Direct save if we already have a real file path
        await invoke("write_file", { path, content });
        markSaved(path);
      } else {
        // Otherwise, open the picker for a new file
        const savedPath = await invoke<string | null>("save_file_picker", { content });
        if (savedPath) {
          // The scratch tab becomes the saved file rather than spawning a second tab.
          rewriteDocuments((p) => (p === UNTITLED_FILE ? savedPath : p));
          markSaved(savedPath);
          setCurrentFile(savedPath);
          setOpenPaths((paths) => paths.map((p) => (p === UNTITLED_FILE ? savedPath : p)));
          recentRef.current = recentRef.current.map((p) => (p === UNTITLED_FILE ? savedPath : p));
        }
      }
    } catch (error) {
      console.error("Failed to save file:", error);
    }
  }, [readDocument, markSaved, rewriteDocuments]);

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
        console.error("Failed to read file:", error);
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
      const rename = (path: string) => (isWithin(path, from) ? path.replace(from, to) : path);

      rewriteDocuments(rename);
      setOpenPaths((paths) => paths.map(rename));
      recentRef.current = recentRef.current.map(rename);
      if (isWithin(currentFileRef.current, from)) setCurrentFile(rename(currentFileRef.current));
    },
    [rewriteDocuments]
  );

  const createFile = useCallback(async (parentPath: string, name: string) => {
    await invoke("create_file", { parentPath, name });
    const entry = { name, path: joinPath(parentPath, name), isDirectory: false };
    setFolderData((tree) => addEntry(tree, rootPathRef.current ?? "", entry));
  }, []);

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
      if (isWithin(currentFileRef.current, path)) {
        setCurrentFile(remaining[0]);
        openDocument(remaining[0], null);
      }
    },
    [forgetDocuments, openDocument, resetToScratch]
  );

  return {
    editorContainer,
    editorView,
    currentFile,
    openPaths,
    dirtyPaths,
    folderData,
    rootPath,
    openFolder,
    save,
    selectFile,
    closeFile,
    cycleFile,
    switchToRecent,
    jumpToFile,
    createFile,
    createFolder,
    renameEntry,
    moveEntry,
    deleteEntry,
  };
}
