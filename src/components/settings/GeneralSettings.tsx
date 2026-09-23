import { Switch } from "@/components/ui/switch";
import { isMacPlatform } from "@/lib/platform";
import SettingRow from "./SettingRow";

interface GeneralSettingsProps {
  vimEnabled: boolean;
  setVimEnabled: (enabled: boolean) => void;
  transparencyEnabled: boolean;
  setTransparencyEnabled: (enabled: boolean) => void;
  autoUpdateEnabled: boolean;
  setAutoUpdateEnabled: (enabled: boolean) => void;
}

export default function GeneralSettings({
  vimEnabled,
  setVimEnabled,
  transparencyEnabled,
  setTransparencyEnabled,
  autoUpdateEnabled,
  setAutoUpdateEnabled,
}: GeneralSettingsProps) {
  const vibrancyLabel = isMacPlatform() ? "macOS vibrancy" : "window blur, where supported";

  return (
    <div className="divide-y divide-zinc-800">
      <SettingRow title="Vim Mode" description="Enable Vim keybindings for the editor">
        <Switch checked={vimEnabled} onCheckedChange={setVimEnabled} />
      </SettingRow>

      <SettingRow
        title="Transparency"
        description={`Use a translucent window background (${vibrancyLabel})`}
      >
        <Switch checked={transparencyEnabled} onCheckedChange={setTransparencyEnabled} />
      </SettingRow>

      <SettingRow
        title="Automatic Updates"
        description="Download new versions in the background. You choose when to restart."
      >
        <Switch checked={autoUpdateEnabled} onCheckedChange={setAutoUpdateEnabled} />
      </SettingRow>
    </div>
  );
}
