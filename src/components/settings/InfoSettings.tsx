import { Switch } from "@/components/ui/switch";
import { isMacPlatform } from "@/lib/platform";
import { UpdateStatus } from "@/hooks/useAppUpdater";
import SettingRow from "./SettingRow";

interface InfoSettingsProps {
  autoUpdateEnabled: boolean;
  setAutoUpdateEnabled: (enabled: boolean) => void;
  updateStatus: UpdateStatus;
  appVersion: string | null;
  onCheckUpdates: () => void;
  onOpenDownloadPage: () => void;
  onOpenChangelog: () => void;
}

/** Where the update row stands, in words, whatever the platform. */
function updateDescription(status: UpdateStatus, isMac: boolean) {
  switch (status.state) {
    case "checking":
      return "Checking for the latest version…";
    case "available":
      return `v${status.version} is available. Our macOS builds aren't code-signed yet, so download and install it by hand.`;
    case "downloading":
      return status.progress === null
        ? `Downloading v${status.version}…`
        : `Downloading v${status.version} — ${status.progress}%`;
    case "ready":
      return status.installError
        ? `v${status.version} is downloaded, but installing it failed: ${status.installError}`
        : `v${status.version} is downloaded and ready to install.`;
    case "installing":
      return `Installing v${status.version}…`;
    case "up-to-date":
      return "You're on the latest version.";
    case "error":
      return `Couldn't check for updates: ${status.message}`;
    default:
      return isMac
        ? "macOS builds aren't code-signed yet, so updates are downloaded manually."
        : "Look for a newer version now rather than waiting for the next background check.";
  }
}

export default function InfoSettings({
  autoUpdateEnabled,
  setAutoUpdateEnabled,
  updateStatus,
  appVersion,
  onCheckUpdates,
  onOpenDownloadPage,
  onOpenChangelog,
}: InfoSettingsProps) {
  const isMac = isMacPlatform();

  return (
    <div className="divide-y divide-zinc-800">
      <SettingRow title="Version" description="The build of nuza you're running right now">
        <span className="font-mono text-xs text-gray-400">{appVersion ? `v${appVersion}` : "unknown"}</span>
      </SettingRow>

      <SettingRow title="Changelog" description="What changed in this release, and the ones before it">
        <button
          onClick={onOpenChangelog}
          className="cursor-pointer rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs text-white transition-colors hover:border-[var(--nuza-accent)]"
        >
          What's New
        </button>
      </SettingRow>

      <SettingRow
        title="Automatic Updates"
        description={
          isMac
            ? "Check for new versions in the background (macOS still requires a manual download below)."
            : "Download new versions in the background. You choose when to restart."
        }
      >
        <Switch checked={autoUpdateEnabled} onCheckedChange={setAutoUpdateEnabled} />
      </SettingRow>

      <SettingRow title="Check for Updates" description={updateDescription(updateStatus, isMac)}>
        {isMac && updateStatus.state === "available" ? (
          <button
            onClick={onOpenDownloadPage}
            className="bg-[var(--nuza-accent)] hover:bg-[var(--nuza-accent-strong)] rounded-md px-3 py-1 text-xs font-medium text-black transition-colors cursor-pointer"
          >
            Download v{updateStatus.version}
          </button>
        ) : (
          <button
            onClick={onCheckUpdates}
            disabled={
              updateStatus.state === "checking" ||
              updateStatus.state === "downloading" ||
              updateStatus.state === "installing"
            }
            className="bg-zinc-800 border border-zinc-700 rounded-md px-3 py-1 text-xs text-white hover:border-[var(--nuza-accent)] transition-colors cursor-pointer disabled:cursor-default disabled:opacity-70"
          >
            {updateStatus.state === "checking"
              ? "Checking…"
              : updateStatus.state === "downloading"
                ? "Downloading…"
                : updateStatus.state === "ready"
                  ? "Install & Restart"
                  : "Check for Updates"}
          </button>
        )}
      </SettingRow>
    </div>
  );
}
