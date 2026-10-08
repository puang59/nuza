import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StateCommand } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import EditorHeader from "./components/EditorHeader";
import StatusBar from "./components/StatusBar";
import WritingStats from "./components/WritingStats";
import Sidebar, { SidebarHandle } from "./components/Sidebar";
import SettingsModal from "./components/SettingsModal";
import FileSearchPalette from "./components/FileSearchPalette";
import ChangedOnDisk from "./components/ChangedOnDisk";
import RecoveredEdits from "./components/RecoveredEdits";
import SidePane from "./components/SidePane";
import Notices from "./components/Notices";
import ContextMenu from "./components/Sidebar/ContextMenu";
import { useKeymaps, useKeymapListener } from "./hooks/useKeymaps";
import { useCloseTabMenu } from "./hooks/useCloseTabMenu";
import { useSaveOnExit } from "./hooks/useSaveOnExit";
import { useNotices } from "./hooks/useNotices";
import { UNTITLED_FILE, useFileOperations } from "./hooks/useFileOperations";
import GettingStarted from "./components/GettingStarted";
import SectionGuides from "./components/SectionGuides";
import type { KeymapAction } from "./lib/keymaps";
import { useVimMode } from "./hooks/useVimMode";
import { useVaults } from "./hooks/useVaults";
import { useAppearance } from "./hooks/useAppearance";
import { useAppUpdater } from "./hooks/useAppUpdater";
import { usePersistedState } from "./hooks/usePersistedState";
import { useRecentFiles } from "./hooks/useRecentFiles";
import { useOutline } from "./hooks/useOutline";
import { hasEmbeds, refreshEmbeds, setVaultFiles } from "./lib/markdown/embedIndex";
import { useResizableSidebar } from "./hooks/useResizableSidebar";
import { report } from "./lib/notices";
import { isMainWindow } from "./lib/windowLabel";
import { addFrontmatter, addProperty, canAddFrontmatter } from "./lib/markdown/addFrontmatter";
import { OpenTarget } from "./lib/launchTarget";
import { wikiLinkText, wikiTargetFor } from "./lib/markdown/wikiLinks";
import { copyText } from "./lib/clipboard";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { relativePath } from "./lib/media";
import { isWithin } from "./lib/path";
import { revealLabel } from "./lib/platform";
import { tabsToClose } from "./lib/tabLabels";
import { directoryOf } from "./lib/markdown";
import { noteLineNumbers } from "./lib/markdown/lineGutter";
import { typewriterScrolling } from "./lib/markdown/scrolling";
import {
  insertLink,
  setHeading,
  toggleBlockquote,
  toggleBold,
  toggleBulletList,
  toggleInlineCode,
  toggleItalic,
  toggleNumberedList,
  toggleStrikethrough,
  toggleTaskList,
} from "./lib/markdown/formatting";
import { jumpToHeadingAt, nextHeading, previousHeading } from "./lib/markdown/headings";
import { isMacPlatform } from "./lib/platform";
import {
  DEFAULT_EDITOR_FONT,
  DEFAULT_CONTENT_WIDTH,
  DEFAULT_EDITOR_FONT_SIZE,
  DEFAULT_LINE_HEIGHT,
  EDITOR_FONT_SIZE_STEP,
  applyTypography,
  clampEditorFontSize,
  editorFontFamily,
} from "./lib/fonts";

/** Space between the editor and the sidebar, collapsed with the panel itself. */
const SIDEBAR_GAP = 12;

