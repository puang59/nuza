import { Registry } from "./registry";

/**
 * A view added to the sidebar's switcher, after Files, Outline, Tags and
 * Links. It is given the panel's element when it is chosen, and keeps it up to
 * date itself; what it hands back is called when another view is chosen or the
 * view is taken away.
 */
export interface SidebarViewSpec {
  id: string;
  /** Its name in the switcher: a word, since it shares the row with four others. */
  label: string;
  /** What hovering its name says. */
  title?: string;
  mount(el: HTMLElement): void | (() => void);
}

/** The views added to this window's sidebar. */
export const sidebarViews = new Registry<SidebarViewSpec>();
