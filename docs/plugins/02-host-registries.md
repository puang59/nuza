# 02. Phase 1: host registries

Before any plugin can exist, the places a plugin wants to add something have to accept
additions. Today each is a closed list compiled into the app. This phase replaces each one
with a registry and moves nuza's own features onto it. Users see no change; the diff is a
refactor, and every existing test should pass unchanged except where a type widens.

This is the most valuable phase even if plugins never shipped: it removes the hand-kept
unions (`KeymapAction`, `StatusItem`, `SidebarView`) that every new feature has to edit.

## 0. The registry primitive

`src/lib/registries/registry.ts`

```ts
export interface Disposable {
  dispose(): void;
}

/** An ordered set of items by id, that React can subscribe to. */
export class Registry<T extends { id: string }> {
  register(item: T, owner?: string): Disposable; // throws on a duplicate id
  get(id: string): T | undefined;
  list(): readonly T[]; // stable array, new identity only on change
  subscribe(listener: () => void): () => void; // for useSyncExternalStore
  disposeOwner(owner: string): void; // everything a plugin added, at once
}

export function useRegistry<T extends { id: string }>(registry: Registry<T>): readonly T[];
```

- `owner` is `"core"` for built-ins and the plugin id for plugins. `disposeOwner` is what
  unloading a plugin calls as a backstop, after the plugin's own disposables.
- `list()` returns the same array until something changes, so `useSyncExternalStore`
  does not re-render on every read.
- Registries are module singletons per window, created in `src/lib/registries/index.ts`.
  Each window is its own JS context, so "per window" is free.

Tests: `tests/registry.test.ts` covers ordering, duplicate ids, dispose idempotence,
`disposeOwner`, and that `list()` keeps its identity across reads.

## 1. Commands and keymaps

Today:

- `src/lib/keymaps.ts` declares `type KeymapAction` (a union of ~50 ids) and
  `KEYMAP_ACTIONS: KeymapDefinition[]`.
- `src/App.tsx:976` builds `keymapHandlers`, an object keyed by those ids.
- `src/hooks/useKeymaps.ts` resolves bindings from `KEYMAP_ACTIONS` plus overrides in
  localStorage, and `useKeymapListener(bindings, handlers)` dispatches keydown.
- `src/App.tsx:1064` derives `paletteCommands` for `SettingsPalette`.
- `src/components/settings/KeymapSettings.tsx` lists `KEYMAP_ACTIONS`.

After:

```ts
// src/lib/registries/commands.ts
export interface CommandSpec {
  id: string; // "toggle-sidebar", or "<plugin-id>:<command-id>"
  label: string;
  description?: string;
  defaultBinding?: string; // same chord syntax as today
  group: "core" | string; // plugin name for plugin commands, for Settings and the palette
  run(): void | Promise<void>;
  /** Hidden from the palette and ignored by its shortcut while false. */
  enabled?(): boolean;
  /** Shown in the palette. False for the palette's own command. */
  inPalette?: boolean;
}
export const commands = new Registry<CommandSpec>();
```

Steps:

1. Keep `KEYMAP_ACTIONS` as the static description of built-ins (labels, defaults) so the
   list stays readable in one place. Keep `KeymapAction` as the type of built-in ids only.
2. In `App.tsx`, replace `useKeymapListener(keymapBindings, keymapHandlers)` with one
   effect that registers each `KEYMAP_ACTIONS` entry with its handler from
   `keymapHandlers`, owner `"core"`. Handlers change identity on re-render, so register a
   stable wrapper that calls through a ref (`handlersRef.current[id]()`), and register once.
3. `useKeymaps()` resolves bindings over `useRegistry(commands)`; overrides keep living
   under `KEYMAP_STORAGE_KEY` and are keyed by string id. An override for a command that
   is not registered (a plugin that is off) is kept, not dropped, so turning the plugin
   back on brings the user's chord back.
4. `useKeymapListener` takes the registry's list and bindings. Conflict rule: if two
   commands share a chord, a `core` command wins over a plugin command, and between
   plugins the first registered wins. `conflictingActions` in `keymaps.ts` already exists
   for Settings; extend it to the registry list.
5. `paletteCommands` becomes a map over the registry, filtering `inPalette !== false` and
   `enabled?.() !== false`.
6. `KeymapSettings` groups by `group`: "nuza" first, then one heading per plugin.
7. `runAction(action)` (used by on-screen buttons) calls `commands.get(action)?.run()`.

Risk: `useKeymapListener` currently returns after the first matching binding even if it
has no handler. Keep that behaviour, it is what stops a chord falling through to the
editor.

## 2. Status bar items

There are two footers: `StatusBar.tsx` (the Vim bar) and `WritingStats.tsx` (the quiet
one), sharing `useStatusItems` for the right-click menu and the hidden list in
`statusBarHidden`.

As built (P1.3), nuza's own items stay where they are. Each one is laid out by hand with
its own narrow-window rule (`@max-[620px]:hidden` and so on), and moving them behind a
registry would only make that harder to read. The registry is for items added to the
footer:

