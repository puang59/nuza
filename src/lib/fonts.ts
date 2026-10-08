import { invoke } from "@tauri-apps/api/core";

/** Empty means "no preference": fall through to the stack below. */
export const DEFAULT_EDITOR_FONT = "";

/**
 * Prose, not code. The editor renders markdown as you type, so the default is a
 * proportional UI face - whichever of these the OS actually has - rather than
 * the monospace font a plain-text editor would reach for. Code blocks and
 * inline code still get a monospace stack of their own from the editor theme.
 */
const FALLBACK_FONT_STACK =
  'ui-sans-serif, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif';

/** CSS `font-family` for a system font name, falling back to the stack above. */
export function editorFontFamily(font: string) {
  if (!font) return FALLBACK_FONT_STACK;
  return `"${font.replace(/["\\]/g, "\\$&")}", ${FALLBACK_FONT_STACK}`;
}

/** Comfortable reading size for body text; headings scale up from here. */
export const DEFAULT_EDITOR_FONT_SIZE = 16;
export const MIN_EDITOR_FONT_SIZE = 8;
export const MAX_EDITOR_FONT_SIZE = 32;
/** How much a single zoom-in/zoom-out keystroke changes the font size, in px. */
export const EDITOR_FONT_SIZE_STEP = 1;

export function clampEditorFontSize(size: number) {
  if (!Number.isFinite(size)) return DEFAULT_EDITOR_FONT_SIZE;
  return Math.min(MAX_EDITOR_FONT_SIZE, Math.max(MIN_EDITOR_FONT_SIZE, Math.round(size)));
}

/**
 * How wide the text column may get, in pixels. Long lines are tiring to read,
 * so the column stops somewhere and the rest of the window is margin - but
 * where it stops is a matter of the screen, the font and the reader. The top
 * of the range is wider than most windows, which is to say "as wide as the
 * pane".
 */
export const DEFAULT_CONTENT_WIDTH = 704;
export const MIN_CONTENT_WIDTH = 480;
export const MAX_CONTENT_WIDTH = 1600;
export const CONTENT_WIDTH_STEP = 8;

export function clampContentWidth(width: number) {
  if (!Number.isFinite(width)) return DEFAULT_CONTENT_WIDTH;
  return Math.min(MAX_CONTENT_WIDTH, Math.max(MIN_CONTENT_WIDTH, Math.round(width)));
}

/** The space between lines of prose, as a multiple of the text's size. */
export const DEFAULT_LINE_HEIGHT = 1.75;
export const MIN_LINE_HEIGHT = 1.3;
export const MAX_LINE_HEIGHT = 2.2;
export const LINE_HEIGHT_STEP = 0.05;

export function clampLineHeight(height: number) {
  if (!Number.isFinite(height)) return DEFAULT_LINE_HEIGHT;
  // Rounded to the step, so a value that has been through a slider and
  // storage does not come back as 1.7500000000000002.
  const stepped = Math.round(height / LINE_HEIGHT_STEP) * LINE_HEIGHT_STEP;
  return Math.min(MAX_LINE_HEIGHT, Math.max(MIN_LINE_HEIGHT, Number(stepped.toFixed(2))));
}

/** The two measurements the editor's column is laid out from. */
export interface Typography {
  contentWidth: number;
  lineHeight: number;
}

/**
 * Hands the measurements to the stylesheet, where the editor's theme reads
 * them. Set on the root rather than through the editor's own configuration,
 * so dragging a slider restyles the page without the editor being rebuilt.
 */
export function applyTypography(root: HTMLElement, { contentWidth, lineHeight }: Typography) {
  root.style.setProperty("--nuza-measure", `${clampContentWidth(contentWidth)}px`);
  root.style.setProperty("--nuza-line-height", String(clampLineHeight(lineHeight)));
}

let systemFonts: Promise<string[]> | null = null;

/** Installed font families, fetched from the backend once and then cached. */
export function listSystemFonts() {
  systemFonts ??= invoke<string[]>("list_system_fonts").catch((error) => {
    systemFonts = null;
    throw error;
  });
  return systemFonts;
}
