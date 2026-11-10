import { afterAll, describe, expect, test } from "bun:test";
import { fakeTauriPage } from "./fakeTauri";

// Before the imports below: the loader puts `nuza` on the window as it loads.
const restore = fakeTauriPage(() => null);
const storage = new Map<string, string>();
const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  },
});
afterAll(() => {
  if (before) Object.defineProperty(globalThis, "localStorage", before);
  else delete (globalThis as Record<string, unknown>).localStorage;
});
afterAll(restore);

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
  trusted = true;
  noPlugins = false;
  installed: Installed[] = [];
  code = new Map<string, Factory>();

  protected async readState() {
    return {
      community: this.community,
      trusted: this.trusted,
      noPlugins: this.noPlugins,
      plugins: this.installed,
    };
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

describe("what holds plugins back", () => {
  test("a vault that is not trusted here runs nothing, and says which plugins it would", async () => {
    const host = new TestHost();
    host.trusted = false;
    host.installed = [installed("counter")];
    host.code.set("counter", factoryFor(Counter));
    const loads = Counter.loads;

    await host.sync();

    expect(Counter.loads).toBe(loads);
    expect(host.current().held).toEqual({ why: "untrusted", names: ["counter"] });
  });

  test("a vault with nothing turned on is not held back", async () => {
    const host = new TestHost();
    host.trusted = false;
    host.installed = [installed("counter", { enabled: false })];
    await host.sync();
    expect(host.current().held).toBeNull();
  });

  test("--no-plugins runs nothing, trusted or not", async () => {
    const host = new TestHost();
    host.noPlugins = true;
    host.installed = [installed("counter")];
    host.code.set("counter", factoryFor(Counter));
    const loads = Counter.loads;
    await host.sync();
    expect(Counter.loads).toBe(loads);
    expect(host.current().held).toEqual({ why: "flag" });
  });

  test("a plugin that stops the window is skipped, with the rest, on the next start", async () => {
    class Hangs extends Plugin {
      onload() {
        // As far as the marker goes, the window died here.
        expect(JSON.parse(storage.get("pluginsLoading:main")!)).toEqual({ vault: "/v", id: "hangs" });
        throw new Error("gone");
      }
    }
    const crashed = new TestHost();
    crashed.installed = [installed("hangs")];
    crashed.code.set("hangs", factoryFor(Hangs));
    expect(crashed.begin("/v", { label: "main", skip: false })).toBeNull();
    await crashed.sync();
    // Settled, so cleared.
    expect(storage.has("pluginsLoading:main")).toBe(false);

    storage.set("pluginsLoading:main", JSON.stringify({ vault: "/v", id: "hangs" }));
    const next = new TestHost();
    next.installed = [installed("counter")];
    next.code.set("counter", factoryFor(Counter));
    expect(next.begin("/v", { label: "main", skip: false })).toEqual({ why: "crashed", id: "hangs" });
    const loads = Counter.loads;
    await next.sync();
    expect(Counter.loads).toBe(loads);

    await next.release();
    expect(Counter.loads).toBe(loads + 1);
    await next.unloadAll();
  });

  test("a marker from another vault, or another window, is not this start's", () => {
    storage.set("pluginsLoading:main", JSON.stringify({ vault: "/other", id: "hangs" }));
    expect(new TestHost().begin("/v", { label: "main", skip: false })).toBeNull();
    storage.set("pluginsLoading:second", JSON.stringify({ vault: "/v", id: "hangs" }));
    expect(new TestHost().begin("/v", { label: "main", skip: false })).toBeNull();
    storage.clear();
  });

  test("Shift held as the vault opens starts it without plugins", async () => {
    const host = new TestHost();
    host.installed = [installed("counter")];
    host.code.set("counter", factoryFor(Counter));
    expect(host.begin("/v", { label: "main", skip: true })).toEqual({ why: "shift" });
    const loads = Counter.loads;
    await host.sync();
    expect(Counter.loads).toBe(loads);
  });
});
