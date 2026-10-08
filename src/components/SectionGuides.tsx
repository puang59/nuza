import { memo } from "react";
import { Outline, headingPath } from "@/lib/markdown/headings";

/** The deepest heading that gets a mark on the rail. Below that it is noise. */
const RAIL_DEPTH = 3;

interface SectionGuidesProps {
  outline: Outline;
  /** Goes to the heading whose line starts at `from`. */
  onJump: (from: number) => void;
}

/**
 * Two quiet signs of where you are in a long note, for when the outline
 * panel is not open.
 *
 * Down the left edge, a short tick for each heading - set in a little for
 * each level - with the one for the section in view brightened; a tick goes
 * to its heading. And across the top, once a section's own heading has
 * scrolled away, the name of the section you are reading and the ones it sits
 * under.
 *
 * Neither is there for a note with fewer than two headings: there is nothing
 * to find your place among.
 */
function SectionGuides({ outline, onJump }: SectionGuidesProps) {
  const { headings, active, headingOffscreen } = outline;
  if (headings.length < 2) return null;

  const path = headingOffscreen ? headingPath(headings, active) : [];
  const top = headings.reduce((least, heading) => Math.min(least, heading.level), 6);
  const marks = headings
    .map((heading, index) => ({ heading, index }))
    .filter(({ heading }) => heading.level - top < RAIL_DEPTH);

  return (
    <>
      {/* Hairlines rather than marks: all one colour, the level told by
          length alone, and nothing in the accent colour - only the section in
          view a shade brighter. Faint until the edge is pointed at. */}
      <nav
        aria-label="Sections"
        className="group/rail absolute inset-y-0 left-0 z-10 flex w-6 flex-col justify-center gap-[5px] pl-2 opacity-40 transition-opacity duration-200 hover:opacity-100 print:hidden"
      >
        {marks.map(({ heading, index }) => (
          <button
            key={`${heading.from}:${heading.text}`}
            type="button"
            title={heading.text}
            aria-label={heading.text}
            aria-current={index === active ? "location" : undefined}
            // Pressed without taking the keyboard: the jump puts it in the note.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onJump(heading.from)}
            style={{ width: `${10 - (heading.level - top) * 3}px` }}
            className={`h-px cursor-pointer rounded-full transition-colors duration-150 hover:bg-zinc-200 ${
              index === active ? "bg-zinc-300" : "bg-zinc-600"
            }`}
          />
        ))}
      </nav>

      {path.length > 0 && (
        <div className="animate-fade-in pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center px-8 pt-2 print:hidden">
          <button
            type="button"
            title="Back to this section's heading"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onJump(path[path.length - 1].from)}
            className="pointer-events-auto max-w-full cursor-pointer truncate rounded-md bg-[var(--nuza-bg)] px-2 py-0.5 text-[11px] text-zinc-600 transition-colors hover:text-zinc-300"
          >
            {path.map((heading, index) => (
              <span key={heading.from}>
                {index > 0 && <span className="mx-1.5 opacity-50">›</span>}
                <span className={index === path.length - 1 ? "text-zinc-400" : undefined}>
                  {heading.text}
                </span>
              </span>
            ))}
          </button>
        </div>
      )}
    </>
  );
}

export default memo(SectionGuides);
