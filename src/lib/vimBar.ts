import { contrast, isHexColor } from "./appearance";

/**
 * The colours of the Vim bar: a badge for each mode, and one for the clock.
 *
 * Chosen as a preset, or one colour at a time. A colour is a hex, or one of
 * two that follow the window instead: `accent`, the accent from Settings, and
 * `ink`, the colour notes are written in - which is how the monotone preset is
 * black on white in a dark window and white on black in a light one.
 */
export type VimBarSlot = "normal" | "insert" | "visual" | "replace" | "clock";

export type VimBarColors = Record<VimBarSlot, string>;

export const VIM_BAR_SLOTS: { id: VimBarSlot; label: string; description: string }[] = [
  { id: "normal", label: "Normal Mode", description: "The badge while moving around" },
  { id: "insert", label: "Insert Mode", description: "The badge while typing" },
  { id: "visual", label: "Visual Mode", description: "The badge while selecting" },
  { id: "replace", label: "Replace Mode", description: "The badge while typing over text" },
  { id: "clock", label: "Clock", description: "The time at the right of the bar" },
];

export interface VimBarPreset {
  id: string;
  label: string;
  colors: VimBarColors;
}

export const VIM_BAR_PRESETS: VimBarPreset[] = [
  {
    id: "classic",
    label: "Classic",
    colors: { normal: "#9696FF", insert: "#96FF96", visual: "#FFFF96", replace: "#FF9696", clock: "accent" },
  },
  {
    id: "monotone",
    label: "Monotone",
    colors: { normal: "ink", insert: "ink", visual: "ink", replace: "ink", clock: "ink" },
  },
  {
    id: "nord",
    label: "Nord",
    colors: { normal: "#88C0D0", insert: "#A3BE8C", visual: "#B48EAD", replace: "#BF616A", clock: "#81A1C1" },
  },
  {
    id: "dracula",
    label: "Dracula",
    colors: { normal: "#BD93F9", insert: "#50FA7B", visual: "#F1FA8C", replace: "#FF5555", clock: "#FF79C6" },
  },
  {
    id: "gruvbox",
    label: "Gruvbox",
    colors: { normal: "#83A598", insert: "#B8BB26", visual: "#FABD2F", replace: "#FB4934", clock: "#FE8019" },
  },
  {
    id: "catppuccin",
    label: "Catppuccin",
    colors: { normal: "#89B4FA", insert: "#A6E3A1", visual: "#CBA6F7", replace: "#F38BA8", clock: "#F5C2E7" },
  },
  {
    id: "tokyo-night",
    label: "Tokyo Night",
    colors: { normal: "#7AA2F7", insert: "#9ECE6A", visual: "#BB9AF7", replace: "#F7768E", clock: "#E0AF68" },
  },
  {
    id: "solarized",
    label: "Solarized",
    colors: { normal: "#268BD2", insert: "#859900", visual: "#6C71C4", replace: "#DC322F", clock: "#B58900" },
  },
];

export interface VimBarStyle {
  /** One of the presets, or `custom` for the colours below. */
  preset: string;
  /** The colours picked one at a time, kept when a preset is chosen so they come back. */
  custom?: VimBarColors;
}

export const DEFAULT_VIM_BAR: VimBarStyle = { preset: "classic" };

const CLASSIC = VIM_BAR_PRESETS[0].colors;

function isColor(value: unknown): value is string {
  return value === "accent" || value === "ink" || (typeof value === "string" && isHexColor(value));
}

/**
 * The colours `style` paints the bar in. Whatever was stored, every slot comes
 * out as something drawable: an unknown preset is Classic, and a custom colour
 * that is not a colour is Classic's for that slot.
 */
export function vimBarColors(style: VimBarStyle | null | undefined): VimBarColors {
  if (style?.preset === "custom") {
    const custom: Partial<Record<VimBarSlot, unknown>> = style.custom ?? {};
    const colors = { ...CLASSIC };
    for (const { id } of VIM_BAR_SLOTS) if (isColor(custom[id])) colors[id] = custom[id] as string;
    return colors;
  }
  return VIM_BAR_PRESETS.find((preset) => preset.id === style?.preset)?.colors ?? CLASSIC;
}

/** A colour as a hex, for a colour picker: `accent` and `ink` as they are now. */
export function resolveVimBarColor(color: string, window: { accent: string; ink: string }) {
  if (color === "accent") return window.accent;
  if (color === "ink") return window.ink;
  return color;
}

/**
 * How a badge in `color` is drawn: its background, and ink that can be read on
 * it - black or white, whichever stands further from it.
 */
export function vimBarBadge(color: string): { background: string; color: string } {
  // Black on the accent, as the clock has always been.
  if (color === "accent") return { background: "var(--nuza-accent)", color: "#000000" };
  // The window's own pair, the other way round.
  if (color === "ink") return { background: "var(--nuza-fg)", color: "var(--nuza-bg)" };
  return {
    background: color,
    color: contrast(color, "#000000") >= contrast(color, "#FFFFFF") ? "#000000" : "#FFFFFF",
  };
}
