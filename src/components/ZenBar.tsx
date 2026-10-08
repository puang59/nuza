interface ZenBarProps {
  /** The keys that leave zen mode, as they read on this platform. */
  keys: string;
  onExit: () => void;
}

/**
 * What stands in for the title bar in zen mode: nothing, until it is pointed
 * at.
 *
 * The strip is still there to drag the window by, and to leave room for the
 * window's own buttons where it draws them over the page. Pointing at it
 * brings up the one thing someone who has forgotten the shortcut needs: the
 * way out.
 */
export default function ZenBar({ keys, onExit }: ZenBarProps) {
  return (
    <div
      data-tauri-drag-region
      className="group/zen flex h-9 shrink-0 items-center justify-end px-4 print:hidden"
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
