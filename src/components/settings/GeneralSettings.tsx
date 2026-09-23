import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { isMacPlatform } from "@/lib/platform";
import { DEFAULT_EDITOR_FONT, listSystemFonts } from "@/lib/fonts";
import SettingRow from "./SettingRow";

interface GeneralSettingsProps {
  vimEnabled: boolean;
  setVimEnabled: (enabled: boolean) => void;
  transparencyEnabled: boolean;
  setTransparencyEnabled: (enabled: boolean) => void;
  autoUpdateEnabled: boolean;
  setAutoUpdateEnabled: (enabled: boolean) => void;
  editorFont: string;
  setEditorFont: (font: string) => void;
}

export default function GeneralSettings({
  vimEnabled,
  setVimEnabled,
  transparencyEnabled,
  setTransparencyEnabled,
  autoUpdateEnabled,
  setAutoUpdateEnabled,
  editorFont,
  setEditorFont,
}: GeneralSettingsProps) {
  const [fonts, setFonts] = useState<string[]>([]);

  useEffect(() => {
    listSystemFonts()
      .then(setFonts)
      .catch((error) => console.error("Failed to list system fonts:", error));
  }, []);

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

      <SettingRow title="Font" description="Any font installed on your system">
        <div className="relative w-40">
          <select
            aria-label="Editor font"
            value={editorFont}
            onChange={(e) => setEditorFont(e.target.value)}
            className="w-full appearance-none truncate bg-zinc-800 border border-zinc-700 rounded-md pl-2 pr-7 py-1 text-xs text-white outline-none focus-visible:border-[#FF9696] cursor-pointer"
          >
            <option value={DEFAULT_EDITOR_FONT}>Default</option>
            {/* Keep a saved font selectable even if it's no longer installed. */}
            {editorFont && !fonts.includes(editorFont) && <option value={editorFont}>{editorFont}</option>}
            {fonts.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
          <ChevronDown
            size={12}
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400"
          />
        </div>
      </SettingRow>
    </div>
  );
}
