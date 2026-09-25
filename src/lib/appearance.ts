/**
 * The colours the app is painted in, and everything derived from them.
 *
 * One is chosen - the accent. The background and the ink are fixed, and the
 * rest - the hairlines, the hover surfaces, the heading white, the selection
 * wash - are worked out from all three, so a change to the accent carries
 * through the whole window instead of leaving half of it behind.
 */
export interface Appearance {
  accent: string;
  /** How much of the desktop shows through, 0 (opaque) to 100 (invisible). */
  transparency: number;
}

/**
 * The window behind everything, and the ink notes are written in. Not settings:
 * a note app that lets you pick both ends of its own contrast is a note app you
 * can make unreadable, so these stay where they were tuned.
 */
export const BACKGROUND = "#1E1E1E";
export const FOREGROUND = "#D4D4D8";

export const DEFAULT_APPEARANCE: Appearance = {
  accent: "#FF9696",
  transparency: 100,
};

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: string) {
  return HEX.test(value.trim());
}

/** A `#abc` or `#aabbcc` colour as its three channels. */
function channels(hex: string): [number, number, number] {
  const value = hex.trim().slice(1);
  const full = value.length === 3 ? value.replace(/./g, (c) => c + c) : value;
  const number = parseInt(full, 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

export function withAlpha(hex: string, alpha: number) {
  const [r, g, b] = channels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Steps `hex` towards `target` by `amount`, 0 to 1. */
function towards(hex: string, target: string, amount: number) {
  const from = channels(hex);
  const to = channels(target);
  const mixed = from.map((channel, index) => Math.round(channel + (to[index] - channel) * amount));
  return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`;
}

/** Whether ink this colour wants a light backdrop behind it. */
function isLight(hex: string) {
  const [r, g, b] = channels(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140;
}

export function clampTransparency(value: number) {
  return Math.min(100, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)));
}

/**
 * Every custom property the stylesheet and the editor theme read. Written onto
 * the document root, so changing a colour restyles the window without the
 * editor being reconfigured or a single component re-rendering.
 */
export function appearanceVariables(appearance: Appearance): Record<string, string> {
  const { accent } = appearance;
  const background = BACKGROUND;
  const foreground = FOREGROUND;
  const opaque = 1 - clampTransparency(appearance.transparency) / 100;
  // Headings step away from the background rather than always towards white,
  // so ink on a light background gets darker instead of vanishing.
  const emphasis = isLight(foreground) ? "#FFFFFF" : "#000000";

  return {
    "--nuza-accent": accent,
    "--nuza-accent-strong": withAlpha(accent, 0.85),
    "--nuza-accent-wash": withAlpha(accent, 0.24),
    "--nuza-accent-faint": withAlpha(accent, 0.045),
    "--nuza-accent-line": withAlpha(accent, 0.5),
    "--nuza-accent-underline": withAlpha(accent, 0.35),

    "--nuza-bg": background,
    "--nuza-bg-alpha": withAlpha(background, opaque),

    "--nuza-fg": foreground,
    "--nuza-heading": towards(foreground, emphasis, 0.45),
    "--nuza-muted": towards(foreground, background, 0.45),
    "--nuza-hairline": withAlpha(foreground, 0.1),
    "--nuza-surface": withAlpha(foreground, 0.045),
    "--nuza-surface-strong": withAlpha(foreground, 0.07),
    "--nuza-selection-idle": withAlpha(foreground, 0.09),
  };
}
