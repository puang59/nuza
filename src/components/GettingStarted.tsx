import { memo } from "react";
import { StatsSubscription, useDocumentStats } from "@/hooks/useDocumentStats";
import { describeStartingPoint, startingPoints } from "@/lib/gettingStarted";
import type { KeymapAction } from "@/lib/keymaps";

interface GettingStartedProps {
  /** Whether the note in front is the scratch note - the only one this is shown over. */
  onScratch: boolean;
  hasVault: boolean;
  subscribeToStats: StatsSubscription;
  /** The keys each action is on right now, so what is shown is what works. */
  bindings: Record<KeymapAction, string>;
  /** Does what the keys would do, for a click. */
  onRun: (action: KeymapAction) => void;
}

/**
 * A few ways in, set in the middle of an empty scratch note.
 *
 * The app opens on a blank page, which is the right thing for someone who
 * knows it and no help at all to someone who does not: nothing says a folder
 * can be opened, or that there are keys for anything. So while the page is
 * empty it carries the first things worth knowing, each with its shortcut,
 * and each one a click away. The moment something is typed they are gone -
 * the page is for writing, and this is only there until it is written on.
 */
function GettingStarted({ onScratch, hasVault, subscribeToStats, bindings, onRun }: GettingStartedProps) {
  const { characters } = useDocumentStats(subscribeToStats);
  if (!onScratch || characters > 0) return null;

  return (
    // Lets clicks through to the note everywhere but on the lines themselves,
    // so the page can still be clicked into and typed on.
    <div className="animate-fade-in pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 px-6 text-center print:hidden">
      {startingPoints(hasVault).map(({ action, label }) => (
        <button
          key={action}
          type="button"
          // Pressed without taking the keyboard from the note.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onRun(action)}
          className="pointer-events-auto cursor-pointer rounded-md px-2 py-0.5 text-[15px] text-[var(--nuza-accent)] opacity-80 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nuza-accent)]"
        >
          {describeStartingPoint(label, bindings[action])}
        </button>
      ))}
      <p className="mt-2 text-xs text-zinc-600">Or just start typing. This page is a scratchpad.</p>
    </div>
  );
}

export default memo(GettingStarted);
