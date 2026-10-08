import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { FileEntry } from "@/lib/types";
import {
  addEntry,
  addFile,
  touchEntry,
  findEntry,
  joinPath,
  mergeListing,
  moveEntry as moveTreeEntry,
  readFolders,
  removeEntry,
  setChildren,
} from "@/lib/fileTree";
import { report } from "@/lib/notices";
import { listenHere } from "@/lib/windowEvents";
import { readScratch, writeScratch } from "@/lib/scratch";
import { readSession, tabsToRestore, writeSession } from "@/lib/session";
import { ATTACHMENT_EVENT, announceAttachment, fileNameOf, writeMedia } from "@/lib/media";
import { isWithin, rewritePath } from "@/lib/path";
import { ClosedTab, placeAt, rememberClosed } from "@/lib/closedTabs";
import { moveTab } from "@/lib/tabOrder";
import { OpenTarget, planOpen } from "@/lib/launchTarget";
import { jumpToHeading } from "@/lib/markdown/headings";
import { showLightbox } from "@/lib/markdown/lightbox";
import { mediaSource } from "@/lib/markdown/sources";
import { isNotText, openerFor } from "@/lib/openers";
import { untitledName } from "@/lib/noteName";
import { EMPTY_TRAIL, Trail, forgetPlaces, leave, renamePlaces, step } from "@/lib/navigation";
import { directoryOf } from "@/lib/markdown/sources";
import { WIKI_LINK_EVENT, WikiLinkRequest, resolveWikiLink } from "@/lib/markdown/wikiLinks";
import { useDocuments } from "./useDocuments";
import { useFileIndex } from "./useFileIndex";

const UNTITLED_FILE = "untitled.md";

/** Announced by the backend when a note changes underneath the app. */
const FILE_CHANGED_EVENT = "file-changed";
/** Announced by the backend when the set of files in the vault changes. */
const INDEX_CHANGED_EVENT = "index-changed";
/** How long the tree waits for a burst of those to finish before reading again. */
const TREE_SETTLE_DELAY = 250;
/**
 * How long a note that cannot be read is given before it is called gone. An
 * editor that saves by replacing the file takes it away for a moment first.
 */
const MISSING_GRACE = 400;
/** Matches `OPEN_TARGET_EVENT` in lib.rs. */
const OPEN_TARGET_EVENT = "open-target";

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

/**
 * How long a save that failed is left before it is tried again. A full disk or
 * a folder that has gone read-only does not mend itself in under a second, and
 * each attempt says that it failed.
 */
