import { isMacPlatform } from "@/lib/platform";

/**
 * Bindings are stored as platform-independent strings joining modifiers with "+",
 * always in the order mod, ctrl, alt, shift, <key> (e.g. "mod+shift+v").
 *
 * "mod" means Cmd on macOS and Ctrl everywhere else, so a single stored binding
 * works on every OS without per-platform duplication. "ctrl" always means the
 * physical Control key - on macOS that's a genuinely separate modifier (⌃Tab is
 * not ⌘Tab), while on Windows and Linux it coincides with "mod".
 */
const MODIFIER_KEYS = new Set(["control", "meta", "alt", "shift"]);
const MODIFIER_NAMES = new Set(["mod", "ctrl", "alt", "shift"]);

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

function normalizeEventKey(e: KeyboardEvent): string {
  const key = e.key.toLowerCase();
  return key === " " ? "space" : key;
}

export function eventToBinding(e: KeyboardEvent, isMac: boolean = isMacPlatform()): string {
  const parts: string[] = [];

  // Only macOS can tell "mod" and "ctrl" apart; elsewhere Control *is* mod.
  if (isMac) {
    if (e.metaKey) parts.push("mod");
    if (e.ctrlKey) parts.push("ctrl");
  } else if (e.ctrlKey) {
    parts.push("mod");
  }

  if (e.altKey) parts.push("alt");

  let key = normalizeEventKey(e);
  if (key in SHIFTED_KEY_EQUIVALENTS) {
    key = SHIFTED_KEY_EQUIVALENTS[key];
  } else if (e.shiftKey) {
    parts.push("shift");
  }

  if (!MODIFIER_KEYS.has(key)) parts.push(key);

  return parts.join("+");
}

export function isCompleteBinding(binding: string): boolean {
  const parts = binding.split("+");
  const key = parts[parts.length - 1];
  return Boolean(key) && !MODIFIER_KEYS.has(key) && !MODIFIER_NAMES.has(key);
}

export function matchesBinding(e: KeyboardEvent, binding: string, isMac: boolean = isMacPlatform()): boolean {
  if (!binding) return false;

  const parts = binding.split("+");
  const key = parts[parts.length - 1];
  if (!key || MODIFIER_NAMES.has(key)) return false;

  const wantsMod = parts.includes("mod");
  const wantsCtrl = parts.includes("ctrl");
  const wantsAlt = parts.includes("alt");
  const wantsShift = parts.includes("shift");

  // Compare against the physical modifiers rather than re-deriving a string, so
  // that "ctrl+tab" and "mod+tab" can both resolve correctly on a platform where
  // Control happens to serve as both.
  const expectMeta = isMac && wantsMod;
  const expectCtrl = wantsCtrl || (!isMac && wantsMod);

  if (e.metaKey !== expectMeta) return false;
  if (e.ctrlKey !== expectCtrl) return false;
  if (e.altKey !== wantsAlt) return false;

  const eventKey = normalizeEventKey(e);
  const unshifted = SHIFTED_KEY_EQUIVALENTS[eventKey];
  if (unshifted) {
    // Shift was only needed to type the character, so don't hold it against the match.
    return unshifted === key;
  }

  return eventKey === key && e.shiftKey === wantsShift;
}

export function formatBinding(binding: string, isMac: boolean = isMacPlatform()): string {
  if (!binding) return "";

  return binding
    .split("+")
    .map((part) => {
      switch (part) {
        case "mod":
          return isMac ? "⌘" : "Ctrl";
        case "ctrl":
          return isMac ? "⌃" : "Ctrl";
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

/**
 * A binding in the syntax the native menu bar speaks, or null when it has no
 * equivalent there. Only macOS needs this: a menu item's key equivalent is
 * taken by the system before the webview is offered the key at all, so a
 * shortcut that collides with one has to be served by the menu instead.
 */
export function toAccelerator(binding: string): string | null {
  if (!isCompleteBinding(binding)) return null;

  const parts = binding.split("+");
  const key = parts[parts.length - 1];

  const modifiers = parts.slice(0, -1).map((part) => {
    switch (part) {
      case "mod":
        return "CmdOrCtrl";
      case "ctrl":
        return "Control";
      case "alt":
        return "Alt";
      case "shift":
        return "Shift";
      default:
        return "";
    }
  });

  if (modifiers.some((modifier) => !modifier)) return null;
  return [...modifiers, key.toUpperCase()].join("+");
}
