import { Switch } from "@/components/ui/switch";
import SettingRow from "./SettingRow";

interface GeneralSettingsProps {
  vimEnabled: boolean;
  setVimEnabled: (enabled: boolean) => void;
}

export default function GeneralSettings({ vimEnabled, setVimEnabled }: GeneralSettingsProps) {
  return (
    <div className="divide-y divide-zinc-800">
      <SettingRow title="Vim Mode" description="Enable Vim keybindings for the editor">
        <Switch checked={vimEnabled} onCheckedChange={setVimEnabled} />
      </SettingRow>
    </div>
  );
}
