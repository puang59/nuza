# 07. Rollout and testing

## Branching

- `main-v3` branches from `main` at `a426542` (v2.2.0) and is the integration branch for
  this work.
- Each PR below targets `main-v3`, with the usual CI (typecheck, build, `bun test`,
  eslint, prettier, rustfmt, clippy and `cargo test` on all three platforms).
- `main` keeps shipping 2.x. Merge `main` into `main-v3` after each 2.x release so the
  final merge stays small.
- When phases 1 to 4 are done and the acceptance criteria below pass, `main-v3` merges
  into `main` and ships as **3.0.0** through the normal version-bump PR and release flow.
- Phase 1 is a pure refactor and can instead go straight to `main` in 2.x if that is
  preferred; it makes the 3.0 merge smaller.

## PR breakdown

### Phase 1: host registries ([02](02-host-registries.md))

| PR  | Title                                                       | Size | Notes                                                                    |
| --- | ----------------------------------------------------------- | ---- | ------------------------------------------------------------------------ |
| 1   | `refactor: a registry primitive`                            | S    | `src/lib/registries/registry.ts`, `useRegistry`, tests                   |
| 2   | `refactor: commands and keymaps on a registry`              | L    | Widens `KeymapAction` to string ids; palette, listener, Keymaps settings |
| 3   | `refactor: status bar items on a registry`                  | S    |                                                                          |
| 4   | `refactor: sidebar views and settings tabs on registries`   | M    |                                                                          |
| 5   | `refactor: an editor compartment for added extensions`      | M    | Reconfigures cached states too                                           |
| 6   | `refactor: code block renderers, with mermaid as the first` | M    | Must not change mermaid behaviour; screenshot before and after           |
| 7   | `feat: vault change events behind a flag`                   | M    | Rust watcher + frontend bus; no-op unless flagged                        |

### Phase 2: local plugins

| PR  | Title                                                  | Size | Notes                                                                           |
| --- | ------------------------------------------------------ | ---- | ------------------------------------------------------------------------------- |
| 8   | `feat: plugins module, manifests and the enabled list` | M    | `plugins/manifest.rs`, `store.rs`, `plugins_state`, `plugins_set_*`             |
| 9   | `feat: the nuza-plugin scheme`                         | M    | `protocol.rs`, CSP in `tauri.conf.json`, scheme tests                           |
| 10  | `feat: the plugin runtime and loader`                  | L    | `window.nuza`, `require`, `Plugin`, `App` wrappers, load/unload, error wrappers |
| 11  | `feat: Community plugins in Settings`                  | M    | Off state, installed list, toggles, reload, open folder                         |
| 12  | `feat: vault trust and safe mode`                      | M    | Banner, `trusted-vaults.json`, loading marker, Shift and `--no-plugins`         |
| 13  | `feat: reload linked plugins on rebuild`               | S    | `dev.rs`                                                                        |
| 14  | `feat: plugin data and multiple windows`               | S    | `loadData`/`saveData`, cross-window events                                      |

### Phase 3: SDK (other repos, plus one nuza PR)

| PR  | Where                                           | Notes                                                |
| --- | ----------------------------------------------- | ---------------------------------------------------- |
| 15  | nuza: `chore: generate the public plugin types` | `public.d.ts`, generator script, type test           |
| 16  | `nuza-plugin-api`                               | First publish as `0.1.0` (pre-1.0 until 3.0.0 ships) |
| 17  | `nuza-sample-plugin`                            | Template, release action                             |
| 18  | Example plugins                                 | See below                                            |
| 19  | nuza-website                                    | "Write a plugin" guide page                          |

**Example plugins**, written by us against the public API only, as the test that the API
is enough. Each exercises a different part:

| Plugin       | Exercises                                                                              |
| ------------ | -------------------------------------------------------------------------------------- |
| Word Goal    | Status bar item, settings tab, `saveData`, `editor-change`                             |
| Daily Note   | Command with a shortcut, `vault.create`, `workspace.openNote`, templates from a folder |
| Chart Blocks | `registerCodeBlockRenderer("chart")`, a bundled library, theme changes                 |

If any of these needs something the API does not have, the API grows before 3.0.0, not
the plugin reaching into internals.

### Phase 4: registry and in-app install ([05](05-registry-and-publishing.md))

| PR  | Where                                               | Notes                                                                                          |
| --- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 20  | `nuza-plugins` repo                                 | `plugins.json` with the three examples, `removed.json`, guidelines, PR template, validation CI |
| 21  | nuza: `feat: fetch the plugin directory`            | `registry.rs`, cache, ETag                                                                     |
| 22  | nuza: `feat: install, update and uninstall plugins` | `install.rs`, staging, fixture server tests                                                    |
| 23  | nuza: `feat: browse community plugins`              | Lazy browse view, README rendering, update checks                                              |

### Phase 5: hardening

| PR  | Notes                                                                |
| --- | -------------------------------------------------------------------- |
| 24  | `app.net.request` and the `network` permission                       |
| 25  | Pinned hashes: registry bot plus refusal on mismatch in `install.rs` |
| 26  | Load-time and error stats per plugin in Settings                     |
| 27  | Download stats Worker (optional)                                     |

