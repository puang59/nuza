import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import type { EditorView } from "@codemirror/view";
import { isMacPlatform, isLinuxPlatform } from "@/lib/platform";
import { events } from "@/lib/registries/events";
import type { Disposable } from "@/lib/registries/registry";
import { host } from "../bridge";
import { baseName, parentOf, toAbsolute, toRelative } from "../paths";
import { confirm, Notice, prompt } from "./ui";

/** A file in the vault, by its path relative to the vault. */
export interface FileRef {
  path: string;
  name: string;
  extension: string;
}

/** A note, by its path relative to the vault. */
export interface NoteRef {
  path: string;
  name: string;
}

/** The editor a note is open in. */
export interface Editor {
  /** The live CodeMirror view. Change it with transactions; never replace its state. */
  readonly view: EditorView;
  text(): string;
  selection(): { from: number; to: number; text: string };
  replaceSelection(text: string): void;
  insert(at: number, text: string): void;
}

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

function root() {
  const folder = host().root();
  if (!folder) throw new Error("No folder is open");
  return folder;
}

function fileRef(path: string): FileRef {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return { path, name, extension: dot > 0 ? name.slice(dot + 1).toLowerCase() : "" };
}

function noteRef(full: string | null): NoteRef | null {
  const folder = host().root();
  const path = full && folder ? toRelative(folder, full) : null;
  return path ? { path, name: baseName(path) } : null;
}

function editorOf(view: EditorView): Editor {
  return {
    view,
    text: () => view.state.doc.toString(),
    selection() {
      const { from, to } = view.state.selection.main;
      return { from, to, text: view.state.sliceDoc(from, to) };
    },
    replaceSelection(text) {
      view.dispatch(view.state.replaceSelection(text));
    },
    insert(at, text) {
      view.dispatch({ changes: { from: at, insert: text } });
    },
  };
}

async function listed(): Promise<FileRef[]> {
  const folder = root();
  const entries = await invoke<FileEntry[]>("list_files");
  return entries.flatMap((entry) => {
    if (entry.isDirectory) return [];
    const path = toRelative(folder, entry.path);
    return path ? [fileRef(path)] : [];
  });
}

async function read(path: string): Promise<string> {
  const full = toAbsolute(root(), path);
  if (host().isOpen(full)) return host().readOpen(full);
  return invoke<string>("read_file", { path: full });
}

async function write(path: string, text: string): Promise<void> {
  const full = toAbsolute(root(), path);
  // A note with a tab is changed in its editor, so its undo, its unsaved mark
  // and the autosave all hold; written to disk under it, it would come back
  // as a conflict with what the tab shows.
  if (host().isOpen(full) && host().editOpen(full, text)) return;
  // Nothing holds it, so there is nothing for a forced write to overrule.
  await invoke("write_file", { path: full, content: text, force: true });
}

type VaultEvent = "create" | "modify" | "delete";

function onVault(event: VaultEvent | "rename", listener: (file: FileRef, from?: string) => void): Disposable {
  return events.on("vault-change", (change) => {
    if (change.kind !== event) return;
    const folder = host().root();
    const path = folder ? toRelative(folder, change.path) : null;
    if (!path) return;
    const from = change.from && folder ? (toRelative(folder, change.from) ?? undefined) : undefined;
    listener(fileRef(path), from);
  });
}

/** Listens for files in the vault appearing, changing, going, or being renamed. */
function vaultOn(event: VaultEvent, listener: (file: FileRef) => void): Disposable;
function vaultOn(event: "rename", listener: (file: FileRef, from: string) => void): Disposable;
function vaultOn(event: VaultEvent | "rename", listener: (file: FileRef, from: string) => void): Disposable {
  return onVault(event, (file, from) => listener(file, from ?? ""));
}

function theme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

let version = "";
void getVersion()
  .then((found) => (version = found))
  .catch(() => {});

/** Everything a plugin reaches nuza through. One for the window, shared by every plugin. */
export const app = {
  get version() {
    return version;
  },
  platform: (isMacPlatform() ? "macos" : isLinuxPlatform() ? "linux" : "windows") as
    "macos" | "windows" | "linux",

  vault: {
    get name() {
      const folder = host().root();
      return folder ? baseName(folder) : "";
    },
    /** Every file in the vault, outside its tools' folders. */
    files: listed,
    read,
    write,
    /** Reads a note, changes it, and writes it back; returns what was written. */
    async process(path: string, change: (text: string) => string) {
      const next = change(await read(path));
      await write(path, next);
      return next;
    },
    /** Makes a new note, and any folders on the way to it. Refuses one that is there already. */
    async create(path: string, text = ""): Promise<FileRef> {
      toAbsolute(root(), path);
      const made = await invoke<string>("create_note", { path, content: text });
      return fileRef(toRelative(root(), made) ?? path);
    },
    async createFolder(path: string) {
      const full = toAbsolute(root(), path);
      await host().createFolder(parentOf(full), baseName(full));
    },
    /** Gives a file or folder a new name, in the same folder. */
    async rename(path: string, newName: string) {
      if (/[\\/]/.test(newName)) throw new Error("A new name can't contain a folder");
      await host().rename(toAbsolute(root(), path), newName);
    },
    /** To the system's trash, as deleting from the sidebar does. */
    async trash(path: string) {
      await host().trash(toAbsolute(root(), path));
    },
    async exists(path: string) {
      return (await listed()).some((file) => file.path === path);
    },
    on: vaultOn,
  },

  workspace: {
    activeNote: (): NoteRef | null => noteRef(host().activePath()),
    activeEditor(): Editor | null {
      const view = host().activeView();
      return view ? editorOf(view) : null;
    },
    async openNote(path: string, options: { split?: boolean } = {}) {
      await host().openNote(toAbsolute(root(), path), options);
    },
    on(
      event: "active-note-change" | "editor-change" | "vault-open",
      listener: (note: NoteRef | null) => void
    ): Disposable {
      if (event === "vault-open") return events.on("vault-open", () => listener(null));
      return events.on(event, ({ path }) => listener(noteRef(path)));
    },
  },

  metadata: {
    /** Every `#tag` in the vault, and how many times it is used. */
    async tags(): Promise<{ tag: string; count: number }[]> {
      const found = await invoke<{ tag: string }[]>("list_tags");
      const counts = new Map<string, number>();
      for (const { tag } of found) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      return [...counts].map(([tag, count]) => ({ tag, count }));
    },
    /** Lines in the vault's notes that hold `query`. */
    async search(query: string, options: { regex?: boolean; limit?: number } = {}) {
      const folder = root();
      const hits = await invoke<{ path: string; line: number; preview: string }[]>("search_contents", {
        query,
        pattern: options.regex ?? false,
      });
      return hits.slice(0, options.limit ?? hits.length).flatMap(({ path, line, preview }) => {
        const inside = toRelative(folder, path);
        return inside ? [{ path: inside, line, preview }] : [];
      });
    },
  },

  ui: {
    notice: (message: string) => void new Notice(message),
    confirm,
    prompt,
    get theme() {
      return theme();
    },
  },
};

export type App = typeof app;
