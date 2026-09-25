import { memo } from "react";
import { ArrowDownCircle, PanelLeft, RefreshCw, Save, Settings } from "lucide-react";
import { UpdateStatus } from "@/hooks/useAppUpdater";
import { isMacPlatform } from "@/lib/platform";
import TabBar from "./TabBar";

interface EditorHeaderProps {
  updateStatus: UpdateStatus;
  version: string | null;
  openPaths: string[];
  currentFile: string;
  dirtyPaths: ReadonlySet<string>;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onCheckUpdates: () => void;
  onInstallUpdate: () => void;
  onOpenSettings: () => void;
  onSave: () => void;
  onToggleSidebar: () => void;
}

/** Short label shown next to the update icon for states worth surfacing. */
function updateLabel(status: UpdateStatus, version: string | null) {
  switch (status.state) {
    case "checking":
      return "Checking…";
    case "up-to-date":
      return "Up to date";
    case "error":
      return "Update failed";
    case "downloading":
      return status.progress === null
        ? `Downloading v${status.version}`
        : `Downloading v${status.version} ${status.progress}%`;
    default:
      return version ? `v${version}` : null;
  }
}

/**
 * The version/update control: checks for updates, or offers a restart once one is
 * downloaded. On macOS our builds aren't notarized, so the plugin's self-install
 * gets silently blocked by Gatekeeper - instead of a button that appears to do
 * nothing, mac users just see a quiet "Update available" hint that opens Settings,
 * where they're guided through downloading the new build by hand.
 */
function UpdateButton({
  status,
  version,
  onCheckUpdates,
  onInstallUpdate,
  onOpenSettings,
}: {
  status: UpdateStatus;
  version: string | null;
  onCheckUpdates: () => void;
  onInstallUpdate: () => void;
  onOpenSettings: () => void;
}) {
  if (isMacPlatform()) {
    if (status.state !== "available") {
      return version ? (
        <span className="text-xs text-gray-400 tabular-nums">{`v${version}`}</span>
      ) : null;
    }

    return (
      <button
        data-tauri-drag-region="false"
        className="flex items-center gap-1.5 rounded-full bg-[var(--nuza-accent)] px-2.5 py-0.5 text-xs font-medium text-black hover:bg-[var(--nuza-accent-strong)] cursor-pointer transition-colors"
        onClick={onOpenSettings}
        title={`nuza v${status.version} is available - open Settings to download it`}
      >
        <ArrowDownCircle size={12} />
        Update available
      </button>
    );
  }

  if (status.state === "ready" || status.state === "installing") {
    const failed = status.state === "ready" && !!status.installError;
    return (
      <button
        data-tauri-drag-region="false"
        className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium text-black cursor-pointer transition-colors disabled:cursor-default disabled:opacity-70 ${
          failed ? "bg-red-400 hover:bg-red-300" : "bg-[var(--nuza-accent)] hover:bg-[var(--nuza-accent-strong)]"
        }`}
        onClick={onInstallUpdate}
        disabled={status.state === "installing"}
        title={
          failed
            ? `Install failed: ${status.installError}`
            : `Restart to update to v${status.version}`
        }
      >
        <ArrowDownCircle size={12} />
        {status.state === "installing"
          ? "Installing…"
          : failed
            ? "Install failed - retry"
            : "Restart to update"}
      </button>
    );
  }

  const busy = status.state === "checking" || status.state === "downloading";
  const label = updateLabel(status, version);

  return (
    <button
      data-tauri-drag-region="false"
      className={`flex items-center gap-1.5 text-sm hover:text-white cursor-pointer transition-colors disabled:cursor-default ${
        status.state === "error" ? "text-[var(--nuza-accent)]" : "text-gray-400"
      }`}
      onClick={onCheckUpdates}
      disabled={busy}
      title={status.state === "error" ? status.message : "Check for updates"}
    >
      <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
      {label && <span className="text-xs tabular-nums">{label}</span>}
    </button>
  );
}

/** The draggable title bar: app name on the left, action buttons on the right. */
function EditorHeader({
  updateStatus,
  version,
  openPaths,
  currentFile,
  dirtyPaths,
  onSelectTab,
  onCloseTab,
  onCheckUpdates,
  onInstallUpdate,
  onOpenSettings,
  onSave,
  onToggleSidebar,
}: EditorHeaderProps) {
  // macOS traffic lights overlay the top-left corner of the window, so the header
  // needs left padding to clear them. Windows/Linux draw their own native window
  // controls outside the webview instead, so that space isn't needed there -
  // without this the "nuza" title sits shifted for no reason on those platforms.
  const leadingPadding = isMacPlatform() ? "pl-24" : "pl-4";

  return (
    <header
      data-tauri-drag-region
      className={`h-12 shrink-0 flex items-center gap-4 px-4 ${leadingPadding}`}
    >
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-sm font-bold text-gray-400">nuza</span>
      </div>

      <TabBar
        paths={openPaths}
        activePath={currentFile}
        dirtyPaths={dirtyPaths}
        onSelect={onSelectTab}
        onClose={onCloseTab}
      />

      <div className="ml-auto flex shrink-0 items-center gap-3">
        <UpdateButton
          status={updateStatus}
          version={version}
          onCheckUpdates={onCheckUpdates}
          onInstallUpdate={onInstallUpdate}
          onOpenSettings={onOpenSettings}
        />

        <button
          data-tauri-drag-region="false"
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white cursor-pointer transition-colors"
          onClick={onOpenSettings}
        >
          <Settings size={14} />
        </button>

        <button
          data-tauri-drag-region="false"
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white cursor-pointer transition-colors"
          onClick={onSave}
        >
          <Save size={14} />
        </button>

        <div className="border-l border-zinc-700 pl-3 flex items-center h-4">
          <button
            onClick={onToggleSidebar}
            className="text-gray-400 hover:text-white transition-colors translate-y-[1px] cursor-pointer"
          >
            <PanelLeft size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}

export default memo(EditorHeader);
