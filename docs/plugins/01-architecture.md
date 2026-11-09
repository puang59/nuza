# 01. Architecture

## Layers

| Layer          | Where                                                                         | Owns                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registries     | `src/lib/registries/` (new)                                                   | The lists the UI renders: commands, status items, sidebar views, settings tabs, editor extensions, code block renderers. Built-in features and plugins both register here. |
| Plugin runtime | `src/lib/plugins/` (new)                                                      | `window.nuza`, the loader, the `Plugin` base class, the `App` object handed to plugins, `require` for shared modules, safe mode.                                           |
| Plugin UI      | `src/components/settings/PluginSettings.tsx`, `src/components/plugins/` (new) | The Community plugins settings tab, the browse view, the vault trust prompt.                                                                                               |
| Rust backend   | `src-tauri/src/plugins/` (new)                                                | Reading manifests, the enabled list, plugin data files, the `nuza-plugin://` scheme, install and update, the registry fetch, vault events for plugins.                     |
| SDK            | separate repos                                                                | `@nuza/plugin-api` (types), `nuza-sample-plugin` (template).                                                                                                               |
| Registry       | `puang59/nuza-plugins` (new repo)                                             | `plugins.json`, validation CI, review.                                                                                                                                     |

The webview never touches plugin files directly. It asks Rust for the list, and the
browser fetches code and styles over `nuza-plugin://`, which Rust answers only for
plugins that are installed and enabled in that window's vault.

## Loading model

nuza's CSP is `script-src 'self'`. There is no `unsafe-eval` and there should not be one.
So plugin code arrives as a classic script from a custom scheme that Rust serves,
the same way `nuza-media://` serves a note's images today (`src-tauri/src/lib.rs:70`).

What an author's `main.js` looks like after the template's esbuild step:

```js
// banner (added by the template's build, not written by the author)
nuza.registerPlugin(function (require, module, exports) {
  // ---- the author's code, bundled as CommonJS ----
  "use strict";
  var view = require("@codemirror/view");
  var nuza_1 = require("nuza");
  class WordGoal extends nuza_1.Plugin {
    onload() {
      /* ... */
    }
  }
  module.exports = { default: WordGoal };
  // footer
});
```

What the loader does for each plugin that should run, in manifest order of dependencies
(none in v1) then alphabetical:

1. Add `<link rel="stylesheet" href="nuza-plugin://<id>/styles.css?v=<hash>" data-plugin-id="<id>">`
   if the plugin has one.
2. Add `<script src="nuza-plugin://<id>/main.js?v=<hash>" data-plugin-id="<id>">`.
3. Inside the script, `nuza.registerPlugin(factory)` reads the id from
   `document.currentScript.dataset.pluginId`. A plugin cannot claim another plugin's id,
   because the id comes from the tag the loader wrote, not from the plugin.
4. The loader calls `factory(requireFor(id), module, module.exports)`, takes
   `module.exports.default` (or `module.exports` if it is itself a class), checks it
   extends `Plugin`, and constructs it with `(app, manifest)`.
5. `await plugin.onload()` inside a try/catch with timing. A throw, or a rejected
   promise, marks the plugin failed: everything it registered is disposed, its style is
   removed, and a notice says which plugin failed and why. Other plugins carry on.
6. `onload` taking longer than 500 ms is logged with the plugin's name, and shown in the
   plugin's row in Settings (see [06-security.md](06-security.md#load-time-budget)).

`?v=<hash>` is the first 12 hex characters of the SHA-256 of `main.js`, computed in Rust
when listing plugins. It makes the webview fetch a new copy after an update or a dev
rebuild without a cache to clear.

Plugins load after the first note is on screen, from an idle callback, so a slow plugin
never delays opening the app. Commands they add appear in the palette as they load.

### Unloading

