import { Switch } from "@/components/ui/switch";
import { SPELL_LANGUAGES, SpellLanguage } from "@/lib/spellDictionaries";
import CommandLineSetting from "./CommandLineSetting";
import SettingRow from "./SettingRow";
import Segmented from "./Segmented";
import { TAB_SIZES, type TabSize } from "@/lib/tabSize";
import ColorField from "./ColorField";
import {
  VIM_BAR_PRESETS,
  VIM_BAR_SLOTS,
  VimBarStyle,
  resolveVimBarColor,
  vimBarBadge,
  vimBarColors,
} from "@/lib/vimBar";

const TAB_SIZE_CHOICES = TAB_SIZES.map((size) => ({ id: String(size), label: `${size} Spaces` }));

interface GeneralSettingsProps {
  vimEnabled: boolean;
  setVimEnabled: (enabled: boolean) => void;
  vimBar: VimBarStyle;
  setVimBar: (style: VimBarStyle) => void;
  /** The accent and the ink as they are now, for the colours that follow them. */
  windowColors: { accent: string; ink: string };
  showLineNumbers: boolean;
  setShowLineNumbers: (enabled: boolean) => void;
  tabSize: TabSize;
  setTabSize: (size: TabSize) => void;
  typewriterScrolling: boolean;
  setTypewriterScrolling: (enabled: boolean) => void;
  spellCheck: boolean;
  setSpellCheck: (enabled: boolean) => void;
  spellLanguage: SpellLanguage;
  setSpellLanguage: (language: SpellLanguage) => void;
  sectionGuides: boolean;
  setSectionGuides: (enabled: boolean) => void;
  noteTitles: boolean;
  setNoteTitles: (enabled: boolean) => void;
  zenDimming: boolean;
  setZenDimming: (enabled: boolean) => void;
  terminalApp: string;
  setTerminalApp: (app: string) => void;
}

/**
 * The status bar's colours, with Vim on: a preset, with a preview of it, and then each colour
 * on its own. Changing one makes the set Custom, starting from what was shown.
 */
function VimBarSettings({
  style,
  onChange,
  windowColors,
}: {
  style: VimBarStyle;
  onChange: (style: VimBarStyle) => void;
  windowColors: { accent: string; ink: string };
}) {
  const colors = vimBarColors(style);
  const preset =
    style.preset === "custom" || VIM_BAR_PRESETS.some((p) => p.id === style.preset)
      ? style.preset
      : "classic";

  return (
    <>
      <SettingRow
        title="Status Bar Colours"
        description="The mode and clock badges in the status bar, with Vim on"
      >
        <div className="flex w-40 flex-col items-stretch gap-2">
          <select
            aria-label="Status bar colours"
            className="cursor-pointer rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-white outline-none focus:border-[var(--nuza-accent)]"
            value={preset}
            onChange={(event) => onChange({ ...style, preset: event.target.value })}
          >
            {VIM_BAR_PRESETS.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
            <option value="custom">Custom</option>
          </select>
          {/* The bar's own badges, in miniature. */}
          <div aria-hidden className="flex overflow-hidden rounded font-mono text-[9px] font-bold uppercase">
            {VIM_BAR_SLOTS.map((slot) => (
              <span key={slot.id} className="flex-1 py-0.5 text-center" style={vimBarBadge(colors[slot.id])}>
                {slot.id === "clock" ? "12:00" : slot.id.slice(0, 3)}
              </span>
            ))}
          </div>
        </div>
      </SettingRow>
      {VIM_BAR_SLOTS.map((slot) => (
        <SettingRow key={slot.id} title={slot.label} description={slot.description}>
          <ColorField
            label={`${slot.label} colour`}
            value={resolveVimBarColor(colors[slot.id], windowColors)}
            onChange={(color) => onChange({ preset: "custom", custom: { ...colors, [slot.id]: color } })}
          />
        </SettingRow>
      ))}
    </>
  );
}

export default function GeneralSettings({
  vimEnabled,
  setVimEnabled,
  vimBar,
  setVimBar,
  windowColors,
  showLineNumbers,
  tabSize,
  setTabSize,
  setShowLineNumbers,
  typewriterScrolling,
  setTypewriterScrolling,
  spellCheck,
  setSpellCheck,
  spellLanguage,
  setSpellLanguage,
  sectionGuides,
  setSectionGuides,
  noteTitles,
  setNoteTitles,
  zenDimming,
  setZenDimming,
  terminalApp,
  setTerminalApp,
}: GeneralSettingsProps) {
  return (
    <div className="divide-y divide-zinc-800">
      <SettingRow title="Vim Mode" description="Enable Vim keybindings for the editor">
        <Switch checked={vimEnabled} onCheckedChange={setVimEnabled} />
      </SettingRow>
      {vimEnabled && <VimBarSettings style={vimBar} onChange={setVimBar} windowColors={windowColors} />}
      <SettingRow title="Line Numbers" description="Show line numbers in the editor gutter">
        <Switch checked={showLineNumbers} onCheckedChange={setShowLineNumbers} />
      </SettingRow>
      <SettingRow title="Tab Size" description="How many spaces Tab indents by, in lists, code and HTML">
        <Segmented
          label="Tab size"
          choices={TAB_SIZE_CHOICES}
          value={String(tabSize)}
          onChange={(size) => setTabSize(Number(size) as TabSize)}
        />
      </SettingRow>
      <SettingRow
        title="Typewriter Scrolling"
        description="Keep the line you are writing in the middle of the window"
      >
        <Switch checked={typewriterScrolling} onCheckedChange={setTypewriterScrolling} />
      </SettingRow>
      <SettingRow
        title="Spell Check"
        description="Underline misspelled words as you write. Right-click one to fix it or add it to your dictionary"
      >
        <Switch checked={spellCheck} onCheckedChange={setSpellCheck} />
      </SettingRow>
      {spellCheck && (
        <SettingRow title="Spelling Language" description="Which spelling the dictionary follows">
          <select
            className="cursor-pointer rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-white outline-none focus:border-[var(--nuza-accent)]"
            value={spellLanguage}
            onChange={(event) => setSpellLanguage(event.target.value as SpellLanguage)}
          >
            {SPELL_LANGUAGES.map((language) => (
              <option key={language.id} value={language.id}>
                {language.label}
              </option>
            ))}
          </select>
        </SettingRow>
      )}
      <SettingRow
        title="Section Guides"
        description="Marks for a note's headings down the edge, and the current section's name at the top"
      >
        <Switch checked={sectionGuides} onCheckedChange={setSectionGuides} />
      </SettingRow>
      <SettingRow
        title="Note Titles in Sidebar"
        description="Show each note by its title - the frontmatter's title, or its first heading - instead of its file name"
      >
        <Switch checked={noteTitles} onCheckedChange={setNoteTitles} />
      </SettingRow>
      <SettingRow
        title="Dim in Zen Mode"
        description="In zen mode, fade everything but the paragraph you are writing"
      >
        <Switch checked={zenDimming} onCheckedChange={setZenDimming} />
      </SettingRow>
      <SettingRow
        title="Terminal"
        description="The app Open in Terminal uses for a folder. Leave it empty for the system's own terminal."
      >
        <input
          aria-label="Terminal app"
          value={terminalApp}
          placeholder="System default"
          onChange={(e) => setTerminalApp(e.target.value)}
          className="w-40 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-white outline-none placeholder:text-zinc-500 focus-visible:border-[var(--nuza-accent)]"
        />
      </SettingRow>
      <CommandLineSetting />
    </div>
  );
}
