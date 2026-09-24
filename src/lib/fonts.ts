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

let systemFonts: Promise<string[]> | null = null;

/** Installed font families, fetched from the backend once and then cached. */
export function listSystemFonts() {
  systemFonts ??= invoke<string[]>("list_system_fonts").catch((error) => {
    systemFonts = null;
    throw error;
  });
  return systemFonts;
}
