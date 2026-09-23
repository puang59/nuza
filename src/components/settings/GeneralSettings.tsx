import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { isMacPlatform } from "@/lib/platform";
import { UpdateStatus } from "@/hooks/useAppUpdater";
import {
  DEFAULT_EDITOR_FONT,
  MAX_EDITOR_FONT_SIZE,
  MIN_EDITOR_FONT_SIZE,
  clampEditorFontSize,
  listSystemFonts,
} from "@/lib/fonts";
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
  editorFontSize: number;
  setEditorFontSize: (size: number) => void;
  updateStatus: UpdateStatus;
  appVersion: string | null;
  onCheckUpdates: () => void;
  onOpenDownloadPage: () => void;
}

/** Describes where things stand for the manual macOS update flow. */
function macUpdateDescription(status: UpdateStatus, appVersion: string | null) {
  switch (status.state) {
    case "checking":
      return "Checking for the latest version…";
    case "available":
      return `v${status.version} is available. Our macOS builds aren't code-signed yet, so download and install it by hand.`;
    case "up-to-date":
      return "You're on the latest version.";
    case "error":
      return `Couldn't check for updates: ${status.message}`;
    default:
      return appVersion
        ? `You're running v${appVersion}. macOS builds aren't code-signed yet, so updates are downloaded manually.`
        : "macOS builds aren't code-signed yet, so updates are downloaded manually.";
  }
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
  editorFontSize,
  setEditorFontSize,
  updateStatus,
  appVersion,
  onCheckUpdates,
  onOpenDownloadPage,
}: GeneralSettingsProps) {
  const [fonts, setFonts] = useState<string[]>([]);
  const [fontSizeInput, setFontSizeInput] = useState(String(editorFontSize));
  const isMac = isMacPlatform();

  useEffect(() => {
    setFontSizeInput(String(editorFontSize));
  }, [editorFontSize]);

  useEffect(() => {
    listSystemFonts()
      .then(setFonts)
      .catch((error) => console.error("Failed to list system fonts:", error));
  }, []);

  const vibrancyLabel = isMac ? "macOS vibrancy" : "window blur, where supported";

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
        description={
          isMac
            ? "Check for new versions in the background (macOS still requires a manual download below)."
            : "Download new versions in the background. You choose when to restart."
        }
      >
        <Switch checked={autoUpdateEnabled} onCheckedChange={setAutoUpdateEnabled} />
      </SettingRow>

      {isMac && (
        <SettingRow title="Update" description={macUpdateDescription(updateStatus, appVersion)}>
          {updateStatus.state === "available" ? (
            <button
              onClick={onOpenDownloadPage}
              className="bg-[#FF9696] hover:bg-[#FFB0B0] rounded-md px-3 py-1 text-xs font-medium text-black transition-colors cursor-pointer"
            >
              Download v{updateStatus.version}
            </button>
          ) : (
            <button
              onClick={onCheckUpdates}
              disabled={updateStatus.state === "checking"}
              className="bg-zinc-800 border border-zinc-700 rounded-md px-3 py-1 text-xs text-white hover:border-[#FF9696] transition-colors cursor-pointer disabled:cursor-default disabled:opacity-70"
            >
              {updateStatus.state === "checking" ? "Checking…" : "Check for Updates"}
            </button>
          )}
        </SettingRow>
      )}

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

      <SettingRow
        title="Font Size"
        description={`Editor text size in pixels (${MIN_EDITOR_FONT_SIZE}-${MAX_EDITOR_FONT_SIZE})`}
      >
        <div className="relative w-40">
          <input
            aria-label="Editor font size"
            type="number"
            min={MIN_EDITOR_FONT_SIZE}
            max={MAX_EDITOR_FONT_SIZE}
            value={fontSizeInput}
            onChange={(e) => setFontSizeInput(e.target.value)}
            onBlur={() => setEditorFontSize(clampEditorFontSize(Number(fontSizeInput)))}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-md pl-2 pr-7 py-1 text-xs text-white outline-none focus-visible:border-[#FF9696]"
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500">
            px
          </span>
        </div>
      </SettingRow>
    </div>
  );
}
