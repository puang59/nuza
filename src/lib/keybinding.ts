import { isMacPlatform } from "@/lib/platform";

/**
 * Bindings are stored as platform-independent strings joining modifiers with "+",
 * always in the order mod, alt, shift, <key> (e.g. "mod+shift+v"). "mod" means
 * Cmd on macOS and Ctrl everywhere else, so a single stored binding works on
 * every OS without per-platform duplication.
 */
const MODIFIER_KEYS = new Set(["control", "meta", "alt", "shift"]);

const KEY_DISPLAY_NAMES: Record<string, string> = {
  " ": "Space",
  space: "Space",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  escape: "Esc",
  enter: "Enter",
  tab: "Tab",
  ",": ",",
  ".": ".",
};

// On most keyboard layouts, typing "+" or "_" requires holding Shift even though the
// shortcut (e.g. zoom in/out) is conceptually just mod+= / mod+-. Normalize to the
// unshifted key so "mod+=" matches whether or not Shift was physically needed.
const SHIFTED_KEY_EQUIVALENTS: Record<string, string> = { "+": "=", "_": "-" };

export function eventToBinding(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("mod");
  if (e.altKey) parts.push("alt");

  let key = e.key.toLowerCase();
  if (key in SHIFTED_KEY_EQUIVALENTS) {
    key = SHIFTED_KEY_EQUIVALENTS[key];
  } else if (e.shiftKey) {
    parts.push("shift");
  }

  if (!MODIFIER_KEYS.has(key)) {
    parts.push(key === " " ? "space" : key);
  }

  return parts.join("+");
}

export function isCompleteBinding(binding: string): boolean {
  const parts = binding.split("+");
  const key = parts[parts.length - 1];
  return Boolean(key) && !MODIFIER_KEYS.has(key) && key !== "mod" && key !== "alt" && key !== "shift";
}

export function matchesBinding(e: KeyboardEvent, binding: string): boolean {
  if (!binding) return false;
  return eventToBinding(e) === binding;
}

export function formatBinding(binding: string, isMac: boolean = isMacPlatform()): string {
  if (!binding) return "";

  return binding
    .split("+")
    .map((part) => {
      switch (part) {
        case "mod":
          return isMac ? "⌘" : "Ctrl";
        case "alt":
          return isMac ? "⌥" : "Alt";
        case "shift":
          return isMac ? "⇧" : "Shift";
        default:
          return KEY_DISPLAY_NAMES[part] ?? part.toUpperCase();
      }
    })
    .join(isMac ? "" : "+");
}
