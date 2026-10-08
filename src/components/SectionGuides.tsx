import { memo } from "react";
import { Outline, headingPath } from "@/lib/markdown/headings";

/** The deepest heading that gets a line on the rail. Below that it is noise. */
const RAIL_DEPTH = 3;
/**
 * How far a line is set in, by how far down the levels its heading sits. The
 * lines are all one length and step to the right, the way an outline is
 * written: a shorter line under a longer one read as a smaller thing rather
 * than as a thing inside it, and three of them as a ragged edge.
 */
const LINE_INDENTS = ["ml-0", "ml-1.5", "ml-3"];
/** How far each level is set in, in the list of names. */
const NAME_INDENTS = ["pl-2.5", "pl-5", "pl-[1.875rem]"];

interface SectionGuidesProps {
  outline: Outline;
  /** Goes to the heading whose line starts at `from`. */
  onJump: (from: number) => void;
}

/**
 * Two quiet signs of where you are in a long note, for when the outline
 * panel is not open.
 *
 * At the left edge, level with the middle of the pane, a short stack of
 * lines - one to a heading, set in for each level down - with the one for
 * the section you are in a shade brighter. It is a picture of the note's shape,
 * not a set of buttons: lines that size are no target to aim at. Pointing at
 * the stack opens the same headings as a list of names, and it is a name that
 * is clicked.
 *
 * And across the top, once a section's own heading has scrolled away, the
 * name of the section you are reading and the ones it sits under.
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
    .map((heading, index) => ({ heading, index, depth: heading.level - top }))
    .filter(({ depth }) => depth < RAIL_DEPTH);
  // The section in view may be deeper than the rail goes; the line that
  // stands for it is then the nearest one above.
  const lit = marks.reduce((found, mark) => (mark.index <= active ? mark.index : found), -1);

  return (
    <>
      <nav
        aria-label="Sections"
        className="group/rail absolute left-0 top-1/2 z-20 -translate-y-1/2 py-3 pl-2.5 pr-3 print:hidden"
      >
        {/* The picture: all one colour and one weight, so it reads as a
            single quiet shape rather than as a row of separate marks. */}
        <div
          aria-hidden
          className="flex max-h-[50vh] flex-col gap-[7px] overflow-hidden transition-opacity duration-150 group-hover/rail:opacity-0 group-focus-within/rail:opacity-0"
        >
          {marks.map(({ heading, index, depth }) => (
            <span
              key={`${heading.from}:${heading.text}`}
              className={`h-[2px] w-3 rounded-full transition-colors duration-200 ${LINE_INDENTS[depth]} ${
                index === lit ? "bg-zinc-300" : "bg-zinc-700"
              }`}
            />
          ))}
        </div>

        {/* The same headings, by name. Laid over the lines where they were
            rather than beside them, so the pointer is already on it. */}
        <div className="pointer-events-none absolute left-1.5 top-1/2 w-56 -translate-y-1/2 scale-[0.98] rounded-lg border border-zinc-800 bg-[var(--nuza-bg)] p-1 opacity-0 shadow-xl shadow-black/30 transition-[opacity,transform] duration-150 group-hover/rail:pointer-events-auto group-hover/rail:scale-100 group-hover/rail:opacity-100 group-focus-within/rail:pointer-events-auto group-focus-within/rail:scale-100 group-focus-within/rail:opacity-100 motion-reduce:transition-none">
          <ul className="max-h-[60vh] overflow-y-auto">
            {marks.map(({ heading, index, depth }) => (
              <li key={`${heading.from}:${heading.text}`}>
                <button
                  type="button"
                  aria-current={index === lit ? "location" : undefined}
                  // Pressed without taking the keyboard: the jump puts it in the note.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onJump(heading.from)}
                  className={`block w-full cursor-pointer truncate rounded-md py-1 pr-2.5 text-left text-xs outline-none transition-colors hover:bg-zinc-800/60 focus-visible:bg-zinc-800/60 ${NAME_INDENTS[depth]} ${
                    index === lit ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {heading.text}
                </button>
              </li>
            ))}
          </ul>
        </div>
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
