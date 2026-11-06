import { CSSProperties, useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { report } from "@/lib/notices";
import { isMacPlatform } from "@/lib/platform";
import {
  CONTENT_WIDTH_STEP,
  LINE_HEIGHT_STEP,
  MAX_CONTENT_WIDTH,
  MAX_EDITOR_FONT_SIZE,
  MAX_LINE_HEIGHT,
  MIN_CONTENT_WIDTH,
  MIN_EDITOR_FONT_SIZE,
  MIN_LINE_HEIGHT,
  clampContentWidth,
  clampEditorFontSize,
  clampLineHeight,
  listSystemFonts,
} from "@/lib/fonts";
import { Appearance, Palette, THEME_CHOICES, Theme, clampTransparency, paletteFor } from "@/lib/appearance";
import ColorField from "./ColorField";
import FontPicker from "./FontPicker";
import { Switch } from "@/components/ui/switch";
import SettingRow from "./SettingRow";
import type { PanelSide } from "@/hooks/useResizableSidebar";
import Segmented from "./Segmented";

const SIDEBAR_SIDES: { id: PanelSide; label: string }[] = [
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
];

interface AppearanceSettingsProps {
  appearance: Appearance;
  windowTheme: Theme;
  setAppearance: (change: Partial<Appearance>) => void;
  resetAppearance: () => void;
  compactMode: boolean;
  setCompactMode: (enabled: boolean) => void;
  sidebarSide: PanelSide;
  setSidebarSide: (side: PanelSide) => void;
  editorFont: string;
  setEditorFont: (font: string) => void;
  uiFont: string;
  setUiFont: (font: string) => void;
  codeFont: string;
  setCodeFont: (font: string) => void;
  editorFontSize: number;
  setEditorFontSize: (size: number) => void;
  contentWidth: number;
  setContentWidth: (width: number) => void;
  lineHeight: number;
  setLineHeight: (height: number) => void;
}

export default function AppearanceSettings({
  appearance,
  windowTheme,
  setAppearance,
  resetAppearance,
  compactMode,
  setCompactMode,
  sidebarSide,
  setSidebarSide,
  editorFont,
  setEditorFont,
  uiFont,
  setUiFont,
  codeFont,
  setCodeFont,
  editorFontSize,
  setEditorFontSize,
  contentWidth,
  setContentWidth,
  lineHeight,
  setLineHeight,
}: AppearanceSettingsProps) {
  // The colours this theme is drawn in now, and what - if anything - had to
  // be put back to keep the note readable.
  const shown = paletteFor(appearance, windowTheme);
  const chosen = appearance.palettes?.[windowTheme] ?? {};
  const palette = {
    background: chosen.background ?? shown.background,
    text: chosen.text ?? shown.foreground,
  };
  const putBack = shown.putBack;
  const setPalette = (change: Palette) =>
    setAppearance({ palettes: { ...appearance.palettes, [windowTheme]: { ...chosen, ...change } } });

  const [fonts, setFonts] = useState<string[]>([]);
  const [fontSizeInput, setFontSizeInput] = useState(String(editorFontSize));
  const isMac = isMacPlatform();

  useEffect(() => {
    setFontSizeInput(String(editorFontSize));
  }, [editorFontSize]);

  useEffect(() => {
    listSystemFonts()
      .then(setFonts)
      .catch((error) => report("Couldn't read the fonts installed on this system", error));
  }, []);

  const vibrancyLabel = isMac ? "macOS vibrancy" : "window blur, where supported";

  return (
    <div className="divide-y divide-zinc-800">
      <SettingRow title="Theme" description="Light or dark, or whichever your system is using">
        <Segmented
          label="Theme"
          choices={THEME_CHOICES}
          value={appearance.theme}
          onChange={(theme) => setAppearance({ theme })}
        />
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
            // A step of 5 is eight visible jumps across a track this narrow.
            // Nothing downstream cares about the granularity, so the thumb may
            // as well follow the pointer.
            step={1}
            value={appearance.transparency}
            onChange={(event) =>
              setAppearance({ transparency: clampTransparency(Number(event.target.value)) })
            }
            // The track paints itself up to the thumb from this, so the filled
            // part follows the value without a second element behind it.
            style={{ "--nuza-slider-ratio": appearance.transparency / 100 } as CSSProperties}
            className="nuza-slider min-w-0 flex-1"
          />
          <span className="w-9 shrink-0 text-right font-mono text-xs text-gray-400">
            {appearance.transparency}%
          </span>
        </div>
      </SettingRow>

      <SettingRow title="Accent" description="Links, bullets, the caret and anything you can act on">
        <ColorField
          label="Accent colour"
          value={appearance.accent}
          onChange={(accent) => setAppearance({ accent })}
        />
      </SettingRow>

      <SettingRow
        title="Background"
        description={`The window behind the note, in the ${windowTheme} theme${
          putBack === "background" ? " - not enough contrast with the text, so the theme's own is used" : ""
        }`}
      >
        <ColorField
          label="Background colour"
          value={palette.background}
          onChange={(background) => setPalette({ background })}
        />
      </SettingRow>

      <SettingRow
        title="Text"
        description={`The ink notes are written in, in the ${windowTheme} theme${
          putBack === "text" ? " - not enough contrast with the background, so the theme's own is used" : ""
        }`}
      >
        <ColorField label="Text colour" value={palette.text} onChange={(text) => setPalette({ text })} />
      </SettingRow>

      <SettingRow
        title="Reset Colours"
        description="Put the accent, background, text and transparency back to how they started"
      >
        <button
          onClick={resetAppearance}
          className="cursor-pointer rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs text-white transition-colors hover:border-[var(--nuza-accent)]"
        >
          Reset
        </button>
      </SettingRow>

      <SettingRow title="Compact Mode" description="Tighter rows in the sidebar, tabs and status bars">
        <Switch checked={compactMode} onCheckedChange={setCompactMode} />
      </SettingRow>

      <SettingRow
        title="Sidebar Side"
        description="Which side of the window the file tree is on - the AI panel takes the other"
      >
        <Segmented
          label="Sidebar side"
          choices={SIDEBAR_SIDES}
          value={sidebarSide}
          onChange={setSidebarSide}
        />
      </SettingRow>

      <SettingRow
        title="Font"
        description="The font notes are written in - any font installed on your system"
      >
        <FontPicker fonts={fonts} value={editorFont} onChange={setEditorFont} />
      </SettingRow>

      <SettingRow title="Interface Font" description="The sidebar, tabs, menus and status bar">
        <FontPicker fonts={fonts} value={uiFont} onChange={setUiFont} />
      </SettingRow>

      <SettingRow title="Code Font" description="Inline code, code blocks and frontmatter">
        <FontPicker fonts={fonts} value={codeFont} onChange={setCodeFont} />
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
            className="w-full bg-zinc-800 border border-zinc-700 rounded-md pl-2 pr-16 py-1 text-xs text-white text-left outline-none focus-visible:border-[var(--nuza-accent)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
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

      <SettingRow
        title="Text Width"
        description="How wide the column of text may get before the rest is margin, at the size above - zooming scales it with the text"
      >
        <div className="flex w-40 items-center gap-3">
          <input
            type="range"
            aria-label="Text column width"
            min={MIN_CONTENT_WIDTH}
            max={MAX_CONTENT_WIDTH}
            step={CONTENT_WIDTH_STEP}
            value={contentWidth}
            onChange={(event) => setContentWidth(clampContentWidth(Number(event.target.value)))}
            style={
              {
                "--nuza-slider-ratio":
                  (contentWidth - MIN_CONTENT_WIDTH) / (MAX_CONTENT_WIDTH - MIN_CONTENT_WIDTH),
              } as CSSProperties
            }
            className="nuza-slider min-w-0 flex-1"
          />
          <span className="w-11 shrink-0 text-right font-mono text-xs text-gray-400">{contentWidth}px</span>
        </div>
      </SettingRow>

      <SettingRow title="Line Height" description="The space between lines of text">
        <div className="flex w-40 items-center gap-3">
          <input
            type="range"
            aria-label="Line height"
            min={MIN_LINE_HEIGHT}
            max={MAX_LINE_HEIGHT}
            step={LINE_HEIGHT_STEP}
            value={lineHeight}
            onChange={(event) => setLineHeight(clampLineHeight(Number(event.target.value)))}
            style={
              {
                "--nuza-slider-ratio": (lineHeight - MIN_LINE_HEIGHT) / (MAX_LINE_HEIGHT - MIN_LINE_HEIGHT),
              } as CSSProperties
            }
            className="nuza-slider min-w-0 flex-1"
          />
          <span className="w-11 shrink-0 text-right font-mono text-xs text-gray-400">
            {lineHeight.toFixed(2)}
          </span>
        </div>
      </SettingRow>
    </div>
  );
}
