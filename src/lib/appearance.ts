/**
 * The colours the app is painted in, and everything derived from them.
 *
 * One is chosen - the accent. The background and the ink are fixed, and the
 * rest - the hairlines, the hover surfaces, the heading white, the selection
 * wash - are worked out from all three, so a change to the accent carries
 * through the whole window instead of leaving half of it behind.
 */
/** What the window is painted as. */
export type Theme = "dark" | "light";
/** What was chosen: one of the two, or whichever the system is using. */
export type ThemeChoice = Theme | "system";

export const THEME_CHOICES: { id: ThemeChoice; label: string }[] = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "system", label: "System" },
];

export interface Appearance {
  accent: string;
  /** How much of the desktop shows through, 0 (opaque) to 100 (invisible). */
  transparency: number;
  theme: ThemeChoice;
  /** The window's background and the ink, where they have been changed, per theme. */
  palettes?: Partial<Record<Theme, Palette>>;
}

/** A theme's own colours, where they differ from the ones it comes with. */
export interface Palette {
  background?: string;
  text?: string;
}

/**
 * How far apart the ink and the background have to be: WCAG's AA level for
 * body text. Below it, what was asked for is put back to the theme's own.
 */
export const MIN_CONTRAST = 4.5;

/**
 * The window behind everything, and the ink notes are written in, as each
 * theme comes. Either can be changed in Settings, but only within reach of the
 * other: a note app that lets you pick both ends of its own contrast is a note
 * app you can make unreadable, which `paletteFor` does not allow.
 */
export const THEMES: Record<Theme, { background: string; foreground: string }> = {
  dark: { background: "#1E1E1E", foreground: "#D4D4D8" },
  light: { background: "#FBFBFA", foreground: "#3F3F46" },
};

/**
 * Colours that are not worked out from the pair: the code in a note, and the
 * tint that sets the writing surface a shade apart from the chrome. The dark
 * ones are pastels, which on white would all but disappear.
 */
const FIXED: Record<Theme, Record<string, string>> = {
  dark: {
    "--nuza-code": "#9696FF",
    "--nuza-syntax-keyword": "#C792EA",
    "--nuza-syntax-string": "#96FF96",
    "--nuza-syntax-number": "#F5C97B",
    "--nuza-syntax-function": "#9696FF",
    "--nuza-syntax-type": "#7BD7F5",
    "--nuza-editor-tint": "rgba(0, 0, 0, 0.2)",
    // The Vim bar: solid, as it has always been on dark.
    "--nuza-status-bg": "var(--nuza-bg)",
  },
  light: {
    "--nuza-code": "#5151C7",
    "--nuza-syntax-keyword": "#8A3FC7",
    "--nuza-syntax-string": "#1F8A3B",
    "--nuza-syntax-number": "#A8641A",
    "--nuza-syntax-function": "#4A4AD0",
    "--nuza-syntax-type": "#0E7490",
    "--nuza-editor-tint": "rgba(0, 0, 0, 0.03)",
    // On light a solid bar is the palest thing in a window whose editor is
    // the tinted, see-through backdrop - so it is painted as that surface is:
    // the window's background, with the editor's tint laid over it.
    "--nuza-status-bg":
      "linear-gradient(var(--nuza-editor-tint), var(--nuza-editor-tint)), var(--nuza-bg-alpha)",
  },
};

export const DEFAULT_APPEARANCE: Appearance = {
  accent: "#FF9696",
  transparency: 100,
  // Dark, as nuza always was: nobody updates into a different-looking app.
  theme: "dark",
};

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "dark" || value === "light" || value === "system";
}

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

/** `towards`, as `#rrggbb` - for a colour that more colours are worked out from. */
function towardsHex(hex: string, target: string, amount: number) {
  const from = channels(hex);
  const to = channels(target);
  return `#${from
    .map((channel, index) =>
      Math.round(channel + (to[index] - channel) * amount)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}

/** Whether ink this colour wants a light backdrop behind it. */
function isLight(hex: string) {
  const [r, g, b] = channels(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140;
}

/** WCAG relative luminance of a colour. */
function luminance(hex: string) {
  const [r, g, b] = channels(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio between two colours, from 1 to 21. */
export function contrast(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * The background and ink `theme` is drawn in: its own, or the ones chosen in
 * Settings - but never two that cannot be read against each other. Changing
 * both ends of a note app's contrast is how it is made unreadable, so a text
 * colour too close to the background gives way to the theme's own, and if
 * that cannot be read on the background either, the background gives way.
 * `putBack` says which, for Settings to explain.
 */
export function paletteFor(appearance: Appearance, theme: Theme) {
  const own = THEMES[theme];
  const chosen = appearance.palettes?.[theme] ?? {};
  const background = chosen.background ?? own.background;
  const text = chosen.text ?? own.foreground;

  if (contrast(text, background) >= MIN_CONTRAST) {
    return { background, foreground: text, putBack: null };
  }
  if (contrast(own.foreground, background) >= MIN_CONTRAST) {
    return { background, foreground: own.foreground, putBack: "text" as const };
  }
  const foreground = contrast(text, own.background) >= MIN_CONTRAST ? text : own.foreground;
  return { background: own.background, foreground, putBack: "background" as const };
}

export function clampTransparency(value: number) {
  return Math.min(100, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)));
}

/**
 * Every custom property the stylesheet and the editor theme read. Written onto
 * the document root, so changing a colour restyles the window without the
 * editor being reconfigured or a single component re-rendering.
 */
export function appearanceVariables(
  appearance: Appearance,
  /**
   * Whether the window has an OS-level backdrop behind it. Without one there
   * is nothing for the desktop to show through - the window would be a hole
   * rather than a pane - so the background is painted solid whatever the
   * transparency setting says.
   */
  hasBackdrop = true,
  /** The theme in force - `appearance.theme`, with "system" already settled. */
  theme: Theme = "dark"
): Record<string, string> {
  const { background, foreground } = paletteFor(appearance, theme);
  // The accent is picked against the dark window. On a light one the same
  // colour is too pale to read as text - a link, a bullet - so it is taken
  // down towards the ink first, and everything derived from it follows.
  const accent = theme === "light" ? towardsHex(appearance.accent, "#000000", 0.28) : appearance.accent;
  const opaque = hasBackdrop ? 1 - clampTransparency(appearance.transparency) / 100 : 1;
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
    "--nuza-rule-strong": withAlpha(foreground, 0.4),
    "--nuza-surface": withAlpha(foreground, 0.045),
    "--nuza-surface-strong": withAlpha(foreground, 0.07),
    "--nuza-selection-idle": withAlpha(foreground, 0.09),

    // Quiet enough to miss, there when looked for.
    "--nuza-scrollbar": withAlpha(foreground, 0.14),
    "--nuza-scrollbar-strong": withAlpha(foreground, 0.28),

    ...FIXED[theme],
  };
}
