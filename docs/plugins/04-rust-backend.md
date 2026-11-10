# 04. Rust backend

A new module, `src-tauri/src/plugins/`, registered in `src-tauri/src/lib.rs` beside the
others. No new crates: `serde`, `serde_json`, `tempfile`, `notify`, `tokio` are direct
dependencies already, and `reqwest` 0.13 and `sha2` 0.10 are in the tree under the
updater; add them to `Cargo.toml` by name at the versions `cargo tree` reports, as was
done for `percent-encoding` and `http-range`.

```
src-tauri/src/plugins/
  mod.rs          commands, the Tauri wiring
  manifest.rs     PluginManifest, validation (shared rules with the registry CI)
  store.rs        .nuza/plugins.json, data.json, the per-machine vault trust file
  protocol.rs     the nuza-plugin:// scheme
  install.rs      download, verify, stage, swap, uninstall
  registry.rs     fetching and caching the registry's plugins.json
  dev.rs          watching a plugin folder for rebuilds
  tests.rs
```

## On disk

```
<vault>/.nuza/
  plugins.json                 { "community": true, "enabled": ["word-goal", "kanban"] }
  plugins/
    word-goal/
      manifest.json
      main.js
      styles.css               optional
      data.json                written by saveData
    .staging-kanban-1a2b3c/    install in progress; removed on success or next start

<app data dir>/
  trusted-vaults.json          { "<canonical vault path>": { "trustedAt": 1762732800 } }   (seconds)
  plugin-registry.json         cached registry, with ETag and fetched-at
```

- `.nuza` starts with a dot, so `tree.rs` already hides it from the sidebar
  (`name.starts_with('.')`, line 46). The file index and content search must skip it
  too; check `index.rs` and `search.rs` and add `.nuza` to the skip rule if they only
  skip by `.gitignore`.