Phase 6 (worker sandbox) is decided after 3.0 has real plugins.

## Testing

### Unit (bun test, `tests/`)

- `registry.test.ts`: ordering, duplicates, dispose, `disposeOwner`, stable `list()`.
- `commandRegistry.test.ts`: binding resolution with overrides, overrides kept for
  absent commands, core-wins conflict rule, palette filtering, `when()`.
- `pluginLoader.test.ts`, with fixture scripts injected into the test DOM:
  - registers, loads, unloads; everything added is disposed;
  - throwing `onload` and rejecting `onload` both mark failed and dispose;
  - a plugin cannot register under another id (id comes from the script tag);
  - `require` of a shared module returns nuza's instance (identity check), and of an
    unknown module throws the documented message;
  - the safe mode marker is written, cleared, and honoured.
- `pluginApi.test.ts`: `vault.write` on an open note goes through the editor (undo works,
  dirty state set); `.nuza` paths are refused; command ids are prefixed.
- `codeBlocks.test.ts`: renderer lookup, eq/re-render rules, a throwing renderer shows
  source plus error, dispose on removal, mermaid unchanged.
- `editorCompartment.test.ts`: registering an extension reconfigures the view and every
  cached state; unregistering removes it.

### Rust (`cargo test`)

As listed in [04-rust-backend.md](04-rust-backend.md#tests-pluginstestsrs).

### Manual, in the app

Against `nuza-test-vault`, never the real notes folder.

1. With no `.nuza` folder: app behaves exactly as 2.2.0; Settings shows the off state.
2. Turn on community plugins; link the sample plugin; it loads; its command is in the
   palette and Keymaps; its status item shows and can be hidden; its settings tab works.
3. Rebuild the sample: it reloads without a restart; state from `saveData` survives.
4. Turn it off: command, status item, tab, styles and editor extension all disappear.
5. Second window on the same vault: toggling and `saveData` propagate.
6. Copy the vault to a new path and open it: trust banner; "Keep off" runs nothing.
7. A fixture plugin that loops forever in `onload`: window recovers on restart into safe
   mode, naming that plugin.
8. Install Word Goal from the browse view; update it to a newer tagged release;
   uninstall it (folder in the Trash).
9. Light and dark themes, accent colour change: example plugins follow.
10. macOS, Windows and Linux: scheme URLs (`nuza-plugin:` vs `http://nuza-plugin.localhost`)
    load scripts and styles.

## Acceptance criteria for 3.0.0

- [ ] All of phases 1 to 4 merged into `main-v3`, CI green on all platforms.
- [ ] `dist/assets` grows by at most 40 KB minified for the main chunk with the browse
      view in its own lazy chunk (compare `bun run build` output against 2.2.0).
- [ ] The release binary grows by at most 300 KB on each platform.
- [ ] With community plugins off, opening a vault does one extra small file read and no
      network requests (check with the log at debug level).
- [ ] Idle memory with no plugins is within noise of 2.2.0 (Activity Monitor, same vault,
      five runs each).
- [ ] The three example plugins work using only `@nuza/plugin-api`.
- [ ] A shared vault with plugins on runs nothing until trusted.
- [ ] A plugin that hangs `onload` cannot make the app unusable.
- [ ] Docs: API reference, "Write a plugin" guide, and the registry guidelines are live.

## Risks

| Risk                                                  | Likelihood       | Mitigation                                                                                          |
| ----------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------- |
| Commands refactor breaks a shortcut                   | Medium           | Existing keymap tests, plus a test that every `KEYMAP_ACTIONS` entry is registered with a handler   |
| Reconfiguring cached states is slow with many tabs    | Low              | It is a state update, no DOM; measure with 50 tabs; batch reconfigures in one microtask             |
| The API is too small and authors reach into internals | High at first    | The three example plugins before 3.0; add API rather than allow internals; review rejects internals |
| Two copies of CodeMirror in a plugin                  | Medium           | Template externals; loader warns when a plugin's `Extension` fails CodeMirror's checks              |
| GitHub API rate limits for update checks              | Medium           | ETag caching, one check per day, Worker in front if needed                                          |
| A malicious plugin gets listed                        | Low, high impact | Review, takedown list, no auto-update, pinned hashes in phase 5                                     |
| Maintainer review load                                | Medium           | CI does the mechanical checks; guidelines are strict and short; reviews can pause                   |

## Open questions

1. **Per-vault or global installs?** The plan follows Obsidian (per vault). A global
   install shared by all vaults is simpler for people with many vaults. Could be added
   later as `<app data>/plugins/` with per-vault enable lists.
2. **Folder name**: `.nuza/` is new. Fine to commit to now; changing it later breaks
   every installed plugin.
3. **Expose React?** Not in v1 (see [01](01-architecture.md#shared-modules)). Revisit if
   most plugins end up bundling their own React.
4. **Registry owner**: `puang59/nuza-plugins`, or a `nuza` GitHub organisation before
   launch so the repo URLs do not have to move later.
5. **Themes**: a plugin with only `styles.css` works today. Whether to list themes
   separately in the browse view is a UI question for after 3.0.
