# 06. Security

## The honest model

A plugin runs in the same webview as nuza, so it can do anything nuza's frontend can:
read and write every note in the vault, call any Tauri command nuza registers (including
`terminal::open_in_terminal` and the agent commands), and change any part of the UI.
`window.__TAURI_INTERNALS__` is reachable from any script on the page; hiding it from
plugins is not possible without a separate context.

So, as with Obsidian, **installing a plugin means trusting its author**. The design does
not pretend otherwise. It works on four things instead:

1. Nothing runs that the user did not turn on, on this machine.
2. What a plugin can reach through the _API_ is scoped, so well-behaved plugins stay
   inside the vault and review has a clear line to check against.
3. Review, takedown and (phase 5) pinned hashes make a bad plugin rare and short-lived.
4. A broken plugin can always be got out of the way.

The Settings off-state text says this plainly: "Plugins run with the same access as nuza.
Only turn on plugins from authors you trust."

## Defaults

- Community plugins are **off** for every vault until turned on in that vault.
- Newly installed plugins are **off** until toggled on.
- No plugin is ever auto-updated in v1.

## Vault trust

The threat: someone shares a vault (a zip, a git repo, a synced folder) that contains
`.nuza/plugins.json` with `community: true` and a malicious plugin enabled. Obsidian
handles this with a "Do you trust the author of this vault?" prompt; nuza does the same.

- Trust is recorded per machine in `<app data>/trusted-vaults.json`, keyed by the
  vault's canonical path. A vault cannot mark itself trusted.
- On opening a vault whose `plugins.json` has community plugins on and at least one
  plugin enabled, and which is not trusted here, nuza loads no plugins and shows a
  banner: "This vault has 3 plugins turned on: Word Goal, Kanban, Citations. Plugins
  can read and change your files. Turn them on?" with **Turn on** and **Keep off**.
  "Keep off" sets `community: false` in that vault.
- Turning community plugins on yourself in Settings counts as trusting the vault.
- Moving or renaming the folder asks again, which is the safe side.
- The scheme and every plugin command check trust in Rust, so a webview-side bug cannot
  load an untrusted plugin.

## Safe mode

A plugin that crashes or hangs the window on load must not lock the user out.

- Before loading each plugin, the loader writes `{ vault, id }` to localStorage under
  `pluginsLoading:<window label>`, which survives a crash and a reload, and clears it
  after the last `onload` settles.
- If the window starts and finds the marker for the same vault, it skips plugins and
  shows "nuza started without plugins because one stopped the last start. Turn them back
  on in Settings, one at a time." The Installed list marks the plugin that was loading
  when it stopped (the marker records the id currently loading).
- Holding Shift while nuza opens a vault starts without plugins, too.
- `nuza --no-plugins` (the CLI in `src-tauri/src/cli.rs`) does the same for every window.

## Load-time budget

`onload` is timed. Over 500 ms is logged and shown on the plugin's row as "Slow to start
(N ms)". Over 10 s the loader stops waiting (the plugin may still finish), treats it as
failed, and disposes what it registered so far. Plugins load after first paint, so even a
slow one does not delay opening a note.

## Errors at runtime

- Command handlers, event callbacks, status items and code block renderers are called
  through a wrapper that catches, reports `"<Plugin>: <message>"` once per minute per
  plugin, and logs the stack.
- Editor extensions go through `EditorView.exceptionSink`; three errors in ten seconds
  remove that plugin's extensions from the editor until it is reloaded
  (see [02](02-host-registries.md#5-editor-extensions)).

## Scope of the API

The API (not the page) enforces:

- Vault paths are vault-relative and resolved through the existing `within_vault*`
  checks in Rust. No API reads outside the vault.
- `.nuza/` is invisible to `vault.*`; a plugin reaches only its own `data.json`.
- `data.json` is capped at 5 MB.
- No API exposes the terminal, the agent, the CLI installer, the updater or window
  management.

Review rejects plugins that call `invoke` directly or touch `__TAURI_INTERNALS__`.

## Network

The CSP keeps `connect-src` to `'self'` and IPC, so a plugin cannot `fetch` the internet
or open a WebSocket. Images over `https:` remain allowed, as they are for notes today
(`img-src https:`), which is a known way to leak small amounts of data in a URL; review
looks for it.

Phase 5 adds `app.net.request({ url, method, headers, body })`, implemented in Rust
(`plugin_request`) with `reqwest`, and only for plugins whose manifest lists
`"network"`. The browse view and the enable toggle show "Uses the internet" for those.
Requests are https only, 30 s timeout, 20 MB response cap, no cookies, and log the host
per plugin so Settings can show "Talked to api.example.com" on the plugin's row.

This is not a sandbox (the plugin could still call `invoke` itself), but it gives
reviewers one obvious place to see what a plugin sends where, and it makes the honest
plugins easy to recognise.

## Takedown

A plugin found to be malicious: its id goes into `removed.json` with a reason, its entry
leaves `plugins.json`, and nuza shows it as removed on next registry fetch, turns it off,
and offers uninstall. Because nuza never auto-runs newly installed or updated code
without a click, the window between a bad release and takedown only affects people who
updated in that time; pinned hashes in phase 5 close that window for reviewed plugins.

## Later: a worker sandbox

For plugins that only process text, talk to a service or add commands (no editor
extensions, no DOM), a real sandbox is possible: run them in a dedicated Web Worker with
no access to `__TAURI_INTERNALS__`, and proxy a subset of the API over `postMessage`.
Then `permissions` (`vault:read`, `vault:write`, `network`) can be enforced, not just
declared. One worker for all sandboxed plugins keeps the memory cost to one JS context
(a few MB). The manifest would gain `"runtime": "worker"`. This is phase 6 and only worth
building if real plugins want it.
