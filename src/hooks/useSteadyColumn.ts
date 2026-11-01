import { RefObject, useLayoutEffect, useRef } from "react";

/** How long the side panels take to slide (`.sidebar-transition`), and a little over. */
const SLIDE_MS = 260;

const COLUMN = "--nuza-steady-column";
const GROW = "--nuza-steady-grow";

function release(root: HTMLElement) {
  for (const scroller of root.querySelectorAll<HTMLElement>(".cm-scroller")) {
    scroller.style.removeProperty(COLUMN);
    scroller.style.removeProperty(GROW);
  }
}

/**
 * Holds the note's text column at one width while a side panel slides in or
 * out.
 *
 * The panels slide by animating their width, so the editor beside them is a
 * different width on every frame of the slide. Left alone, every paragraph in
 * view re-wrapped on every frame - words hopping between lines, everything
 * under them bobbing up and down. Instead, for the length of the slide, the
 * column is held at the narrower of the width it has and the width it will
 * have: a panel opening re-wraps the text once, as it starts, and one closing
 * re-wraps it once, as it finishes. In between, the column only moves.
 *
 * `panelSpace` is the width the panels take up between them. `sliding` is
 * false while a panel is being dragged to a new width, which follows the
 * pointer with no transition and so has no slide to hold still through.
 */
export function useSteadyColumn(area: RefObject<HTMLElement | null>, panelSpace: number, sliding: boolean) {
  const previous = useRef(panelSpace);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    // How much wider the editor is about to get: less than nothing when a
    // panel is opening.
    const change = previous.current - panelSpace;
    previous.current = panelSpace;
    const root = area.current;
    if (!change || !sliding || !root) return;

    // Read before anything is set: the transition has not moved yet, so this
    // is the layout the slide starts from. In the split the panes share the
    // change between them.
    const scrollers = Array.from(root.querySelectorAll<HTMLElement>(".cm-scroller"));
    const widths = scrollers.map((scroller) => {
      const content = scroller.querySelector<HTMLElement>(".cm-content");
      if (!content) return null;
      const padding = getComputedStyle(scroller);
      const room = scroller.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight);
      const measure = parseFloat(getComputedStyle(content).maxWidth) || Infinity;
      const after = Math.min(measure, room + change / scrollers.length);
      return Math.max(0, Math.min(content.getBoundingClientRect().width, after));
    });

    scrollers.forEach((scroller, index) => {
      const width = widths[index];
      if (width === null) return;
      scroller.style.setProperty(COLUMN, `${width}px`);
      scroller.style.setProperty(GROW, "0");
    });

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      release(root);
    }, SLIDE_MS);
  }, [area, panelSpace, sliding]);

  useLayoutEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
}
