import { Registry } from "./registry";

/**
 * Something added to the footer beside nuza's own counts. It is given an
 * element of its own, once, and keeps it up to date itself; what it hands
 * back is called when the item is taken away.
 */
export interface StatusItemSpec {
  id: string;
  /** Its name in the footer's right-click menu. */
  label: string;
  mount(el: HTMLElement): void | (() => void);
}

/** The footer items added to this window, after nuza's own. */
export const statusItems = new Registry<StatusItemSpec>();
