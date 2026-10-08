import { Switch } from "@/components/ui/switch";
import CommandLineSetting from "./CommandLineSetting";
import SettingRow from "./SettingRow";

interface GeneralSettingsProps {
  vimEnabled: boolean;
  setVimEnabled: (enabled: boolean) => void;
  showLineNumbers: boolean;
  setShowLineNumbers: (enabled: boolean) => void;
  typewriterScrolling: boolean;
  setTypewriterScrolling: (enabled: boolean) => void;
  sectionGuides: boolean;
  setSectionGuides: (enabled: boolean) => void;
}

export default function GeneralSettings({
  vimEnabled,
  setVimEnabled,
  showLineNumbers,
  setShowLineNumbers,
  typewriterScrolling,
  setTypewriterScrolling,
  sectionGuides,
  setSectionGuides,
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
        title="Section Guides"
        description="Marks for a note's headings down the edge, and the current section's name at the top"
      >
        <Switch checked={sectionGuides} onCheckedChange={setSectionGuides} />
      </SettingRow>
      <CommandLineSetting />
    </div>
  );
}
