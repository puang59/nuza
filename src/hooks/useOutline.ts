import { useEffect, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { EMPTY_OUTLINE, Outline, subscribeToOutline } from "@/lib/markdown/headings";

/**
 * The headings of the note in `view`, and which section of it is in view -
 * what the sidebar's outline draws. Only re-renders when one of those two
 * things changes, not on every scroll or keystroke.
 */
export function useOutline(view: EditorView | null): Outline {
  const [outline, setOutline] = useState<Outline>(EMPTY_OUTLINE);

  useEffect(() => {
    if (!view) return;
    return subscribeToOutline((from, next) => {
      if (from !== view) return;
      setOutline((last) =>
        last.active === next.active &&
        last.headingOffscreen === next.headingOffscreen &&
        sameHeadings(last.headings, next.headings)
          ? last
          : next
      );
    });
  }, [view]);

  // With no editor there is no note to have an outline of, whatever was last heard.
  return view ? outline : EMPTY_OUTLINE;
}

function sameHeadings(a: Outline["headings"], b: Outline["headings"]) {
  return (
    a.length === b.length &&
    a.every(
      (heading, index) =>
        heading.from === b[index].from && heading.level === b[index].level && heading.text === b[index].text
    )
  );
}