`plugin.onunload()` is called, then every disposable the plugin registered through
`this.register*` / `this.add*` is disposed in reverse order, then its `<link>` is removed.
The `<script>` element is removed too, but a script cannot be un-run: anything the plugin
did outside the API (a global, a monkey-patched prototype, a raw `addEventListener`
without `registerDomEvent`) stays until the window reloads. The guidelines say so
(see [05-registry-and-publishing.md](05-registry-and-publishing.md#review-checklist)) and
review checks for it.

Reloading a plugin is unload, then load again with the new hash.

## Shared modules

Plugins must use nuza's copies of the libraries that share state across a page, or
CodeMirror's `instanceof` checks fail and extensions silently do nothing. The template
marks these as external; at runtime `require` resolves them from a fixed table:

| Module                                                                                                                                    | Why it is shared                                                         | Stability                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `nuza`                                                                                                                                    | The plugin API runtime (`Plugin`, `Notice`, `Modal`, `Setting`, helpers) | Versioned API, see [03](03-plugin-api.md#versioning)         |
| `@codemirror/state`, `@codemirror/view`, `@codemirror/language`, `@codemirror/commands`, `@codemirror/search`, `@codemirror/autocomplete` | One CodeMirror per page                                                  | Follows nuza's pinned versions; major bumps are an API major |
| `@lezer/common`, `@lezer/highlight`, `@lezer/markdown`                                                                                    | Syntax tree types shared with the markdown parser                        | Same                                                         |

`require` of anything else throws `Cannot find module "<name>"; bundle it with your
plugin`. React is deliberately not in the table for v1: views receive a plain
`HTMLElement`, as in Obsidian, so the API does not tie plugins to nuza's React version.
A plugin that wants React bundles its own and renders into that element. Exposing nuza's
React later is additive.

The table lives in `src/lib/plugins/modules.ts` and imports each module statically, which
Vite already bundles for nuza itself, so it costs nothing extra in size.

## Lifecycle across the app

```
app start
  -> window opens a vault (folder::open_folder)
  -> first note painted
  -> requestIdleCallback
       -> plugins_list()                       (Rust: read .nuza/plugins.json + manifests)
       -> community plugins off for this vault? stop.
       -> vault not trusted on this machine? show the trust prompt, stop until answered.
       -> safe mode sentinel set? skip loading, show "plugins were not loaded" notice.
       -> set sentinel, load each enabled plugin, clear sentinel
vault switch in the same window
  -> unload every plugin (reverse order), then the sequence above for the new vault
window close
  -> onunload for each, best effort, no awaiting
```

## Multiple windows

Each window is its own webview with its own JavaScript, and its own vault
(`state::Windows` keyed by window label). So each window loads its own instance of each
plugin. That is what Obsidian does too, and it keeps plugins simple: there is one vault,
one editor set, one window per `App`.

Two windows on the same vault share files on disk. Plugin data (`data.json`) is written
through Rust, which then emits `plugin-data-changed { id }` to the other windows open on
the same vault; the `Plugin` base calls `onExternalDataChange()` on the plugin there
(default: nothing). The enabled list works the same way: turning a plugin off in one
window unloads it in the others.

## How it fits the existing editor

nuza keeps one `EditorState` per open note in `states.current` in
`src/hooks/useDocuments.ts`, and builds each from `writingSurface` plus two compartments
(`preferences`, `location`). Plugins get a third compartment, `pluginExtensions`. When the
editor extension registry changes, every live view is reconfigured, and every cached
state in `states.current` is replaced by `state.update({ effects: reconfigure }).state`,
so a note switched to later already has the change. Details in
[02-host-registries.md](02-host-registries.md#5-editor-extensions).

## Size and memory budget

| Item                                                                       | Budget                                                                                              |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| JS added to `dist/assets` (registries, runtime, Settings tab, browse view) | 40 KB minified; the browse view is its own lazy chunk                                               |
| Rust added to the binary                                                   | 300 KB; no new HTTP, TLS or hashing crates (`reqwest` 0.13 and `sha2` 0.10 are already in the tree) |
| Work at startup with community plugins off                                 | One read of `.nuza/plugins.json` (or a missing file), nothing else                                  |
| Memory with no plugins                                                     | Not measurable against run-to-run noise                                                             |
| Memory per plugin                                                          | The plugin's own; nuza adds a few objects per registration                                          |

[07-rollout-and-testing.md](07-rollout-and-testing.md#acceptance-criteria) turns these into
checks.
