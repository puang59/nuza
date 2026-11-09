# 03. The plugin API

What a plugin sees. Published as types in `@nuza/plugin-api`; the runtime behind it is
`src/lib/plugins/api/` in nuza, exposed to plugins as `require("nuza")`.

Rule for everything here: **a plugin never gets an internal object.** It gets a thin
wrapper whose shape is in this document. Internals can then be renamed and reorganised
without breaking published plugins. The two exceptions are CodeMirror's own types
(`EditorView`, `Extension`), which are already a public, stable API.

## As built in P2.3

The runtime is `src/lib/plugins/` (`api/plugin.ts`, `api/app.ts`, `api/ui.ts`,
`loader.ts`, `modules.ts`, `bridge.ts`, `paths.ts`). Where it differs from the design
below:

- `vault.files()` and `vault.exists()` are async (they ask the index in Rust).
- `vault.rename(path, newName)` renames within the same folder; moving is not in v1.
- `metadata` has `tags()` and `search()`; `frontmatter`, `backlinks`, `outgoingLinks`
  and `resolveLink` come later.
- `workspace.on` covers `active-note-change`, `editor-change` and `vault-open`; each
  listener gets the note (or null). `note-open` and `layout-change` come later.
- `ui.pick` comes later; `ui.notice`, `confirm`, `prompt` and `theme` are in.
- `vault.write` to a note with a tab goes through its editor (`useDocuments.edit`), so it
  is undoable and autosaved; to any other note it is a forced write.
- A plugin's errors are caught where nuza calls into it (commands, DOM events, footer
  items, settings panes, sidebar views, code block renderers) and reported once a minute
  per plugin. Errors inside a CodeMirror extension are left to CodeMirror, which logs
  them and disables that plugin; attributing them to a plugin is still to do.

Checked end to end in the real app with a hand-written plugin in the test vault: loaded
over `nuza-plugin://` under the real CSP, its `styles.css` applied, `require` handed it
nuza's CodeMirror and refused an unshared module, `vault.files()` and `activeNote()`
answered, a path out of the vault was refused, `saveData` wrote `data.json`, and a note
created from the terminal reached its `vault.on("create")` listener.

## The manifest

`manifest.json` in the plugin folder and attached to every release:

```json
{
  "id": "word-goal",
  "name": "Word Goal",
  "version": "1.2.0",
  "minAppVersion": "3.0.0",
  "apiVersion": 1,
  "description": "A daily word target in the status bar.",
  "author": "Jane Doe",
  "authorUrl": "https://example.com",
  "fundingUrl": "https://example.com/sponsor",
  "permissions": []
}
```

