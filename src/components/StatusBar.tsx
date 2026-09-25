import { memo, useEffect, useState } from "react";
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
  vimEnabled: boolean;
  mode: string;
  currentFile: string;
}

/** Background/text color for each Vim mode indicator, keyed by CodeMirror's mode name. */
const VIM_MODE_STYLES: Record<string, string> = {
  insert: "bg-[#96FF96] text-black",
  normal: "bg-[#9696FF] text-black",
  visual: "bg-[#FFFF96] text-black",
};

/** The bottom bar: current Vim mode on the left, file name and the time on the right. */
function StatusBar({ vimEnabled, mode, currentFile }: StatusBarProps) {
  const modeStyle = vimEnabled ? VIM_MODE_STYLES[mode] : undefined;
  const fileName = currentFile.split(/[/\\]/).pop() || "untitled.md";
  const timestamp = useClock();

  return (
    <div className="bg-[#1E1E1E] flex items-center justify-between font-bold font-mono shrink-0 h-7 relative z-10">
      <span className={`text-xs uppercase px-4 h-full flex items-center w-fit ${modeStyle ?? ""}`}>
        {modeStyle ? `--${mode}--` : ""}
      </span>
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
