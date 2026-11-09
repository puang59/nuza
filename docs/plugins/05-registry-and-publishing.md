# 05. Registry, publishing and the author's side

## The pieces

| Repo                         | What it is                                                           | Owner  |
| ---------------------------- | -------------------------------------------------------------------- | ------ |
| `puang59/nuza-plugins`       | The registry: `plugins.json`, guidelines, validation CI, PR template | nuza   |
| `puang59/nuza-plugin-api`    | `@nuza/plugin-api` on npm: `.d.ts` only, plus docs generated from it | nuza   |
| `puang59/nuza-sample-plugin` | GitHub template repo authors start from                              | nuza   |
| `<author>/<plugin>`          | The plugin itself, releases attached                                 | author |

## The registry file

`plugins.json`, sorted by id, one object per plugin:

```json
[
  {
    "id": "word-goal",
    "name": "Word Goal",
    "author": "Jane Doe",
    "description": "A daily word target in the status bar.",
    "repo": "janedoe/nuza-word-goal"
  }
]
```

Phase 5 adds an optional `pinned` map, `{ "<version>": { "main.js": "<sha256>", ... } }`,
written by a bot (see [Pinned hashes](#later-pinned-hashes)).

Alongside it:

- `removed.json`: ids taken down, with a reason. nuza shows a removed plugin as
  "Removed from the directory: <reason>" in Settings and offers to uninstall it. It does
  not delete anything by itself.
- `GUIDELINES.md`: the review checklist below, written for authors.
- `.github/PULL_REQUEST_TEMPLATE.md`: checkboxes matching the checklist.

## Author workflow

1. **Create** a repo from `nuza-sample-plugin` ("Use this template").
2. **Develop**:
   ```bash
   bun install
   bun run dev        # esbuild --watch, writes main.js
   ```
   Link the folder into a test vault:
   `ln -s ~/code/my-plugin ~/test-vault/.nuza/plugins/my-plugin`. nuza sees the link,
   marks the plugin "linked" in Settings, and reloads it every time `main.js` changes
   (`plugins_dev_watch`). No restart, no copying.
3. **Release**:
   ```bash
   bun run version 1.0.0   # bumps manifest.json and package.json, commits, tags 1.0.0
   git push --follow-tags
   ```
   The template's GitHub Action builds on tag and creates a release with `manifest.json`,
   `main.js` and `styles.css` attached. The tag is the bare version, no `v` prefix.
4. **Submit**: open a PR to `nuza-plugins` adding one entry to `plugins.json`.
5. **Update**: tag a new release. Nothing in the registry changes; nuza finds new
   versions from the repo's latest release.

## The template repo

```
nuza-sample-plugin/
  manifest.json
  package.json          devDependencies: @nuza/plugin-api, esbuild, typescript
  esbuild.config.mjs
  src/main.ts           a command, a status bar item, a settings tab
  styles.css
  version.mjs           the `bun run version` script
  .github/workflows/release.yml
  README.md             the five steps above
```

`esbuild.config.mjs`, the part that matters:

```js
import esbuild from "esbuild";

const shared = [
  "nuza",
  "@codemirror/state",
  "@codemirror/view",
  "@codemirror/language",
  "@codemirror/commands",
  "@codemirror/search",
  "@codemirror/autocomplete",
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/markdown",
];

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  target: "es2022",
  external: shared,
  outfile: "main.js",
  banner: { js: "nuza.registerPlugin(function (require, module, exports) {" },
  footer: { js: "});" },
  minify: process.argv.includes("--production"),
  sourcemap: process.argv.includes("--production") ? false : "inline",
});
```

`target: es2022` matches the WebKit nuza supports on macOS (check against the oldest
macOS in `tauri.conf.json`'s bundle settings before publishing the template).

## `@nuza/plugin-api`

- Types only: `index.d.ts` with everything in [03-plugin-api.md](03-plugin-api.md),
  re-exporting the CodeMirror types it mentions from peer dependencies pinned to nuza's
  versions.
- Generated from a source of truth in the nuza repo, `src/lib/plugins/api/public.d.ts`,
  by a script in `scripts/`, so the published types and the runtime cannot drift. A test
  in nuza type-checks the runtime against `public.d.ts`.
- Docs: TypeDoc output published to GitHub Pages, plus a hand-written guide page on
  nuza-website ("Write a plugin") linking to it.

## Validation CI

A GitHub Action on every PR to `nuza-plugins`, written in TypeScript and run with bun:

1. `plugins.json` parses, is sorted by id, and the PR changes at most one entry (new
   plugins) or only fields of an existing entry made by that plugin's author.
2. The entry: `id` matches the manifest rules from [03](03-plugin-api.md#the-manifest),
   is unique, not in `removed.json`; `repo` exists and is public.
3. The repo's latest release exists, its tag equals `manifest.version`, and it has
   `manifest.json` and `main.js` attached.
4. The release's `manifest.json` passes validation and its `id`, `name`, `author` and
   `description` match the entry.
5. `main.js` starts with the template's banner, is under the size cap, and parses.
6. Static flags for the reviewer (not failures): uses of `eval`, `new Function`,
   `innerHTML` with non-literal strings, `document.write`, `require("child_process")` or
   any Node module name, `fetch(`/`XMLHttpRequest` (blocked by CSP anyway), obfuscated
   code (very long lines with high entropy), and `localStorage` (should be `saveData`).

The CI posts a summary comment with what it checked and what it flagged.

## Review checklist

What a human checks before merging. Written up for authors in `GUIDELINES.md`.

- The plugin does what its description says, and nothing it does not say.
- Everything is registered through `this.*` so it is undone on unload: no bare
  `addEventListener`, `setInterval` or `app.vault.on` without `register*`.
- No monkey-patching of nuza or CodeMirror internals; no reaching into the DOM outside
  the plugin's own elements beyond adding a class.
- No `innerHTML` with note or user content. Use `textContent` or `createEl`.
- Styles are scoped under a class with the plugin id; no global selectors that restyle
  nuza.
- No default shortcuts unless the command is the plugin's whole point.
- No telemetry, no network access without the `network` permission and a description
  of where data goes in the README.
- Source matches the release: the reviewer rebuilds from the tag and diffs `main.js`
  (the template's build is reproducible with a locked esbuild version).
- Name and id do not contain "nuza", and the plugin does not pretend to be built in.

## In the app

The **Community plugins** settings tab (`src/components/settings/PluginSettings.tsx`):

- **Off state**: one paragraph on what plugins can do (full access to notes and files),
  and a "Turn on community plugins" button. Off by default for every vault.
- **Installed**: a row per plugin with name, version, author, description, a toggle,
  and a menu (Settings if it added a tab, Reload, Open folder, Uninstall). Problems show
  in the row: "Needs nuza 3.2 or newer", "Failed to load: <message>", "Slow to start
  (1.2 s)", "Removed from the directory: <reason>".
- **Updates**: "3 updates" with Update all, checked on opening the tab and once a day.
  nuza never updates a plugin without being asked, in v1.
- **Browse** button: opens the browse view, a lazy chunk (`React.lazy`, as other heavy
  panels are), so it costs nothing until opened.

The **browse view** (`src/components/plugins/PluginBrowser.tsx`): search over name,
author and description; a detail pane with the README from the repo (fetched through
Rust, rendered with the app's own markdown sanitiser in `src/lib/markdown/sanitize.ts`),
version, last release date, a link to the repo; Install / Installed / Update buttons.
The README is shown as text and images only: no scripts, no iframes, links open in the
browser.

Download counts and sorting by popularity are phase 5+: a Worker can sum
`download_count` across release assets daily and publish `stats.json` beside the
registry.

## Later: pinned hashes

Phase 5 tightens what "reviewed" means. A bot in `nuza-plugins` watches listed repos for
new releases and opens a PR adding the new version's SHA-256s to `pinned`. A maintainer
merges after a lighter review of the diff between versions. nuza then refuses to install
a version whose files do not match a pin, and offers "unreviewed" versions only behind an
explicit "Install anyway" for plugins with no pin yet. This stops a compromised author
account from pushing code straight to every user, which the Obsidian model does not.
