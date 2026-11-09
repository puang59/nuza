import { useEffect, useRef, type HTMLAttributes } from "react";
import { report } from "@/lib/notices";

/** Something drawn into an element nuza makes for it, rather than by React. */
export interface Mountable {
  /** What it is called where it is shown, for saying which one failed. */
  label: string;
  mount(el: HTMLElement): void | (() => void);
}

interface MountedProps extends HTMLAttributes<HTMLElement> {
  item: Mountable;
  /** Where it was meant to be, as in "couldn't be shown in the footer". */
  place: string;
  as?: "span" | "div";
}

/**
 * An element made once and handed to `item` to fill, and given back - its
 * clean-up run, its contents cleared - when the item goes or this unmounts.
 * A `mount` that throws is reported and leaves the element empty, rather than
 * taking down what it sits in.
 */
export default function Mounted({ item, place, as: Tag = "div", ...rest }: MountedProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cleanup: void | (() => void);
    try {
      cleanup = item.mount(el);
    } catch (error) {
      report(`"${item.label}" couldn't be shown in ${place}`, error);
    }
    return () => {
      try {
        cleanup?.();
      } catch (error) {
        console.error(`Failed to take "${item.label}" out of ${place}:`, error);
      }
      el.replaceChildren();
    };
  }, [item, place]);

  return <Tag ref={ref as React.Ref<never>} {...rest} />;
}
