import { invoke } from "@tauri-apps/api/core";
import type { Extension } from "@codemirror/state";
import { codeBlockRenderers } from "@/lib/markdown/codeBlocks";
import { report } from "@/lib/notices";
import { commands } from "@/lib/registries/commands";
import { editorExtensions } from "@/lib/registries/editorExtensions";
import type { Disposable } from "@/lib/registries/registry";
import { settingTabs } from "@/lib/registries/settingTabs";
import { sidebarViews } from "@/lib/registries/sidebarViews";
import { statusItems } from "@/lib/registries/statusItems";
import type { App, Editor, NoteRef } from "./app";
import type { PluginSettingTab } from "./ui";

/** What a plugin's manifest.json says about it. */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion: string;
  apiVersion: number;
  description: string;
  author: string;
  authorUrl?: string;
  fundingUrl?: string;
  permissions?: string[];
}

/** Something to run from the palette or a shortcut. */
export interface Command {
  /** Unique within the plugin; nuza puts the plugin's id in front. */
  id: string;
  name: string;
  /** Optional, and best left to the person using it. Never takes a chord from nuza. */
  defaultBinding?: string;
  /** Runs anywhere. */
  run?(): void | Promise<void>;
  /** Runs on the note in the main pane; the command is hidden while there is none. */
  editorRun?(editor: Editor, note: NoteRef | null): void | Promise<void>;
  /** False to hide the command for now. */
  when?(): boolean;
}

/** A view of the plugin's own in the sidebar's switcher. */
export interface SidebarViewSpec {
  id: string;
  label: string;
  title?: string;
  mount(el: HTMLElement): void | (() => void);
}

export type CodeBlockRender = (
  source: string,
  el: HTMLElement,
  context: { language: string; theme: "light" | "dark" }
) => void | (() => void) | Promise<void>;

/** Languages nuza draws itself, which no plugin can take over. */
const RESERVED_LANGUAGES = new Set(["mermaid", "math"]);

/** How long between two notices of the same plugin failing. */
const FAILURE_NOTICE_GAP = 60_000;

const owned = new WeakMap<Plugin, Disposable[]>();
const lastNotice = new WeakMap<Plugin, number>();

/**
 * Says a plugin failed - in the console every time, on screen at most once a
 * minute, so a plugin that throws on every keystroke does not bury the window
 * in notices.
 */
export function pluginFailed(plugin: Plugin, what: string, error: unknown) {
  const name = plugin.manifest.name;
  const now = Date.now();
  if (now - (lastNotice.get(plugin) ?? 0) < FAILURE_NOTICE_GAP) {
    console.error(`${name}: ${what}`, error);
    return;
  }
  lastNotice.set(plugin, now);
  report(`${name}: ${what}`, error);
}

/** Calls into a plugin, so that a throw - now or later, from a promise - is the plugin's to answer for. */
function guarded<A extends unknown[], R>(plugin: Plugin, what: string, call: (...args: A) => R) {
  return (...args: A): R | undefined => {
    try {
      const result = call(...args);
      if (result instanceof Promise) result.catch((error) => pluginFailed(plugin, what, error));
      return result;
    } catch (error) {
      pluginFailed(plugin, what, error);
      return undefined;
    }
  };
}

/** Undoes everything `plugin` added, newest first. Each undone once. */
export function disposeAdded(plugin: Plugin) {
  const added = owned.get(plugin) ?? [];
  for (const disposable of added.splice(0).reverse()) {
    try {
      disposable.dispose();
    } catch (error) {
      console.error(`Failed to undo something ${plugin.manifest.name} added:`, error);
    }
  }
}

/**
 * The class every plugin extends. Whatever it adds through `this` is undone
 * when it is turned off, so `onunload` is only for what it set up some other
 * way.
 */
export abstract class Plugin {
  readonly app: App;
  readonly manifest: PluginManifest;
  private added = 0;

  constructor(app: App, manifest: PluginManifest) {
    this.app = app;
    this.manifest = manifest;
    owned.set(this, []);
  }

  onload(): void | Promise<void> {}
  onunload(): void {}
  /** Another window on this vault saved this plugin's data: read it again with `loadData`. */
  onExternalDataChange(): void | Promise<void> {}

  /** Something to call when the plugin is turned off. */
  register(cleanup: () => void) {
    owned.get(this)?.push({ dispose: cleanup });
  }

  /** A listener from `app.*.on(...)`, removed when the plugin is turned off. */
  registerEvent(ref: Disposable) {
    owned.get(this)?.push(ref);
  }

