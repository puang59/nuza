import { Switch } from "@/components/ui/switch";
import { SPELL_LANGUAGES, SpellLanguage } from "@/lib/spellDictionaries";
import CommandLineSetting from "./CommandLineSetting";
import SettingRow from "./SettingRow";

interface GeneralSettingsProps {
  vimEnabled: boolean;
  setVimEnabled: (enabled: boolean) => void;
  showLineNumbers: boolean;
  setShowLineNumbers: (enabled: boolean) => void;
  typewriterScrolling: boolean;
  setTypewriterScrolling: (enabled: boolean) => void;
  spellCheck: boolean;
  setSpellCheck: (enabled: boolean) => void;
  spellLanguage: SpellLanguage;
  setSpellLanguage: (language: SpellLanguage) => void;
  sectionGuides: boolean;
  setSectionGuides: (enabled: boolean) => void;
  zenDimming: boolean;
  setZenDimming: (enabled: boolean) => void;
}

export default function GeneralSettings({
  vimEnabled,
  setVimEnabled,
  showLineNumbers,
  setShowLineNumbers,
  typewriterScrolling,
  setTypewriterScrolling,
  spellCheck,
  setSpellCheck,
  spellLanguage,
  setSpellLanguage,
  sectionGuides,
  setSectionGuides,
  zenDimming,
  setZenDimming,
}: GeneralSettingsProps) {
  return (
    <div className="divide-y divide-zinc-800">
      <SettingRow title="Vim Mode" description="Enable Vim keybindings for the editor">
        <Switch checked={vimEnabled} onCheckedChange={setVimEnabled} />
      </SettingRow>
      <SettingRow title="Line Numbers" description="Show line numbers in the editor gutter">
        <Switch checked={showLineNumbers} onCheckedChange={setShowLineNumbers} />
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
        title="Dim in Zen Mode"
        description="In zen mode, fade everything but the paragraph you are writing"
      >
        <Switch checked={zenDimming} onCheckedChange={setZenDimming} />
      </SettingRow>
      <CommandLineSetting />
    </div>
  );
}
