import { describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

mock.module("@tauri-apps/api/core", () => ({
  invoke: async () => null,
  convertFileSrc: (path: string, protocol: string) => `${protocol}://localhost/${encodeURIComponent(path)}`,
}));
mock.module("@tauri-apps/api/app", () => ({ getVersion: async () => "3.0.0" }));

// Before the imports below: the loader puts `nuza` on the window as it loads.
const page = new Window();
Object.assign(globalThis, {
  window: page,
  document: page.document,
  HTMLElement: page.HTMLElement,
  Element: page.Element,
  Event: page.Event,
  CustomEvent: page.CustomEvent,
});

const { PluginHost } = await import("../src/lib/plugins/loader");
const { Plugin } = await import("../src/lib/plugins/api/plugin");
const { requireShared } = await import("../src/lib/plugins/modules");
const { commands } = await import("../src/lib/registries/commands");
const { statusItems } = await import("../src/lib/registries/statusItems");
const state = await import("@codemirror/state");

type Installed = import("../src/lib/plugins/loader").InstalledPlugin;
type Factory = import("../src/lib/plugins/loader").Factory;

function installed(id: string, overrides: Partial<Installed> = {}): Installed {
  return {
    id,
    manifest: {
      id,
      name: id.replace(/-/g, " "),
      version: "1.0.0",
      minAppVersion: "3.0.0",
      apiVersion: 1,
      description: "A test plugin.",
      author: "Test",
    },
    enabled: true,
    hasStyles: false,
    hash: "abc123",
    problem: null,
    linked: false,
    ...overrides,
  };
}

/** A plugin, as a template-built main.js would hand it over. */
function factoryFor(Class: unknown): Factory {
  return (_require, module) => {
    module.exports = { default: Class };
  };
}

/** A host whose vault and scripts are given rather than read. */
class TestHost extends PluginHost {
  community = true;
  installed: Installed[] = [];
  code = new Map<string, Factory>();

  protected async readState() {
    return { community: this.community, plugins: this.installed };
  }

  protected async loadCode(plugin: Installed) {
    const factory = this.code.get(plugin.id);
    if (!factory) throw new Error("Its main.js didn't register a plugin. Was it built with the template?");
    return factory;
  }

  status(id: string) {
    return this.current().statuses.get(id);
  }
}

class Counter extends Plugin {
  static loads = 0;
  static unloads = 0;
  onload() {
    Counter.loads++;
    this.addCommand({ id: "count", name: "Count", run() {} });
    this.addStatusBarItem().textContent = "1";
  }
  onunload() {
    Counter.unloads++;
  }
}

describe("the plugin host", () => {
  test("loads what is turned on, and undoes everything it added when it is turned off", async () => {
    const host = new TestHost();
    host.installed = [installed("counter")];
    host.code.set("counter", factoryFor(Counter));

    await host.sync();
    expect(host.status("counter")?.state).toBe("loaded");
    expect(commands.get("counter:count")?.group).toBe("counter");
    expect(statusItems.list().some((item) => item.id.startsWith("counter:"))).toBe(true);

    host.installed = [installed("counter", { enabled: false })];
    await host.sync();
    expect(host.status("counter")?.state).toBe("off");
    expect(commands.get("counter:count")).toBeUndefined();
    expect(statusItems.list().some((item) => item.id.startsWith("counter:"))).toBe(false);
    expect(Counter.unloads).toBe(1);
  });

  test("loads nothing while community plugins are off", async () => {
    const host = new TestHost();
    host.community = false;
    host.installed = [installed("counter")];
    host.code.set("counter", factoryFor(Counter));
    const before = Counter.loads;

    await host.sync();

    expect(Counter.loads).toBe(before);
    expect(host.status("counter")?.state).toBe("off");
  });

  test("leaves alone a plugin with a problem", async () => {
    const host = new TestHost();
    host.installed = [installed("counter", { problem: "Needs nuza 9.0.0 or newer" })];
    host.code.set("counter", factoryFor(Counter));
    const before = Counter.loads;
    await host.sync();
    expect(Counter.loads).toBe(before);
  });

  test("reloads a plugin whose code changed", async () => {
    const host = new TestHost();
    host.installed = [installed("counter")];
    host.code.set("counter", factoryFor(Counter));
    await host.sync();
    const loads = Counter.loads;

    host.installed = [installed("counter", { hash: "def456" })];
    await host.sync();

    expect(Counter.loads).toBe(loads + 1);
    await host.unloadAll();
  });

  for (const [what, onload] of [
    [
      "throws",
      () => {
        throw new Error("broken");
      },
    ],
    [
      "rejects",
      async () => {
        throw new Error("broken");
      },
    ],
  ] as const) {
    test(`marks a plugin whose onload ${what} as failed, and undoes what it added first`, async () => {
      class Broken extends Plugin {
        onload() {
          this.addCommand({ id: "half", name: "Half", run() {} });
          return onload();
        }
      }
      const host = new TestHost();
      host.installed = [installed("broken")];
      host.code.set("broken", factoryFor(Broken));

      await host.sync();

      expect(host.status("broken")).toEqual({ state: "failed", reason: "broken" });
      expect(commands.get("broken:half")).toBeUndefined();
    });
  }

  test("refuses code that does not export a plugin", async () => {
    const host = new TestHost();
    host.installed = [installed("not-a-plugin")];
    host.code.set("not-a-plugin", factoryFor(class {}));
    await host.sync();
    expect(host.status("not-a-plugin")).toEqual({
      state: "failed",
      reason: "Its main.js doesn't export a class that extends Plugin",
    });
  });

  test("a plugin that fails does not stop the others", async () => {
    const host = new TestHost();
    host.installed = [installed("aaa-missing"), installed("counter")];
    host.code.set("counter", factoryFor(Counter));
    await host.sync();
    expect(host.status("aaa-missing")?.state).toBe("failed");
    expect(host.status("counter")?.state).toBe("loaded");
    await host.unloadAll();
  });
});

describe("a plugin's require", () => {
  test("hands over nuza's own copy of a shared library", () => {
    expect(requireShared("@codemirror/state")).toBe(state);
    expect((requireShared("nuza") as { Plugin: unknown }).Plugin).toBe(Plugin);
  });

  test("says what to do about a library nuza does not share", () => {
    expect(() => requireShared("lodash")).toThrow('Cannot find module "lodash"');
  });
});

describe("a plugin's commands", () => {
  test("are named after the plugin, and a second one with the same id refuses", async () => {
    const host = new TestHost();
    host.installed = [installed("counter")];
    host.code.set("counter", factoryFor(Counter));
    await host.sync();

    expect(commands.get("counter:count")?.label).toBe("Count");
    await host.unloadAll();
  });

  test("need exactly one of run and editorRun", () => {
    class Odd extends Plugin {}
    const plugin = new Odd({} as never, installed("odd").manifest!);
    expect(() => plugin.addCommand({ id: "x", name: "X" })).toThrow("exactly one of run and editorRun");
  });

  test("can't take a language nuza draws itself", () => {
    class Odd extends Plugin {}
    const plugin = new Odd({} as never, installed("odd").manifest!);
    expect(() => plugin.registerCodeBlockRenderer("Mermaid", () => {})).toThrow("drawn by nuza itself");
  });
});
