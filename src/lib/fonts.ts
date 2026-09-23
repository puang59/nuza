import { invoke } from "@tauri-apps/api/core";

/** Empty means "no preference": keep CodeMirror's stock monospace font. */
export const DEFAULT_EDITOR_FONT = "";

/** CSS `font-family` for a system font name, falling back to monospace if it's missing. */
export function editorFontFamily(font: string) {
  if (!font) return "monospace";
  return `"${font.replace(/["\\]/g, "\\$&")}", monospace`;
}

/** Matches the editor's default Tailwind `text-sm` size, so the font-size setting starts a no-op. */
export const DEFAULT_EDITOR_FONT_SIZE = 14;
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
