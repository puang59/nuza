import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { runBoundCommand } from "../src/hooks/useKeymaps";
import { conflictingActions, KEYMAP_ACTIONS } from "../src/lib/keymaps";
import { commands, CORE_GROUP, resolveBindings, type CommandSpec } from "../src/lib/registries/commands";

let window: Window;

beforeAll(() => {
  window = new Window();
  globalThis.document = window.document as unknown as Document;
  globalThis.Element = window.Element as unknown as typeof Element;
  globalThis.HTMLElement = window.HTMLElement as unknown as typeof HTMLElement;
});

afterEach(() => {
  commands.disposeOwner("core");
  commands.disposeOwner("word-goal");
});

function key(init: { key: string; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean }) {
  return new window.KeyboardEvent("keydown", { cancelable: true, ...init }) as unknown as KeyboardEvent;
}

function command(id: string, overrides: Partial<CommandSpec> = {}): CommandSpec {
  return { id, label: id, group: CORE_GROUP, run() {}, ...overrides };
}

describe("resolveBindings", () => {
  test("gives every built-in action its default, registered or not", () => {
    const bindings = resolveBindings([], {});
    for (const action of KEYMAP_ACTIONS) expect(bindings[action.id]).toBe(action.defaultBinding);
  });

  test("puts the user's choice over a default", () => {
    const bindings = resolveBindings([], { "toggle-sidebar": "ctrl+alt+b" });
    expect(bindings["toggle-sidebar"]).toBe("ctrl+alt+b");
  });

  test("adds registered commands after the built-ins, with their own defaults", () => {
    const bindings = resolveBindings([command("word-goal:show", { defaultBinding: "ctrl+alt+g" })], {});
    const ids = Object.keys(bindings);
    expect(ids.slice(0, KEYMAP_ACTIONS.length)).toEqual(KEYMAP_ACTIONS.map((action) => action.id));
    expect(bindings["word-goal:show"]).toBe("ctrl+alt+g");
  });

  test("leaves out a command with no binding, and an override for a command that is gone", () => {
    const bindings = resolveBindings([command("word-goal:show")], { "kanban:open": "ctrl+alt+k" });
    expect("word-goal:show" in bindings).toBe(false);
    expect("kanban:open" in bindings).toBe(false);
  });

  test("flags a plugin's shortcut that lands on one of nuza's", () => {
    const sidebar = KEYMAP_ACTIONS.find((action) => action.id === "toggle-sidebar")!;
    const bindings = resolveBindings(
      [command("word-goal:show", { defaultBinding: sidebar.defaultBinding })],
      {}
    );
    expect(conflictingActions(bindings)).toEqual(new Set(["toggle-sidebar", "word-goal:show"]));
  });
});

describe("runBoundCommand", () => {
  test("runs the command the keystroke is bound to", () => {
    let ran = 0;
    commands.register(command("a", { run: () => void ran++ }));
    const event = key({ key: "g", ctrlKey: true, shiftKey: true });

    expect(runBoundCommand(event, { a: "ctrl+shift+g" })).toBe(true);
    expect(ran).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });

  test("gives a shared chord to the binding that comes first", () => {
    const ran: string[] = [];
    commands.register(command("core-one", { run: () => void ran.push("core") }));
    commands.register(
      command("word-goal:one", { group: "Word Goal", run: () => void ran.push("plugin") }),
      "word-goal"
    );

    runBoundCommand(key({ key: "g", ctrlKey: true, shiftKey: true }), {
      "core-one": "ctrl+shift+g",
      "word-goal:one": "ctrl+shift+g",
    });

    expect(ran).toEqual(["core"]);
  });

  test("leaves the keystroke alone when its command cannot run", () => {
    let ran = 0;
    commands.register(command("a", { enabled: () => false }));
    commands.register(command("b", { run: () => void ran++ }));
    const event = key({ key: "g", ctrlKey: true, shiftKey: true });

    expect(runBoundCommand(event, { a: "ctrl+shift+g", b: "ctrl+shift+g" })).toBe(false);
    expect(ran).toBe(0);
    expect(event.defaultPrevented).toBe(false);
  });

  test("does nothing for a keystroke nothing is bound to", () => {
    commands.register(command("a"));
    expect(runBoundCommand(key({ key: "h", ctrlKey: true, shiftKey: true }), { a: "ctrl+shift+g" })).toBe(
      false
    );
  });
});

describe("nuza's own actions", () => {
  // App.tsx registers every action in KEYMAP_ACTIONS as a command that calls
  // its handler, and treats one with no handler as unable to run - so an
  // action added to the list but not given a handler would show in Keymaps
  // and quietly never work.
  test("each has a handler in App", () => {
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    const start = app.indexOf("const keymapHandlers = useMemo(");
    const handlers = app.slice(start, app.indexOf("useKeymapListener(", start));

    for (const action of KEYMAP_ACTIONS) {
      const named = new RegExp(`^\\s{6}"${action.id}":`, "m").test(handlers);
      const shorthand = new RegExp(
        `^\\s{6}${action.id.replace(/-./g, (m) => m[1].toUpperCase())},?$`,
        "m"
      ).test(handlers);
      expect({ action: action.id, handled: named || shorthand }).toEqual({
        action: action.id,
        handled: true,
      });
    }
  });
});
