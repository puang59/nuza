import { beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { KEYMAP_ACTIONS } from "../src/lib/keymaps";
import { ownedHere, VIM_OWNED_KEYS } from "../src/hooks/useKeymaps";

beforeAll(() => {
  const window = new Window();
  globalThis.document = window.document as unknown as Document;
  globalThis.Element = window.Element as unknown as typeof Element;
});

function press(target: Element, mods: { ctrl?: boolean; meta?: boolean }): KeyboardEvent {
  return {
    target,
    key: "[",
    code: "BracketLeft",
    metaKey: !!mods.meta,
    ctrlKey: !!mods.ctrl,
    altKey: false,
    shiftKey: false,
    getModifierState: () => false,
  } as unknown as KeyboardEvent;
}

function editor(owning: boolean) {
  const host = document.createElement("div");
  if (owning) host.setAttribute("data-own-keys", VIM_OWNED_KEYS);
  const content = document.createElement("div");
  host.append(content);
  document.body.append(host);
  return content;
}

describe("Control and [ with Vim on", () => {
  test("Go Back is bound to the chord Vim reads as Escape off macOS", () => {
    const goBack = KEYMAP_ACTIONS.find((action) => action.id === "go-back");
    expect(goBack?.defaultBinding).toBe("mod+[");
  });

  test("the editor keeps it, so Vim sees it and leaves insert mode", () => {
    expect(ownedHere(press(editor(true), { ctrl: true }))).toBe(true);
  });

  test("with Vim off the window still has it, for Go Back", () => {
    expect(ownedHere(press(editor(false), { ctrl: true }))).toBe(false);
  });

  test("Command and [ is never the editor's: on a Mac it is still Go Back", () => {
    expect(ownedHere(press(editor(true), { meta: true }))).toBe(false);
  });
});
