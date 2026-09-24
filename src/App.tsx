import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeMirror, { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { getCM, vim, Vim } from "@replit/codemirror-vim";
import { EditorView } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import EditorHeader from "./components/EditorHeader";
import StatusBar from "./components/StatusBar";
import Sidebar, { SidebarHandle } from "./components/Sidebar";
import SettingsModal from "./components/SettingsModal";
import { useKeymaps, useKeymapListener } from "./hooks/useKeymaps";
import { useFileOperations } from "./hooks/useFileOperations";
import { useAppUpdater } from "./hooks/useAppUpdater";
import { usePersistedState } from "./hooks/usePersistedState";
import { useResizableSidebar } from "./hooks/useResizableSidebar";
import { directoryOf, liveMarkdown, noteDirectory } from "./lib/markdown";
import { isMacPlatform } from "./lib/platform";
import {
  DEFAULT_EDITOR_FONT,
  DEFAULT_EDITOR_FONT_SIZE,
  EDITOR_FONT_SIZE_STEP,
  clampEditorFontSize,
  editorFontFamily,
} from "./lib/fonts";

/** Space between the editor and the sidebar, collapsed with the panel itself. */
const SIDEBAR_GAP = 12;

/** Built once: a fresh instance would reset Vim's state on every rebuild. */
const vimExtension = vim();

function App() {
  const [mode, setMode] = useState<string>("normal");
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [vimEnabled, setVimEnabled] = usePersistedState("vimEnabled", true);
  const [transparencyEnabled, setTransparencyEnabled] = usePersistedState("transparencyEnabled", true);
  const [autoUpdateEnabled, setAutoUpdateEnabled] = usePersistedState("autoUpdateEnabled", true);
  const [editorFont, setEditorFont] = usePersistedState("editorFont", DEFAULT_EDITOR_FONT);
  const [editorFontSize, setEditorFontSize] = usePersistedState("editorFontSize", DEFAULT_EDITOR_FONT_SIZE);

  const {
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
  } = useFileOperations({
    onFolderOpened: () => setIsSidebarOpen(true),
  });
  const { status: updateStatus, checkForUpdates, installUpdate, openDownloadPage, version } = useAppUpdater({
    autoUpdate: autoUpdateEnabled,
  });
  const { bindings: keymapBindings, setBinding: setKeymapBinding, resetBinding: resetKeymapBinding, resetAll: resetAllKeymaps } = useKeymaps();
  const { width: sidebarWidth, isResizing, startResize, resetWidth } = useResizableSidebar();

  useEffect(() => {
    invoke("set_transparency", { enabled: transparencyEnabled }).catch((error) => {
      console.error("Failed to update transparency:", error);
    });
  }, [transparencyEnabled]);

  const editorFontTheme = useMemo(
    () =>
      EditorView.theme({
        ".cm-scroller": { fontFamily: editorFontFamily(editorFont), fontSize: `${editorFontSize}px` },
      }),
    [editorFont, editorFontSize]
  );

  // Memoised because CodeMirror reconfigures itself whenever this array's
  // identity changes - rebuilding it every render would throw away the
  // rendered document and the Vim state on each keystroke.
  const editorExtensions = useMemo(
    () => [
      liveMarkdown,
      noteDirectory.of(directoryOf(currentFile)),
      ...(vimEnabled ? [vimExtension] : []),
      editorFontTheme,
    ],
    [currentFile, vimEnabled, editorFontTheme]
  );

  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const sidebarRef = useRef<SidebarHandle>(null);
  const now = new Date().toLocaleString();

  const keymapHandlers = useMemo(
    () => ({
      "toggle-sidebar": () => setIsSidebarOpen((open) => !open),
      "save-file": save,
      "open-folder": openFolder,
      "search-files": () => {
        // The panel has to be open - and un-`inert` - before its input can
        // take focus, which is why the sidebar defers the focus itself.
        setIsSidebarOpen(true);
        sidebarRef.current?.focusSearch();
      },
      "open-settings": () => setIsSettingsOpen((open) => !open),
      "toggle-vim-mode": () => setVimEnabled((enabled) => !enabled),
      "check-updates": checkForUpdates,
      "increase-font-size": () => setEditorFontSize((size) => clampEditorFontSize(size + EDITOR_FONT_SIZE_STEP)),
      "decrease-font-size": () => setEditorFontSize((size) => clampEditorFontSize(size - EDITOR_FONT_SIZE_STEP)),
      "next-tab": () => cycleFile(1),
      "previous-tab": () => cycleFile(-1),
      "recent-tab": switchToRecent,
      "close-tab": () => closeFile(currentFile),
    }),
    [save, openFolder, checkForUpdates, setVimEnabled, setEditorFontSize, cycleFile, switchToRecent, closeFile, currentFile]
  );

  useKeymapListener(keymapBindings, keymapHandlers);

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

  const handleEditorCreated = useCallback(
    (view: EditorView) => {
      const cm = getCM(view);
      if (!cm) return;
      // @ts-ignore - codemirror-vim's event isn't typed
      cm.on("vim-mode-change", (e) => setMode(e.mode));

      Vim.defineEx("write", "w", async () => {
        await save();
      });
      Vim.defineEx("wall", "wa", async () => {
        await save();
      });
    },
    [save]
  );

  return (
    <main className={`h-screen flex flex-col text-white overflow-hidden ${transparencyEnabled ? "bg-transparent" : "bg-[#1E1E1E]"}`}>
      <EditorHeader
        updateStatus={updateStatus}
        version={version}
        openPaths={openPaths}
        currentFile={currentFile}
        dirtyPaths={dirtyPaths}
        onSelectTab={selectFile}
        onCloseTab={closeFile}
        onCheckUpdates={checkForUpdates}
        onInstallUpdate={installUpdate}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onSave={save}
        onToggleSidebar={() => setIsSidebarOpen((open) => !open)}
      />

      <div className="flex-1 min-h-0 px-4 flex w-full relative z-20">
        {/* The editor sits a shade below the surrounding chrome so the writing
            surface reads as the deepest layer, with the sidebar and the bars
            above it. Tinted rather than filled so window vibrancy still shows
            through when transparency is on. */}
        <div className="flex-1 min-w-0 h-full relative overflow-hidden rounded-t-lg bg-black/20">
          <CodeMirror
            ref={editorRef}
            value={value}
            height="100%"
            theme="none"
            extensions={editorExtensions}
            onChange={setValue}
            className="h-full border-none outline-none"
            basicSetup={{
              // Nothing in the margins and nothing highlighted: the rendered
              // markdown is the only thing on screen worth looking at.
              lineNumbers: false,
              foldGutter: false,
              highlightActiveLine: false,
              highlightActiveLineGutter: false,
            }}
            onCreateEditor={handleEditorCreated}
          />
        </div>

        {/*
          The sidebar stays mounted so it can animate closed as well as open;
          `inert` keeps the collapsed copy out of tab order and off screen
          readers. The gap between editor and sidebar lives in here too, so it
          collapses along with the panel instead of leaving a dead strip.
        */}
        <div
          className={`h-full shrink-0 overflow-hidden ${isResizing ? "" : "sidebar-transition"}`}
          style={{ width: isSidebarOpen ? sidebarWidth + SIDEBAR_GAP : 0 }}
          inert={!isSidebarOpen}
        >
          <div className="h-full" style={{ width: sidebarWidth + SIDEBAR_GAP, paddingLeft: SIDEBAR_GAP }}>
            <Sidebar
              ref={sidebarRef}
              data={folderData}
              rootPath={rootPath}
              onOpenFolder={openFolder}
              onFileSelect={selectFile}
              currentFile={currentFile}
              onCreateFile={createFile}
              onCreateFolder={createFolder}
              onRename={renameEntry}
              onDelete={deleteEntry}
              onMove={moveEntry}
              onResizeStart={startResize}
              onResizeReset={resetWidth}
              isResizing={isResizing}
            />
          </div>
        </div>
      </div>

      <StatusBar vimEnabled={vimEnabled} mode={mode} currentFile={currentFile} timestamp={now} />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        vimEnabled={vimEnabled}
        setVimEnabled={setVimEnabled}
        transparencyEnabled={transparencyEnabled}
        setTransparencyEnabled={setTransparencyEnabled}
        autoUpdateEnabled={autoUpdateEnabled}
        setAutoUpdateEnabled={setAutoUpdateEnabled}
        editorFont={editorFont}
        setEditorFont={setEditorFont}
        editorFontSize={editorFontSize}
        setEditorFontSize={(size) => setEditorFontSize(clampEditorFontSize(size))}
        keymapBindings={keymapBindings}
        setKeymapBinding={setKeymapBinding}
        resetKeymapBinding={resetKeymapBinding}
        resetAllKeymaps={resetAllKeymaps}
        updateStatus={updateStatus}
        appVersion={version}
        onCheckUpdates={checkForUpdates}
        onOpenDownloadPage={openDownloadPage}
      />
    </main>
  );
}

export default App;
