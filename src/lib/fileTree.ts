import { FileEntry } from "./types";

/**
 * The file tree, edited in place.
 *
 * Creating or renaming a note changes one row in a vault that may hold
 * thousands, so the tree is patched where it changed rather than read back off
 * disk - a re-read costs a walk of every directory and a fresh copy of the
 * whole tree across the process boundary, for a result that differs in one
 * entry.
 *
 * The tree is read a folder at a time: a folder with no `children` has not been
 * read yet, which is not the same as one with nothing in it. An edit under a
 * folder that has not been read is left alone - the folder will show it when it
 * is read, which is when somebody asks to see inside it.
 */

/** The separator the host is already using, inferred from the path itself. */
function separatorFor(path: string) {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

function lastSeparator(path: string) {
  return Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
}

/** The directory part of a path, for either separator style. */
export function parentOf(path: string) {
  const index = lastSeparator(path);
  return index < 0 ? "" : path.slice(0, index);
}

/** The final segment of a path, for either separator style. */
export function nameOf(path: string) {
  return path.slice(lastSeparator(path) + 1);
}

export function joinPath(parent: string, name: string) {
  return `${parent}${separatorFor(parent)}${name}`;
}

/** True if `path` is `ancestor` itself, or lives somewhere underneath it. */
function isWithin(path: string, ancestor: string) {
  return path === ancestor || path.startsWith(ancestor + "/") || path.startsWith(ancestor + "\\");
}

/** Directories first, then by name - the order the backend hands the tree over in. */
function inOrder(entries: FileEntry[]) {
  return entries.slice().sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    const left = a.name.toLowerCase();
    const right = b.name.toLowerCase();
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/**
 * Replaces the children of the directory at `path`. Only the branch leading to
 * it is rebuilt; every other subtree is carried over by reference, so a change
 * deep in the tree leaves the rest of it untouched for React to skip over.
 * A directory that has not been read is not changed, and nor is anything
 * below it - there is nothing of it here to change.
 */
function updateDirectory(
  nodes: FileEntry[],
  path: string,
  change: (children: FileEntry[]) => FileEntry[]
): FileEntry[] {
  return nodes.map((node) => {
    if (!node.isDirectory || !node.children || !isWithin(path, node.path)) return node;
    if (node.path === path) return { ...node, children: change(node.children) };
    return { ...node, children: updateDirectory(node.children, path, change) };
  });
}

/**
 * Fills in the folder at `path` with what was read of it - the folder opened
 * for the first time, or opened again to look for what it could not answer for.
 */
export function setChildren(tree: FileEntry[], rootPath: string, path: string, children: FileEntry[]) {
  if (path === rootPath) return children;
  const update = (nodes: FileEntry[]): FileEntry[] =>
    nodes.map((node) => {
      if (!node.isDirectory || !isWithin(path, node.path)) return node;
      if (node.path === path) return { ...node, children };
      return node.children ? { ...node, children: update(node.children) } : node;
    });
  return update(tree);
}

/** Whether two rows say the same thing about the same entry, whatever is inside it. */
function sameRow(a: FileEntry, b: FileEntry) {
  return (
    a.path === b.path &&
    a.name === b.name &&
    a.isDirectory === b.isDirectory &&
    a.modified === b.modified &&
    a.created === b.created &&
    !!a.unavailable === !!b.unavailable
  );
}

/**
 * A folder's rows as they are now on disk (`listed`), laid over the rows the
 * tree had for it: what is new comes in, what is gone goes, and a folder that
 * had already been read keeps what was read of it - a fresh listing never
 * looks inside the folders it lists, and taking it as it is would fold every
 * one of them shut.
 *
 * Rows that have not changed are handed back as the same objects, and a
 * listing that changes nothing as the same array, so a refresh that found
 * nothing new redraws nothing.
 */
export function mergeListing(had: FileEntry[], listed: FileEntry[]): FileEntry[] {
  const before = new Map(had.map((entry) => [entry.path, entry]));

  const merged = listed.map((entry) => {
    const old = before.get(entry.path);
    if (!old) return entry;
    if (sameRow(old, entry)) return old;
    return entry.isDirectory && old.isDirectory && old.children
      ? { ...entry, children: old.children }
      : entry;
  });

  const unchanged = merged.length === had.length && merged.every((entry, index) => entry === had[index]);
  return unchanged ? had : merged;
}

/** The folders of `tree` that have been read, parents before what is inside them. */
export function readFolders(tree: FileEntry[]): string[] {
  const paths: string[] = [];
  const collect = (entries: FileEntry[]) => {
    for (const entry of entries) {
      if (!entry.isDirectory || !entry.children) continue;
      paths.push(entry.path);
      collect(entry.children);
    }
  };
  collect(tree);
  return paths;
}

/** Whether a folder has been read, or only listed. */
export function isRead(entry: FileEntry) {
  return !!entry.children;
}

/** Whether any row of a folder's own is one the filesystem could not answer for. */
export function hasUnavailable(entry: FileEntry) {
  return !!entry.children?.some((child) => child.unavailable);
}

/** The entry at `path`, or null if the tree has no such row. */
export function findEntry(nodes: FileEntry[], path: string): FileEntry | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.isDirectory && node.children && isWithin(path, node.path)) {
      const found = findEntry(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

/** Adds `entry` to the tree, under whichever directory its path names. */
export function addEntry(tree: FileEntry[], rootPath: string, entry: FileEntry): FileEntry[] {
  const parent = parentOf(entry.path);
  const insert = (children: FileEntry[]) => inOrder([...children, entry]);
  return parent === rootPath ? insert(tree) : updateDirectory(tree, parent, insert);
}

/** Drops the entry at `path`, and everything underneath it, from the tree. */
export function removeEntry(tree: FileEntry[], rootPath: string, path: string): FileEntry[] {
  const parent = parentOf(path);
  const drop = (children: FileEntry[]) => children.filter((child) => child.path !== path);
  return parent === rootPath ? drop(tree) : updateDirectory(tree, parent, drop);
}

/** Rewrites an entry's own path, and its descendants', after it has moved. */
function relocate(entry: FileEntry, from: string, to: string): FileEntry {
  const path = entry.path === from ? to : to + entry.path.slice(from.length);
  return {
    ...entry,
    path,
    name: nameOf(path),
    children: entry.children?.map((child) => relocate(child, from, to)),
  };
}

/** Moves the entry at `path` to `newPath`, covering renames as well as drags. */
export function moveEntry(tree: FileEntry[], rootPath: string, path: string, newPath: string): FileEntry[] {
  const entry = findEntry(tree, path);
  if (!entry) return tree;
  return addEntry(removeEntry(tree, rootPath, path), rootPath, relocate(entry, path, newPath));
}

/**
 * Makes sure the tree has a row for the directory at `path`, adding it - and
 * any missing directory above it - if it does not. Used when a file lands
 * somewhere the sidebar has never shown, such as a `media` folder created on
 * the first paste.
 */
export function ensureDirectory(tree: FileEntry[], rootPath: string, path: string): FileEntry[] {
  if (!path || path === rootPath || findEntry(tree, path)) return tree;

  const parent = parentOf(path);
  const withParent = parent && parent !== rootPath ? ensureDirectory(tree, rootPath, parent) : tree;
  return addEntry(withParent, rootPath, { name: nameOf(path), path, isDirectory: true, children: [] });
}

/** Adds a file that has just been written, creating its folder if need be. */
export function addFile(tree: FileEntry[], rootPath: string, path: string): FileEntry[] {
  if (findEntry(tree, path)) return tree;
  const withFolder = ensureDirectory(tree, rootPath, parentOf(path));
  return addEntry(withFolder, rootPath, { name: nameOf(path), path, isDirectory: false });
}

/** How the sidebar orders a folder's contents. Folders always come first. */
export type SortOrder = "name" | "modified" | "created";

export const SORT_ORDERS: { id: SortOrder; label: string }[] = [
  { id: "name", label: "Name" },
  { id: "modified", label: "Date Modified" },
  { id: "created", label: "Date Created" },
];

/**
 * When an entry was changed or made, for sorting. One with no time is newer
 * than anything - it is a file the app has only just created - and a
 * creation time the filesystem does not keep falls back to the last write.
 */
function timeOf(entry: FileEntry, order: "modified" | "created") {
  const time = order === "created" ? (entry.created ?? entry.modified) : entry.modified;
  return time ?? Number.POSITIVE_INFINITY;
}

function byName(a: FileEntry, b: FileEntry) {
  const left = a.name.toLowerCase();
  const right = b.name.toLowerCase();
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The tree as the sidebar shows it: folders first, then by name, or newest
 * first by date. The tree itself stays in name order - the order every edit to
 * it keeps - so this is only ever a view of it, and for name order it is the
 * tree itself.
 */
export function sortTree(tree: FileEntry[], order: SortOrder): FileEntry[] {
  if (order === "name") return tree;

  const sort = (entries: FileEntry[]): FileEntry[] =>
    entries
      .map((entry) => (entry.children ? { ...entry, children: sort(entry.children) } : entry))
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        const newer = timeOf(b, order) - timeOf(a, order);
        return (Number.isNaN(newer) ? 0 : newer) || byName(a, b);
      });

  return sort(tree);
}

/** Marks the entry at `path` as written just now, after the app saved it. */
export function touchEntry(tree: FileEntry[], rootPath: string, path: string, at = Date.now()): FileEntry[] {
  // The same tree back for a note the sidebar does not list - the scratch
  // note above all, saved on the same timer - so nothing re-renders for it.
  if (!findEntry(tree, path)) return tree;
  const parent = parentOf(path);
  const touch = (children: FileEntry[]) =>
    children.map((child) => (child.path === path ? { ...child, modified: at } : child));
  return parent === rootPath ? touch(tree) : updateDirectory(tree, parent, touch);
}
