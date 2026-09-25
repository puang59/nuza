import { memo, useEffect, useState } from "react";
import { StatsSubscription, useDocumentStats } from "@/hooks/useDocumentStats";

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
}

/** Background/text color for each Vim mode indicator, keyed by CodeMirror's mode name. */
const VIM_MODE_STYLES: Record<string, string> = {
  insert: "bg-[#96FF96] text-black",
  normal: "bg-[#9696FF] text-black",
  visual: "bg-[#FFFF96] text-black",
};

/**
 * The bottom bar as Vim users get it: mode on the left, then where the caret is
 * and how much has been written, with the file name and the time on the right.
 */
function StatusBar({ mode, currentFile, subscribeToStats }: StatusBarProps) {
  const modeStyle = VIM_MODE_STYLES[mode];
  const fileName = currentFile.split(/[/\\]/).pop() || "untitled.md";
  const timestamp = useClock();
  const { words, line, column } = useDocumentStats(subscribeToStats);

  return (
    <div className="bg-[#1E1E1E] flex items-center justify-between font-bold font-mono shrink-0 h-7 relative z-10">
      <div className="flex items-center h-full">
        <span className={`text-xs uppercase px-4 h-full flex items-center w-fit ${modeStyle ?? ""}`}>
          {modeStyle ? `--${mode}--` : ""}
        </span>
        <span className="font-light text-xs text-gray-500 flex items-center gap-3 px-4">
          <span>
            Ln {line}, Col {column}
          </span>
          {words > 0 && <span>{words.toLocaleString()} words</span>}
        </span>
      </div>

      <span className="font-light text-xs text-gray-400 flex items-center gap-2 h-full">
        {fileName}
        <span className="text-xs font-medium uppercase px-4 h-full flex items-center bg-[#FF9696] text-black w-fit ml-2">
          {timestamp}
        </span>
      </span>
    </div>
  );
}

export default memo(StatusBar);
