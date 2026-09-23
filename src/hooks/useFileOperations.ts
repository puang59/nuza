import { useCallback, useMemo, useReducer, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileEntry } from "@/lib/types";

const UNTITLED_FILE = "untitled.md";

interface UseFileOperationsOptions {
  /** Called after a folder is successfully opened, e.g. to reveal the sidebar. */
  onFolderOpened?: () => void;
}

interface OpenedFolder {
  path: string;
  entries: FileEntry[];
}

/**
 * One open document. `saved` is the content as of the last read or write, so
 * comparing it against `content` is what marks a tab as having unsaved edits.
 */
interface OpenDoc {
  content: string;
  saved: string;
}

/** True if `path` is `ancestor` itself, or lives somewhere underneath it. */
function isWithin(path: string, ancestor: string) {
  return path === ancestor || path.startsWith(ancestor + "/") || path.startsWith(ancestor + "\\");
}

/** Owns the editor's open documents and every Tauri file-system round trip. */
export function useFileOperations({ onFolderOpened }: UseFileOperationsOptions = {}) {
  const [value, setValue] = useState<string>("");
  const [currentFile, setCurrentFile] = useState<string>(UNTITLED_FILE);
  const [openPaths, setOpenPaths] = useState<string[]>([UNTITLED_FILE]);
  const [folderData, setFolderData] = useState<FileEntry[]>([]);
  const [rootPath, setRootPath] = useState<string | null>(null);

  // Vim's `:w` command runs outside of React, from a closure captured once
  // when the editor mounts, so it can't see state updates directly - it
  // reads through these refs instead to always get the latest value.
  const valueRef = useRef(value);
  const currentFileRef = useRef(currentFile);
  const rootPathRef = useRef(rootPath);
  const openPathsRef = useRef(openPaths);
  const docsRef = useRef<Record<string, OpenDoc>>({ [UNTITLED_FILE]: { content: "", saved: "" } });
  /** Open paths in most-recently-viewed order, so ctrl+tab can flip back. */
  const recentRef = useRef<string[]>([UNTITLED_FILE]);

  valueRef.current = value;
  currentFileRef.current = currentFile;
  rootPathRef.current = rootPath;
  openPathsRef.current = openPaths;

  // Writing to disk doesn't touch React state on its own, but it does change
  // which tabs count as dirty - bump this to recompute after a save.
  const [savedRevision, markSaved] = useReducer((n: number) => n + 1, 0);

  /** Parks the live editor buffer back on its document before switching away. */
  const stashCurrent = useCallback(() => {
    const path = currentFileRef.current;
    const doc = docsRef.current[path];
    docsRef.current[path] = { content: valueRef.current, saved: doc?.saved ?? valueRef.current };
  }, []);

  /** Paths whose buffer has drifted from what's on disk. */
  const dirtyPaths = useMemo(() => {
    const dirty = new Set<string>();
    for (const path of openPaths) {
      const doc = docsRef.current[path];
      if (!doc) continue;
      const content = path === currentFile ? value : doc.content;
      if (content !== doc.saved) dirty.add(path);
    }
    return dirty;
    // `savedRevision` isn't read directly - it's what re-runs this after a save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPaths, currentFile, value, savedRevision]);

  const openFolder = useCallback(async () => {
    try {
      const result = await invoke<OpenedFolder | null>("load_folder_picker");
      if (result) {
        setRootPath(result.path);
        setFolderData(result.entries);

        docsRef.current = { [UNTITLED_FILE]: { content: "", saved: "" } };
        recentRef.current = [UNTITLED_FILE];
        setOpenPaths([UNTITLED_FILE]);
        setCurrentFile(UNTITLED_FILE);
        setValue("");

        onFolderOpened?.();
      }
    } catch (error) {
      console.error("Failed to load folder:", error);
    }
  }, [onFolderOpened]);

  const refreshFolder = useCallback(async () => {
    const path = rootPathRef.current;
    if (!path) return;
    try {
      const entries = await invoke<FileEntry[]>("read_folder", { path });
      setFolderData(entries);
    } catch (error) {
      console.error("Failed to refresh folder:", error);
    }
  }, []);

  const save = useCallback(async () => {
    try {
      const path = currentFileRef.current;
      const content = valueRef.current;

      if (path !== UNTITLED_FILE) {
        // Direct save if we already have a real file path
        await invoke("write_file", { path, content });
        docsRef.current[path] = { content, saved: content };
      } else {
        // Otherwise, open the picker for a new file
        const savedPath = await invoke<string | null>("save_file_picker", { content });
        if (savedPath) {
          setCurrentFile(savedPath);
          docsRef.current[savedPath] = { content, saved: content };
          delete docsRef.current[UNTITLED_FILE];
          // The scratch tab becomes the saved file rather than spawning a second tab.
          setOpenPaths((paths) => paths.map((p) => (p === UNTITLED_FILE ? savedPath : p)));
        }
      }
      markSaved();
    } catch (error) {
      console.error("Failed to save file:", error);
    }
  }, []);

  const selectFile = useCallback(
    async (path: string) => {
      try {
        if (path === currentFileRef.current) return;
        stashCurrent();

        const cached = docsRef.current[path];
        if (!cached) {
          const content = await invoke<string>("read_file", { path });
          docsRef.current[path] = { content, saved: content };
          setValue(content);
        } else {
          setValue(cached.content);
        }

        setCurrentFile(path);
        setOpenPaths((paths) => (paths.includes(path) ? paths : [...paths, path]));
        recentRef.current = [path, ...recentRef.current.filter((p) => p !== path)];
      } catch (error) {
        console.error("Failed to read file:", error);
      }
    },
    [stashCurrent]
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
        docsRef.current[UNTITLED_FILE] = { content: "", saved: "" };
        recentRef.current = [UNTITLED_FILE];
        setOpenPaths([UNTITLED_FILE]);
        setCurrentFile(UNTITLED_FILE);
        setValue("");
        return;
      }

      setOpenPaths(remaining);
      if (path === currentFileRef.current) {
        void selectFile(remaining[index] ?? remaining[remaining.length - 1]);
      }
    },
    [selectFile]
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
  const rewritePaths = useCallback((from: string, to: string) => {
    for (const key of Object.keys(docsRef.current)) {
      if (isWithin(key, from)) {
        docsRef.current[key.replace(from, to)] = docsRef.current[key];
        delete docsRef.current[key];
      }
    }
    setOpenPaths((paths) => paths.map((p) => (isWithin(p, from) ? p.replace(from, to) : p)));
    recentRef.current = recentRef.current.map((p) => (isWithin(p, from) ? p.replace(from, to) : p));
    if (isWithin(currentFileRef.current, from)) {
      setCurrentFile(currentFileRef.current.replace(from, to));
    }
  }, []);

  const createFile = useCallback(
    async (parentPath: string, name: string) => {
      await invoke("create_file", { parentPath, name });
      await refreshFolder();
    },
    [refreshFolder]
  );

  const createFolder = useCallback(
    async (parentPath: string, name: string) => {
      await invoke("create_folder", { parentPath, name });
      await refreshFolder();
    },
    [refreshFolder]
  );

  const renameEntry = useCallback(
    async (path: string, newName: string) => {
      const newPath = await invoke<string>("rename_entry", { path, newName });
      await refreshFolder();
      rewritePaths(path, newPath);
    },
    [refreshFolder, rewritePaths]
  );

  const moveEntry = useCallback(
    async (path: string, targetDir: string) => {
      const newPath = await invoke<string>("move_entry", { path, targetDir });
      await refreshFolder();
      rewritePaths(path, newPath);
    },
    [refreshFolder, rewritePaths]
  );

  const deleteEntry = useCallback(
    async (path: string) => {
      await invoke("delete_entry", { path });
      await refreshFolder();

      for (const key of Object.keys(docsRef.current)) {
        if (isWithin(key, path)) delete docsRef.current[key];
      }

      const remaining = openPathsRef.current.filter((p) => !isWithin(p, path));
      recentRef.current = recentRef.current.filter((p) => !isWithin(p, path));

      if (remaining.length === 0) {
        docsRef.current[UNTITLED_FILE] = { content: "", saved: "" };
        recentRef.current = [UNTITLED_FILE];
        setOpenPaths([UNTITLED_FILE]);
        setCurrentFile(UNTITLED_FILE);
        setValue("");
        return;
      }

      setOpenPaths(remaining);
      if (isWithin(currentFileRef.current, path)) {
        const doc = docsRef.current[remaining[0]];
        setCurrentFile(remaining[0]);
        setValue(doc?.content ?? "");
      }
    },
    [refreshFolder]
  );

  return {
    value,
    setValue,
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