  registerDomEvent<K extends keyof HTMLElementEventMap>(
    el: Window | Document | HTMLElement,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions
  ) {
    const call = guarded(this, `${type} handler failed`, listener) as EventListener;
    el.addEventListener(type, call, options);
    this.register(() => el.removeEventListener(type, call, options));
  }

  registerInterval(id: number) {
    this.register(() => clearInterval(id));
    return id;
  }

  addCommand(command: Command) {
    const { run, editorRun } = command;
    if (!run === !editorRun)
      throw new Error(`Command "${command.id}" needs exactly one of run and editorRun`);
    const failed = `"${command.name}" failed`;
    const when = command.when ? guarded(this, failed, command.when.bind(command)) : null;
    this.registerEvent(
      commands.register(
        {
          id: `${this.manifest.id}:${command.id}`,
          label: command.name,
          group: this.manifest.name,
          defaultBinding: command.defaultBinding,
          run: guarded(this, failed, () => {
            if (run) return run.call(command);
            const editor = this.app.workspace.activeEditor();
            if (editor) return editorRun!.call(command, editor, this.app.workspace.activeNote());
          }),
          enabled: () => (!editorRun || this.app.workspace.activeEditor() !== null) && when?.() !== false,
        },
        this.manifest.id
      )
    );
    return command;
  }

  /** An element of the plugin's own in the footer, to fill and keep up to date. */
  addStatusBarItem(options: { label?: string } = {}): HTMLElement {
    const el = document.createElement("span");
    el.className = `plugin-${this.manifest.id}`;
    this.registerEvent(
      statusItems.register(
        {
          id: `${this.manifest.id}:status:${++this.added}`,
          label: options.label ?? this.manifest.name,
          mount(slot) {
            slot.append(el);
            return () => el.remove();
          },
        },
        this.manifest.id
      )
    );
    return el;
  }

  /** The plugin's pane in Settings, listed under its name. One per plugin. */
  addSettingTab(tab: PluginSettingTab) {
    const display = guarded(this, "Its settings couldn't be shown", () => tab.display());
    const hide = guarded(this, "Its settings failed to close", () => tab.hide());
    this.registerEvent(
      settingTabs.register(
        {
          id: this.manifest.id,
          label: this.manifest.name,
          mount(el) {
            tab.containerEl = el;
            display();
            return () => void hide();
          },
        },
        this.manifest.id
      )
    );
  }

  addSidebarView(view: SidebarViewSpec) {
    const mount = guarded(this, `"${view.label}" couldn't be shown`, view.mount.bind(view));
    this.registerEvent(
      sidebarViews.register(
        {
          id: `${this.manifest.id}:${view.id}`,
          label: view.label,
          title: view.title,
          mount: (el) => mount(el) ?? undefined,
        },
        this.manifest.id
      )
    );
  }

  /** A CodeMirror extension for every note's editor. */
  registerEditorExtension(extension: Extension) {
    this.registerEvent(
      editorExtensions.register(
        { id: `${this.manifest.id}:editor:${++this.added}`, extension },
        this.manifest.id
      )
    );
  }

  /** Draws ```<language> blocks in live preview. One plugin per language; nuza's own are not offered. */
  registerCodeBlockRenderer(language: string, render: CodeBlockRender) {
    const key = language.trim().toLowerCase();
    if (RESERVED_LANGUAGES.has(key)) throw new Error(`\`${key}\` blocks are drawn by nuza itself`);
    const failed = `A \`${key}\` block couldn't be drawn`;
    this.registerEditorExtension(
      codeBlockRenderers.of({
        language: key,
        className: `plugin-${this.manifest.id}`,
        // Not swallowed: the block shows its source and why it could not be
        // drawn, which it can only do if the error reaches it.
        render: (source, el) => {
          try {
            const drawn = render(source, el, { language: key, theme: this.app.ui.theme });
            if (drawn instanceof Promise) drawn.catch((error) => pluginFailed(this, failed, error));
            return drawn;
          } catch (error) {
            pluginFailed(this, failed, error);
            throw error;
          }
        },
      })
    );
  }

  /** The plugin's saved settings, or null if it has never saved any. */
  async loadData<T = unknown>(): Promise<T | null> {
    const text = await invoke<string | null>("plugin_load_data", { id: this.manifest.id });
    return text === null ? null : (JSON.parse(text) as T);
  }

  /** Saves the plugin's settings, in `.nuza/plugins/<id>/data.json`. */
  async saveData(data: unknown): Promise<void> {
    await invoke("plugin_save_data", { id: this.manifest.id, data: JSON.stringify(data, null, 2) });
  }
}