const AUTOSAVE_RETRY_DELAY = 10_000;

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
  /** The note in the split beside the main pane, if there is one. It has no tab. */
  const [sideFile, setSideFile] = useState<string | null>(null);
  const [folderData, setFolderData] = useState<FileEntry[]>([]);
  const [rootPath, setRootPath] = useState<string | null>(null);
  /**
   * Notes that have changed on disk while there were unsaved edits in them
   * here. Nothing is written back to one of these until someone has said which
   * copy to keep.
   */
  const [conflicts, setConflicts] = useState<ReadonlySet<string>>(() => new Set());
  /**
   * Edits kept from a previous run, by the note they belong to. A note gets
   * an entry here when it is opened and there is a buffer waiting for it; the
   * entry goes when the offer has been answered either way.
   */
  const [recovered, setRecovered] = useState<ReadonlyMap<string, string>>(() => new Map());
  /**
   * Open notes whose file has gone from disk - deleted, moved or renamed by
   * something other than the app. The tab still holds the text, which may be
   * the last copy of it there is, so it stays and says so.
   */
  const [missing, setMissing] = useState<ReadonlySet<string>>(() => new Set());

  // Destructured rather than held as one object: every member is stable, so
  // the callbacks below keep their identity from one render to the next.
  const {
    container: editorContainer,
    view: editorView,
    sideContainer,
    sideView,
    openSide: openSideDocument,
    closeSide: closeSideDocument,
    viewGeneration,
    dirtyPaths,
    subscribeToStats,
    open: openDocument,
    replace: replaceDocument,
    showing: showingDocument,
    showingSide: showingSideDocument,
    isOpen: isDocumentOpen,
    read: readDocument,
    revision: documentRevision,
    caretOf,
    markSaved,
    forget: forgetDocuments,
    rewrite: rewriteDocuments,
  } = useDocuments({
    preferences,
    initialPath: UNTITLED_FILE,
    initialContent: keptScratch,
    vault: rootPath ?? "",
    openPaths,
  });

  // Vim's `:w` command runs outside of React, from a closure captured once
  // when the editor mounts, so it can't see state updates directly - it
  // reads through these refs instead to always get the latest value.
  const currentFileRef = useRef(currentFile);
  const rootPathRef = useRef(rootPath);
  const openPathsRef = useRef(openPaths);
  /** Open paths in most-recently-viewed order, so ctrl+tab can flip back. */
  const recentRef = useRef<string[]>([UNTITLED_FILE]);
  /** Tabs closed this session, most recent last, for reopening. */
  const closedRef = useRef<ClosedTab[]>([]);
  const folderDataRef = useRef(folderData);
  folderDataRef.current = folderData;
  // Every file in the vault, not only those in the folders the sidebar has
  // opened: what a wiki-link or a closed tab is looked for among.
  const fileIndex = useFileIndex(rootPath);
  const fileIndexRef = useRef(fileIndex);
  fileIndexRef.current = fileIndex;

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
    // The question has been answered, so there is nothing left to hold on to.
    void invoke("drop_recovery", { path }).catch(() => {});
  }, []);

  const flagMissing = useCallback((path: string) => {
    setMissing((paths) => (paths.has(path) ? paths : new Set(paths).add(path)));
  }, []);

  const clearMissing = useCallback((path: string) => {
    setMissing((paths) => {
      if (!paths.has(path)) return paths;
      const next = new Set(paths);
      next.delete(path);
      return next;
    });
  }, []);

  /** Stops offering what was kept for `path`, and forgets it on disk. */
  const forgetRecovered = useCallback((path: string) => {
    setRecovered((kept) => {
      if (!kept.has(path)) return kept;
      const next = new Map(kept);
      next.delete(path);
      return next;
    });
    void invoke("drop_recovery", { path }).catch(() => {});
  }, []);

  /**
   * Asks whether anything was kept for `onDisk`, and offers it if what was
   * kept is not simply what is there now.
   *
   * A buffer that matches the file is one the answer no longer matters for -
   * something else saved the same text, or the note was reloaded - and asking
   * about it would be asking someone to choose between two identical things.
   */
  const offerRecovered = useCallback(async (path: string, onDisk: string) => {
    try {
      const kept = await invoke<string | null>("take_recovery", { path });
      if (kept === null) return;
      if (kept === onDisk) {
        void invoke("drop_recovery", { path }).catch(() => {});
        return;
      }
      setRecovered((held) => new Map(held).set(path, kept));
    } catch (error) {
      // Nothing is lost by failing to ask - the buffer stays where it is
      // and the offer comes round again the next time the note is opened.
      console.error("Couldn't look for kept edits:", error);
    }
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
  /** The places left behind on the way here, and the ones gone back from. */
  const trail = useRef<Trail>(EMPTY_TRAIL);
  /** Set while going back or forward, so that move does not itself count as a place left. */
  const retracing = useRef(false);

  /**
   * Notes that where the caret is now is about to be left - before following
   * a link, opening a search hit or switching notes - so it can be come back
   * to. The scratch note is not noted: it has no file to come back to once
   * its tab has gone.
   */
  const leavePlace = useCallback(() => {
    if (retracing.current) return;
    const path = currentFileRef.current;
    if (path === UNTITLED_FILE) return;
    trail.current = leave(trail.current, { path, caret: caretOf(path) ?? 0 });
  }, [caretOf]);

  /** Counts the restores started, so one overtaken by the next can tell. */
  const restoring = useRef(0);
  /**
   * Where the caret was in each of the session's notes, as last recorded: what
   * a tab not looked at yet this run opens at, and what is written back for it
   * until it has been.
   */
  const savedCarets = useRef<Record<string, number>>({});

  /**
   * Reopens the notes that were last open in `folder`, or leaves the editor on
   * a scratch note if there is nothing to reopen. Only the note in front is
   * read from disk - the other tabs are read when they are looked at, which is
   * what keeps a vault with twenty tabs open as quick to launch as an empty one.
   */
  const restoreSession = useCallback(
    async (folder: OpenedFolder, focus?: string) => {
      const mine = ++restoring.current;
      const overtaken = () => mine !== restoring.current;

      const session = readSession(folder.path);
      // A note asked for by name - from a terminal - goes in front of whatever
      // was open, and joins the tabs if it was not one of them.
      const wanted = focus && !session.open.includes(focus) ? [...session.open, focus] : session.open;

      let restored = false;
      try {
        // Notes deleted or moved since last time are quietly dropped rather
        // than reopened as tabs onto nothing. The disk is asked, not the tree:
        // the tree is read a folder at a time, and has not heard of a note in
        // a folder nobody has opened yet - which used to lose every such tab.
        let present = wanted;
        if (wanted.length > 0) {
          try {
            present = await invoke<string[]>("existing_files", { paths: wanted });
          } catch (error) {
            // Not knowing which are gone is no reason to drop them all.
            console.error("Couldn't check which notes are still there:", error);
          }
        }
        if (overtaken()) return;

        const { open, current } = tabsToRestore(session, present, focus);
        if (!current) throw new Error("nothing to reopen");
        const content = await invoke<string>("read_file", { path: current });
        if (overtaken()) return;

        savedCarets.current = { ...session.carets };

        recentRef.current = [current, ...open.filter((path) => path !== current)];
        setOpenPaths(open);
        setCurrentFile(current);
        openDocument(current, content, savedCarets.current[current]);
        restored = true;

        // The likeliest note to have edits waiting is the one that was open
        // when the app went away, and this is the path it comes back through -
        // it never goes near `selectFile`.
        void offerRecovered(current, content);
      } catch {
        // Nothing to reopen, or the note in front could not be read.
      }

      // Another folder was opened while this one was being read: the tabs on
      // screen are that one's business now, and so is saying they are ready.
      if (overtaken()) return;
      if (!restored) resetToScratch();
      sessionReady.current = true;
    },
    [openDocument, resetToScratch, offerRecovered]
  );

  /** Switches the app over to a folder that has already been read. */
  const adoptFolder = useCallback(
    (folder: OpenedFolder, focus?: string) => {
      setRootPath(folder.path);
      setFolderData(folder.entries);

      // Before the documents go: the scratch note is not one of the tabs being
      // left behind with the old vault, it is the same note either side of the
      // switch. Forgetting it here is what used to throw it away.
      keepScratch();
      forgetDocuments(() => true);
      setSideFile(null);
      setMissing(new Set());
      resetToScratch();
      // The tabs closed in the vault being left are no tabs of this one, and
      // nor are the places its notes were left at.
      closedRef.current = [];
      savedCarets.current = {};
      trail.current = EMPTY_TRAIL;

      sessionVault.current = folder.path;
      sessionReady.current = false;
      void restoreSession(folder, focus);

      onFolderOpened?.(folder.path);
    },
    [keepScratch, forgetDocuments, resetToScratch, restoreSession, onFolderOpened]
  );

  // What is open, kept for next time. The scratch note is left out: it is not
  // a file, so there is nothing to reopen it from.
  const recordSession = useCallback(() => {
    const root = rootPathRef.current;
    if (!sessionReady.current || sessionVault.current !== root || !root) return;

    const open = openPathsRef.current.filter((path) => path !== UNTITLED_FILE);
    const current = currentFileRef.current;

    // A tab that has not been looked at this run has no caret of its own
    // yet, so the one it was recorded with stands.
    const carets: Record<string, number> = {};
    for (const path of open) {
      const caret = caretOf(path) ?? savedCarets.current[path];
      if (caret) carets[path] = caret;
    }
    savedCarets.current = carets;

    writeSession(root, { open, current: open.includes(current) ? current : (open[0] ?? ""), carets });
  }, [caretOf]);

  useEffect(() => {
    recordSession();
  }, [rootPath, openPaths, currentFile, recordSession]);

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
    async (path: string, focus?: string) => {
      try {
        adoptFolder(await invoke<OpenedFolder>("open_folder", { path }), focus);
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
  /**
   * How soon the autosave should run again once the one in hand is done, or
   * null if it has nothing left to do. A note that is still dirty after a save
   * does not change the dirty set, so nothing else would bring the timer back.
   */
  const saveAgain = useRef<number | null>(null);

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
      // Typed in while the write was on its way: what is on disk is already
      // behind, and the autosave has to come round again for the rest.
      else saveAgain.current = AUTOSAVE_DELAY;
      // Keeps "Date Modified" order honest about the notes written from here.
      setFolderData((tree) => touchEntry(tree, rootPathRef.current ?? "", path));
      // What is on disk is this note now, whatever it was a moment ago - and
      // it is on disk, if it had gone from there.
      clearConflict(path);
      clearMissing(path);
    },
    [documentRevision, readDocument, markSaved, flagConflict, clearConflict, clearMissing]
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
          if (!isConflict(error)) {
            report(`Couldn't save "${fileNameOf(path)}"`, error);
            // Still unsaved, and nothing but another try will change that.
            saveAgain.current ??= AUTOSAVE_RETRY_DELAY;
          }
        }
      })
    );
  }, [writeDocument]);

  /**
   * The edits in notes that are waiting on an answer, put somewhere they will
   * outlive the window.
   *
   * `saveDirty` leaves these alone on purpose - writing one would be picking a
   * winner nobody asked it to pick - but leaving them *only* in the editor's
   * own state means the window closing takes them. They go to the app's data
   * directory instead: nothing in the vault is touched, no copy is declared
   * the right one, and the question can be put again the next time the note is
   * opened.
   *
   * Written on every flush rather than only on the way out, so what is kept is
   * what was last typed, and so a crash is covered as well as a quit.
   */
  const keepConflicted = useCallback(async () => {
    const paths = Array.from(dirtyPathsRef.current).filter(
      (path) => path !== UNTITLED_FILE && conflictsRef.current.has(path)
    );

    await Promise.all(
      paths.map(async (path) => {
        try {
          await invoke("keep_recovery", { path, content: readDocument(path) });
        } catch (error) {
          report(`Couldn't keep the unsaved edits in "${fileNameOf(path)}"`, error);
        }
      })
    );
  }, [readDocument]);

  /**
   * Everything that has drifted from where it is kept, put back: the notes to
   * their files, the scratch note to storage, and the edits nobody has decided
   * about yet somewhere they will survive. This is what the autosave timer
   * runs, and what the app runs once more on the way out.
   */
  const flush = useCallback(async () => {
    keepScratch();
    // Where the caret is in each note, along with the tabs: it moves without
    // the tabs changing, so this is where it is caught up with - as notes are
    // saved, and once more on the way out.
    recordSession();
    await Promise.all([saveDirty(), keepConflicted()]);
  }, [keepScratch, recordSession, saveDirty, keepConflicted]);

  // The dirty set only changes identity when a path joins or leaves it, so
  // this schedules a write shortly after a note *becomes* dirty rather than
  // restarting on every keystroke - a run of typing is saved every
  // AUTOSAVE_DELAY rather than only once the typing stops.
  //
  // A note typed in while its save was in flight is still dirty when the save
  // lands, and the set is the same set - so the save asks for another round
  // itself, through `saveAgain`, or that note would sit unsaved until quit.
  const [autosave, setAutosave] = useState({ round: 0, delay: AUTOSAVE_DELAY });
  useEffect(() => {
    if (dirtyPaths.size === 0) return;

    const timer = setTimeout(() => {
      saveAgain.current = null;
      void flush().finally(() => {
        const delay = saveAgain.current;
        setAutosave((last) => {
          if (delay !== null) return { round: last.round + 1, delay };
          // Nothing left over: back to the usual pace, if a failure slowed it.
          return last.delay === AUTOSAVE_DELAY ? last : { ...last, delay: AUTOSAVE_DELAY };
        });
      });
    }, autosave.delay);
    return () => clearTimeout(timer);
  }, [dirtyPaths, flush, autosave]);

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
    const listening = listenHere<string>(FILE_CHANGED_EVENT, async ({ payload: path }) => {
      // Only notes the app is actually holding. Everything else is the
      // sidebar's business, and it is not showing stale text of anything.
      if (!isDocumentOpen(path)) return;

      let content: string;
      try {
        content = await invoke<string>("read_file", { path });
      } catch {
        // Gone, or no longer readable - or being replaced, which is how a
        // good many editors save, and looks like gone for a moment. So it is
        // asked again shortly before anything is said about it.
        await new Promise((resolve) => setTimeout(resolve, MISSING_GRACE));
        try {
          content = await invoke<string>("read_file", { path });
        } catch {
          // What is held here is the last copy of it there is, so it stays -
          // marked, if the file really is not there, so the tab does not go
          // on looking like a note that is safely on disk.
          const there = await invoke<string[]>("existing_files", { paths: [path] }).catch(() => [path]);
          if (there.length === 0 && isDocumentOpen(path)) flagMissing(path);
          return;
        }
      }

      clearMissing(path);

      // The app's own save, arriving back as news. Cheap to rule out, and
      // worth ruling out: replacing a document resets its undo history.
      if (content === readDocument(path)) return;

      if (dirtyPathsRef.current.has(path)) flagConflict(path);
      else replaceDocument(path, content);
    });

    return () => {
      void listening.then((stop) => stop());
    };
  }, [isDocumentOpen, readDocument, replaceDocument, flagConflict, flagMissing, clearMissing]);

  /** Takes the copy on disk, dropping the edits made here. */
  const reloadFromDisk = useCallback(
    async (path: string) => {
      try {
        replaceDocument(path, await invoke<string>("read_file", { path }));
        markSaved(path);
        clearConflict(path);
        clearMissing(path);
      } catch (error) {
        report(`Couldn't read "${fileNameOf(path)}" back from disk`, error);
      }
    },
    [replaceDocument, markSaved, clearConflict, clearMissing]
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

  /**
   * Puts the kept edits back in the tab, and writes them.
   *
   * Written rather than left sitting there dirty, because `replace` is the
   * "this note has caught up with the file" path and deliberately does not
   * mark anything dirty - the edits would be on screen and still one crash
   * away from being lost. Choosing to restore them is choosing them over what
   * is on disk, so they go to disk.
   */
  const restoreRecovered = useCallback(
    async (path: string) => {
      const kept = recovered.get(path);
      if (kept === undefined) return;

      replaceDocument(path, kept);
      forgetRecovered(path);

      try {
        await writeDocument(path, true);
      } catch (error) {
        report(`Couldn't save the restored edits to "${fileNameOf(path)}"`, error);
      }
    },
    [recovered, replaceDocument, forgetRecovered, writeDocument]
  );

  /** Keeps what was read from disk, and lets the kept edits go. */
  const discardRecovered = useCallback(
    (path: string) => {
      forgetRecovered(path);
    },
    [forgetRecovered]
  );

  /**
   * Which request for a note is the one still being waited on.
   *
   * Opening a note that is not already in memory costs a read, and two clicks
   * in quick succession put two of those in flight at once. Whichever came
   * back last used to be the one applied - so clicking a large note and then
   * a small one left the editor on the large one, because the small one was
   * read and opened while the large one was still coming.
   *
   * Every call takes a number on the way in and checks it is still the latest
   * on the way out. The one that is not has been overtaken, and the note
   * somebody asked for most recently is the note they get.
   */
  const selectionRef = useRef(0);

  const selectFile = useCallback(
    async (path: string) => {
      try {
        // A picture or a document is not a note to put in a tab: one is shown
        // where it is, the other handed to whatever the system opens it with.
        // A file already open as text stays text, however it is named.
        if (!isDocumentOpen(path)) {
          const opener = openerFor(path);
          if (opener === "image") {
            showLightbox(mediaSource(path), fileNameOf(path));
            return;
          }
          if (opener === "system") {
            await invoke("open_with_system", { path });
            return;
          }
        }

        // Taken before anything else, so that going back to the note already
        // on screen overtakes one that is still being read.
        const mine = ++selectionRef.current;
        if (path === currentFileRef.current) return;

        // Only a document that has never been opened costs a read; everything
        // else is already sitting in memory as editor state.
        const firstRead = !isDocumentOpen(path);
        const content = firstRead ? await invoke<string>("read_file", { path }) : null;

        // Overtaken while that read was happening. Dropped rather than opened
        // quietly in the background: `open` swaps what the editor is showing,
        // so applying this now would put a note on screen that nobody is
        // asking for any more.
        if (mine !== selectionRef.current) return;

        leavePlace();
        openDocument(path, content, firstRead ? savedCarets.current[path] : undefined);
        // A note the split was showing has moved across to this pane.
        setSideFile((side) => (side === path ? null : side));

        // "The next time that note is opened" is this: a tab being switched
        // back to is already holding whatever was typed in it, and only a read
        // from disk is a moment where edits from a previous run could have
        // been lost. It is also the only moment worth the round trip.
        if (firstRead) void offerRecovered(path, content ?? "");

        setCurrentFile(path);
        setOpenPaths((paths) => (paths.includes(path) ? paths : [...paths, path]));
        recentRef.current = [path, ...recentRef.current.filter((p) => p !== path)];
      } catch (error) {
        // Not a kind that is known, and not text either. Said plainly rather
        // than as the decoder's complaint about its bytes.
        if (isNotText(error)) report(`"${fileNameOf(path)}" isn't text, so it can't be opened here`);
        else report(`Couldn't open "${fileNameOf(path)}"`, error);
      }
    },
    [isDocumentOpen, openDocument, offerRecovered, leavePlace]
  );

  const sideSelectionRef = useRef(0);

  /**
   * Shows `path` in the split beside the main pane. A note is in one pane at a
   * time, so one that has a tab leaves it for the split, and the note in the
   * main pane cannot be sent there at all. What the split showed before is
   * closed the way a tab is: kept as it stands, and saved if it has edits.
   */
  const openToSide = useCallback(
    async (path: string) => {
      try {
        // There is no putting a picture or a PDF in the split: it opens the
        // way it would from anywhere else.
        if (!isDocumentOpen(path) && openerFor(path) !== "editor") {
          await selectFile(path);
          return;
        }

        const mine = ++sideSelectionRef.current;
        if (path === currentFileRef.current) return;

        const firstRead = !isDocumentOpen(path);
        const content = firstRead ? await invoke<string>("read_file", { path }) : null;

        // Overtaken, or made the main pane's note while it was being read.
        if (mine !== sideSelectionRef.current || path === currentFileRef.current) return;
        if (!openSideDocument(path, content, firstRead ? savedCarets.current[path] : undefined)) return;

        if (firstRead) void offerRecovered(path, content ?? "");
        setSideFile(path);
        setOpenPaths((paths) => paths.filter((p) => p !== path));
        recentRef.current = recentRef.current.filter((p) => p !== path);
      } catch (error) {
        report(`Couldn't open "${fileNameOf(path)}"`, error);
      }
    },
    [isDocumentOpen, openSideDocument, offerRecovered, selectFile]
  );

  const closeSide = useCallback(() => {
    // Whatever was being read for the split is no longer wanted.
    sideSelectionRef.current++;
    closeSideDocument();
    setSideFile(null);
  }, [closeSideDocument]);

  /**
   * The tree, brought back into line with the disk: every folder that has
   * been read is read again, and what is new, gone or renamed since is taken
   * in. This is what makes a file dropped in by a sync client, or made in a
   * terminal, turn up in the sidebar without the vault being opened again -
   * the tree is otherwise only ever changed by what the app itself does.
   *
   * Folders that have not been opened are left unread, as they were.
   */
  const refreshingTree = useRef(0);
  const refreshTree = useCallback(async () => {
    const root = rootPathRef.current;
    if (!root) return;

    const mine = ++refreshingTree.current;
    const folders = [root, ...readFolders(folderDataRef.current)];
    const listings = await Promise.all(
      folders.map(async (path) => {
        try {
          return { path, listed: await invoke<FileEntry[]>("list_folder", { path }) };
        } catch {
          // Gone, or not answering. Its own row goes when the folder above it
          // is read; until then it is left as it was.
          return null;
        }
      })
    );
    // Overtaken by a later read, or the vault was switched meanwhile.
    if (mine !== refreshingTree.current || root !== rootPathRef.current) return;

    setFolderData((tree) => {
      let next = tree;
      for (const listing of listings) {
        if (!listing) continue;
        const had = listing.path === root ? next : findEntry(next, listing.path)?.children;
        if (!had) continue;
        const merged = mergeListing(had, listing.listed);
        if (merged !== had) next = setChildren(next, root, listing.path, merged);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const listening = listenHere(INDEX_CHANGED_EVENT, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refreshTree(), TREE_SETTLE_DELAY);
    });

    return () => {
      clearTimeout(timer);
      void listening.then((stop) => stop());
    };
  }, [refreshTree]);

  /**
   * Opens `path` with the caret on `line` (1-based) at `column`, counted in
   * UTF-16 units the way the editor counts positions - where a search hit in
   * the note's text was found. Left where it opened if something else was
   * asked for while the note was being read, or if the note is shorter now
   * than when it was searched.
   */
  const openAt = useCallback(
    async (path: string, line: number, column: number) => {
      // A hit further down the note already open is a place left as well;
      // one in another note is noted by the switch itself.
      if (path === currentFileRef.current) leavePlace();
      await selectFile(path);
      const view = editorView;
      if (!view || showingDocument() !== path) return;

      const doc = view.state.doc;
      if (line < 1 || line > doc.lines) return;
      const target = doc.line(line);
      const anchor = Math.min(target.from + column, target.to);
      view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: "center" }) });
      view.focus();
    },
    [selectFile, editorView, showingDocument, leavePlace]
  );

  /**
   * Goes back to the place left most recently, or forward again to the one
   * gone back from: the note reopened if its tab has been closed, and the
   * caret put where it was, in the middle of the pane. A place whose note
   * can no longer be opened is passed over for the one before it.
   */
  const retrace = useCallback(
    async (direction: "back" | "forward") => {
      if (retracing.current) return;
      retracing.current = true;
      try {
        for (;;) {
          const here = currentFileRef.current;
          const from = { path: showingDocument(), caret: caretOf(showingDocument()) ?? 0 };
          const moved = step(trail.current, from, direction);
          if (!moved) return;

          // The scratch note is never a place to come back to, so it is not
          // left on the other stack either.
          trail.current =
            here === UNTITLED_FILE
              ? direction === "back"
                ? { ...moved.trail, forward: moved.trail.forward.slice(0, -1) }
                : { ...moved.trail, back: moved.trail.back.slice(0, -1) }
              : moved.trail;

          const { path, caret } = moved.to;
          if (showingDocument() !== path) await selectFile(path);
          const view = editorView;
          if (!view || showingDocument() !== path) continue;

          const anchor = Math.min(caret, view.state.doc.length);
          view.dispatch({
            selection: { anchor },
            effects: EditorView.scrollIntoView(anchor, { y: "center" }),
          });
          view.focus();
          return;
        }
      } finally {
        retracing.current = false;
      }
    },
    [selectFile, editorView, showingDocument, caretOf]
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
      // The scratch note is never really closed - it is kept either way.
      if (path !== UNTITLED_FILE) closedRef.current = rememberClosed(closedRef.current, { path, index });

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

  /**
   * Closes several tabs at once, for "Close Others" and "Close to the Right".
   * Done in one go rather than one `closeFile` after another: each of those
   * reads the tabs as they were when this render started, and the second
   * would put back what the first took away.
   */
  const closeFiles = useCallback(
    (closing: readonly string[]) => {
      const going = new Set(closing);
      const paths = openPathsRef.current;
      const remaining = paths.filter((path) => !going.has(path));
      if (remaining.length === paths.length) return;

      paths.forEach((path, index) => {
        if (going.has(path) && path !== UNTITLED_FILE) {
          closedRef.current = rememberClosed(closedRef.current, { path, index });
        }
      });
      recentRef.current = recentRef.current.filter((path) => !going.has(path));

      if (remaining.length === 0) {
        resetToScratch();
        return;
      }

      setOpenPaths(remaining);
      if (going.has(currentFileRef.current)) {
        const next =
          recentRef.current.find((path) => remaining.includes(path)) ?? remaining[remaining.length - 1];
        void selectFile(next);
      }
    },
    [resetToScratch, selectFile]
  );

  /**
   * Lets go of a note whose file has gone, and of whatever was typed in it:
   * the tab closes, or the split does, and nothing is written. The other
   * answer to a missing file is `keepMine`, which puts it back on disk.
   */
  const discardMissing = useCallback(
    async (path: string) => {
      if (showingSideDocument() === path) {
        sideSelectionRef.current++;
        closeSideDocument();
        setSideFile(null);
      } else {
        const paths = openPathsRef.current;
        const index = paths.indexOf(path);
        if (index === -1) return;

        const remaining = paths.filter((p) => p !== path);
        if (remaining.length === 0) {
          resetToScratch();
        } else {
          // The editor moves on first, and is waited for: the document must
          // not be forgotten while it is still the one on screen.
          if (showingDocument() === path) {
            await selectFile(remaining[index] ?? remaining[remaining.length - 1]);
            // The note to fall back on could not be opened. Better a tab onto
            // a missing file than an editor showing a note with no tab.
            if (showingDocument() === path) return;
          }
          setOpenPaths((open) => open.filter((p) => p !== path));
        }
        recentRef.current = recentRef.current.filter((p) => p !== path);
      }

      forgetDocuments((open) => open === path);
      clearConflict(path);
      clearMissing(path);
      closedRef.current = closedRef.current.filter((tab) => tab.path !== path);
    },
    [
      showingSideDocument,
      showingDocument,
      closeSideDocument,
      resetToScratch,
      selectFile,
      forgetDocuments,
      clearConflict,
      clearMissing,
    ]
  );

  /**
   * Brings back the tab closed most recently, in the place it was closed
   * from. A closed note that has since gone from the vault, or been opened
   * again some other way, is passed over for the one closed before it.
   */
  const reopenClosedTab = useCallback(async () => {
    const open = new Set(openPathsRef.current);
    let tab: ClosedTab | undefined;
    while ((tab = closedRef.current.pop())) {
      const there = fileIndexRef.current.paths.has(tab.path) || findEntry(folderDataRef.current, tab.path);
      if (!open.has(tab.path) && there) break;
    }
    if (!tab) return;

    const { path, index } = tab;
    await selectFile(path);
    setOpenPaths((paths) => placeAt(paths, path, index));
  }, [selectFile]);

  /** Drags a tab to a new place in the strip; the session records the order. */
  const reorderTabs = useCallback((path: string, before: number) => {
    setOpenPaths((paths) => moveTab(paths, path, before));
  }, []);

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
      closedRef.current = closedRef.current.map((tab) => ({ ...tab, path: rename(tab.path) }));
      trail.current = renamePlaces(trail.current, rename);
      savedCarets.current = Object.fromEntries(
        Object.entries(savedCarets.current).map(([kept, caret]) => [rename(kept), caret])
      );
      if (isWithin(currentFileRef.current, from)) setCurrentFile(rename(currentFileRef.current));
      setSideFile((side) => (side && isWithin(side, from) ? rename(side) : side));
      setMissing((paths) => (paths.size === 0 ? paths : new Set(Array.from(paths, rename))));
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

  /**
   * Makes a new note beside the one that is open - or at the top of the vault
   * when nothing from it is - under the first "Untitled" name that is free,
   * and opens it. With no folder open there is nowhere to make one, and the
   * scratch note is what there is to write in.
   */
  const createNote = useCallback(async () => {
    const root = rootPathRef.current;
    if (!root) return;

    const here = currentFileRef.current;
    const parent = here !== UNTITLED_FILE && isWithin(here, root) ? directoryOf(here) || root : root;

    // The names the index and the tree know of in that folder. Neither is
    // sure to be complete, so a name that turns out to be taken is stepped
    // past rather than reported.
    const taken = new Set<string>();
    for (const path of fileIndexRef.current.paths) {
      if (directoryOf(path) === parent) taken.add(fileNameOf(path));
    }
    const listed =
      parent === root ? folderDataRef.current : findEntry(folderDataRef.current, parent)?.children;
    for (const entry of listed ?? []) taken.add(entry.name);

    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        await createFile(parent, untitledName(taken, attempt));
        return;
      } catch (error) {
        if (!String(error).includes("already exists")) {
          report("Couldn't make a new note", error);
          return;
        }
      }
    }
    report("Couldn't find a free name for a new note");
  }, [createFile]);

  /**
   * Copies a note beside itself as "name 1.md" and opens the copy. Edits not
   * yet written are written first, so the copy is of the note as it stands
   * rather than as it was at the last autosave - unless the note is waiting
   * on a changed-on-disk decision, which a duplicate is no reason to make.
   */
  const duplicateEntry = useCallback(
    async (path: string) => {
      if (dirtyPathsRef.current.has(path) && !conflictsRef.current.has(path)) await writeDocument(path);
      const copy = await invoke<string>("duplicate_entry", { path });
      const entry = { name: fileNameOf(copy), path: copy, isDirectory: false };
      setFolderData((tree) => addEntry(tree, rootPathRef.current ?? "", entry));
      await selectFile(copy);
    },
    [writeDocument, selectFile]
  );

  /**
   * Follows a wiki-link: opens the note it names, or - for a name no note in
   * the vault has - creates one beside the note the link is in and opens that,
   * the way a link to a note that is not written yet works in any vault app.
   * A path to nowhere is only reported: which folders to make is a guess.
   */
  useEffect(() => {
    async function follow(event: Event) {
      const { target, heading, fromDirectory, view: origin } = (event as CustomEvent<WikiLinkRequest>).detail;

      // `[[#heading]]`: a heading in the note the link is written in - which,
      // with the split open, is the note in the pane it was followed in, and
      // not always the one in the main pane. It needs no vault to work.
      if (!target) {
        const view = origin ?? editorView;
        if (view === editorView) leavePlace();
        if (heading && view && !jumpToHeading(view, heading)) {
          report(`There's no heading "${heading}" in this note`);
        }
        return;
      }

      const root = rootPathRef.current;
      if (!root) return;

      // Once the note is open: the heading the link goes on to, if it has one.
      const goToHeading = (path: string) => {
        const view = editorView;
        if (!heading || !view || showingDocument() !== path) return;
        if (!jumpToHeading(view, heading)) report(`There's no heading "${heading}" in that note`);
      };

      // The index knows the whole vault; the tree knows a note made a moment
      // ago, before the index has heard of it.
      const known = new Set(fileIndexRef.current.notes);
      const collect = (entries: FileEntry[]) => {
        for (const entry of entries) {
          if (entry.children) collect(entry.children);
          else if (/\.md$/i.test(entry.name)) known.add(entry.path);
        }
      };
      collect(folderDataRef.current);
      const notes = [...known];

      const found = resolveWikiLink(target, notes, root, fromDirectory);
      if (found) {
        await selectFile(found);
        goToHeading(found);
        return;
      }
      if (/[\\/]/.test(target)) {
        report(`There's no note at "${target}"`);
        return;
      }

      try {
        const name = /\.md$/i.test(target) ? target : `${target}.md`;
        await createFile(fromDirectory && isWithin(fromDirectory, root) ? fromDirectory : root, name);
      } catch (error) {
        report(`Couldn't create "${target}"`, error);
      }
    }

    window.addEventListener(WIKI_LINK_EVENT, follow);
    return () => window.removeEventListener(WIKI_LINK_EVENT, follow);
  }, [selectFile, createFile, showingDocument, editorView, leavePlace]);

  /**
   * Opens what `nuza <path>` asked for: a folder as the vault, or a note in
   * the vault it is in - or, if that is not the one open, in its own folder.
   */
  const openTarget = useCallback(
    async (target: OpenTarget) => {
      const plan = planOpen(target, rootPathRef.current);
      if (!plan) return;

      if ("select" in plan) {
        await selectFile(plan.select);
      } else if (!(await openVault(plan.folder, plan.focus))) {
        report(`Couldn't open "${plan.folder}"`);
      }
    },
    [selectFile, openVault]
  );

  // The command run again while the app is open, which hands what it was
  // asked for to this window instead of starting another.
  useEffect(() => {
    const listening = listenHere<OpenTarget>(OPEN_TARGET_EVENT, ({ payload }) => void openTarget(payload));
    return () => {
      void listening.then((unlisten) => unlisten());
    };
  }, [openTarget]);

  /**
   * Reads what is inside a folder the sidebar has just opened. Rejects when the
   * folder did not answer, which the row says; the next time it is opened it
   * is asked again.
   */
  const loadFolder = useCallback(async (path: string) => {
    const root = rootPathRef.current;
    const children = await invoke<FileEntry[]>("list_folder", { path });
    // The vault was switched while the folder was being read.
    if (!root || root !== rootPathRef.current) return;
    setFolderData((tree) => setChildren(tree, root, path, children));
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
      setSideFile((side) => (side && isWithin(side, path) ? null : side));
      setMissing((paths) =>
        paths.size === 0 ? paths : new Set(Array.from(paths).filter((gone) => !isWithin(gone, path)))
      );

      const remaining = openPathsRef.current.filter((p) => !isWithin(p, path));
      recentRef.current = recentRef.current.filter((p) => !isWithin(p, path));
      closedRef.current = closedRef.current.filter((tab) => !isWithin(tab.path, path));
      trail.current = forgetPlaces(trail.current, (place) => isWithin(place, path));

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
    sideContainer,
    sideView,
    sideFile,
    openToSide,
    closeSide,
    viewGeneration,
    subscribeToStats,
    currentFile,
    openPaths,
    dirtyPaths,
    conflicts,
    missing,
    discardMissing,
    folderData,
    fileIndex,
    loadFolder,
    rootPath,
    openFolder,
    openVault,
    openTarget,
    save,
    saveDirty,
    flush,
    selectFile,
    openAt,
    retrace,
    reopenClosedTab,
    reorderTabs,
    closeFile,
    closeFiles,
    cycleFile,
    switchToRecent,
    jumpToFile,
    reloadFromDisk,
    keepMine,
    recovered,
    restoreRecovered,
    discardRecovered,
    createFile,
    createNote,
    createFolder,
    renameEntry,
    duplicateEntry,
    moveEntry,
    deleteEntry,
    attachFiles,
  };
}