function App() {
  const [mode, setMode] = useState<string>("normal");
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isQuickOpenOpen, setIsQuickOpenOpen] = useState(false);
  // Off by default: Vim is something you go and turn on, not something a note
  // taking app should assume about whoever just opened it.
  const [vimEnabled, setVimEnabled] = usePersistedState("vimEnabled", false);
  const [showLineNumbers, setShowLineNumbers] = usePersistedState("showLineNumbers", false);
  const [typewriter, setTypewriter] = usePersistedState("typewriterScrolling", false);
  // Off unless asked for: marks on the writing surface are not something to
  // put in front of everyone.
  const [sectionGuides, setSectionGuides] = usePersistedState("sectionGuides", false);
  const [compactMode, setCompactMode] = usePersistedState("compactMode", false);
  const [autoUpdateEnabled, setAutoUpdateEnabled] = usePersistedState("autoUpdateEnabled", true);
  const [editorFont, setEditorFont] = usePersistedState("editorFont", DEFAULT_EDITOR_FONT);
  const [editorFontSize, setEditorFontSize] = usePersistedState("editorFontSize", DEFAULT_EDITOR_FONT_SIZE);
  const [contentWidth, setContentWidth] = usePersistedState("editorContentWidth", DEFAULT_CONTENT_WIDTH);
  const [lineHeight, setLineHeight] = usePersistedState("editorLineHeight", DEFAULT_LINE_HEIGHT);

  // Read by the editor's theme through the stylesheet, so a slider being
  // dragged restyles the note without the editor being reconfigured.
  useEffect(() => {
    applyTypography(document.documentElement, { contentWidth, lineHeight });
  }, [contentWidth, lineHeight]);

  const { module: vimModule, extension: vimExtension } = useVimMode(vimEnabled);
  const { vaults, remember: rememberVault, rename: renameVault, forget: forgetVault } = useVaults();
  // Assumed until the window has answered, so the app does not flash opaque on
  // the way up on the platforms that do have a backdrop.
  const [hasBackdrop, setHasBackdrop] = useState(true);
  const { appearance, update: setAppearance, reset: resetAppearance } = useAppearance(hasBackdrop);

  // Read by the `compact:` variant in App.css, so flipping it retightens the
  // sidebar and chrome without a single component re-rendering.
  useEffect(() => {
    if (compactMode) document.documentElement.dataset.compact = "";
    else delete document.documentElement.dataset.compact;
  }, [compactMode]);

  const sidebarRef = useRef<SidebarHandle>(null);

  const onFolderOpened = useCallback(
    (path: string) => {
      rememberVault(path);
      setIsSidebarOpen(true);
    },
    [rememberVault]
  );

  const editorFontTheme = useMemo(
    () =>
      EditorView.theme({
        ".cm-scroller": { fontFamily: editorFontFamily(editorFont), fontSize: `${editorFontSize}px` },
      }),
    [editorFont, editorFontSize]
  );

  // Memoised because the editor reconfigures itself whenever this array's
  // identity changes - rebuilding it every render would put the documents
  // through a reconfiguration on every keystroke.
  const editorPreferences = useMemo(
    () => [
      ...(vimExtension ? [vimExtension] : []),
      editorFontTheme,
      ...(showLineNumbers ? [noteLineNumbers] : []),
      ...(typewriter ? [typewriterScrolling] : []),
    ],
    [vimExtension, editorFontTheme, showLineNumbers, typewriter]
  );

  const {
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
    recovered,
    restoreRecovered,
    discardRecovered,
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
    closeFile,
    closeFiles,
    openInNewWindow,
    reopenClosedTab,
    reorderTabs,
    cycleFile,
    switchToRecent,
    jumpToFile,
    reloadFromDisk,
    keepMine,
    createFile,
    createNote,
    createFolder,
    renameEntry,
    duplicateEntry,
    moveEntry,
    deleteEntry,
    attachFiles,
  } = useFileOperations({
    preferences: editorPreferences,
    onFolderOpened,
  });
  const {
    status: updateStatus,
    checkForUpdates,
    installUpdate,
    openDownloadPage,
    openChangelog,
    version,
  } = useAppUpdater({
    autoUpdate: autoUpdateEnabled,
  });
  const {
    bindings: keymapBindings,
    setBinding: setKeymapBinding,
    resetBinding: resetKeymapBinding,
    resetAll: resetAllKeymaps,
  } = useKeymaps();
  const { width: sidebarWidth, isResizing, startResize, resetWidth } = useResizableSidebar();
  const { notices, dismiss: dismissNotice, hold: noticeHold } = useNotices();
  const { recent: recentFiles, record: recordRecentFile } = useRecentFiles();

  // Whatever comes to the front is what was most recently worked in. The
  // scratch note has no path, and is not a file to come back to.
  useEffect(() => {
    if (currentFile) recordRecentFile(currentFile);
  }, [currentFile, recordRecentFile]);

  // What `nuza <path>` started the app on: undefined until the backend has
  // said, then the target or null. It has to be known before the last vault is
  // reopened, or the vault would open first and the command's note after it.
  const [launchTarget, setLaunchTarget] = useState<OpenTarget | null | undefined>(undefined);
  useEffect(() => {
    // The target is handed over once, so when this runs twice - as it does in
    // development, under StrictMode - the second answer is "nothing", and must
    // not take the place of the first.
    invoke<OpenTarget | null>("take_launch_target")
      .then((target) => setLaunchTarget((current) => current ?? target))
      .catch(() => setLaunchTarget((current) => current ?? null));
  }, []);

  // Picking up where you left off: the vault most recently opened is reopened
  // on launch, so the app starts in a folder rather than on an empty picker.
  // A path given on the command line is where it starts instead.
  const reopened = useRef(false);
  useEffect(() => {
    if (reopened.current || launchTarget === undefined) return;

    if (launchTarget) {
      reopened.current = true;
      void openTarget(launchTarget);
      return;
    }

    // A window opened with File > New Window is for a vault of its own choosing:
    // reopening the last one there would put two windows on one vault.
    if (!isMainWindow()) {
      reopened.current = true;
      return;
    }

    // Marked as done only once there was something to do. Setting it on the
    // first run regardless means an empty list - which is what a vault store
    // that answers asynchronously would hand over first - spends the one
    // chance this has to reopen anything.
    const [lastUsed] = vaults;
    if (!lastUsed) return;

    reopened.current = true;
    void openVault(lastUsed.path);
  }, [vaults, openVault, openTarget, launchTarget]);

  // The native effect only has to be on while something is meant to show
  // through; the amount itself is painted by the window's own background.
  //
  // Deliberately keyed on the switch rather than on the amount: applying it
  // hangs a fresh NSVisualEffectView off the window, so depending on the number
  // would rebuild the window's backing layer on every frame of a slider drag.
  const wantsTransparency = appearance.transparency > 0;
  useEffect(() => {
    invoke<boolean>("set_transparency", { enabled: wantsTransparency })
      .then(setHasBackdrop)
      .catch((error) => {
        report("Couldn't change the window transparency", error);
        setHasBackdrop(false);
      });
  }, [wantsTransparency]);

  // An embed names a file, and which file that is depends on what the vault
  // holds. The editors are told when that changes, and when a note comes to
  // the front that may have been drawn before the list was known - but only
  // a note with an embed in it is put through being drawn again.
  const vaultFileList = fileIndex.files;
  useEffect(() => {
    setVaultFiles(
      rootPath ?? "",
      vaultFileList.map((file) => file.path)
    );
    for (const view of [editorView, sideView]) {
      if (view && hasEmbeds(view.state.doc)) view.dispatch({ effects: refreshEmbeds.of(null) });
    }
  }, [rootPath, vaultFileList, editorView, sideView, sideFile, viewGeneration]);

  // The open note's file, for the footer's "edited a while ago". The scratch
  // note has none.
  const notePath = rootPath && isWithin(currentFile, rootPath) ? currentFile : null;

  const outline = useOutline(editorView);
  const onJumpToHeading = useCallback(
    (from: number) => {
      if (editorView) jumpToHeadingAt(editorView, from);
    },
    [editorView]
  );

  /**
   * Moves by heading in whichever pane has the keyboard - the main one when
   * neither does, since the chord works from the sidebar too.
   */
  const moveByHeading = useCallback(
    (move: (view: EditorView) => boolean) => {
      const view = sideView?.hasFocus ? sideView : editorView;
      if (view) move(view);
    },
    [editorView, sideView]
  );

  // Stable identities, so the memoised chrome around the editor is not
  // re-rendered by a handler that was rebuilt for no reason.
  const returnFocusToEditor = useCallback(() => editorView?.focus(), [editorView]);

  /**
   * Where the editor's own menu is open, if it is. It stands in for the
   * webview's, so it carries cut, copy and paste as that one did, alongside
   * what is nuza's own. A right-click inside a property's field still gets
   * the webview's - that is a text box, with a text box's menu.
   */
  const [editorMenu, setEditorMenu] = useState<{ x: number; y: number; view: EditorView } | null>(null);
  /** The editor the link picker was opened from, for the link to be written into. */
  const [linkView, setLinkView] = useState<EditorView | null>(null);
  const closeEditorMenu = useCallback(() => setEditorMenu(null), []);
  /** Whether the note picker for a new wiki-link is open. */
  const [isLinkPickerOpen, setIsLinkPickerOpen] = useState(false);

  const openEditorMenu = useCallback((event: React.MouseEvent, view: EditorView | null) => {
    if (!view) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
    setEditorMenu({ x: event.clientX, y: event.clientY, view });
  }, []);

  const selectedText = useCallback(
    (view: EditorView) =>
      view.state.selection.ranges.map((range) => view.state.sliceDoc(range.from, range.to)).join("\n"),
    []
  );

  const copySelection = useCallback(
    async (view: EditorView, cut: boolean) => {
      try {
        await copyText(selectedText(view));
        if (cut) view.dispatch(view.state.replaceSelection(""), { userEvent: "delete.cut" });
      } catch (error) {
        report(cut ? "Couldn't cut that" : "Couldn't copy that", error);
      }
      view.focus();
    },
    [selectedText]
  );

  // Pasted through the editor's own paste handling, as a keyboard paste is,
  // so lists continue and nothing arrives as anything but text.
  const pasteClipboard = useCallback(async (view: EditorView) => {
    view.focus();
    try {
      const text = await navigator.clipboard.readText();
      view.dispatch(view.state.replaceSelection(text), { userEvent: "input.paste" });
    } catch (error) {
      report(`Couldn't paste from here - ${isMacPlatform() ? "⌘" : "Ctrl+"}V still works`, error);
    }
  }, []);

  /**
   * Writes a link to the chosen note where the caret is - by name, or by path
   * where another note of that name would be found first - with any selected
   * text as the link's label.
   */
  const linkToNote = useCallback(
    (path: string) => {
      const view = linkView ?? editorView;
      if (!view || !rootPath) return;
      const notes = fileIndex.notes;

      // Resolved from the folder of the note the link is going into, which in
      // the split is not the one in the main pane.
      const writingIn = view === sideView && sideFile ? sideFile : currentFile;
      const target = wikiTargetFor(path, notes, rootPath, directoryOf(writingIn) || rootPath);
      const { from, to } = view.state.selection.main;
      const insert = wikiLinkText(target, view.state.sliceDoc(from, to));
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
        userEvent: "input",
      });
      view.focus();
    },
    [linkView, editorView, sideView, sideFile, rootPath, fileIndex.notes, currentFile]
  );

  /** Where a tab's own menu is open, and for which tab. */
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const openTabMenu = useCallback((path: string, x: number, y: number) => setTabMenu({ x, y, path }), []);
  const closeTabMenu = useCallback(() => setTabMenu(null), []);

  const tabMenuItems = useCallback(
    (path: string) => {
      // The scratch note has no file: nothing to show in a folder, no path to copy.
      const isFile = !!rootPath && isWithin(path, rootPath);
      const copy = (text: string) =>
        void copyText(text).catch((error) => report("Couldn't copy that", error));
      const others = tabsToClose(openPaths, path, "others");
      const toTheRight = tabsToClose(openPaths, path, "right");

      return [
        { label: "Close", onClick: () => closeFile(path) },
        ...(others.length ? [{ label: "Close Others", onClick: () => closeFiles(others) }] : []),
        ...(toTheRight.length
          ? [{ label: "Close to the Right", onClick: () => closeFiles(toTheRight) }]
          : []),
        ...(isFile
          ? [
              ...(path !== currentFile
                ? [{ label: "Open to the Side", onClick: () => void openToSide(path) }]
                : []),
              { label: "Move to New Window", onClick: () => void openInNewWindow(path, true) },
              {
                label: revealLabel(),
                onClick: () =>
                  void revealItemInDir(path).catch((error) => report("Couldn't show that file", error)),
              },
              { label: "Copy Path", onClick: () => copy(path) },
              { label: "Copy Relative Path", onClick: () => copy(relativePath(rootPath ?? "", path)) },
            ]
          : []),
      ];
    },
    [rootPath, openPaths, currentFile, closeFile, closeFiles, openToSide, openInNewWindow]
  );

  const editorMenuItems = useCallback(
    (view: EditorView) => {
      const hasSelection = view.state.selection.ranges.some((range) => !range.empty);
      return [
        ...(hasSelection
          ? [
              { label: "Cut", onClick: () => void copySelection(view, true) },
              { label: "Copy", onClick: () => void copySelection(view, false) },
            ]
          : []),
        { label: "Paste", onClick: () => void pasteClipboard(view) },
        ...(rootPath
          ? [
              {
                label: "Link to Note…",
                onClick: () => {
                  setLinkView(view);
                  setIsLinkPickerOpen(true);
                },
              },
            ]
          : []),
        canAddFrontmatter(view)
          ? { label: "Add Frontmatter", onClick: () => addFrontmatter(view) }
          : { label: "Add Property", onClick: () => addProperty(view) },
      ];
    },
    [rootPath, copySelection, pasteClipboard]
  );

  /**
   * Opening the panel puts the keyboard in it, and closing it gives the
   * keyboard back - a collapsed sidebar is `inert`, so focus left inside one
   * would be focus nowhere at all, and the next keystroke would go to the
   * window rather than to the note.
   */
  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((open) => {
      if (open) returnFocusToEditor();
      else sidebarRef.current?.focusTree();
      return !open;
    });
  }, [returnFocusToEditor]);
  const openSettings = useCallback(() => setIsSettingsOpen(true), []);
  const closeQuickOpen = useCallback(() => setIsQuickOpenOpen(false), []);

  // Named rather than inlined into the handler table: the macOS menu bar needs
  // the same action, since ⌘W is a key equivalent there and never reaches the
  // keymap listener.
  const closeCurrentTab = useCallback(() => closeFile(currentFile), [closeFile, currentFile]);

  /**
   * Runs a formatting command on the note, when the note is what has the
   * keyboard. The chords fire everywhere else too - they carry a modifier -
   * and bolding the note from the sidebar's rename box would be a surprise.
   */
  const format = useCallback(
    (command: StateCommand) => {
      const focused = editorView?.hasFocus ? editorView : sideView?.hasFocus ? sideView : null;
      if (focused) command(focused);
    },
    [editorView, sideView]
  );

  /**
   * Prints the open note. CodeMirror only draws the lines near the screen, and
   * draws the whole note while printing - which it learns from `beforeprint`,
   * an event the native print panel does not always send. So it is sent here
   * first, and the note is laid out in full before the panel reads it.
   */
  const printNote = useCallback(() => {
    window.dispatchEvent(new Event("beforeprint"));
    invoke("print_page").catch((error) => report("Couldn't open the print dialog", error));
  }, []);

  const keymapHandlers = useMemo(
    () => ({
      "toggle-sidebar": toggleSidebar,
      "save-file": save,
      "open-folder": openFolder,
      "quick-open": () => setIsQuickOpenOpen((open) => !open),
      "search-files": () => {
        // The panel has to be open - and un-`inert` - before its input can
        // take focus, which is why the sidebar defers the focus itself.
        setIsSidebarOpen(true);
        sidebarRef.current?.focusSearch();
      },
      "new-window": () =>
        void invoke("open_new_window").catch((error) => report("Couldn't open a window", error)),
      "open-settings": () => setIsSettingsOpen((open) => !open),
      "toggle-vim-mode": () => setVimEnabled((enabled) => !enabled),
      "check-updates": checkForUpdates,
      "increase-font-size": () =>
        setEditorFontSize((size) => clampEditorFontSize(size + EDITOR_FONT_SIZE_STEP)),
      "decrease-font-size": () =>
        setEditorFontSize((size) => clampEditorFontSize(size - EDITOR_FONT_SIZE_STEP)),
      "next-tab": () => cycleFile(1),
      "previous-tab": () => cycleFile(-1),
      "recent-tab": switchToRecent,
      "close-tab": closeCurrentTab,
      "reopen-closed-tab": () => void reopenClosedTab(),
      "go-back": () => void retrace("back"),
      "go-forward": () => void retrace("forward"),
      "new-note": () => void createNote(),
      "reset-font-size": () => setEditorFontSize(DEFAULT_EDITOR_FONT_SIZE),
      "toggle-inline-code": () => format(toggleInlineCode),
      "toggle-strikethrough": () => format(toggleStrikethrough),
      "toggle-bullet-list": () => format(toggleBulletList),
      "toggle-numbered-list": () => format(toggleNumberedList),
      "toggle-task-list": () => format(toggleTaskList),
      "toggle-blockquote": () => format(toggleBlockquote),
      "heading-1": () => format(setHeading(1)),
      "heading-2": () => format(setHeading(2)),
      "heading-3": () => format(setHeading(3)),
      "heading-4": () => format(setHeading(4)),
      "heading-5": () => format(setHeading(5)),
      "heading-6": () => format(setHeading(6)),
      "heading-none": () => format(setHeading(0)),
      "toggle-bold": () => format(toggleBold),
      "toggle-italic": () => format(toggleItalic),
      "insert-link": () => format(insertLink),
      "print-note": printNote,
      "next-heading": () => moveByHeading(nextHeading),
      "previous-heading": () => moveByHeading(previousHeading),
    }),
    [
      save,
      openFolder,
      checkForUpdates,
      setVimEnabled,
      setEditorFontSize,
      cycleFile,
      switchToRecent,
      closeCurrentTab,
      reopenClosedTab,
      toggleSidebar,
      format,
      printNote,
      moveByHeading,
      createNote,
      retrace,
    ]
  );

  useKeymapListener(keymapBindings, keymapHandlers);

  /** Does what an action's keys would, for something on screen that offers it. */
  const runAction = useCallback(
    (action: KeymapAction) => (keymapHandlers as Partial<Record<KeymapAction, () => void>>)[action]?.(),
    [keymapHandlers]
  );

  // The two extra buttons on the side of a mouse, which go back and forward
  // everywhere else they are found.
  useEffect(() => {
    function onMouseUp(event: MouseEvent) {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      void retrace(event.button === 3 ? "back" : "forward");
    }

    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, [retrace]);
  useCloseTabMenu(keymapBindings["close-tab"], closeCurrentTab);
  useSaveOnExit(flush);

  // mod+1..8 jump to that tab and mod+9 to the last, matching what browsers and
  // editors do. These stay fixed rather than joining the rebindable keymap list,
  // which would mean nine near-identical rows in Settings for a convention
  // nobody reassigns.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const usesMod = isMacPlatform() ? event.metaKey : event.ctrlKey;
      if (!usesMod || event.altKey || event.shiftKey) return;
      if (event.key < "1" || event.key > "9") return;

      event.preventDefault();
      jumpToFile(event.key === "9" ? -1 : Number(event.key) - 1);
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [jumpToFile]);

  // The Vim adapter only exists on the editor while the extension is part of
  // its configuration, so the mode indicator is wired up after the editor has
  // been reconfigured rather than when it was first created. Opening a document
  // builds a new adapter, which is what viewGeneration follows: without it the
  // listener stays on the adapter the old document left behind and the
  // indicator sits on whichever mode it was last told about.
  useEffect(() => {
    if (!vimModule || !vimEnabled || !editorView) return;

    const cm = vimModule.getCM(editorView);
    if (!cm) return;

    // A new adapter starts in normal mode, whatever the last one was showing.
    setMode("normal");

    const onModeChange = (event: { mode: string }) => setMode(event.mode);
    cm.on("vim-mode-change", onModeChange);
    return () => cm.off("vim-mode-change", onModeChange);
  }, [vimModule, vimEnabled, editorView, viewGeneration]);

  useEffect(() => {
    if (!vimModule) return;
    vimModule.Vim.defineEx("write", "w", async () => {
      await save();
    });
    // `:wa` means every buffer, not just the one in front of you.
    vimModule.Vim.defineEx("wall", "wa", async () => {
      await saveDirty();
    });
    // `]]` and `[[`: by section, as they move in Vim through a file of them.
    vimModule.Vim.defineAction("nuzaNextHeading", (cm: { cm6: EditorView }) => void nextHeading(cm.cm6));
    vimModule.Vim.defineAction(
      "nuzaPreviousHeading",
      (cm: { cm6: EditorView }) => void previousHeading(cm.cm6)
    );
    vimModule.Vim.mapCommand("]]", "action", "nuzaNextHeading", {}, { context: "normal" });
    vimModule.Vim.mapCommand("[[", "action", "nuzaPreviousHeading", {}, { context: "normal" });
  }, [vimModule, save, saveDirty]);

  return (
    <main
      className="h-screen flex flex-col text-white overflow-hidden print:block print:h-auto print:overflow-visible"
      style={{ backgroundColor: "var(--nuza-bg-alpha)" }}
    >
      <div className="contents print:hidden">
        <EditorHeader
          updateStatus={updateStatus}
          version={version}
          openPaths={openPaths}
          currentFile={currentFile}
          dirtyPaths={dirtyPaths}
          missingPaths={missing}
          onSelectTab={selectFile}
          onCloseTab={closeFile}
          onReorderTabs={reorderTabs}
          onTabMenu={openTabMenu}
          onCheckUpdates={checkForUpdates}
          onInstallUpdate={installUpdate}
          onOpenSettings={openSettings}
          onSave={save}
          onToggleSidebar={toggleSidebar}
        />
      </div>

      <div className="flex-1 min-h-0 px-4 flex w-full relative z-20 print:block print:p-0">
        {/* The editor sits a shade below the surrounding chrome so the writing
            surface reads as the deepest layer, with the sidebar and the bars
            above it. Tinted rather than filled so window vibrancy still shows
            through when transparency is on. */}
        <div className="flex-1 min-w-0 h-full relative flex overflow-hidden rounded-t-lg bg-[var(--nuza-editor-tint)] print:block print:h-auto print:overflow-visible print:rounded-none print:bg-transparent">
          <div className="relative flex min-w-0 flex-1 flex-col print:block">
            {/* Above the text rather than over it: the note underneath is what
              the choice is about, and covering it would be a poor way to ask. */}
            <div className="contents print:hidden">
              <ChangedOnDisk
                path={conflicts.has(currentFile) || missing.has(currentFile) ? currentFile : null}
                missing={missing.has(currentFile)}
                onReload={() => void reloadFromDisk(currentFile)}
                onKeepMine={() => void keepMine(currentFile)}
                onDiscard={() => void discardMissing(currentFile)}
              />
              {/* Under the conflict bar, on the rare occasion both are up: the
              one about what is happening now comes before the one about what
              happened last time. */}
              <RecoveredEdits
                path={recovered.has(currentFile) ? currentFile : null}
                onRestore={() => void restoreRecovered(currentFile)}
                onDiscard={() => discardRecovered(currentFile)}
              />
            </div>
            {/* CodeMirror mounts itself in here and owns the document from then
              on. Nothing about the text passes back through React, which is
              what keeps a keystroke from costing anything at the app level. */}
            {/* The split's name bar takes this much from its pane, and this keeps
                the first line of each at the same height. */}
            {sideFile && <div className="h-8 shrink-0 print:hidden" aria-hidden />}
            <div
              ref={editorContainer}
              onContextMenu={(event) => openEditorMenu(event, editorView)}
              className="flex-1 min-h-0 print:h-auto"
            />
            {sectionGuides && <SectionGuides outline={outline} onJump={onJumpToHeading} />}
            <GettingStarted
              onScratch={currentFile === UNTITLED_FILE}
              hasVault={!!rootPath}
              subscribeToStats={subscribeToStats}
              bindings={keymapBindings}
              onRun={runAction}
            />
          </div>

          {/* The split: a second note beside the first, with its own editor. */}
          {sideFile && (
            <SidePane
              path={sideFile}
              isDirty={dirtyPaths.has(sideFile)}
              hasConflict={conflicts.has(sideFile)}
              isMissing={missing.has(sideFile)}
              onDiscardMissing={() => void discardMissing(sideFile)}
              hasRecovered={recovered.has(sideFile)}
              containerRef={sideContainer}
              onContextMenu={(event) => openEditorMenu(event, sideView)}
              onClose={closeSide}
              onReload={() => void reloadFromDisk(sideFile)}
              onKeepMine={() => void keepMine(sideFile)}
              onRestore={() => void restoreRecovered(sideFile)}
              onDiscard={() => discardRecovered(sideFile)}
            />
          )}

          {tabMenu && (
            <ContextMenu
              x={tabMenu.x}
              y={tabMenu.y}
              items={tabMenuItems(tabMenu.path)}
              onClose={closeTabMenu}
            />
          )}

          {editorMenu && (
            <ContextMenu
              x={editorMenu.x}
              y={editorMenu.y}
              items={editorMenuItems(editorMenu.view)}
              onClose={closeEditorMenu}
            />
          )}
        </div>

        {/*
          The sidebar stays mounted so it can animate closed as well as open;
          `inert` keeps the collapsed copy out of tab order and off screen
          readers. The gap between editor and sidebar lives in here too, so it
          collapses along with the panel instead of leaving a dead strip.
        */}
        <div
          className={`h-full shrink-0 overflow-hidden print:hidden ${isResizing ? "" : "sidebar-transition"}`}
          style={{ width: isSidebarOpen ? sidebarWidth + SIDEBAR_GAP : 0 }}
          inert={!isSidebarOpen}
        >
          <div className="h-full" style={{ width: sidebarWidth + SIDEBAR_GAP, paddingLeft: SIDEBAR_GAP }}>
            <Sidebar
              ref={sidebarRef}
              data={folderData}
              searchTree={fileIndex.tree}
              notes={fileIndex.notes}
              onLoadFolder={loadFolder}
              rootPath={rootPath}
              onOpenFolder={openFolder}
              onFileSelect={selectFile}
              onOpenToSide={(path) => void openToSide(path)}
              onOpenInWindow={(path) => void openInNewWindow(path)}
              onOpenAt={(path, line, column) => void openAt(path, line, column)}
              currentFile={currentFile}
              onCreateFile={createFile}
              onCreateFolder={createFolder}
              onRename={renameEntry}
              onDuplicate={duplicateEntry}
              onDelete={deleteEntry}
              onMove={moveEntry}
              onAttachFiles={attachFiles}
              vaults={vaults}
              onSelectVault={openVault}
              onRenameVault={renameVault}
              onForgetVault={forgetVault}
              onResizeStart={startResize}
              onResizeReset={resetWidth}
              isResizing={isResizing}
              outline={outline}
              onJumpToHeading={onJumpToHeading}
              vimEnabled={vimEnabled}
              onReturnFocus={returnFocusToEditor}
            />
          </div>
        </div>
      </div>

      {/* The Vim bar earns its place for someone who is tracking a mode;
          without Vim there is no mode to track, so the footer steps back to
          what a writer actually wants from it. */}
      <div className="contents print:hidden">
        {vimEnabled ? (
          <StatusBar
            mode={mode}
            currentFile={currentFile}
            subscribeToStats={subscribeToStats}
            notePath={notePath}
            saved={!dirtyPaths.has(currentFile)}
          />
        ) : (
          <WritingStats
            subscribeToStats={subscribeToStats}
            notePath={notePath}
            saved={!dirtyPaths.has(currentFile)}
          />
        )}
      </div>

      <FileSearchPalette
        isOpen={isQuickOpenOpen}
        onClose={closeQuickOpen}
        data={fileIndex.tree}
        openPaths={openPaths}
        recentPaths={recentFiles}
        currentFile={currentFile}
        onSelect={(path, beside) => void (beside ? openToSide(path) : selectFile(path))}
      />

      <FileSearchPalette
        isOpen={isLinkPickerOpen}
        onClose={() => {
          setIsLinkPickerOpen(false);
          (linkView ?? editorView)?.focus();
        }}
        data={fileIndex.tree}
        openPaths={openPaths}
        recentPaths={recentFiles}
        currentFile={currentFile}
        onSelect={linkToNote}
        placeholder="Link to a note"
        notesOnly
      />

      <div className="contents print:hidden">
        <Notices notices={notices} onDismiss={dismissNotice} hold={noticeHold} />
      </div>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        vimEnabled={vimEnabled}
        setVimEnabled={setVimEnabled}
        showLineNumbers={showLineNumbers}
        setShowLineNumbers={setShowLineNumbers}
        typewriterScrolling={typewriter}
        setTypewriterScrolling={setTypewriter}
        sectionGuides={sectionGuides}
        setSectionGuides={setSectionGuides}
        appearance={appearance}
        setAppearance={setAppearance}
        resetAppearance={resetAppearance}
        compactMode={compactMode}
        setCompactMode={setCompactMode}
        autoUpdateEnabled={autoUpdateEnabled}
        setAutoUpdateEnabled={setAutoUpdateEnabled}
        editorFont={editorFont}
        setEditorFont={setEditorFont}
        editorFontSize={editorFontSize}
        setEditorFontSize={(size) => setEditorFontSize(clampEditorFontSize(size))}
        contentWidth={contentWidth}
        setContentWidth={setContentWidth}
        lineHeight={lineHeight}
        setLineHeight={setLineHeight}
        keymapBindings={keymapBindings}
        setKeymapBinding={setKeymapBinding}
        resetKeymapBinding={resetKeymapBinding}
        resetAllKeymaps={resetAllKeymaps}
        updateStatus={updateStatus}
        appVersion={version}
        onCheckUpdates={checkForUpdates}
        onOpenDownloadPage={openDownloadPage}
        onOpenChangelog={openChangelog}
      />
    </main>
  );
}

export default App;