- `plugins.json` missing means community plugins off and nothing enabled.
- Trust is per machine, not in the vault, so a vault cannot vouch for itself
  (see [06-security.md](06-security.md#vault-trust)).

## Types

```rust
#[derive(Serialize)]
pub struct InstalledPlugin {
    manifest: PluginManifest,
    enabled: bool,
    has_styles: bool,
    /// First 12 hex chars of SHA-256 of main.js, for cache busting.
    hash: String,
    /// Why it will not load, if it will not: bad manifest, too new, missing main.js.
    problem: Option<String>,
    /// Whether this folder is a symlink (a dev checkout), which turns on dev reload.
    linked: bool,
}

#[derive(Serialize)]
pub struct PluginsState {
    community: bool,
    trusted: bool,
    plugins: Vec<InstalledPlugin>,
}
```

## Commands

All take the calling window and resolve its vault through `state::Windows`, as the file
commands do, so a window can only see and change its own vault's plugins.

| Command                         | Does                                                                                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugins_state()`               | Reads `plugins.json`, every `plugins/*/manifest.json`, hashes `main.js`, checks `minAppVersion`/`apiVersion`. Returns `PluginsState`. Never errors for one bad plugin; it sets that plugin's `problem`. |
| `plugins_set_community(on)`     | Writes `community` in `plugins.json`.                                                                                                                                                                   |
| `plugins_trust_vault()`         | Adds the canonical vault path to `trusted-vaults.json`.                                                                                                                                                 |
| `plugins_set_enabled(id, on)`   | Edits `enabled`; emits `plugins-changed` to other windows on the same vault.                                                                                                                            |
| `plugin_load_data(id)`          | Reads `plugins/<id>/data.json`, `null` if missing.                                                                                                                                                      |
| `plugin_save_data(id, json)`    | Atomic write (tempfile + rename, as `files::write_file` does), 5 MB cap; emits `plugin-data-changed { id }` to other windows on the vault.                                                              |
| `plugins_install(id, version?)` | See [Install](#install).                                                                                                                                                                                |
| `plugins_uninstall(id)`         | Disables, then moves the folder to the system trash (`trash` crate, as deleting a note does).                                                                                                           |
| `plugins_registry(refresh)`     | Returns the cached registry; fetches if `refresh` or older than 6 hours.                                                                                                                                |
| `plugins_check_updates()`       | Compares installed versions with each listed repo's latest release.                                                                                                                                     |
| `plugins_watch_vault(on)`       | Sets `Vault.plugin_events` (see [Vault events](#vault-events)).                                                                                                                                         |
| `plugins_dev_watch(id, on)`     | Watches a linked plugin folder; emits `plugin-rebuilt { id }` when `main.js` or `styles.css` changes.                                                                                                   |
| `plugin_request(id, request)`   | Phase 5. HTTP for plugins that declare `network`; see [06](06-security.md#network).                                                                                                                     |
| `plugins_open_folder()`         | Opens `.nuza/plugins` in the file manager (`files::open_with_system`).                                                                                                                                  |

Register each in `generate_handler!` in `lib.rs`. These are custom commands, so the
`capabilities/default.json` permissions list does not change.

## The `nuza-plugin` scheme

`protocol.rs`, registered with `register_asynchronous_uri_scheme_protocol` next to
`media::MEDIA_PROTOCOL` and served off the main thread with `spawn_blocking`, exactly as
`serve_media` is.

`nuza-plugin://<id>/<file>`:

1. Look up the window's vault from the webview label (`context.webview_label()`).
2. Refuse (403) unless `<id>` is installed **and** enabled in that vault, community
   plugins are on, and the vault is trusted.
3. Allow only `main.js`, `styles.css`, and files under `assets/` (images and fonts a
   plugin ships). Resolve with the same `within`-style check `media.rs` uses, with the
   plugin folder as the root, so `..` and symlinks out of it are refused. Linked dev
   folders are allowed to be symlinks themselves, but nothing inside may escape them.
4. Content types: `text/javascript`, `text/css`, then by extension for assets.
5. `Cache-Control: no-store`; the `?v=` query busts the webview's memory cache.

On Windows and Linux, Tauri serves custom schemes as `http://<scheme>.localhost`, which
is why the CSP lists both forms (as it already does for `nuza-media`).

## CSP

`src-tauri/tauri.conf.json`, both `csp` and `devCsp`:

```
script-src 'self' nuza-plugin: http://nuza-plugin.localhost;
style-src  'self' 'unsafe-inline' nuza-plugin: http://nuza-plugin.localhost;
img-src    ... nuza-plugin: http://nuza-plugin.localhost;
font-src   'self' data: nuza-plugin: http://nuza-plugin.localhost;
```

`connect-src` stays as it is: plugins have no direct `fetch` to the internet. That is a
feature (see [06](06-security.md#network)). `frame-src 'none'` stays until the optional
sandbox phase.

## Install

`plugins_install(id, version?)`:

1. Find `id` in the cached registry; get `repo`.
2. Resolve the version: given, or the latest GitHub release
   (`https://api.github.com/repos/<repo>/releases/latest`, unauthenticated, with the
   registry's ETag cache to stay under the 60 requests/hour limit).
3. Download `manifest.json`, `main.js` and, if listed in the release, `styles.css`
   from `https://github.com/<repo>/releases/download/<version>/<file>` with `reqwest`
   (rustls, as the updater uses). Size caps: manifest 64 KB, `main.js` 10 MB,
   `styles.css` 2 MB. Timeout 30 s.
4. Validate: manifest parses and passes `manifest.rs`; `manifest.id == id`;
   `manifest.version == version`; `minAppVersion` not newer than this nuza.
5. Phase 5: compare SHA-256 of each file with the hashes pinned in the registry for that
   version, and refuse on mismatch.
6. Write into `.nuza/plugins/.staging-<id>-<random>/`, then, if updating, rename the old
   folder aside, rename staging into place, carry `data.json` over, and delete the old
   one. Any failure removes staging and leaves the installed version untouched.
7. Emit `plugins-changed`. The webview reloads that plugin if it was enabled.

Stale `.staging-*` folders are removed on `plugins_state()`.

## Vault events

`watcher.rs` already sees every change under the vault. Add a field `plugin_events:
AtomicBool` on `Vault`. When set, the watcher callback also emits, to that window only:

```rust
#[derive(Serialize, Clone)]
struct VaultChange { kind: &'static str /* create|modify|delete|rename */, path: String, from: Option<String>, own: bool }
```

- `own` comes from the same `changed_since_read` / own-write bookkeeping the watcher
  already uses to keep the app's own saves quiet.
- Paths under `.nuza/` are never emitted.
- Renames: `notify` reports them as a pair on macOS and Linux, and as remove + create on
  some Windows setups; pair them within 100 ms by file id where available, else report
  delete + create. The API documents that `rename` may arrive as delete + create.
- Coalesce bursts (a `git checkout` touching 2,000 files) into batches every 100 ms; the
  frontend bus fans them out.

When the flag is clear the callback does exactly what it does today, so a window with no
plugins pays nothing.

## Registry fetch

`registry.rs` fetches
`https://raw.githubusercontent.com/puang59/nuza-plugins/main/plugins.json` with
`If-None-Match`, stores body and ETag in `plugin-registry.json`, and parses it into
`Vec<RegistryEntry { id, name, author, description, repo, pinned: Option<...> }>`.
Fetch failures return the cached copy with a `stale: true` flag; no cache and no network
returns an error the browse view shows as "Can't reach the plugin list".

If GitHub's rate limits or availability become a problem, put a Cloudflare Worker in
front at a `nuza-plugins.puang.in`-style host (as with `nuza-update.puang.in`) that
caches `plugins.json` and the latest-release lookups. The client only needs the base URL
changed; nothing else depends on GitHub directly.

## Tests (`plugins/tests.rs`)

- Manifest validation: each rule, accepted and refused examples.
- `plugins_state` on a fixture vault: good plugin, bad manifest, too-new `minAppVersion`,
  missing `main.js`, stale staging folder removed.
- Scheme: `..`, encoded `%2e%2e`, absolute paths, symlink out of the folder, disabled
  plugin, untrusted vault, other window's vault, a file outside the allowed list. All 403.
- Install: against a local `tokio` HTTP fixture server (no network in CI): success,
  wrong id, wrong version, oversized file, interrupted download leaves the old version.
- Watcher: with the flag clear no `vault-change` is emitted; with it set, create, modify,
  delete, rename and `.nuza` exclusion.

### As built: dev reload (P2.6)

`plugins/dev.rs`: `plugins_dev_watch(id, on)` refuses a folder that is not a link, and an
untrusted vault, then watches the link's target (not recursive) and emits
`plugin-rebuilt` with the id when `main.js` or `styles.css` is written. Watchers live in
`Vault.dev_watchers` and are dropped when the window opens another folder. The plugin's
`hash` now covers `styles.css` as well, so the page's `PluginHost.rebuilt()` (debounced
150 ms) only has to sync. Checked in the real app: a rebuild reloads the plugin with no
page reload, and its `saveData` state carries over; a styles-only change reloads it too.

### As built: data across windows (P2.7)

`plugin_save_data` emits `plugin-data-changed` (the id) to the vault's other windows, which
call that plugin's `onExternalDataChange()` (may return a promise; a throw is the
plugin's, as everywhere). `plugins-changed` from P2.1 already re-syncs them on a toggle.
Checked in the real app with two windows on one vault: a save in one shows in the other,
and turning the plugin off in one unloads it in both.
