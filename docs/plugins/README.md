# nuza plugins: implementation plan

Community plugins for nuza, in the spirit of Obsidian's: anyone can write a plugin in
TypeScript, publish it as a GitHub release, get it listed in a public registry, and anyone
using nuza can browse, install, update and turn it off from Settings.

Written against nuza `v2.2.0` (commit `a426542`) on the `main-v3` branch. Every file path
here is relative to the repo root unless it says otherwise.

## Goals

1. **Plugins can do what nuza's own features do.** Add commands with shortcuts, status bar
   items, sidebar views, settings tabs, CodeMirror extensions and fenced code block
   renderers, and read and write notes in the vault.
2. **nuza stays light.** With no plugins installed the feature adds well under 0.5 MB to
   the app and no measurable memory. A disabled plugin is never loaded.
3. **Publishing is cheap for authors.** Clone a template, `bun run build`, tag a GitHub
   release, open one PR against the registry.
4. **Opening a vault never runs code by surprise.** A vault that arrives with plugins
   enabled (synced, cloned, shared) runs none of them until this machine says so.
5. **The API is a contract.** It is small, typed, versioned, and nuza's own features are
   built on the same registries so it cannot quietly rot.

## Non-goals (for v3.0)

- A sandbox for plugin code. Plugins run with full trust, as in Obsidian. A worker sandbox
  for plugins that do not touch the editor is sketched in
  [06-security.md](06-security.md#later-a-worker-sandbox) as a later phase.
- Paid plugins, accounts, or a hosted store. The registry is a GitHub repo.
- Themes as a separate kind of package. A plugin can ship `styles.css`, which covers
  most of it; first-class themes can come later on the same machinery.
- Plugins written in Rust or WASM.

## The shape in one picture

```
 GitHub release (author)          nuza-plugins repo (registry)
   manifest.json main.js styles.css     plugins.json  <-- PR, reviewed
            \                               |
             \        install / update      |  browse
              v                             v
  Rust: src-tauri/src/plugins/  ----  fetch, verify, stage, rename into
        <vault>/.nuza/plugins/<id>/
        nuza-plugin://<id>/main.js   (scheme, scoped to the window's vault)
              |
              v
  Webview: src/lib/plugins/loader.ts
        <script src="nuza-plugin://id/main.js">  ->  nuza.registerPlugin(factory)
        new Plugin(app, manifest).onload()
              |
              v
  Registries (src/lib/registries/*)  <-- nuza's own features register here too
        commands  statusItems  sidebarViews  settingTabs  editorExtensions  codeBlocks
```

## The documents

| #   | Document                                                       | What it covers                                                                      |
| --- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | [01-architecture.md](01-architecture.md)                       | Layers, loading model, shared modules, lifecycle, multiple windows, the size budget |
| 2   | [02-host-registries.md](02-host-registries.md)                 | Phase 1: turning nuza's fixed feature lists into registries, file by file           |
| 3   | [03-plugin-api.md](03-plugin-api.md)                           | The public API: `Plugin`, `App`, events, types, versioning                          |
| 4   | [04-rust-backend.md](04-rust-backend.md)                       | `src-tauri/src/plugins/`: storage, commands, the `nuza-plugin` scheme, CSP, install |
| 5   | [05-registry-and-publishing.md](05-registry-and-publishing.md) | The registry repo, review CI, author workflow, SDK and template, in-app browser     |
| 6   | [06-security.md](06-security.md)                               | Trust model, vault trust, safe mode, limits, network, later sandbox                 |
| 7   | [07-rollout-and-testing.md](07-rollout-and-testing.md)         | Phases, PR breakdown, tests, acceptance criteria, risks, open questions             |
| 8   | [CHECKLIST.md](CHECKLIST.md)                                   | The task list, worked through one PR at a time                                      |

## Decisions already made

| Question           | Decision                                                                                  | Why                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Where plugins run  | Main webview, full trust                                                                  | Editor plugins need the live `EditorView`; Obsidian proves the model works        |
| How code is loaded | Classic `<script>` from a `nuza-plugin://` scheme                                         | Works under the current `script-src 'self'` CSP plus one scheme; no `unsafe-eval` |
| Bundle format      | CommonJS body wrapped by a banner/footer that calls `nuza.registerPlugin`                 | Gives each plugin its own `require`, `module`, `exports`; one esbuild config      |
| Shared libraries   | `require("@codemirror/view")` etc. resolve to nuza's own copies                           | Two copies of `@codemirror/state` break extensions silently                       |
| Where plugins live | Per vault, `<vault>/.nuza/plugins/<id>/`                                                  | Same as Obsidian; plugins travel with a synced vault                              |
| Who turns them on  | Per vault list in `.nuza/plugins.json`, gated by a per-machine vault trust                | Goal 4                                                                            |
| Registry           | `puang59/nuza-plugins` on GitHub, `plugins.json`, PR to list                              | No infrastructure, reviewable history                                             |
| Release files      | GitHub release assets `manifest.json`, `main.js`, `styles.css`                            | Same as Obsidian; authors already know it                                         |
| Branching          | `main-v3` is the integration branch; feature PRs target it; it merges to `main` for 3.0.0 | Keeps 2.x releasable from `main` meanwhile                                        |

## Phases at a glance

| Phase              | Ships                                                                                                                 | Users see                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1. Host registries | Commands, status items, sidebar views, settings tabs, editor extensions and code block renderers move onto registries | Nothing (refactor)                                        |
| 2. Local plugins   | Rust plugins module, scheme, loader, `Plugin` API, Plugins settings tab, vault trust, safe mode, dev reload           | "Community plugins" in Settings, manual install by folder |
| 3. SDK             | `@nuza/plugin-api` types, `nuza-sample-plugin` template, docs, three first-party example plugins                      | Authors can build                                         |
| 4. Registry        | Registry repo + CI, browse/install/update/uninstall in the app                                                        | One-click install                                         |
| 5. Hardening       | Network API behind a permission, pinned hashes, load-time stats                                                       | Safer, faster                                             |
| 6. Optional        | Worker sandbox for non-editor plugins                                                                                 | Permissions that mean something                           |

Details and the PR list are in [07-rollout-and-testing.md](07-rollout-and-testing.md).
