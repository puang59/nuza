import { describe, expect, test } from "bun:test";
import {
  eventToBinding,
  formatBinding,
  isCompleteBinding,
  matchesBinding,
  toAccelerator,
} from "../src/lib/keybinding";

/** A KeyboardEvent-shaped object; only the fields the module reads. */
function key(k: string, mods: Partial<Record<"meta" | "ctrl" | "alt" | "shift", boolean>> = {}) {
  return {
    key: k,
    metaKey: !!mods.meta,
    ctrlKey: !!mods.ctrl,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift,
  } as KeyboardEvent;
}

describe("eventToBinding", () => {
  test("mod is Cmd on mac and Ctrl elsewhere", () => {
    expect(eventToBinding(key("s", { meta: true }), true)).toBe("mod+s");
    expect(eventToBinding(key("s", { ctrl: true }), false)).toBe("mod+s");
  });

  test("mac tells Ctrl and Cmd apart", () => {
    expect(eventToBinding(key("tab", { ctrl: true }), true)).toBe("ctrl+tab");
    expect(eventToBinding(key("tab", { meta: true, ctrl: true }), true)).toBe("mod+ctrl+tab");
  });

  test("a bare modifier is not a binding on its own", () => {
    expect(eventToBinding(key("shift", { shift: true }), true)).toBe("shift");
    expect(isCompleteBinding("shift")).toBe(false);
  });

  test("shifted characters normalise to the unshifted key", () => {
    expect(eventToBinding(key("+", { meta: true, shift: true }), true)).toBe("mod+=");
    expect(eventToBinding(key("_", { meta: true, shift: true }), true)).toBe("mod+-");
  });
});

describe("matchesBinding", () => {
  test("matches the platform's own mod key", () => {
    expect(matchesBinding(key("s", { meta: true }), "mod+s", true)).toBe(true);
    expect(matchesBinding(key("s", { ctrl: true }), "mod+s", false)).toBe(true);
  });

  test("does not match Ctrl for mod on mac", () => {
    expect(matchesBinding(key("s", { ctrl: true }), "mod+s", true)).toBe(false);
  });

  test("an extra modifier held down is not the same binding", () => {
    expect(matchesBinding(key("s", { meta: true, alt: true }), "mod+s", true)).toBe(false);
  });

  test("zoom in matches whether or not shift was needed to type it", () => {
    expect(matchesBinding(key("=", { meta: true }), "mod+=", true)).toBe(true);
    expect(matchesBinding(key("+", { meta: true, shift: true }), "mod+=", true)).toBe(true);
  });

  test("an empty or modifier-only binding never matches", () => {
    expect(matchesBinding(key("s", { meta: true }), "", true)).toBe(false);
    expect(matchesBinding(key("s", { meta: true }), "mod", true)).toBe(false);
  });

  test("a binding survives the round trip from the event it came from", () => {
    const event = key("b", { meta: true, shift: true });
    expect(matchesBinding(event, eventToBinding(event, true), true)).toBe(true);
  });
});

describe("formatBinding", () => {
  test("glyphs on mac, words elsewhere", () => {
    expect(formatBinding("mod+shift+v", true)).toBe("⌘⇧V");
    expect(formatBinding("mod+shift+v", false)).toBe("Ctrl+Shift+V");
  });

  test("names the keys that have no glyph", () => {
    expect(formatBinding("mod+arrowright", true)).toBe("⌘→");
    expect(formatBinding("ctrl+tab", true)).toBe("⌃Tab");
  });
});

describe("toAccelerator", () => {
  test("speaks the menu bar's syntax", () => {
    expect(toAccelerator("mod+w")).toBe("CmdOrCtrl+W");
    expect(toAccelerator("mod+shift+u")).toBe("CmdOrCtrl+Shift+U");
  });

  test("refuses anything the menu bar cannot express", () => {
    expect(toAccelerator("mod")).toBeNull();
    expect(toAccelerator("")).toBeNull();
  });
});
