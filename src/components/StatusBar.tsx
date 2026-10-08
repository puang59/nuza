import { memo, useEffect, useState } from "react";
import { StatsSubscription, useDocumentStats } from "@/hooks/useDocumentStats";
import NoteAge from "./NoteAge";

/**
 * The wall clock, ticking on its own. It used to come in as a prop that was
 * recomputed whenever the app happened to re-render, which meant it only kept
 * time because typing re-rendered everything - it would sit still now that
 * keystrokes stay inside the editor.
 */
function useClock() {
  const [now, setNow] = useState(() => new Date().toLocaleString());

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date().toLocaleString()), 1000);
    return () => clearInterval(tick);
  }, []);

  return now;
}

interface StatusBarProps {
  mode: string;
  currentFile: string;
  subscribeToStats: StatsSubscription;
  /** The open note's file, or null for the scratch note. */
  notePath: string | null;
  /** Whether the note has nothing unsaved in it. */
  saved: boolean;
}

/** Background/text color for each Vim mode indicator, keyed by CodeMirror's mode name. */
const VIM_MODE_STYLES: Record<string, string> = {
  insert: "bg-[#96FF96] text-black",
  normal: "bg-[#9696FF] text-black",
  replace: "bg-[#FF9696] text-black",
  visual: "bg-[#FFFF96] text-black",
};

/**
 * The bottom bar as Vim users get it: mode on the left, then where the caret is
 * and how much has been written, with the file name and the time on the right.
 */
function StatusBar({ mode, currentFile, subscribeToStats, notePath, saved }: StatusBarProps) {
  const modeStyle = VIM_MODE_STYLES[mode];
  const fileName = currentFile.split(/[/\\]/).pop() || "untitled.md";
  const timestamp = useClock();
  const { words, line, column } = useDocumentStats(subscribeToStats);

  return (
    // Nothing in the bar wraps: it is one line tall, and a second line had
    // nowhere to go but out of it. As the window narrows the bar lets go of
    // what matters least first - when the note was edited, then the word
    // count, then the file's name (the tab already says it) - and keeps the
    // mode, the caret's place and the clock to the end. Measured against the
    // bar itself, so it is the same whichever way the room was lost.
    <div
      className="@container flex items-center justify-between gap-2 overflow-hidden whitespace-nowrap font-bold font-mono shrink-0 h-7 compact:h-6 relative z-10"
      style={{ background: "var(--nuza-status-bg)" }}
    >
      <div className="flex h-full shrink-0 items-center">
        <span className={`text-xs uppercase px-4 h-full flex shrink-0 items-center w-fit ${modeStyle ?? ""}`}>
          {modeStyle ? `--${mode}--` : ""}
        </span>
        <span className="font-light text-xs text-gray-500 flex items-center gap-3 px-4">
          <span>
            Ln {line}, Col {column}
          </span>
          {words > 0 && <span className="@max-[620px]:hidden">{words.toLocaleString()} words</span>}
          <span className="contents @max-[780px]:hidden">
            <NoteAge path={notePath} saved={saved} />
          </span>
        </span>
      </div>

      <span className="font-light text-xs text-gray-400 flex h-full min-w-0 flex-1 items-center justify-end gap-2">
        <span className="min-w-0 truncate @max-[520px]:hidden">{fileName}</span>
        <span className="text-xs font-medium uppercase px-4 h-full flex shrink-0 items-center bg-[var(--nuza-accent)] text-black w-fit ml-2">
          {timestamp}
        </span>
      </span>
    </div>
  );
}

export default memo(StatusBar);