```ts
// src/lib/registries/statusItems.ts
export interface StatusItemSpec {
  id: string;
  label: string; // the name in the right-click menu
  mount(el: HTMLElement): void | (() => void);
}
```

- `AddedStatusItems.tsx` renders one `<span data-status-item>` per registered item and
  hands it to `mount` once; the returned function runs when the item goes. A `mount` that
  throws is reported and leaves an empty span, not a broken footer.
- Both footers show added items: the Vim bar on its right, before the file name; the
  quiet footer first in its row.
- `useStatusItems` offers added items in the right-click menu after the footer's own.
  Hidden items are stored as a list of hidden ids, so a new item shows until hidden.

## 3. Sidebar views

As built (P1.4): `sidebarViews` registry of `{ id, label, title?, mount(el) }`. nuza's
four views stay hand-built; added views follow them in `ViewSwitcher`, whose row is now
`repeat(N, minmax(0, 1fr))` with the highlight one column wide, and labels truncate.
`readView(stored, addedIds)` reads an added view's id as itself only while it is
registered, so a view whose plugin is off shows Files, and the stored choice comes back
when the plugin does. The chosen added view is drawn by `Mounted` (shared with footer
items) inside the same panel the other non-file views use.

## 4. Settings tabs

As built (P1.4): `settingTabs` registry of `{ id, label, mount(el) }`. `SettingsModal`
lists added panes after Info under a small "Plugins" heading (hidden in the narrow,
horizontal layout), and draws the chosen one with `Mounted`. A pane that goes away while
open leaves Settings on General. The Community plugins pane itself arrives with P2.4.
`src/lib/settingsSearch.ts` only indexes built-in settings; plugin panes are not searched
in v1.

## 5. Editor extensions

As built (P1.5): `editorExtensions` registry of `{ id, extension }`, and
`addedExtensions()`, which returns one `Extension` that keeps its identity until the
registry changes. `src/hooks/useDocuments.ts` has a third compartment, `additions`,
beside `preferences` and `location`:

1. `stateFor` builds every new note with `additions.of(addedExtensions())`.
2. A registry change reconfigures the main and side views at once.
3. A note parked in `states.current` is not rewritten. It gets the current set when it is
   opened again, in the same dispatch that reapplies the settings and its location (all
   three places a parked state is put into a view). This is how the settings compartment
   already works, and costs nothing for notes that are never reopened.
4. nuza's own extensions are not in this compartment; `writingSurface` is unchanged.

Errors: CodeMirror already catches an exception thrown from a `ViewPlugin` or update
listener, logs it, and disables that plugin, so a broken extension cannot take the editor
down. Saying _which_ plugin failed is P2.3's job, where the loader wraps a plugin's
extensions with `EditorView.exceptionSink` and attributes errors by owner.

## 6. Fenced code block renderers

Today `src/lib/markdown/livePreview.ts:643` special-cases ` ```mermaid ` and draws it with
`MermaidWidget`, unless the block is being edited.

After:

1. A facet `codeBlockRenderers` (`Facet<CodeBlockRenderer>`) in
   `src/lib/markdown/codeBlocks.ts`:
   ```ts
   interface CodeBlockRenderer {
     language: string; // lower-cased info string
     render(source: string, el: HTMLElement, ctx: CodeBlockContext): void | Disposable | Promise<void>;
   }
   ```
2. The mermaid branch becomes the general one: look up the info string in the facet;
   if a renderer exists, replace the block with a `RenderedCodeBlockWidget` that creates
   a container, calls `render`, keeps the disposable, and disposes it in `destroy()`.
   `eq()` compares language and source so typing elsewhere does not re-render it.
3. Mermaid registers itself through the facet in `writingSurface`, so it is the first
   user of the API and its behaviour (edit on click, block decoration, lazy import of
   `mermaid`) is the reference implementation.
4. Plugins add renderers through `registerCodeBlockRenderer`, which puts a
   `codeBlockRenderers.of(...)` into the plugin compartment.
5. A renderer that throws shows the block's source as plain code with a one-line error
   under it, never a blank gap.

## 7. Vault events

Today Rust emits `FILE_CHANGED_EVENT` only for notes the window is holding
(`src-tauri/src/watcher.rs:53`) and announces "files changed" for the index.

After: a frontend event bus `src/lib/registries/events.ts` with typed events
`note-create`, `note-modify`, `note-delete`, `note-rename`, `active-note-change`,
`note-open`, `editor-change` (debounced), `vault-open`, `layout-change`.

- `active-note-change`, `note-open`, `editor-change` and `layout-change` come from the
  app's own state and cost nothing.
- The four file events come from a new Rust event `vault-change { kind, path, from? }`
  that the watcher emits only while `Vault.plugin_events` is set (see
  [04-rust-backend.md](04-rust-backend.md#vault-events)). The flag is set when the first
  plugin subscribes to a file event and cleared when the last unsubscribes, so with no
  plugins the watcher does exactly what it does today.
- nuza's own saves are included (with `own: true`), since a plugin that reacts to edits
  wants those most of all.

## Order of work

Each numbered section above is one PR into `main-v3`, in the order given, except 7 which
can go in parallel with 2 to 6. Section 1 is the largest and riskiest; land it first and
on its own.
