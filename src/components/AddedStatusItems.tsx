import { memo } from "react";
import { statusItems } from "@/lib/registries/statusItems";
import { useRegistry } from "@/lib/registries/registry";
import Mounted from "./Mounted";

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
          <Mounted
            key={item.id}
            item={item}
            place="the footer"
            as="span"
            className="shrink-0 tabular-nums"
            data-status-item={item.id}
          />
        ))}
    </>
  );
}

export default memo(AddedStatusItems);
