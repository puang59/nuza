import { invoke } from "@tauri-apps/api/core";

/** Empty means "no preference": keep CodeMirror's stock monospace font. */
export const DEFAULT_EDITOR_FONT = "";

/** CSS `font-family` for a system font name, falling back to monospace if it's missing. */
export function editorFontFamily(font: string) {
  if (!font) return "monospace";
  return `"${font.replace(/["\\]/g, "\\$&")}", monospace`;
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