| Field           | Rule                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| `id`            | `^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$`, unique in the registry, must not contain `nuza`, equals the folder name |
| `name`          | 1 to 60 characters, must not contain "nuza"                                                                  |
| `version`       | Semver `x.y.z`, equals the GitHub release tag                                                                |
| `minAppVersion` | Semver; nuza refuses to load the plugin if older, and says so in its row                                     |
| `apiVersion`    | Integer major of the plugin API; nuza loads plugins whose `apiVersion` it supports                           |
| `description`   | 1 to 250 characters, a sentence, no "This plugin"                                                            |
| `permissions`   | Subset of `["network"]` in v1, see [06-security.md](06-security.md#network)                                  |

Validation lives in Rust (`plugins/manifest.rs`) and in the registry CI, sharing the same
rules (the CI runs a small script that mirrors them; see
[05](05-registry-and-publishing.md#validation-ci)).

## `Plugin`

```ts
export abstract class Plugin {
  readonly app: App;
  readonly manifest: PluginManifest;

  /** Set up. Everything added through `this` is undone on unload. */
  onload(): void | Promise<void>;
  /** Extra clean-up for anything not added through `this`. */
  onunload(): void;
  /** Another window on this vault saved this plugin's data. */
  onExternalDataChange(): void;

  // Things nuza shows
  addCommand(command: Command): Command;
  addStatusBarItem(options?: { side?: "left" | "right"; label?: string }): HTMLElement;
  addSettingTab(tab: PluginSettingTab): void;
  addSidebarView(view: SidebarViewSpec): void;

  // The editor
  registerEditorExtension(extension: Extension | Extension[]): void;
  registerCodeBlockRenderer(language: string, render: CodeBlockRender): void;

  // Clean-up helpers
  registerEvent(ref: EventRef): void;
  registerDomEvent<K extends keyof WindowEventMap>(
    el: Window | Document | HTMLElement,
    type: K,
    cb: (ev: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions
  ): void;
  registerInterval(id: number): number;
  register(cleanup: () => void): void;

  // Settings storage: <vault>/.nuza/plugins/<id>/data.json
  loadData<T = unknown>(): Promise<T | null>;
  saveData(data: unknown): Promise<void>;
}
```

`addStatusBarItem` returns an element the plugin fills and updates. `label` is the name
in the status bar's right-click menu; it defaults to the plugin name.

## `Command`

```ts
export interface Command {
  id: string; // registered as "<plugin-id>:<id>"
  name: string; // palette shows "<Plugin name>: <name>"
  /** Optional, and discouraged: users choose their own. Never overrides a core chord. */
  defaultBinding?: string;
  /** Runs anywhere. */
  run?(): void | Promise<void>;
  /** Runs only with a note open; hidden from the palette otherwise. */
  editorRun?(editor: Editor, note: NoteRef): void | Promise<void>;
  /** Return false to hide the command right now. */
  when?(): boolean;
}
```

Exactly one of `run` or `editorRun` is required. The plugin's `id` prefix is added by the
host, so two plugins can both have a `"insert"` command.

## `App`

```ts
export interface App {
  readonly version: string; // nuza's version
  readonly platform: "macos" | "windows" | "linux";
  readonly vault: Vault;
  readonly workspace: Workspace;
  readonly metadata: Metadata;
  readonly ui: Ui;
}
```

### `Vault`

Backed by the existing Rust commands (`files::read_file`, `files::write_file`,
`files::create_note`, `files::rename_entry`, `files::delete_entry`, `search::list_files`),
which already refuse paths outside the vault. Paths are vault-relative with `/`
separators; the wrapper converts.

```ts
export interface Vault {
  readonly name: string;
  /** Every note and file, vault-relative, from the in-memory file index. */
  files(): readonly FileRef[];
  read(path: string): Promise<string>;
  /** Writes through nuza's atomic save; an open tab of that note updates. */
  write(path: string, text: string): Promise<void>;
  /** Read, change and write in one step against the open editor if the note is open. */
  process(path: string, change: (text: string) => string): Promise<string>;
  create(path: string, text?: string): Promise<FileRef>;
  createFolder(path: string): Promise<void>;
  rename(path: string, to: string): Promise<void>;
  /** To the system trash, as deleting in the sidebar does. */
  trash(path: string): Promise<void>;
  exists(path: string): boolean;
  on(event: "create" | "modify" | "delete", cb: (file: FileRef) => void): EventRef;
  on(event: "rename", cb: (file: FileRef, from: string) => void): EventRef;
}
export interface FileRef {
  path: string;
  name: string;
  extension: string;
  isFolder: boolean;
}
```

`write` on a note that is open in a tab goes through the editor instead (a transaction
replacing the document) so the undo history, dirty state and recovery file stay right.
This is the same path the AI panel's accepted edits take (`src/lib/ai/proposals.ts`),
and should reuse it.

`.nuza/` is not visible through `files()`, `read` or `write`, except a plugin's own folder
through `loadData`/`saveData`.

### `Workspace`

```ts
export interface Workspace {
  /** The note in the focused pane, if any. */
  activeNote(): NoteRef | null;
  activeEditor(): Editor | null;
  openNote(path: string, options?: { split?: boolean; newWindow?: boolean; heading?: string }): Promise<void>;
  on(event: "active-note-change", cb: (note: NoteRef | null) => void): EventRef;
  on(event: "note-open", cb: (note: NoteRef) => void): EventRef;
  on(event: "editor-change", cb: (editor: Editor, note: NoteRef) => void): EventRef;
  on(event: "layout-change", cb: () => void): EventRef;
}
export interface NoteRef {
  path: string;
  name: string;
}
export interface Editor {
  /** The live CodeMirror view. Use transactions; do not replace its state. */
  readonly view: EditorView;
  text(): string;
  selection(): { from: number; to: number; text: string };
  replaceSelection(text: string): void;
  insert(at: number, text: string): void;
}
```

### `Metadata`

Read-only views of what nuza already indexes in Rust (`src-tauri/src/index.rs`,
`tags.rs`, `wiki.rs`) and the frontmatter parser in `src/lib/markdown/frontmatter.ts`.

```ts
export interface Metadata {
  frontmatter(path: string): Promise<Record<string, unknown> | null>;
  tags(): Promise<{ tag: string; count: number }[]>;
  notesWithTag(tag: string): Promise<string[]>;
  backlinks(path: string): Promise<string[]>;
  outgoingLinks(path: string): Promise<string[]>;
  resolveLink(target: string, from: string): string | null;
  search(query: string, options?: { regex?: boolean; limit?: number }): Promise<SearchHit[]>;
}
```

### `Ui`

```ts
export interface Ui {
  notice(message: string, options?: { timeout?: number }): void; // src/lib/notices.ts
  confirm(options: { title: string; body?: string; confirm?: string; danger?: boolean }): Promise<boolean>;
  prompt(options: { title: string; placeholder?: string; value?: string }): Promise<string | null>;
  pick<T>(items: readonly T[], options: { label(item: T): string; placeholder?: string }): Promise<T | null>;
  readonly theme: "light" | "dark";
  on(event: "theme-change", cb: (theme: "light" | "dark") => void): EventRef;
}
```

`pick` reuses the quick-open palette's look (`FileSearchPalette`), so a plugin's chooser
looks like nuza's own.

Plus classes exported from `nuza`:

- `Modal`: `open()`, `close()`, `onOpen()`, `onClose()`, `titleEl`, `contentEl`; drawn
  in the same shell as `ConfirmDeleteModal`.
- `PluginSettingTab`: `display(containerEl)`, `hide()`, `name`.
- `Setting`: builder for one row that matches `SettingRow.tsx`:
  `new Setting(el).setName().setDesc().addToggle(...).addText(...).addDropdown(...).addButton(...)`.
- `Notice`: same as `ui.notice` for authors used to Obsidian.

These render with nuza's own CSS variables (the `--nuza-*` tokens in `src/App.css`:
`--nuza-bg`, `--nuza-fg`, `--nuza-muted`, `--nuza-surface`, `--nuza-hairline`,
`--nuza-accent` and its `-strong`, `-wash`, `-faint` variants, among others). The ones
listed in the API docs are part of the contract, so plugin styles can follow the user's
theme and accent colour; any other variable can change without notice.

## Code block renderers

```ts
export type CodeBlockRender = (
  source: string,
  el: HTMLElement,
  ctx: { note: NoteRef; language: string; theme: "light" | "dark" }
) => void | (() => void) | Promise<void>;
```

Called when the block is shown in live preview and not being edited (see
[02](02-host-registries.md#6-fenced-code-block-renderers)). A returned function is called
when the block is removed or re-rendered. One renderer per language; a second plugin
asking for the same language is refused with a notice naming both. Plugins cannot claim
`mermaid` or `math`.

## Events

`EventRef` is an opaque object. `this.registerEvent(app.vault.on(...))` is the pattern
that removes the listener on unload; the review checklist rejects plugins that call
`on()` without it.

## Versioning

- `apiVersion` is an integer. nuza 3.x supports `1`.
- Additions (new methods, new optional fields, new events) are minor releases of
  `@nuza/plugin-api` and need no `apiVersion` change. A plugin using a new method sets
  `minAppVersion` to the first nuza that has it.
- Removing or changing anything is `apiVersion: 2`. nuza then supports `1` and `2` side by
  side for at least one major release, with a deprecation notice in the plugin's row.
- CodeMirror major upgrades count as an API major, since `Extension` is part of the API.
- Every API member has a `@since` tag with the nuza version, generated into the docs.
