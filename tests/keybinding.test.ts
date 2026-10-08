import { describe, expect, test } from "bun:test";
import {
  eventToBinding,
  firesWhileTyping,
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

describe("firesWhileTyping", () => {
  // The defaults all carry one of these, which is the point: nothing about
  // them changes, and a rebind to something lighter stops reaching into a
  // filename somebody is in the middle of typing.
  test("a chord held with Cmd or Ctrl is not typing", () => {
    expect(firesWhileTyping("mod+s")).toBe(true);
    expect(firesWhileTyping("mod+shift+f")).toBe(true);
    expect(firesWhileTyping("ctrl+tab")).toBe(true);
    expect(firesWhileTyping("mod+alt+arrowright")).toBe(true);
  });

  test("everything else is something somebody might be typing", () => {
    expect(firesWhileTyping("p")).toBe(false);
    expect(firesWhileTyping("shift+p")).toBe(false);
    expect(firesWhileTyping("alt+p")).toBe(false);
    expect(firesWhileTyping("alt+shift+p")).toBe(false);
    expect(firesWhileTyping("")).toBe(false);
  });
});

describe("keys a modifier renames", () => {
  /** An event with the key's position as well as what it typed. */
  function pressed(
    typed: string,
    code: string,
    mods: Partial<Record<"meta" | "ctrl" | "alt" | "shift" | "altGraph", boolean>> = {}
  ) {
    return {
      key: typed,
      code,
      metaKey: !!mods.meta,
      ctrlKey: !!mods.ctrl,
      altKey: !!mods.alt,
      shiftKey: !!mods.shift,
      getModifierState: (name: string) => name === "AltGraph" && !!mods.altGraph,
    } as unknown as KeyboardEvent;
  }

  // Option+1 on a Mac types "¡", and Shift+8 types "*": the binding names the key.
  test("a digit is matched by where it is, whatever Shift or Option made it type", () => {
    expect(matchesBinding(pressed("¡", "Digit1", { meta: true, alt: true }), "mod+alt+1", true)).toBe(true);
    expect(matchesBinding(pressed("*", "Digit8", { meta: true, shift: true }), "mod+shift+8", true)).toBe(
      true
    );
    expect(matchesBinding(pressed("*", "Digit8", { ctrl: true, shift: true }), "mod+shift+8", false)).toBe(
      true
    );
    expect(matchesBinding(pressed("*", "Digit8", { meta: true, shift: true }), "mod+shift+7", true)).toBe(
      false
    );
  });

  test("a letter under Option, and the period under Shift, are matched the same way", () => {
    expect(matchesBinding(pressed("∆", "KeyJ", { meta: true, alt: true }), "mod+alt+j", true)).toBe(true);
    expect(matchesBinding(pressed(">", "Period", { meta: true, shift: true }), "mod+shift+.", true)).toBe(
      true
    );
  });

  test("recording one of those chords writes down the key, so it matches itself", () => {
    const event = pressed("¡", "Digit1", { meta: true, alt: true });
    expect(eventToBinding(event, true)).toBe("mod+alt+1");
    expect(matchesBinding(event, eventToBinding(event, true), true)).toBe(true);
  });

  test("a plain digit or letter is still read as what it typed", () => {
    expect(matchesBinding(pressed("0", "Digit0", { meta: true }), "mod+0", true)).toBe(true);
    expect(matchesBinding(pressed("e", "KeyE", { meta: true }), "mod+e", true)).toBe(true);
    // A layout where the E position types something else keeps its own letter.
    expect(matchesBinding(pressed(".", "KeyE", { meta: true }), "mod+e", true)).toBe(false);
  });

  // AltGr reports as Control and Alt together, and is how `{` is typed on a
  // German keyboard: on AltGr+7. That is typing, and must not make a heading.
  test("AltGr is typing, never a chord", () => {
    const brace = pressed("{", "Digit7", { ctrl: true, alt: true, altGraph: true });
    expect(matchesBinding(brace, "mod+alt+7", false)).toBe(false);
    const chord = pressed("7", "Digit7", { ctrl: true, alt: true });
    expect(matchesBinding(chord, "mod+alt+7", false)).toBe(true);
  });
});
