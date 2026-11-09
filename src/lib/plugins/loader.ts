import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { report } from "@/lib/notices";
import { commands } from "@/lib/registries/commands";
import { editorExtensions } from "@/lib/registries/editorExtensions";
import { settingTabs } from "@/lib/registries/settingTabs";
import { sidebarViews } from "@/lib/registries/sidebarViews";
import { statusItems } from "@/lib/registries/statusItems";
import { app } from "./api/app";
import { disposeAdded, Plugin, type PluginManifest } from "./api/plugin";
import { requireShared } from "./modules";

/** What `plugins_state` says about one installed plugin (plugins/store.rs). */
export interface InstalledPlugin {
  id: string;
  manifest: PluginManifest | null;
  enabled: boolean;
  hasStyles: boolean;
  hash: string;
  problem: string | null;
  linked: boolean;
}

export interface PluginsState {
  community: boolean;
  plugins: InstalledPlugin[];
}

/** How a plugin is doing in this window, for Settings. */
export type PluginStatus =
  { state: "loaded"; loadMs: number } | { state: "failed"; reason: string } | { state: "off" };

/** How long a plugin's onload may take before it counts as having failed. */
const LOAD_LIMIT_MS = 10_000;

/** Past this, a plugin's start is slow enough to say so. */
export const SLOW_LOAD_MS = 500;

const PLUGIN_PROTOCOL = "nuza-plugin";

export type Factory = (
  require: (name: string) => unknown,
  module: { exports: unknown },
  exports: unknown
) => void;

/** Factories handed over by plugin scripts as they run, by the id on their script tag. */
const registered = new Map<string, Factory>();

declare global {
  interface Window {
    nuza?: { registerPlugin(factory: Factory): void };
  }
}

/**
 * What a plugin's script calls as it runs. Which plugin it is comes from the
 * tag the loader put in the page, never from the plugin: a plugin cannot
 * register itself as another.
 */
function registerPlugin(factory: Factory) {
  const script = document.currentScript as HTMLScriptElement | null;
  const id = script?.dataset.pluginId;
  if (!id || typeof factory !== "function") {
    console.error("nuza.registerPlugin was called from outside a plugin's script");
    return;
  }
  registered.set(id, factory);
}

interface Loaded {
  plugin: Plugin;
  hash: string;
  elements: HTMLElement[];
}

/** Ends after `ms`, failing with `message`, unless `promise` settles first. */
function within<T>(promise: Promise<T>, ms: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms)));
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** Adds `el` to the page and waits for it to load. */
function attach(el: HTMLScriptElement | HTMLLinkElement) {
  return new Promise<void>((resolve, reject) => {
    el.addEventListener("load", () => resolve(), { once: true });
    el.addEventListener(
      "error",
      () =>
        reject(new Error(`${el instanceof HTMLScriptElement ? "main.js" : "styles.css"} couldn't be loaded`)),
      { once: true }
    );
    document.head.append(el);
  });
}

function fileUrl(id: string, file: string, hash: string) {
  return `${convertFileSrc(`${id}/${file}`, PLUGIN_PROTOCOL)}?v=${hash}`;
}

/**
 * The community plugins running in this window: loads what the vault has
 * turned on, unloads what it has not, and keeps a status for each for Settings.
 */
export class PluginHost {
  private loaded = new Map<string, Loaded>();
  private statuses = new Map<string, PluginStatus>();
  private listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private snapshot: { state: PluginsState | null; statuses: ReadonlyMap<string, PluginStatus> } = {
    state: null,
    statuses: new Map(),
  };

  constructor() {
    window.nuza = { registerPlugin };
  }

  /** Brings what is loaded into line with what the vault says should be. One at a time. */
  sync(): Promise<void> {
    const next = this.queue.then(() => this.syncNow());
    this.queue = next.catch(() => {});
    return next;
  }

  /** Unloads every plugin, as when the window leaves its folder. */
  unloadAll(): Promise<void> {
    const next = this.queue.then(() => {
      for (const id of [...this.loaded.keys()].reverse()) this.unload(id);
      this.snapshot = { state: null, statuses: new Map() };
      this.statuses.clear();
      this.changed();
    });
    this.queue = next.catch(() => {});
    return next;
  }

