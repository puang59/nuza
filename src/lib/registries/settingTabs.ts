import { Registry } from "./registry";

/**
 * A pane added to Settings, listed after nuza's own. It is given the pane's
 * element each time it is opened, and fills it itself; what it hands back is
 * called when another pane is chosen or Settings closes.
 */
export interface SettingTabSpec {
  id: string;
  /** Its name in the list down the side of Settings. */
  label: string;
  mount(el: HTMLElement): void | (() => void);
}

/** The panes added to this window's Settings. */
export const settingTabs = new Registry<SettingTabSpec>();
