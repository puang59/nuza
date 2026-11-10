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
  /** Whether this machine has said the vault's plugins may run. */
  trusted: boolean;
  /** Started with `nuza --no-plugins`. */
  noPlugins: boolean;
  plugins: InstalledPlugin[];
}

/**
 * Why plugins that are turned on are not running in this window: a vault
 * that came with them turned on and is not trusted here yet, a start they
 * stopped last time (and which one was starting), Shift held as the vault
 * opened, or `nuza --no-plugins`.
 */
export type Held =
  | { why: "untrusted"; names: string[] }
  | { why: "crashed"; id: string | null }
  | { why: "shift" }
  | { why: "flag" };

/** What is written while plugins load, and is still there if one stops the window. */
interface LoadingMarker {
  vault: string;
  id: string;
}

const MARKER_PREFIX = "pluginsLoading:";

function readMarker(key: string): LoadingMarker | null {
  try {
    const text = localStorage.getItem(key);
    return text ? (JSON.parse(text) as LoadingMarker) : null;
  } catch {
    return null;
  }
}

function writeMarker(key: string, marker: LoadingMarker | null) {
  try {
    if (marker) localStorage.setItem(key, JSON.stringify(marker));
    else localStorage.removeItem(key);
  } catch {
    // Without storage there is no safe mode, which only matters after a crash.
  }
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
  /** A link to where it is built, watched for rebuilds. */
  linked: boolean;
}

/** Told by plugins/dev.rs when a linked plugin is rebuilt. */
export const PLUGIN_REBUILT_EVENT = "plugin-rebuilt";

/** How long a rebuild is given to finish writing before the plugin is reloaded. */
const REBUILD_SETTLE_MS = 150;

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
      () => reject(new Error(`${el.tagName === "SCRIPT" ? "main.js" : "styles.css"} couldn't be loaded`)),
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
  private snapshot: {
    state: PluginsState | null;
    statuses: ReadonlyMap<string, PluginStatus>;
    held: Held | null;
  } = { state: null, statuses: new Map(), held: null };
  /** The open vault, and where its loading marker is kept for this window. */
  private vault: string | null = null;
  private markerKey: string | null = null;
  /** Held back for this visit to the vault, until the person says otherwise. */
  private skipped: Held | null = null;
  private rebuildTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    window.nuza = { registerPlugin };
  }

  /** Brings what is loaded into line with what the vault says should be. One at a time. */
  sync(): Promise<void> {
    const next = this.queue.then(() => this.syncNow());
    this.queue = next.catch(() => {});
    return next;
  }

  /**
   * The window has opened `vault`. If plugins stopped its last start here -
   * the marker written while they load is still there - or `skip` (Shift was
   * held), this visit starts without them until `release`.
   */
  begin(vault: string, { label, skip }: { label: string; skip: boolean }) {
    this.vault = vault;
    this.markerKey = MARKER_PREFIX + label;
    const marker = readMarker(this.markerKey);
    // Read once: the next start tries again, as it should once the plugin is fixed or off.
    writeMarker(this.markerKey, null);
    if (marker?.vault === vault) this.skipped = { why: "crashed", id: marker.id };
    else if (skip) this.skipped = { why: "shift" };
    else this.skipped = null;
    return this.skipped;
  }

  /**
   * A linked plugin was rebuilt: reloads it once the build has settled - its
   * hash has changed, which is what `sync` reloads on.
   */
  rebuilt() {
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => void this.sync(), REBUILD_SETTLE_MS);
  }

  /** Loads the vault's plugins after all, in a visit that started without them. */
  release(): Promise<void> {
    this.skipped = null;
    return this.sync();
  }

  /** Unloads every plugin, as when the window leaves its folder. */
  unloadAll(): Promise<void> {
    const next = this.queue.then(() => {
      for (const id of [...this.loaded.keys()].reverse()) this.unload(id);
      this.snapshot = { state: null, statuses: new Map(), held: null };
      this.vault = null;
      this.skipped = null;
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
    this.snapshot = { ...this.snapshot, statuses: new Map(this.statuses) };
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
    const runnable = state.community
      ? state.plugins.filter((plugin) => plugin.enabled && !plugin.problem && plugin.manifest)
      : [];
    const held: Held | null = !runnable.length
      ? null
      : state.noPlugins
        ? { why: "flag" }
        : !state.trusted
          ? { why: "untrusted", names: runnable.map((plugin) => plugin.manifest!.name) }
          : this.skipped;
    this.snapshot = { ...this.snapshot, state, held };

    const wanted = new Map(held ? [] : runnable.map((plugin) => [plugin.id, plugin]));

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
      // Left behind if this plugin stops the window, so the next start skips them all.
      if (this.markerKey && this.vault) writeMarker(this.markerKey, { vault: this.vault, id: plugin.id });
      this.statuses.set(plugin.id, await this.load(plugin));
      this.changed();
    }
    if (this.markerKey) writeMarker(this.markerKey, null);
  }

  /** What the vault has installed and turned on. */
  protected readState(): Promise<PluginsState> {
    return invoke<PluginsState>("plugins_state");
  }

  /** Starts or stops reloading a linked plugin when it is rebuilt. */
  protected watchRebuilds(id: string, on: boolean) {
    invoke("plugins_dev_watch", { id, on }).catch((error) =>
      console.warn(`Couldn't ${on ? "watch" : "stop watching"} ${id} for rebuilds:`, error)
    );
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
      this.loaded.set(id, { plugin, hash, elements, linked: installed.linked });
      if (installed.linked) this.watchRebuilds(id, true);
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
    if (loaded.linked) this.watchRebuilds(id, false);
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

/** What to say about plugins held back from a start, or null for a vault that is not trusted, which asks instead. */
export function heldMessage(held: Held, name?: string): string | null {
  switch (held.why) {
    case "crashed":
      return `nuza started without plugins because ${name ?? "one"} stopped the last start. Turn them back on in Settings, one at a time.`;
    case "shift":
      return "Opened without plugins, as Shift was held.";
    case "flag":
      return "Plugins are off for this run (nuza --no-plugins).";
    case "untrusted":
      return null;
  }
}

/** The name of the plugin a crashed start was loading, if it is still installed. */
export function pluginName(installed: InstalledPlugin[], held: Held) {
  if (held.why !== "crashed") return undefined;
  const plugin = installed.find((candidate) => candidate.id === held.id);
  return plugin ? (plugin.manifest?.name ?? plugin.id) : undefined;
}

/** The names, as a list to read: "A", "A and B", "A, B and C". */
export function listed(names: string[]) {
  return names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
