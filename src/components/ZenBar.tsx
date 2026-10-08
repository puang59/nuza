interface ZenBarProps {
  /** The keys that leave zen mode, as they read on this platform. */
  keys: string;
  onExit: () => void;
}

/**
 * What is left of the title bar in zen mode: nothing to see.
 *
 * A strip across the top of the page that takes no room from it - the note
 * runs underneath - and is still there to drag the window by. Pointing at it
 * brings up the one thing someone who has forgotten the shortcut needs: the
 * way out.
 */
export default function ZenBar({ keys, onExit }: ZenBarProps) {
  return (
    <div
      data-tauri-drag-region
      className="group/zen absolute inset-x-0 top-0 z-30 flex h-8 items-center justify-end px-4 print:hidden"
    >
      <button
        type="button"
        data-tauri-drag-region="false"
        onClick={onExit}
        className="cursor-pointer rounded-md px-2 py-0.5 text-[11px] text-zinc-500 opacity-0 transition-opacity duration-200 hover:text-zinc-200 focus-visible:opacity-100 group-hover/zen:opacity-100"
      >
        Exit Zen Mode{keys ? ` (${keys})` : ""}
      </button>
    </div>
  );
}