  /** The last state read, and each plugin's status: for Settings. */
  current() {
    return this.snapshot;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  private changed() {
    this.snapshot = { state: this.snapshot.state, statuses: new Map(this.statuses) };
    for (const listener of [...this.listeners]) listener();
  }

  private async syncNow() {
    let state: PluginsState;
    try {
      state = await this.readState();
    } catch (error) {
      // No folder open: nothing to run.
      console.debug("No plugins to load:", error);
      return;
    }
    this.snapshot = { ...this.snapshot, state };

    const wanted = new Map(
      state.community
        ? state.plugins
            .filter((plugin) => plugin.enabled && !plugin.problem && plugin.manifest)
            .map((plugin) => [plugin.id, plugin])
        : []
    );

    for (const id of [...this.loaded.keys()].reverse()) {
      const want = wanted.get(id);
      if (!want || want.hash !== this.loaded.get(id)!.hash) this.unload(id);
    }
    for (const plugin of state.plugins) {
      if (!wanted.has(plugin.id)) this.statuses.set(plugin.id, { state: "off" });
    }
    this.changed();

    for (const plugin of wanted.values()) {
      if (this.loaded.has(plugin.id)) continue;
      this.statuses.set(plugin.id, await this.load(plugin));
      this.changed();
    }
  }

  /** What the vault has installed and turned on. */
  protected readState(): Promise<PluginsState> {
    return invoke<PluginsState>("plugins_state");
  }

  /** Runs the plugin's main.js, and hands back the factory it registered. */
  protected async loadCode(installed: InstalledPlugin, elements: HTMLElement[]): Promise<Factory> {
    const { id, hash } = installed;
    registered.delete(id);
    const script = document.createElement("script");
    script.src = fileUrl(id, "main.js", hash);
    script.dataset.pluginId = id;
    elements.push(script);
    await attach(script);

    const factory = registered.get(id);
    registered.delete(id);
    if (!factory) throw new Error("Its main.js didn't register a plugin. Was it built with the template?");
    return factory;
  }

  private async load(installed: InstalledPlugin): Promise<PluginStatus> {
    const { id, hash } = installed;
    const manifest = installed.manifest!;
    const elements: HTMLElement[] = [];
    let plugin: Plugin | null = null;
    const started = performance.now();

    try {
      if (installed.hasStyles) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = fileUrl(id, "styles.css", hash);
        link.dataset.pluginId = id;
        elements.push(link);
        await attach(link);
      }

      const factory = await this.loadCode(installed, elements);
      const module: { exports: unknown } = { exports: {} };
      factory(requireShared, module, module.exports);
      const exported = module.exports as { default?: unknown } | undefined;
      const Class = (exported && "default" in exported ? exported.default : exported) as unknown;
      if (typeof Class !== "function" || !(Class.prototype instanceof Plugin)) {
        throw new Error("Its main.js doesn't export a class that extends Plugin");
      }

      plugin = new (Class as new (app: unknown, manifest: PluginManifest) => Plugin)(app, manifest);
      await within(Promise.resolve(plugin.onload()), LOAD_LIMIT_MS, "It took more than 10 seconds to start");

      const loadMs = Math.round(performance.now() - started);
      if (loadMs > SLOW_LOAD_MS) console.warn(`${manifest.name} took ${loadMs} ms to start`);
      this.loaded.set(id, { plugin, hash, elements });
      return { state: "loaded", loadMs };
    } catch (error) {
      if (plugin) this.undo(plugin);
      this.forget(id, elements);
      report(`${manifest.name} couldn't start`, error);
      return { state: "failed", reason: error instanceof Error ? error.message : String(error) };
    }
  }

  private unload(id: string) {
    const loaded = this.loaded.get(id);
    if (!loaded) return;
    this.loaded.delete(id);
    try {
      loaded.plugin.onunload();
    } catch (error) {
      console.error(`${loaded.plugin.manifest.name} failed to stop cleanly:`, error);
    }
    this.undo(loaded.plugin);
    this.forget(id, loaded.elements);
    this.statuses.set(id, { state: "off" });
  }

  /** Everything the plugin added, through `this` and - as a backstop - under its id. */
  private undo(plugin: Plugin) {
    disposeAdded(plugin);
    for (const registry of [commands, statusItems, settingTabs, sidebarViews, editorExtensions]) {
      registry.disposeOwner(plugin.manifest.id);
    }
  }

  /** Takes the plugin's script and styles out of the page. The script's effects stay until the window reloads. */
  private forget(id: string, elements: HTMLElement[]) {
    for (const el of elements) el.remove();
    registered.delete(id);
  }
}

/** This window's plugins. */
export const plugins = new PluginHost();
