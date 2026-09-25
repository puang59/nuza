import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { isMacPlatform } from "@/lib/platform";
import { UpdateStatus } from "@/hooks/useAppUpdater";
import {
  MAX_EDITOR_FONT_SIZE,
  MIN_EDITOR_FONT_SIZE,
  clampEditorFontSize,
  listSystemFonts,
} from "@/lib/fonts";
import { Appearance, clampTransparency } from "@/lib/appearance";
import ColorField from "./ColorField";
import FontPicker from "./FontPicker";
import SettingRow from "./SettingRow";

interface GeneralSettingsProps {
  vimEnabled: boolean;
  setVimEnabled: (enabled: boolean) => void;
  appearance: Appearance;
  setAppearance: (change: Partial<Appearance>) => void;
  resetAppearance: () => void;
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
  appearance,
  setAppearance,
  resetAppearance,
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
        description={`How much of the desktop shows through (${vibrancyLabel})`}
      >
        <div className="flex w-40 items-center gap-3">
          <input
            type="range"
            aria-label="Window transparency"
            min={0}
            max={100}
            step={5}
            value={appearance.transparency}
            onChange={(event) => setAppearance({ transparency: clampTransparency(Number(event.target.value)) })}
            className="nuza-slider min-w-0 flex-1"
          />
          <span className="w-9 shrink-0 text-right font-mono text-xs text-gray-400">
            {appearance.transparency}%
          </span>
        </div>
      </SettingRow>

      <SettingRow title="Accent" description="Links, bullets, the caret and anything you can act on">
        <ColorField label="Accent colour" value={appearance.accent} onChange={(accent) => setAppearance({ accent })} />
      </SettingRow>

      <SettingRow title="Background" description="The window behind everything, tinted by the transparency above">
        <ColorField
          label="Background colour"
          value={appearance.background}
          onChange={(background) => setAppearance({ background })}
        />
      </SettingRow>

      <SettingRow title="Text" description="The ink notes are written in; headings and dimmed text follow it">
        <div className="flex w-40 items-center gap-2">
          <ColorField
            label="Text colour"
            value={appearance.foreground}
            onChange={(foreground) => setAppearance({ foreground })}
          />
        </div>
      </SettingRow>

      <SettingRow title="Reset Colours" description="Put the accent, background and text back to how they started">
        <button
          onClick={resetAppearance}
          className="cursor-pointer rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs text-white transition-colors hover:border-[var(--nuza-accent)]"
        >
          Reset
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

      {isMac && (
        <SettingRow title="Update" description={macUpdateDescription(updateStatus, appVersion)}>
          {updateStatus.state === "available" ? (
            <button
              onClick={onOpenDownloadPage}
              className="bg-[var(--nuza-accent)] hover:bg-[var(--nuza-accent-strong)] rounded-md px-3 py-1 text-xs font-medium text-black transition-colors cursor-pointer"
            >
              Download v{updateStatus.version}
            </button>
          ) : (
            <button
              onClick={onCheckUpdates}
              disabled={updateStatus.state === "checking"}
              className="bg-zinc-800 border border-zinc-700 rounded-md px-3 py-1 text-xs text-white hover:border-[var(--nuza-accent)] transition-colors cursor-pointer disabled:cursor-default disabled:opacity-70"
            >
              {updateStatus.state === "checking" ? "Checking…" : "Check for Updates"}
            </button>
          )}
        </SettingRow>
      )}

      <SettingRow title="Font" description="Any font installed on your system">
        <FontPicker fonts={fonts} value={editorFont} onChange={setEditorFont} />
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
            className="w-full bg-zinc-800 border border-zinc-700 rounded-md pl-2 pr-16 py-1 text-xs text-white text-right outline-none focus-visible:border-[var(--nuza-accent)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          {/* Native number-input spinner arrows render black on some platforms and are
              unreadable on this dark background, so we hide them (above) and drive the
              same clamp/step logic from our own grey buttons instead. */}
          <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-2">
            <span className="text-xs text-gray-500">px</span>
            <div className="pointer-events-auto flex flex-col items-center gap-px border-l border-zinc-700 pl-2">
              <button
                type="button"
                aria-label="Increase font size"
                onClick={() => setEditorFontSize(clampEditorFontSize(editorFontSize + 1))}
                className="text-gray-400 hover:text-white cursor-pointer leading-none"
              >
                <ChevronUp size={10} />
              </button>
              <button
                type="button"
                aria-label="Decrease font size"
                onClick={() => setEditorFontSize(clampEditorFontSize(editorFontSize - 1))}
                className="text-gray-400 hover:text-white cursor-pointer leading-none"
              >
                <ChevronDown size={10} />
              </button>
            </div>
          </div>
        </div>
      </SettingRow>
    </div>
  );
}
