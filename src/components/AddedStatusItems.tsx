import { memo, useEffect, useRef } from "react";
import { report } from "@/lib/notices";
import { statusItems, type StatusItemSpec } from "@/lib/registries/statusItems";
import { useRegistry } from "@/lib/registries/registry";

/** One added item: an element made once, handed to its owner, and given back on the way out. */
function AddedStatusItem({ item }: { item: StatusItemSpec }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cleanup: void | (() => void);
    try {
      cleanup = item.mount(el);
    } catch (error) {
      report(`"${item.label}" couldn't be shown in the footer`, error);
    }
    return () => {
      try {
        cleanup?.();
      } catch (error) {
        console.error(`Failed to take "${item.label}" out of the footer:`, error);
      }
      el.replaceChildren();
    };
  }, [item]);

  return <span ref={ref} className="shrink-0 tabular-nums" data-status-item={item.id} />;
}

interface AddedStatusItemsProps {
  shows: (id: string) => boolean;
}

/** The footer items added beside nuza's own, less any hidden from the right-click menu. */
function AddedStatusItems({ shows }: AddedStatusItemsProps) {
  const items = useRegistry(statusItems);
  return (
    <>
      {items
        .filter((item) => shows(item.id))
        .map((item) => (
          <AddedStatusItem key={item.id} item={item} />
        ))}
    </>
  );
}

export default memo(AddedStatusItems);
