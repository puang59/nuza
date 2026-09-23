import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeMirror, { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { getCM, vim, Vim } from "@replit/codemirror-vim";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import EditorHeader from "./components/EditorHeader";
import StatusBar from "./components/StatusBar";
import Sidebar from "./components/Sidebar";
import SettingsModal from "./components/SettingsModal";
import { useKeymaps, useKeymapListener } from "./hooks/useKeymaps";
import { useFileOperations } from "./hooks/useFileOperations";
import { useAppUpdater } from "./hooks/useAppUpdater";
import { usePersistedState } from "./hooks/usePersistedState";
import { useResizableSidebar } from "./hooks/useResizableSidebar";
import {
  DEFAULT_EDITOR_FONT,
  DEFAULT_EDITOR_FONT_SIZE,
  EDITOR_FONT_SIZE_STEP,
  clampEditorFontSize,
  editorFontFamily,
} from "./lib/fonts";

/** Space between the editor and the sidebar, collapsed with the panel itself. */
const SIDEBAR_GAP = 20;

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
    folderData,
    rootPath,
    openFolder,
    save,
    selectFile,
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

  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const now = new Date().toLocaleString();

  const keymapHandlers = useMemo(
    () => ({
      "toggle-sidebar": () => setIsSidebarOpen((open) => !open),
      "save-file": save,
      "open-folder": openFolder,
      "open-settings": () => setIsSettingsOpen((open) => !open),
      "toggle-vim-mode": () => setVimEnabled((enabled) => !enabled),
      "check-updates": checkForUpdates,
      "increase-font-size": () => setEditorFontSize((size) => clampEditorFontSize(size + EDITOR_FONT_SIZE_STEP)),
      "decrease-font-size": () => setEditorFontSize((size) => clampEditorFontSize(size - EDITOR_FONT_SIZE_STEP)),
    }),
    [save, openFolder, checkForUpdates, setVimEnabled, setEditorFontSize]
  );

  useKeymapListener(keymapBindings, keymapHandlers);

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
        onCheckUpdates={checkForUpdates}
        onInstallUpdate={installUpdate}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onSave={save}
        onToggleSidebar={() => setIsSidebarOpen((open) => !open)}
      />

      <div className="flex-1 min-h-0 px-4 flex w-full relative z-20">
        <div className="flex-1 min-w-0 h-full relative">
          <CodeMirror
            ref={editorRef}
            value={value}
            height="100%"
            theme={oneDark}
            extensions={[markdown(), ...(vimEnabled ? [vim()] : []), EditorView.lineWrapping, editorFontTheme]}
            onChange={setValue}
            className="h-full text-sm border-none outline-none"
            basicSetup={{
              lineNumbers: true,
              foldGutter: false,
              highlightActiveLine: true,
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
