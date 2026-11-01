import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Command } from "lucide-react";
import { cn } from "cn";
import { useExitAnimation } from "@/hooks/useExitAnimation";
import { searchSettings, ToggleSetting } from "@/lib/settingsSearch";
import { Switch } from "@/components/ui/switch";
import { usePersistedState } from "@/hooks/usePersistedState";
import MatchedText from "./MatchedText";

/** Something the app can do, from the keymap: run once, then out of the way. */
export interface PaletteCommand {
  id: string;
  title: string;
  description: string;
  /** Its keyboard shortcut, as it is shown in menus. */
  shortcut: string;
  run: () => void;
}

type Entry = ToggleSetting | PaletteCommand;

function isCommand(entry: Entry): entry is PaletteCommand {
  return "run" in entry;
}

/** How many commands are remembered as recently run. */
const RECENT_COMMANDS = 8;

interface SettingsPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ToggleSetting[];
  commands?: PaletteCommand[];
}

/**
 * Everything the app can do, and the on/off settings, a keystroke away: the
 * quick-open palette's floating search, over the commands and the switches
 * instead of the files. A command runs and the palette goes, since what is
 * wanted next is the note; flipping a switch leaves it open, since the next
 * thing wanted is as often another switch. With nothing typed, the commands
 * run most recently come first.
 */
const NO_COMMANDS: PaletteCommand[] = [];

function SettingsPalette({ isOpen, onClose, settings, commands = NO_COMMANDS }: SettingsPaletteProps) {
  const [recent, setRecent] = usePersistedState<string[]>("recentCommands", []);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const { isMounted, isClosing } = useExitAnimation(isOpen);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [isOpen]);

  const entries = useMemo<Entry[]>(() => {
    const order = (command: PaletteCommand) => {
      const index = Array.isArray(recent) ? recent.indexOf(command.id) : -1;
      return index < 0 ? Infinity : index;
    };
    const byRecency = commands
      .map((command, index) => ({ command, index }))
      .sort((a, b) => order(a.command) - order(b.command) || a.index - b.index)
      .map(({ command }) => command);
    return [...byRecency, ...settings];
  }, [commands, settings, recent]);

  const matches = useMemo(
    () => (isMounted ? searchSettings(entries, query) : []),
    [isMounted, entries, query]
  );

  /** Runs a command once the palette has handed the keyboard back to the note. */
  function choose(entry: Entry) {
    if (!isCommand(entry)) {
      entry.onToggle(!entry.enabled);
      return;
    }
    setRecent((list) =>
      [entry.id, ...(Array.isArray(list) ? list : []).filter((id) => id !== entry.id)].slice(
        0,
        RECENT_COMMANDS
      )
    );
    onClose();
    setTimeout(entry.run, 0);
  }

  useEffect(() => {
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, matches.length]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => Math.min(Math.max(index + step, 0), matches.length - 1));
      return;
    }

    if (event.key === "Enter" && matches[activeIndex]) {
      event.preventDefault();
      choose(matches[activeIndex].setting);
    }
  }

  if (!isMounted) return null;

  return (
    <div
      onClick={onClose}
      className={cn(
        "fixed inset-0 z-50 flex items-start justify-center bg-black/25 px-4 pb-4 pt-[14vh]",
        isClosing ? "animate-fade-out" : "animate-fade-in"
      )}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className={cn(
          "flex w-[460px] max-w-full flex-col overflow-hidden nuza-palette rounded-xl border border-white/10 bg-[#262628]/65 shadow-2xl backdrop-blur-2xl",
          isClosing ? "animate-palette-out" : "animate-palette-in"
        )}
      >
        <div className="flex shrink-0 items-center gap-2 px-3 py-2 leading-5">
          <Command className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          <input
            autoFocus
            value={query}
            placeholder="Search commands and settings"
            aria-label="Commands and settings"
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-zinc-500"
          />
        </div>

        {matches.length === 0 ? (
          <p className="border-t border-white/5 px-3 py-4 text-center text-xs text-zinc-500">
            Nothing matches.
          </p>
        ) : (
          <ul
            ref={listRef}
            role="listbox"
            aria-label="Commands and settings"
            className="max-h-[280px] min-h-0 overflow-y-auto border-t border-white/5 p-1"
          >
            {matches.map(({ setting, highlight }, index) => (
              // A row rather than a button: the switch inside is one already,
              // and it is the row as a whole that is clicked.
              <li
                key={setting.id}
                role="option"
                aria-selected={index === activeIndex}
                aria-checked={isCommand(setting) ? undefined : setting.enabled}
                onMouseEnter={() => setActiveIndex(index)}
                // Keeps the keyboard in the search box, so the arrows and
                // Enter carry on working after a click.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(setting)}
                title={setting.description}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-[13px] leading-5 transition-colors",
                  index === activeIndex ? "bg-white/8" : "hover:bg-white/5"
                )}
              >
                <span className="shrink-0 text-zinc-200">
                  <MatchedText name={setting.title} highlight={highlight} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">
                  {setting.description}
                </span>
                {isCommand(setting) ? (
                  setting.shortcut && (
                    <kbd className="shrink-0 font-sans text-[11px] text-zinc-500">{setting.shortcut}</kbd>
                  )
                ) : (
                  <Switch
                    size="sm"
                    checked={setting.enabled}
                    tabIndex={-1}
                    aria-hidden
                    className="pointer-events-none"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default memo(SettingsPalette);
