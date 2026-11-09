# Plugin system: work checklist

The working list for building [the plan](README.md), one task at a time. Each task is one
PR. Tick the box in the same PR that finishes the task, and fill in its PR number.

## How each task is done

1. Start from the latest `origin/main-v3`; branch `plugins/<task-id>-<slug>` (for
   example `plugins/p1.2-command-registry`).
2. Read the task's plan section before writing code; if the code has moved since the
   plan was written, update the plan doc in the same PR.
3. Run `bun run build`, `bun test`, `bun run lint`, `bun run format:check`, and for Rust
   `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (all
   with `--manifest-path src-tauri/Cargo.toml`).
4. Open the PR against `main-v3` (not `main`), conventional title, short description,
   no co-author or generated-by lines.
5. Merge (squash) once CI is green; update local `main-v3`.
6. GUI checks only against `nuza-test-vault`.

Status key: `[ ]` not started · `[~]` in progress · `[x]` merged

## Decisions (before or during phase 1)

- [ ] **D1** Install plugins per vault or once for every vault. Plan default: per vault. Needed by P2.1.
- [ ] **D2** Confirm `.nuza/` as the in-vault folder name. Needed by P2.1.
- [ ] **D3** Expose nuza's React to plugins: plan default no. Needed by P2.3.
- [ ] **D4** Registry owner: `puang59/nuza-plugins` or a `nuza` org. Needed by P3.2.
- [x] **D5** Phase 1 into `main-v3` (plan default) or straight to `main` in 2.x. Needed by P1.1. Decided: `main-v3`.

## Phase 1: host registries ([02](02-host-registries.md))

Users see no change. Every existing test keeps passing.

- [x] **P1.1 Registry primitive** · PR #384
  - `src/lib/registries/registry.ts` (`Registry<T>`, `Disposable`, `disposeOwner`), `useRegistry` hook, `src/lib/registries/index.ts`.
  - Done when: `tests/registry.test.ts` covers ordering, duplicate ids, dispose twice, `disposeOwner`, stable `list()` identity.
- [x] **P1.2 Commands and keymaps on a registry** · PR #385 · after P1.1
  - `src/lib/registries/commands.ts`; `App.tsx` registers `KEYMAP_ACTIONS` with handlers through a ref; `useKeymaps`, `useKeymapListener`, palette commands, `runAction`, `KeymapSettings` (grouped) read the registry.
  - Overrides for unregistered ids are kept; core beats plugin on a chord clash.
  - Done when: every shortcut and palette entry works as in 2.2.0; new tests for binding resolution, kept overrides, conflicts, palette filtering; a test that each `KEYMAP_ACTIONS` id has a handler.
- [x] **P1.3 Status bar items on a registry** · PR #386 · after P1.1
  - `src/lib/registries/statusItems.ts`; React-or-mount render union; `StatusBar.tsx` and `useStatusItems` read it.
  - Done when: right-click menu and hidden items behave as before.
- [x] **P1.4 Sidebar views and settings tabs on registries** · PR #387 · after P1.1
  - `ViewSwitcher.tsx` / `Sidebar/index.tsx` and `SettingsModal.tsx` `TABS` read registries; `readView` fallback kept.
  - Done when: all four views and five tabs unchanged.
- [x] **P1.5 Editor compartment for added extensions** · PR #388 · after P1.1
  - `pluginExtensions` compartment in `useDocuments.ts` `stateFor`; reconfigure main view, side pane view, and every cached state in `states.current`; `exceptionSink` wrapper per owner.
  - Done when: test that registering and disposing an extension affects the view and cached states; 50-tab reconfigure timed and noted in the PR.
- [x] **P1.6 Code block renderers, mermaid first** · PR #389 · after P1.5
  - `src/lib/markdown/codeBlocks.ts` facet; general branch in `livePreview.ts` replacing the mermaid special case; `RenderedCodeBlockWidget`; error fallback shows source plus message.
  - Done when: mermaid looks and edits exactly as before (before/after screenshots in PR); `tests/codeBlocks.test.ts`.
- [x] **P1.7 Vault change events behind a flag** · PR #390 · after P1.1
  - Rust: `plugin_events` flag on `Vault`, `vault-change` event from `watcher.rs` (kinds, `own`, `.nuza` excluded, 100 ms batching), `plugins_watch_vault` command. Frontend: `src/lib/registries/events.ts` bus with app-side events too.
  - Done when: Rust tests show nothing emitted with the flag off; events correct with it on.

## Phase 2: local plugins

- [ ] **P2.1 Plugins module, manifests, enabled list** · PR # · after D1, D2
  - `src-tauri/src/plugins/{mod,manifest,store}.rs`; `plugins_state`, `plugins_set_community`, `plugins_set_enabled`, `plugins_open_folder`; stale staging cleanup; `.nuza` skipped by index and search.
  - Done when: manifest rule tests and fixture-vault `plugins_state` tests pass ([04](04-rust-backend.md#tests-pluginstestsrs)).
- [ ] **P2.2 The `nuza-plugin` scheme and CSP** · PR # · after P2.1
  - `plugins/protocol.rs`; `csp` and `devCsp` in `tauri.conf.json` (both scheme forms).
  - Done when: every refusal case in the plan returns 403 in tests; a script and stylesheet load in dev on macOS.
- [ ] **P2.3 Plugin runtime and loader** · PR # · after P1.2-P1.6, P2.2, D3
  - `src/lib/plugins/`: `window.nuza.registerPlugin`, `modules.ts` shared `require`, `Plugin` base, `App` wrappers (vault, workspace, metadata, ui), `Modal`, `Setting`, `PluginSettingTab`, `Notice`; load after first paint; timing; unload in reverse; runtime error wrappers.
  - Done when: `tests/pluginLoader.test.ts` and `tests/pluginApi.test.ts` cover the cases in [07](07-rollout-and-testing.md#unit-bun-test-tests); a hand-written fixture plugin works in the app.
- [ ] **P2.4 Community plugins settings tab** · PR # · after P2.3
  - `src/components/settings/PluginSettings.tsx`: off state, installed rows, toggles, problems, reload, open folder; per-plugin tabs under a "Plugins" heading.
  - Done when: manual checks 1, 2 and 4 in [07](07-rollout-and-testing.md#manual-in-the-app) pass.
- [ ] **P2.5 Vault trust and safe mode** · PR # · after P2.4
  - `trusted-vaults.json`, `plugins_trust_vault`, trust checked in Rust for scheme and commands; banner; loading marker per window; Shift on open; `nuza --no-plugins`.
  - Done when: manual checks 6 and 7 pass.
- [ ] **P2.6 Reload linked plugins on rebuild** · PR # · after P2.3
  - `plugins/dev.rs`, `plugins_dev_watch`, `plugin-rebuilt` event, "linked" badge.
  - Done when: manual check 3 passes.
- [ ] **P2.7 Plugin data and multiple windows** · PR # · after P2.3
  - `plugin_load_data`, `plugin_save_data` (atomic, 5 MB cap), `plugin-data-changed` and `plugins-changed` to other windows on the vault, `onExternalDataChange`.
  - Done when: manual check 5 passes.

## Phase 3: SDK

- [ ] **P3.1 Generated public types** · PR # · after P2.3
  - `src/lib/plugins/api/public.d.ts`, generator in `scripts/`, type test that the runtime matches it.
- [ ] **P3.2 `nuza-plugin-api` repo and npm package** · after P3.1, D4
  - Publish `@nuza/plugin-api@0.1.0`, TypeDoc on GitHub Pages. Ask before the first npm publish.
- [ ] **P3.3 `nuza-sample-plugin` template repo** · after P3.2
  - esbuild config with externals, banner, footer; `version` script; release workflow on tag.
- [ ] **P3.4 Example plugin: Word Goal** · after P3.3
- [ ] **P3.5 Example plugin: Daily Note** · after P3.3
- [ ] **P3.6 Example plugin: Chart Blocks** · after P3.3
  - For P3.4-P3.6: public API only; any gap becomes an API change in nuza first.
- [ ] **P3.7 "Write a plugin" guide on nuza-website** · after P3.3
  - nuza-website rules apply (no em dashes in copy).

## Phase 4: registry and in-app install ([05](05-registry-and-publishing.md))

- [ ] **P4.1 `nuza-plugins` registry repo** · after D4, P3.4-P3.6
  - `plugins.json` with the three examples, `removed.json`, `GUIDELINES.md`, PR template, validation CI with reviewer flags.
- [ ] **P4.2 Fetch the plugin directory** · PR # · after P4.1
  - `plugins/registry.rs`, ETag cache in app data, `plugins_registry`, stale flag.
- [ ] **P4.3 Install, update, uninstall** · PR # · after P4.2
  - `plugins/install.rs` with caps, validation, staging swap, `data.json` kept; `plugins_check_updates`, `plugins_uninstall` to trash; fixture HTTP server tests.
- [ ] **P4.4 Browse community plugins** · PR # · after P4.3
  - Lazy `src/components/plugins/PluginBrowser.tsx`, README via sanitiser, install/update buttons, removed-plugin notices.
  - Done when: manual check 8 passes.
- [ ] **P4.5 Release 3.0.0** · after everything above
  - Every box in [acceptance criteria](07-rollout-and-testing.md#acceptance-criteria-for-300) ticked with numbers in the PR; merge `main-v3` into `main`; version bump PR; release.

## Phase 5: hardening

- [ ] **P5.1 `app.net.request` and the `network` permission** · PR #
- [ ] **P5.2 Pinned hashes** (registry bot plus refusal in `install.rs`) · PR #
- [ ] **P5.3 Load-time and error stats per plugin in Settings** · PR #
- [ ] **P5.4 Download stats Worker** (optional)

## Phase 6 (decide after 3.0)

- [ ] **P6.1 Worker sandbox for non-editor plugins**, see [06](06-security.md#later-a-worker-sandbox)

## Ongoing

- [ ] After each 2.x release on `main`, merge `main` into `main-v3`.
