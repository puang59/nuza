import { useCallback, useMemo, useState } from "react";
import type { ContextMenuItem } from "@/components/Sidebar/ContextMenu";
import { usePersistedState } from "./usePersistedState";

/** Everything either footer can show, by the name the right-click menu gives it. */
export const STATUS_ITEMS = {
  position: "Line and Column",
  words: "Words",
  characters: "Characters",
  paragraphs: "Paragraphs",
  reading: "Reading Time",
  age: "Last Edited",
  fileName: "File Name",
  clock: "Clock",
} as const;

export type StatusItem = keyof typeof STATUS_ITEMS;

/**
 * Which of the footer's counts are shown, chosen from its right-click menu and
 * kept across restarts. Stored as the ones hidden, so an item added later is
 * shown until someone says otherwise.
 */
export function useStatusItems(offered: readonly StatusItem[]) {
  const [stored, setStored] = usePersistedState<string[]>("statusBarHidden", []);
  const hidden = useMemo(() => new Set(Array.isArray(stored) ? stored : []), [stored]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const shows = useCallback((item: StatusItem) => !hidden.has(item), [hidden]);

  const menuItems: ContextMenuItem[] = offered.map((item) => ({
    label: STATUS_ITEMS[item],
    checked: !hidden.has(item),
    onClick: () =>
      setStored((list) => {
        const current = Array.isArray(list) ? list : [];
        return current.includes(item) ? current.filter((other) => other !== item) : [...current, item];
      }),
  }));

  const openMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY });
  }, []);

  return { shows, menu, menuItems, openMenu, closeMenu: () => setMenu(null) };
}
