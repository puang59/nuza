import { ArrowDownCircle, PanelLeft, RefreshCw, Save, Settings } from "lucide-react";
import { UpdateStatus } from "@/hooks/useAppUpdater";

interface EditorHeaderProps {
  updateStatus: UpdateStatus;
  version: string | null;
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

/** The version/update control: checks for updates, or offers a restart once one is downloaded. */
function UpdateButton({
  status,
  version,
  onCheckUpdates,
  onInstallUpdate,
}: {
  status: UpdateStatus;
  version: string | null;
  onCheckUpdates: () => void;
  onInstallUpdate: () => void;
}) {
  if (status.state === "ready" || status.state === "installing") {
    return (
      <button
        data-tauri-drag-region="false"
        className="flex items-center gap-1.5 rounded-full bg-[#FF9696] px-2.5 py-0.5 text-xs font-medium text-black hover:bg-[#FFB0B0] cursor-pointer transition-colors disabled:cursor-default disabled:opacity-70"
        onClick={onInstallUpdate}
        disabled={status.state === "installing"}
        title={`Restart to update to v${status.version}`}
      >
        <ArrowDownCircle size={12} />
        {status.state === "installing" ? "Installing…" : "Restart to update"}
      </button>
    );
  }

  const busy = status.state === "checking" || status.state === "downloading";
  const label = updateLabel(status, version);

  return (
    <button
      data-tauri-drag-region="false"
      className={`flex items-center gap-1.5 text-sm hover:text-white cursor-pointer transition-colors disabled:cursor-default ${
        status.state === "error" ? "text-[#FF9696]" : "text-gray-400"
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
export default function EditorHeader({
  updateStatus,
  version,
  onCheckUpdates,
  onInstallUpdate,
  onOpenSettings,
  onSave,
  onToggleSidebar,
}: EditorHeaderProps) {
  return (
    <header
      data-tauri-drag-region
      className="h-12 shrink-0 flex items-center justify-between px-4 pl-24"
    >
      <div className="flex items-center gap-3">
        <span className="text-sm font-bold text-gray-400">nuza</span>
      </div>

      <div className="flex items-center gap-3">
        <UpdateButton
          status={updateStatus}
          version={version}
          onCheckUpdates={onCheckUpdates}
          onInstallUpdate={onInstallUpdate}
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
